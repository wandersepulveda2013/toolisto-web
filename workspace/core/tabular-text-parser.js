// Parser compartido para convertir texto OCR o delimitado en una tabla editable.
// Mantiene juntos los importes con coma decimal y reconstruye etiquetas OCR con espacios.

export function parseTabularText(input) {
  const lines = String(input || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('No text content to convert');

  const delimiter = detectDelimiter(lines);
  const parsed = delimiter
    ? lines.map(line => splitDelimitedLine(line, delimiter))
    : parseWhitespaceRows(lines);
  const headers = (parsed[0] || ['Columna 1']).map((cell, index) => cell || `Columna ${index + 1}`);
  const rows = parsed.slice(1).map(row => normalizeRow(row, headers.length));

  return {
    headers,
    rows: rows.length ? rows : [headers.map(() => '')],
    delimiter: delimiter || 'whitespace',
  };
}

function detectDelimiter(lines) {
  for (const delimiter of ['\t', ';', '|']) {
    if (lines.filter(line => line.includes(delimiter)).length >= 2) return delimiter;
  }
  // Una coma entre digitos suele ser decimal en OCR español (p. ej. 1,50), no una columna.
  const commaLines = lines.filter(line => line.includes(','));
  if (commaLines.length >= 2 && commaLines.some(line => !/\d,\d/.test(line))) return ',';
  return '';
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let cell = '', quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += char; index++; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim()); cell = '';
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseWhitespaceRows(lines) {
  const header = lines[0].split(/\s+/);
  return [header, ...lines.slice(1).map(line => reconstructWhitespaceRow(line, header.length))];
}

function reconstructWhitespaceRow(line, columnCount) {
  const tokens = line.split(/\s+/).map(normalizeNumber);
  if (tokens.length <= columnCount) return tokens;
  const numericIndex = tokens.findIndex(isNumberLike);
  if (numericIndex !== -1 && columnCount >= 3) {
    const row = new Array(columnCount).fill('');
    row[0] = tokens.slice(0, numericIndex).join(' ');
    row[1] = tokens[numericIndex];
    row[columnCount - 1] = tokens.slice(numericIndex + 1).join(' ');
    return row;
  }
  return tokens.slice(0, columnCount - 1).concat(tokens.slice(columnCount - 1).join(' '));
}

function normalizeRow(row, columnCount) {
  const normalized = row.map(normalizeNumber);
  if (normalized.length > columnCount && columnCount === 2 && normalized.slice(1).every(part => /^-?[\d. ]+$/.test(part))) {
    return [normalized[0], normalized.slice(1).join(',')];
  }
  return normalized.length >= columnCount
    ? normalized.slice(0, columnCount)
    : normalized.concat(new Array(columnCount - normalized.length).fill(''));
}

function normalizeNumber(value) {
  return String(value || '').replace(/[−–—]/g, '-').replace(/(?<=\d)\s+(?=\d{3}(?:\D|$))/g, '');
}

function isNumberLike(value) {
  return /^-?(?:\d{1,3}(?:[ .]\d{3})*|\d+)(?:[,.]\d+)?%?$/.test(value);
}
