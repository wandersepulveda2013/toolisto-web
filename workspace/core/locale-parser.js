/**
 * core/locale-parser.js — Canonical locale-aware parsers for numbers, dates
 * and delimiters. All modules must use this instead of ad-hoc parsing.
 *
 * Contracts:
 *   parseLocaleNumber: returns number|null; percentages → decimal (12% → 0.12);
 *     currency prefixes/suffixes stripped; ambiguous tokens → null.
 *   detectSeparator: scoring-based over up to 10 lines; quote-aware.
 *   classifyDate: single-value classifier; ambiguous → {ambiguous:true}.
 *   inferDateFormat: column-level; uses evidence across all values.
 */

/* ── Numeric parsing ─────────────────────────────────────────── */

const CURRENCY_RE = /[\$\u00A2\u00A3\u00A5\u20AC\u20B9\u20BA\u20B1\u20B9\u0E3F\u058F\u060B\u09F3\u0FDFC\uFFE0\uFFE1\uFFE5\uFFE6]/g;
const NBSP_RE = /[\u00A0\u2007\u202F]/g;
const GROUP_BREAK_RE = /(\d)[\s\u00A0]+(?=\d{3}(?:\D|$))/g;

function stripNoise(text) {
  return text
    .replace(CURRENCY_RE, '')
    .replace(NBSP_RE, ' ')
    .trim();
}

/**
 * parseLocaleNumber(value, hints?)
 *
 * @param {*} value — raw cell value
 * @param {object} [hints] — optional column-level hints
 * @param {string} [hints.defaultDecimal] — ',' or '.' when column context is known
 * @param {boolean} [hints.isPercentColumn] — treat trailing % as division by 100
 * @returns {number|null}
 */
export function parseLocaleNumber(value, hints) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let text = String(value).trim();
  if (!text) return null;

  text = stripNoise(text);

  const negativeByParentheses = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, '');

  const hasTrailingPercent = /%\s*$/.test(text);
  text = text.replace(/%\s*$/, '');

  if (!/\d/.test(text)) return null;

  text = text.replace(/\s+/g, '');

  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');

  if (hints && hints.defaultDecimal) {
    if (hints.defaultDecimal === ',' && comma >= 0) {
      if (dot >= 0 && dot < comma) {
        text = text.replace(/\./g, '').replace(',', '.');
      } else {
        text = text.replace(/,/g, '.');
      }
    } else if (hints.defaultDecimal === '.' && dot >= 0) {
      if (comma >= 0 && comma > dot) {
        text = text.replace(/\./g, '').replace(',', '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (hints.defaultDecimal === ',' && dot >= 0) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else if (hints.defaultDecimal === '.' && comma >= 0) {
      text = text.replace(/,/g, '');
    }
  } else if (comma >= 0 && dot >= 0) {
    if (comma > dot) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (comma >= 0) {
    const groups = text.split(',');
    const lastGroup = groups.at(-1);
    const isThousandSeparator = groups.length >= 2 && /^\d{3}$/.test(lastGroup);
    text = isThousandSeparator ? groups.join('') : text.replace(',', '.');
  } else if (dot >= 0) {
    const groups = text.split('.');
    const lastGroup = groups.at(-1);
    const isThousandSeparator = groups.length >= 2 && /^\d{3}$/.test(lastGroup);
    text = isThousandSeparator ? groups.join('') : text;
  }

  const num = Number(text);
  if (!Number.isFinite(num)) return null;

  const result = negativeByParentheses ? -Math.abs(num) : num;
  return hasTrailingPercent ? result / 100 : result;
}

/**
 * Column-level numeric analysis. Given all non-empty values in a column,
 * returns a hints object that can be passed to parseLocaleNumber.
 */
export function inferNumericHints(values) {
  const samples = (values || []).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (samples.length < 1) return {};

  let commaDecimalVotes = 0;
  let dotDecimalVotes = 0;
  let hasPercent = false;

  for (const raw of samples) {
    let text = stripNoise(String(raw).trim());
    const hasPercentInSample = /%/.test(text);
    if (hasPercentInSample) hasPercent = true;
    text = text.replace(/%\s*$/, '').replace(/[()]/g, '').trim();
    if (!/\d/.test(text)) continue;

    const comma = text.lastIndexOf(',');
    const dot = text.lastIndexOf('.');

    if (comma >= 0 && dot >= 0) {
      if (comma > dot) commaDecimalVotes++;
      else dotDecimalVotes++;
    } else if (comma >= 0) {
      const parts = text.split(',');
      const lastPart = parts.at(-1);
      if (/^\d{3}$/.test(lastPart) && parts.length >= 2) {
        dotDecimalVotes++;
      } else {
        commaDecimalVotes++;
      }
    }
  }

  const hints = {};
  if (commaDecimalVotes > dotDecimalVotes) hints.defaultDecimal = ',';
  else if (dotDecimalVotes > commaDecimalVotes) hints.defaultDecimal = '.';
  if (hasPercent) hints.isPercentColumn = true;
  return hints;
}

/* ── Date classification ─────────────────────────────────────── */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_DMY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const SLASH_YMD_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const DASH_DMY_RE = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const DASH_YMD_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DOT_DMY_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

function isValidDate(day, month, year) {
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function isUnambiguousYmd(yearStr, monthStr, dayStr) {
  const y = Number(yearStr), m = Number(monthStr), d = Number(dayStr);
  if (m > 12) return true;
  if (d > 12) return true;
  return false;
}

/**
 * classifyDate(value)
 *
 * Returns:
 *   { format: 'YYYY-MM-DD', ambiguous: false }
 *   { format: 'DD/MM', ambiguous: true }  — slash/dash date, cannot tell DD/MM vs MM/DD
 *   { format: 'DD/MM', ambiguous: false } — evidence proves DD (e.g. day > 12)
 *   { format: 'MM/DD', ambiguous: false } — evidence proves MM (e.g. day > 12 in second pos)
 *   { format: 'text', ambiguous: false }  — not a date at all
 */
export function classifyDate(value) {
  if (value === null || value === undefined) return { format: 'text', ambiguous: false };
  const text = String(value).trim();
  if (!text) return { format: 'text', ambiguous: false };

  if (ISO_DATE_RE.test(text)) {
    return { format: 'YYYY-MM-DD', ambiguous: false };
  }

  let m;

  m = SLASH_YMD_RE.exec(text);
  if (m) return { format: 'YYYY/MM/DD', ambiguous: false };

  m = DASH_YMD_RE.exec(text);
  if (m) return { format: 'YYYY-MM-DD', ambiguous: false };

  m = DOT_DMY_RE.exec(text);
  if (m) return { format: 'DD.MM.YYYY', ambiguous: false };

  m = SLASH_DMY_RE.exec(text);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) return { format: 'DD/MM', ambiguous: false };
    if (b > 12 && a <= 12) return { format: 'MM/DD', ambiguous: false };
    if (a > 12 && b > 12) return { format: 'text', ambiguous: false };
    return { format: 'DD/MM', ambiguous: true };
  }

  m = DASH_DMY_RE.exec(text);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) return { format: 'DD/MM', ambiguous: false };
    if (b > 12 && a <= 12) return { format: 'MM/DD', ambiguous: false };
    if (a > 12 && b > 12) return { format: 'text', ambiguous: false };
    return { format: 'DD/MM', ambiguous: true };
  }

  return { format: 'text', ambiguous: false };
}

/**
 * inferDateFormat(values, hints?)
 *
 * Analyzes all values in a column to determine the date format.
 *
 * @param {Array} values — column values
 * @param {object} [hints] — { locale: 'es-DO' | 'en-US' | 'de-DE', defaultFormat: 'DD/MM' | 'MM/DD' }
 * @returns {{ format: string, ambiguous: boolean, confidence: number }}
 */
export function inferDateFormat(values, hints) {
  const raw = (values || []).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
  if (raw.length === 0) return { format: 'text', ambiguous: false, confidence: 0 };

  const classified = raw.map(v => classifyDate(v));
  const dateValues = classified.filter(c => c.format !== 'text');
  if (dateValues.length === 0) return { format: 'text', ambiguous: false, confidence: 0 };

  const unambiguousCount = dateValues.filter(s => !s.ambiguous).length;
  const ambiguousCount = dateValues.filter(s => s.ambiguous).length;

  if (unambiguousCount === 0 && ambiguousCount > 0) {
    const dmyStrong = raw.filter(v => {
      const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(String(v).trim());
      return m && Number(m[1]) > 12 && Number(m[2]) <= 12;
    }).length;
    const mdyStrong = raw.filter(v => {
      const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(String(v).trim());
      return m && Number(m[2]) > 12 && Number(m[1]) <= 12;
    }).length;

    if (dmyStrong > mdyStrong) return { format: 'DD/MM', ambiguous: false, confidence: dmyStrong / raw.length };
    if (mdyStrong > dmyStrong) return { format: 'MM/DD', ambiguous: false, confidence: mdyStrong / raw.length };

    if (hints?.defaultFormat) {
      return { format: hints.defaultFormat, ambiguous: false, confidence: 0.6 };
    }
    return { format: 'DD/MM', ambiguous: true, confidence: 0 };
  }

  const dmyVotes = dateValues.filter(s =>
    s.format === 'DD/MM' || s.format === 'DD.MM.YYYY'
  ).length;
  const mdyVotes = dateValues.filter(s => s.format === 'MM/DD').length;
  const isoVotes = dateValues.filter(s =>
    s.format === 'YYYY-MM-DD' || s.format === 'YYYY/MM/DD'
  ).length;

  if (dmyVotes > mdyVotes) return { format: 'DD/MM', ambiguous: false, confidence: dmyVotes / dateValues.length };
  if (mdyVotes > dmyVotes) return { format: 'MM/DD', ambiguous: false, confidence: mdyVotes / dateValues.length };
  if (isoVotes > 0) return { format: 'YYYY-MM-DD', ambiguous: false, confidence: isoVotes / dateValues.length };

  if (hints?.defaultFormat) {
    return { format: hints.defaultFormat, ambiguous: false, confidence: 0.5 };
  }

  return { format: 'DD/MM', ambiguous: true, confidence: 0 };
}

/* ── Separator / delimiter detection ─────────────────────────── */

/**
 * detectSeparator(text, options?)
 *
 * Score-based, quote-aware delimiter detection over up to 10 meaningful lines.
 *
 * @param {string} text — raw text content
 * @param {object} [options]
 * @param {number} [options.maxLines=10] — max lines to sample
 * @returns {string} — detected delimiter or '' for whitespace
 */
export function detectSeparator(text, options) {
  const maxLines = options?.maxLines || 10;
  const allLines = String(text || '').split(/\r?\n/).filter(l => l.trim().length > 0);
  const lines = allLines.slice(0, maxLines);
  if (lines.length < 2) return '';

  const candidates = [',', ';', '\t', '|'];
  const scores = {};

  for (const sep of candidates) {
    let score = 0;
    const fieldCounts = [];
    const totalOutside = [];

    for (const line of lines) {
      let inQuote = false;
      let fields = 1;
      let outsideCount = 0;

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuote = !inQuote;
        } else if (ch === sep) {
          if (!inQuote) {
            outsideCount++;
            fields++;
          }
        }
      }

      fieldCounts.push(fields);
      totalOutside.push(outsideCount);
    }

    const sumOutside = totalOutside.reduce((a, b) => a + b, 0);
    if (sumOutside === 0) { scores[sep] = -1; continue; }

    score = sumOutside;

    const first = fieldCounts[0];
    const consistent = fieldCounts.every(c => c === first);
    if (consistent) score += 3;
    else {
      const variance = Math.max(...fieldCounts) - Math.min(...fieldCounts);
      score += Math.max(0, 3 - variance);
    }

    if (sep === ',') {
      const allBetweenDigits = lines.every(line => {
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') inQ = !inQ;
          else if (ch === ',' && !inQ) {
            const prev = line[i - 1] || '';
            const next = line[i + 1] || '';
            if (!/\d/.test(prev) || !/\d/.test(next)) return false;
          }
        }
        return true;
      });
      if (allBetweenDigits && sumOutside < lines.length) score -= 4;
    }

    scores[sep] = score;
  }

  let bestSep = '';
  let bestScore = 0;
  for (const sep of candidates) {
    if ((scores[sep] || 0) > bestScore) {
      bestScore = scores[sep];
      bestSep = sep;
    }
  }

  return bestScore > 0 ? bestSep : '';
}
