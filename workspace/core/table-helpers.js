/**
 * core/table-helpers.js — Canonical accessors for table-document objects.
 *
 * After FASE 1, all code must use these helpers instead of reading
 * top-level `headers`/`rows` directly. Legacy flat fields are treated
 * as compatibility inputs only.
 */

/**
 * Returns the active sheet from a table-document.
 * Falls back to constructing a minimal sheet from legacy flat fields.
 */
export function getActiveSheet(table) {
  if (!table) return { id: '', name: 'Sheet 1', index: 0, columns: [], rows: [] };

  if (Array.isArray(table.sheets) && table.sheets.length > 0) {
    const idx = table.activeSheetIndex || 0;
    return table.sheets[idx] || table.sheets[0];
  }

  const columns = Array.isArray(table.headers) ? table.headers : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  return { id: table.id || '', name: 'Sheet 1', index: 0, columns, rows };
}

/**
 * Returns column headers for the active sheet.
 */
export function getTableHeaders(table) {
  return getActiveSheet(table).columns || [];
}

/**
 * Returns data rows for the active sheet.
 */
export function getTableRows(table) {
  return getActiveSheet(table).rows || [];
}

/**
 * Returns column headers (alias for getTableHeaders).
 * For clarity in pipeline code.
 */
export function getTableColumns(table) {
  return getTableHeaders(table);
}
