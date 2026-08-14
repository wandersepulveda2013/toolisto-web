const FIELD_DEFINITIONS = [
  {
    key: 'invoiceNumber',
    label: 'Número de factura',
    pattern: /^(?:factura(?:\s*(?:n[º°o.]?|no\.?|número|number|#))?|invoice(?:\s*(?:n[º°o.]?|no\.?|number|#))?|n[úu]mero\s+de\s+factura)\s*[:#-]?\s*(.*)$/i,
    clean: value => value.replace(/^(?:electr[oó]nica|electronic)\b[\s:#-]*/i, ''),
  },
  {
    key: 'issueDate',
    label: 'Fecha de emisión',
    pattern: /^(?:fecha(?:\s+de\s+(?:emisi[oó]n|factura))?|emisi[oó]n|issue\s+date|date)\s*[:#-]?\s*(.*)$/i,
  },
  {
    key: 'dueDate',
    label: 'Fecha de vencimiento',
    pattern: /^(?:fecha\s+de\s+vencimiento|vencimiento|due\s+date|payment\s+due)\s*[:#-]?\s*(.*)$/i,
  },
  {
    key: 'supplier',
    label: 'Proveedor / emisor',
    pattern: /^(?:proveedor|vendedor|emisor|supplier|vendor|from)\s*[:#-]?\s*(.*)$/i,
  },
  {
    key: 'taxId',
    label: 'Identificación fiscal',
    pattern: /^(?:rnc|nif|cif|nit|rut|tax\s*id|vat\s*id|identificaci[oó]n\s*fiscal)\s*[:#-]?\s*(.*)$/i,
  },
  {
    key: 'customer',
    label: 'Cliente / receptor',
    pattern: /^(?:cliente|comprador|receptor|facturar\s+a|customer|bill\s+to|sold\s+to)\s*[:#-]?\s*(.*)$/i,
  },
  {
    key: 'subtotal',
    label: 'Subtotal',
    pattern: /^(?:subtotal|base\s+imponible|net\s+amount|net\s+total)\s*[:#-]?\s*(.*)$/i,
    amount: true,
  },
  {
    key: 'tax',
    label: 'Impuestos / IVA',
    pattern: /^(?:iva|itbis|igv|impuesto(?:s)?|tax(?:es)?|vat)\s*[:#-]?\s*(.*)$/i,
    amount: true,
  },
  {
    key: 'total',
    label: 'Total',
    pattern: /^(?:(?:total\s+(?:a\s+pagar|factura|due|amount))|importe\s+total|monto\s+total|grand\s+total|amount\s+due|total)\s*[:#-]?\s*(.*)$/i,
    amount: true,
  },
  {
    key: 'currency',
    label: 'Moneda',
    pattern: /^(?:moneda|currency)\s*[:#-]?\s*(.*)$/i,
  },
  {
    key: 'paymentMethod',
    label: 'Método de pago',
    pattern: /^(?:m[eé]todo\s+de\s+pago|forma\s+de\s+pago|payment\s+method|paid\s+by)\s*[:#-]?\s*(.*)$/i,
  },
];

const FIELD_LABELS = FIELD_DEFINITIONS.map(field => field.pattern);

function normalizeInvoiceText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .split('\n')
    .map(line => line.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function cleanValue(value, field) {
  let result = String(value || '')
    .replace(/^\s*[:#-]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (field.clean) result = field.clean(result).trim();
  if (field.amount) {
    const amount = result.match(/(?:[$€£]|USD|EUR|DOP|RD\$)?\s*-?\d[\d\s.,]*/i);
    if (amount) result = amount[0].trim().replace(/\s+/g, ' ');
  }
  return result.replace(/[|;,]+$/, '').trim();
}

function isFieldLabel(line) {
  return FIELD_LABELS.some(pattern => pattern.test(line));
}

function valueFromLines(lines, field) {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(field.pattern);
    if (!match) continue;
    let value = cleanValue(match[1], field);
    if (!value && lines[index + 1] && !isFieldLabel(lines[index + 1])) {
      value = cleanValue(lines[index + 1], field);
    }
    if (value) return { value, confidence: 0.86, line: index + 1 };
  }
  return { value: '', confidence: 0, line: null };
}

function inferCurrency(text, fields) {
  if (fields.currency.value) return fields.currency;
  const symbol = text.match(/(?:\b(USD|EUR|DOP|RD\$)\b|[$€£])/i);
  if (!symbol) return { value: '', confidence: 0, line: null };
  return { value: symbol[1] || (symbol[0] === '$' ? 'USD' : symbol[0] === '€' ? 'EUR' : 'GBP'), confidence: 0.58, line: null };
}

function parseLineItems(lines) {
  const items = [];
  const headerIndex = lines.findIndex(line => /(?:descripci[oó]n|concepto|art[ií]culo|producto).*(?:cantidad|precio|importe|total)/i.test(line));
  const start = headerIndex >= 0 ? headerIndex + 1 : 0;
  const itemPattern = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(?:[$€£]|USD|EUR|DOP|RD\$)?\s*([\d.,]+)(?:\s+(?:[$€£]|USD|EUR|DOP|RD\$)?\s*([\d.,]+))?\s*$/i;
  for (let index = start; index < lines.length; index += 1) {
    if (/^(?:subtotal|iva|itbis|impuesto|total|importe|monto|tax|vat|amount\s+due)/i.test(lines[index])) break;
    const match = lines[index].match(itemPattern);
    if (!match) continue;
    items.push({
      description: match[1].trim(),
      quantity: match[2],
      unitPrice: match[3],
      amount: match[4] || match[3],
    });
  }
  return items.slice(0, 200);
}

function parseInvoiceText(text) {
  const normalizedText = normalizeInvoiceText(text);
  const lines = normalizedText.split('\n');
  const fields = {};
  FIELD_DEFINITIONS.forEach(field => {
    fields[field.key] = valueFromLines(lines, field);
  });
  fields.currency = inferCurrency(normalizedText, fields);
  const detected = FIELD_DEFINITIONS.map(field => fields[field.key]).filter(field => field.value);
  const confidence = detected.length ? Math.round((detected.reduce((sum, field) => sum + field.confidence, 0) / detected.length) * 100) : 0;
  return {
    text: normalizedText,
    fields,
    lineItems: parseLineItems(lines),
    confidence,
  };
}

function invoiceRows(parsed, page = 1) {
  return FIELD_DEFINITIONS.map(field => {
    const result = parsed.fields[field.key] || { value: '', confidence: 0, line: null };
    return [
      field.label,
      result.value || '',
      result.value ? `${Math.round(result.confidence * 100)}%` : 'Pendiente',
      result.line ? String(page) : '',
    ];
  });
}

export { FIELD_DEFINITIONS, normalizeInvoiceText, parseInvoiceText, invoiceRows };
