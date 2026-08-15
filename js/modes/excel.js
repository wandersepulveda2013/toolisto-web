/* Toolisto — modo hoja de cálculo (14 herramientas: csvToExcel, excelToCsv,
 * excelToJson, jsonToExcel, csvToJson, jsonToCsv, jsonToXml, mergeExcel,
 * splitExcel, compareExcel, xlsToXlsx, xlsxToOds, odsToXlsx, xmlToJson).
 * Criterio: vista tabular editable, tipos explícitos, errores por fila y
 * reapertura de salida.
 */
(function () {
  'use strict';
  var M = window.ToolistoModes;
  if (!M) return;

  var KIND = {
    csvToExcel: { in: 'csv', out: 'xlsx', multi: false, min: 1 },
    csvToJson: { in: 'csv', out: 'json', multi: false, min: 1 },
    excelToCsv: { in: 'excel', out: 'csv', multi: false, min: 1 },
    excelToJson: { in: 'excel', out: 'json', multi: false, min: 1 },
    jsonToExcel: { in: 'json', out: 'xlsx', multi: false, min: 1 },
    jsonToCsv: { in: 'json', out: 'csv', multi: false, min: 1 },
    jsonToXml: { in: 'json', out: 'xml', multi: false, min: 1 },
    mergeExcel: { in: 'excel', out: 'xlsx', multi: true, min: 1 },
    splitExcel: { in: 'excel', out: 'xlsx', multi: false, min: 1 },
    compareExcel: { in: 'excel', out: 'xlsx', multi: true, min: 2 },
    xlsToXlsx: { in: 'excel', out: 'xlsx', multi: false, min: 1 },
    xlsxToOds: { in: 'excel', out: 'ods', multi: false, min: 1 },
    odsToXlsx: { in: 'excel', out: 'xlsx', multi: false, min: 1 },
    xmlToJson: { in: 'xml', out: 'json', multi: false, min: 1 }
  };

  var TITLES = {
    csvToExcel: 'CSV a Excel', excelToCsv: 'Excel a CSV', excelToJson: 'Excel a JSON',
    jsonToExcel: 'JSON a Excel', csvToJson: 'CSV a JSON', jsonToCsv: 'JSON a CSV',
    jsonToXml: 'JSON a XML', mergeExcel: 'Unir Excel', splitExcel: 'Dividir Excel',
    compareExcel: 'Comparar Excel', xlsToXlsx: 'XLS a XLSX', xlsxToOds: 'XLSX a ODS',
    odsToXlsx: 'ODS a XLSX', xmlToJson: 'XML a JSON'
  };

  var HELP = {
    csvToExcel: 'Carga un CSV. Podrás editar los datos, revisar tipos y errores por fila antes de descargar el XLSX.',
    excelToCsv: 'Carga un Excel (XLS/XLSX/ODS). Revisa y edita la tabla antes de exportar a CSV.',
    excelToJson: 'Carga un Excel (XLS/XLSX/ODS). Revisa y edita la tabla antes de exportar a JSON.',
    jsonToExcel: 'Carga un JSON. La vista editable te permite corregir tipos y errores antes de exportar a XLSX.',
    csvToJson: 'Carga un CSV. Edita la tabla y revisa errores por fila antes de exportar a JSON.',
    jsonToCsv: 'Carga un JSON. Edita la tabla y revisa errores por fila antes de exportar a CSV.',
    jsonToXml: 'Carga un JSON. Edita la tabla y revisa errores por fila antes de exportar a XML.',
    mergeExcel: 'Carga uno o varios Excel. Se combinan todas las filas en una sola tabla editable.',
    splitExcel: 'Carga un Excel. La vista editable muestra los datos antes de dividirlos.',
    compareExcel: 'Carga al menos dos Excel. Se comparan celda por celda y se genera un informe de diferencias.',
    xlsToXlsx: 'Carga un XLS. Revisa la tabla antes de convertir a XLSX.',
    xlsxToOds: 'Carga un XLSX. Revisa la tabla antes de convertir a ODS.',
    odsToXlsx: 'Carga un ODS. Revisa la tabla antes de convertir a XLSX.',
    xmlToJson: 'Carga un XML. La vista editable te permite revisar la estructura antes de exportar a JSON.'
  };

  var ACCEPT = {
    csv: '.csv,text/csv',
    excel: '.xls,.xlsx,.ods,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    json: '.json,application/json',
    xml: '.xml,text/xml'
  };

  // Continuaciones deliberadamente cortas: cada una consume el archivo real
  // recién generado y evita volver a cargarlo desde el equipo.
  var CONTINUATIONS = {
    csvToExcel: 'excelToJson',
    csvToJson: 'jsonToExcel',
    excelToCsv: 'csvToJson',
    excelToJson: 'jsonToCsv',
    jsonToExcel: 'excelToCsv',
    jsonToCsv: 'csvToExcel',
    xmlToJson: 'jsonToExcel'
  };

  var state = { aoa: null, types: [], sheetNames: [], sheet: '', outKind: '', toolId: '', files: [] };
  var xlsxPromise = null;

  // SheetJS no debe formar parte de la descarga inicial de las 167 páginas.
  // Este modo lo necesita al cargar el primer archivo, incluso para CSV, pues
  // usa su parser y su exportador para mantener conversiones consistentes.
  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = './vendor/xlsx/xlsx.min.js';
      script.async = true;
      script.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS no estuvo disponible.')); };
      script.onerror = function () { reject(new Error('No se pudo cargar el componente de hojas de cálculo.')); };
      document.head.appendChild(script);
    }).catch(function (error) { xlsxPromise = null; throw error; });
    return xlsxPromise;
  }

  function detectType(values) {
    var hasText = false, hasNum = false;
    var seen = values.filter(function (v) { return v !== null && v !== undefined && String(v).trim() !== ''; });
    if (!seen.length) return 'texto';
    for (var i = 0; i < seen.length; i++) {
      var s = String(seen[i]).trim();
      if (/^[-+]?(\d{1,3}(\.\d{3})*|\d+)([.,]\d+)?$/.test(s) || /^[-+]?\d+(\.\d+)?$/.test(s)) hasNum = true;
      else hasText = true;
    }
    if (hasText && !hasNum) return 'texto';
    if (hasNum && !hasText) return 'numero';
    return 'texto';
  }

  function isNumberValue(s) {
    if (s === null || s === undefined) return true;
    s = String(s).trim();
    if (s === '') return true;
    return /^[-+]?(\d{1,3}(\.\d{3})*|\d+)([.,]\d+)?$/.test(s) || /^[-+]?\d+(\.\d+)?$/.test(s);
  }

  function rowErrors(row, types) {
    var errs = [];
    for (var c = 0; c < row.length; c++) {
      var v = row[c];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      if (types[c] === 'numero' && !isNumberValue(v)) errs.push('Columna ' + (c + 1) + ': se esperaba un número');
    }
    return errs;
  }

  function parseCsvText(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var sep = 'auto';
    if (sep === 'auto') {
      var firstLine = text.split('\n')[0];
      var counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
      var best = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
      sep = counts[best] > 0 ? best : ',';
    }
    var wb = XLSX.read(text, { type: 'string', raw: true, FS: sep });
    return wb;
  }

  async function fileToAoa(file, kind) {
    if (kind === 'csv') {
      var text = await file.text();
      var wb = parseCsvText(text);
      var ws = wb.Sheets[wb.SheetNames[0]];
      return { aoa: XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }), sheetNames: wb.SheetNames };
    }
    if (kind === 'json') {
      var jtext = await file.text();
      var data = JSON.parse(jtext);
      if (!Array.isArray(data)) data = [data];
      var keys = [];
      data.forEach(function (o) { if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); }); });
      var aoa = [keys];
      data.forEach(function (o) {
        aoa.push(keys.map(function (k) { return o && o[k] !== undefined ? o[k] : null; }));
      });
      return { aoa: aoa, sheetNames: [] };
    }
    if (kind === 'xml') {
      var xtext = await file.text();
      var parser = new DOMParser();
      var doc = parser.parseFromString(xtext, 'application/xml');
      var err = doc.querySelector('parsererror');
      if (err) throw new Error('XML inválido: ' + (err.textContent || '').substring(0, 120));
      var rows = Array.prototype.slice.call(doc.documentElement.children || []);
      var keys = [];
      rows.forEach(function (r) {
        Array.prototype.slice.call(r.children || []).forEach(function (ch) {
          var n = ch.nodeName;
          if (keys.indexOf(n) === -1) keys.push(n);
        });
      });
      var aoa = [keys];
      rows.forEach(function (r) {
        var map = {};
        Array.prototype.slice.call(r.children || []).forEach(function (ch) { map[ch.nodeName] = ch.textContent; });
        aoa.push(keys.map(function (k) { return map[k] !== undefined ? map[k] : null; }));
      });
      return { aoa: aoa, sheetNames: [] };
    }
    var buf = await file.arrayBuffer();
    var wb = XLSX.read(buf, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    return { aoa: XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }), sheetNames: wb.SheetNames };
  }

  function aoaToFile(aoa, outKind) {
    if (outKind === 'csv') {
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      var csv = XLSX.utils.sheet_to_csv(ws, { FS: ',' });
      return new File([csv], 'toolisto-salida.csv', { type: 'text/csv;charset=utf-8' });
    }
    if (outKind === 'json') {
      var keys = aoa[0] || [];
      var arr = [];
      for (var r = 1; r < aoa.length; r++) {
        var o = {};
        keys.forEach(function (k, c) { o[k !== null && k !== undefined ? k : 'col' + (c + 1)] = aoa[r][c] !== null && aoa[r][c] !== undefined ? aoa[r][c] : ''; });
        arr.push(o);
      }
      return new File([JSON.stringify(arr, null, 2)], 'toolisto-salida.json', { type: 'application/json;charset=utf-8' });
    }
    if (outKind === 'xml') {
      var k2 = aoa[0] || [];
      var parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<datos>'];
      for (var r2 = 1; r2 < aoa.length; r2++) {
        parts.push('  <fila>');
        k2.forEach(function (k, c) { parts.push('    <' + k + '>' + M.esc(String(aoa[r2][c] !== null && aoa[r2][c] !== undefined ? aoa[r2][c] : '')) + '</' + k + '>'); });
        parts.push('  </fila>');
      }
      parts.push('</datos>');
      return new File([parts.join('\n')], 'toolisto-salida.xml', { type: 'application/xml;charset=utf-8' });
    }
    var wsx = XLSX.utils.aoa_to_sheet(aoa);
    var wbx = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbx, wsx, 'Datos');
    var bookType = outKind === 'ods' ? 'ods' : 'xlsx';
    var ext = outKind === 'ods' ? 'ods' : 'xlsx';
    var arrOut = XLSX.write(wbx, { bookType: bookType, type: 'array' });
    return new File([arrOut], 'toolisto-salida.' + ext, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function renderGrid() {
    var box = document.getElementById('xlGrid');
    var meta = document.getElementById('xlMeta');
    var errCount = document.getElementById('xlErrCount');
    if (!box || !state.aoa) return;
    if (!state.aoa.length) { box.innerHTML = '<span class="mode-placeholder">Sin datos.</span>'; if (meta) meta.textContent = ''; if (errCount) errCount.textContent = ''; return; }

    var aoa = state.aoa;
    var colCount = 0;
    aoa.forEach(function (r) { colCount = Math.max(colCount, r.length); });
    if (state.types.length !== colCount) {
      state.types = [];
      for (var c = 0; c < colCount; c++) {
        var vals = aoa.slice(1).map(function (r) { return r[c]; });
        state.types.push(detectType(vals));
      }
    }

    var html = '<div class="xl-toolbar"><div class="xl-toolbar-left"><strong>' + TITLES[state.toolId] + '</strong><span class="xl-dim">' + (aoa.length - 1) + ' filas × ' + colCount + ' columnas</span></div><div class="xl-toolbar-right"><button class="quiet-button xl-btn" id="xlAddRow" type="button">+ Fila</button><button class="quiet-button xl-btn" id="xlAddCol" type="button">+ Columna</button></div></div>';
    html += '<div class="xl-scroll"><table class="xl-grid"><thead><tr>';
    html += '<th class="xl-rowhead">#</th>';
    for (var c2 = 0; c2 < colCount; c2++) {
      html += '<th><select class="xl-type" data-col="' + c2 + '">' +
        ['texto', 'numero', 'fecha', 'booleano'].map(function (t) {
          return '<option value="' + t + '"' + (state.types[c2] === t ? ' selected' : '') + '>' + (t === 'texto' ? 'Texto' : t === 'numero' ? 'Número' : t === 'fecha' ? 'Fecha' : 'Booleano') + '</option>';
        }).join('') +
        '</select></th>';
    }
    html += '</tr></thead><tbody>';
    for (var r = 0; r < aoa.length; r++) {
      var errs = r === 0 ? [] : rowErrors(aoa[r], state.types);
      html += '<tr class="' + (errs.length ? 'xl-row-err' : '') + '">';
      html += '<td class="xl-rowhead">' + (r === 0 ? 'H' : r) + '</td>';
      for (var c3 = 0; c3 < colCount; c3++) {
        var v = aoa[r][c3];
        html += '<td class="xl-cell" contenteditable="true" data-r="' + r + '" data-c="' + c3 + '">' + M.esc(v === null || v === undefined ? '' : String(v)) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    var errTotal = 0;
    for (var rr = 1; rr < aoa.length; rr++) errTotal += rowErrors(aoa[rr], state.types).length;
    html += '<div class="xl-errors"><span id="xlErrBadge">Errores por fila: <b class="' + (errTotal ? 'xl-err-bad' : 'xl-err-ok') + '">' + errTotal + '</b></span></div>';

    box.innerHTML = html;
    if (meta) meta.textContent = 'Tipos detectados automáticamente. Puedes editarlos desde el selector de cada columna.';
    if (errCount) errCount.textContent = errTotal ? String(errTotal) : '';

    box.querySelector('#xlAddRow').addEventListener('click', function () {
      state.aoa.push(new Array(colCount).fill(null));
      renderGrid();
    });
    box.querySelector('#xlAddCol').addEventListener('click', function () {
      state.aoa.forEach(function (r) { r.push(null); });
      state.types.push('texto');
      renderGrid();
    });
    box.querySelectorAll('.xl-type').forEach(function (sel) {
      sel.addEventListener('change', function () {
        state.types[parseInt(sel.dataset.col, 10)] = sel.value;
        renderGrid();
      });
    });
    box.querySelectorAll('.xl-cell').forEach(function (cell) {
      cell.addEventListener('blur', function () {
        var r = parseInt(cell.dataset.r, 10);
        var c = parseInt(cell.dataset.c, 10);
        if (!state.aoa[r]) state.aoa[r] = [];
        var raw = cell.textContent;
        state.aoa[r][c] = raw.trim() === '' ? null : raw;
        renderGrid();
      });
    });
  }

  async function run() {
    if (!state.aoa || !state.aoa.length) { M.toast('Carga un archivo primero.'); return; }
    var cfg = KIND[state.toolId];
    if (!cfg) { M.toast('Herramienta no disponible.'); return; }
    var btn = document.getElementById('xlRun');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>Procesando…</span>'; }
    try {
      var proc = window.ToolProcessors && window.ToolProcessors[state.toolId];
      if (!proc) throw new Error('Procesador no disponible.');
      var files;
      if (cfg.in === 'excel' && cfg.multi && state.files.length >= 2 && state.toolId === 'compareExcel') {
        files = state.files;
      } else {
        var rebuildKind = cfg.in === 'excel' ? 'xlsx' : cfg.in;
        files = [aoaToFile(state.aoa, rebuildKind)];
      }
      if (window.ToolistoEnsureDependencies) await window.ToolistoEnsureDependencies(state.toolId);
      var res = await proc(files, {}, function () {});
      if (!res || !res.files || !res.files.length) { M.toast(res && res.message ? res.message : 'No se pudo generar el resultado.'); return; }
      var f = res.files[0];
      M.downloadBlob(f.blob, f.name);
      M.toast(res.message || 'Resultado listo.');
      var reopenBtn = document.getElementById('xlReopen');
      if (reopenBtn) { reopenBtn.hidden = false; state._lastResult = f.blob; }
      var continueBtn = document.getElementById('xlContinue');
      var nextToolId = CONTINUATIONS[state.toolId];
      if (continueBtn) {
        continueBtn.hidden = !nextToolId;
        if (nextToolId) continueBtn.textContent = 'Continuar con ' + TITLES[nextToolId];
      }
    } catch (err) {
      M.toast(err && err.message ? err.message : 'No se pudo procesar.');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span>Generar y descargar</span>'; }
    }
  }

  async function reopenOutput() {
    var f = state._lastResult;
    if (!f) return;
    var kind = state.outKind === 'xlsx' || state.outKind === 'ods' ? 'excel' : state.outKind;
    try {
      var parsed = await fileToAoa(f, kind);
      state.aoa = parsed.aoa;
      state.sheetNames = parsed.sheetNames;
      state.types = [];
      renderGrid();
      var meta = document.getElementById('xlMeta');
      if (meta) meta.textContent = 'Salida reabierta y verificada.';
      M.toast('Salida reabierta correctamente.');
    } catch (err) {
      M.toast('No se pudo reabrir la salida: ' + (err && err.message ? err.message : 'error desconocido'));
    }
  }

  async function continueOutput() {
    var nextToolId = CONTINUATIONS[state.toolId];
    var result = state._lastResult;
    if (!nextToolId || !result) return;
    var next = KIND[nextToolId];
    try {
      var extension = state.outKind === 'excel' ? 'xlsx' : state.outKind;
      var output = new File([result], 'toolisto-continuacion.' + extension, { type: result.type || 'application/octet-stream' });
      var parsed = await fileToAoa(output, next.in);
      state.toolId = nextToolId;
      state.outKind = next.out;
      state.files = [output];
      state.aoa = parsed.aoa;
      state.sheetNames = parsed.sheetNames;
      state.types = [];
      state._lastResult = null;
      var input = document.getElementById('xlFile');
      if (input) {
        input.value = '';
        input.accept = ACCEPT[next.in];
        input.multiple = false;
      }
      var reopenBtn = document.getElementById('xlReopen');
      if (reopenBtn) reopenBtn.hidden = true;
      var continueBtn = document.getElementById('xlContinue');
      if (continueBtn) continueBtn.hidden = true;
      renderGrid();
      var meta = document.getElementById('xlMeta');
      if (meta) meta.textContent = 'Salida cargada localmente. Ahora puedes continuar con ' + TITLES[nextToolId] + '.';
      M.toast('Salida preparada para ' + TITLES[nextToolId] + '.');
    } catch (err) {
      M.toast('No se pudo continuar con la salida: ' + (err && err.message ? err.message : 'error desconocido'));
    }
  }

  function bindDrop(panel) {
    var input = panel.querySelector('#xlFile');
    if (!input) return;
    input.addEventListener('change', function () {
      state.files = Array.prototype.slice.call(input.files || []);
      loadFiles();
    });
  }

  async function loadFiles() {
    if (!state.files.length) return;
    var cfg = KIND[state.toolId];
    try {
      await ensureXlsx();
      var kind = cfg.in;
      if (state.files.length === 1 || state.toolId === 'mergeExcel') {
        var all = [];
        for (var i = 0; i < state.files.length; i++) {
          var parsed = await fileToAoa(state.files[i], kind);
          all.push(parsed.aoa);
        }
        var merged = [];
        if (all.length) {
          merged = all[0].slice();
          for (var m = 1; m < all.length; m++) merged = merged.concat(all[m].slice(1));
        }
        state.aoa = merged;
        state.sheetNames = [];
      } else {
        var first = await fileToAoa(state.files[0], kind);
        state.aoa = first.aoa;
        state.sheetNames = first.sheetNames;
      }
      state.types = [];
      renderGrid();
      var reopen = document.getElementById('xlReopen');
      if (reopen) reopen.hidden = true;
      var continueBtn = document.getElementById('xlContinue');
      if (continueBtn) continueBtn.hidden = true;
    } catch (err) {
      M.toast(err && err.message ? err.message : 'No se pudo leer el archivo.');
    }
  }

  function init(cfg) {
    var c = KIND[cfg.toolId];
    if (!c) return;
    state.toolId = cfg.toolId;
    state.outKind = c.out;
    state.aoa = null;
    state.types = [];
    state.files = [];
    state._lastResult = null;

    var multi = c.multi;
    var panel = M.mount([
      '<div class="mode-xls">',
      '  <p class="mode-help">' + (HELP[cfg.toolId] || '') + '</p>',
      '  <form id="xlForm" class="mode-form" novalidate>',
      '    <label class="mode-label" for="xlFile">' + (multi ? 'Archivos (' + c.min + ' o más)' : 'Archivo') + ' <span class="req">*</span></label>',
      '    <input type="file" id="xlFile" accept="' + ACCEPT[c.in] + '"' + (multi ? ' multiple' : '') + '>',
      '  </form>',
      '  <div class="xl-workspace">',
      '    <div id="xlGrid"><span class="mode-placeholder">Carga un archivo para ver la vista editable.</span></div>',
      '    <p class="mode-preview-note" id="xlMeta"></p>',
      '  </div>',
      '  <div class="calc-row">',
      '    <button class="primary-button" id="xlRun" type="button">Generar y descargar</button>',
      '    <button class="quiet-button" id="xlReopen" type="button" hidden>Reabrir salida</button>',
      '    <button class="quiet-button" id="xlContinue" type="button" hidden>Continuar</button>',
      '  </div>',
      '</div>'
    ].join(''));
    var runBtn = panel.querySelector('#xlRun');
    runBtn.addEventListener('click', run);
    panel.querySelector('#xlReopen').addEventListener('click', reopenOutput);
    panel.querySelector('#xlContinue').addEventListener('click', continueOutput);
    bindDrop(panel);
  }

  M.register({
    name: 'excel',
    toolIds: Object.keys(KIND),
    init: init
  });
})();
