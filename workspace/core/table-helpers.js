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

/*
 * CE-130: los filtros de columna del Workspace viven en `table._colFilters[ci]`
 * como objetos `Set` (workspace.js:5401). `JSON.stringify(new Set(...))` los
 * serializa como `{}` (y pierde los valores), asi que un round-trip de proyecto
 * .toolisto (export -> JSON -> import) corrompia en silencio cada filtro:
 * checksums de integridad seguian validos porque ambos lados hashean el MISMO
 * `{}`, pero la vista de tabla lanzaba `TypeError: colFilter.has is not a
 * function` al aplicar el filtro.
 *
 * Estas tres funciones cierran el hueco en las DOS direcciones:
 *   - `colFiltersToSerializable`: proyecta los `Set` como arrays (JSON-safe)
 *     para el bundle de export, SIN mutar la tabla viva.
 *   - `normalizeColFilters`: repara `_colFilters` en el import/lectura (arrays
 *     -> Set; cualquier forma invalida, p. ej. un `{}` de un export viejo, se
 *     descarta en vez de crashear).
 *   - `colFilterHas`: predicate seguro de pertenencia para el render (una forma
 *     corrupta cuenta como "sin filtro", la fila pasa).
 */

function filterToArray(f) {
  if (f instanceof Set) return [...f].sort();
  if (Array.isArray(f)) return [...f].sort();
  if (f && typeof f.has === 'function' && typeof f.values === 'function') return [...f.values()].sort();
  return null;
}

/**
 * Devuelve una copia JSON-serializable (arrays ordenados) de los filtros de
 * columna, o undefined si no hay filtros aplicables. No muta la tabla.
 */
export function colFiltersToSerializable(table) {
  const filters = table && table._colFilters;
  if (!filters || typeof filters !== 'object') return undefined;
  const out = {};
  let any = false;
  for (const key of Object.keys(filters)) {
    const asArray = filterToArray(filters[key]);
    if (asArray) { out[key] = asArray; any = true; }
  }
  return any ? out : undefined;
}

/**
 * Repara en sitio los filtros de columna de una tabla para que cada entrada sea
 * un `Set`: los arrays se convierten, los `Set` se conservan y cualquier forma
 * invalida (un `{}` tras JSON, null, tipos raros) se descarta de la columna.
 * Devuelve la tabla (encadenable).
 */
export function normalizeColFilters(table) {
  if (!table || typeof table !== 'object' || !table._colFilters || typeof table._colFilters !== 'object') return table;
  const cleaned = {};
  for (const key of Object.keys(table._colFilters)) {
    const f = table._colFilters[key];
    if (f instanceof Set) cleaned[key] = f;
    else if (Array.isArray(f)) cleaned[key] = new Set(f);
    else if (f && typeof f.has === 'function' && typeof f.values === 'function') cleaned[key] = f;
  }
  table._colFilters = cleaned;
  return table;
}

/**
 * Membresia segura de un filtro de columna (el filtro de UNA columna, no el
 * mapa completo). Devuelve true cuando no hay filtro aplicable para la columna
 * (la fila pasa) o cuando `value` pertenece al conjunto. Una forma corrupta
 * (p. ej. `{}`) cuenta como "sin filtro".
 */
export function colFilterHas(colFilter, value) {
  if (colFilter == null) return true;
  if (colFilter instanceof Set) return colFilter.has(value);
  if (Array.isArray(colFilter)) return colFilter.includes(value);
  if (typeof colFilter.has === 'function') return colFilter.has(value);
  return true;
}
