/* Toolisto — modo Estructura (listToTable, textToUnicodeBraille, txtToEpub).
 * Criterio: vista previa, corrección de estructura y salida validada.
 */
(function () {
  'use strict';
  var M = window.ToolistoModes;
  if (!M) return;

  function mountPanel(cfg, fieldsHTML, help) {
    return M.mount([
      '<div class="mode-file">',
      '  <p class="mode-help">' + (help || '') + '</p>',
      '  <label class="drop-btn-label">',
      '    <input id="modeFileInput" type="file" accept="' + (cfg.inputAccept || '*/*') + '" />',
      '    <span class="drop-btn"><b id="modeFileBtn">Seleccionar archivo</b><span class="mode-file-name" id="modeFileName">Ningún archivo seleccionado</span></span>',
      '  </label>',
      fieldsHTML || '',
      '  <div class="structure-preview" id="structurePreview"><span class="mode-placeholder">La vista previa aparece aquí.</span></div>',
      '  <div class="calc-row">',
      '    <button class="primary-button" id="modeRun" type="button" disabled>Procesar y descargar</button>',
      '  </div>',
      '</div>'
    ].join(''));
  }

  function wireCommon(cfg, fn, validate) {
    var input = document.getElementById('modeFileInput');
    var btn = document.getElementById('modeRun');
    var nameEl = document.getElementById('modeFileName');

    function fileChanged() {
      var f = input.files && input.files[0];
      if (nameEl) nameEl.textContent = f ? f.name + ' (' + M.formatBytes(f.size) + ')' : 'Ningún archivo seleccionado';
      var ok = f ? true : false;
      if (btn) btn.disabled = !ok;
      if (validate) validate(f);
    }
    input.addEventListener('change', fileChanged);
    if (btn) {
      btn.addEventListener('click', function () {
        var f = input.files && input.files[0];
        if (!f) { M.toast('Selecciona un archivo.'); return; }
        var opts = fn.readOptions ? fn.readOptions() : {};
        var proc = window.ToolProcessors && window.ToolProcessors[cfg.toolId];
        if (!proc) { M.toast('Procesador no disponible.'); return; }
        btn.disabled = true;
        btn.innerHTML = '<span>Procesando\u2026</span>';
        var ensure = window.ToolistoEnsureDependencies ? window.ToolistoEnsureDependencies(cfg.toolId) : Promise.resolve();
        ensure.then(function () { return proc([f], opts, function () {}); }).then(function (res) {
          if (!res || !res.files || !res.files.length) {
            M.toast(res && res.message ? res.message : 'No se pudo procesar.');
            return;
          }
          var out = res.files[0];
          M.downloadBlob(out.blob, out.name);
          M.toast(res.message || 'Resultado listo.');
          if (fn.afterResult) fn.afterResult(res, f);
        }).catch(function (err) {
          M.toast(err && err.message ? err.message : 'No se pudo procesar.');
        }).then(function () {
          btn.disabled = false;
          btn.innerHTML = '<span>Procesar y descargar</span>';
        });
      });
    }
    return input;
  }

  function showPreview(html) {
    var box = document.getElementById('structurePreview');
    if (!box) return;
    box.innerHTML = html || '<span class="mode-placeholder">La vista previa aparece aquí.</span>';
  }

  /* ── listToTable ─────────────────────────────────────────────────── */
  function initListToTable(cfg) {
    var panel = mountPanel(cfg, [
      '<div class="mode-form">',
      '  <label class="mode-label" for="ltDelimiter">Separador</label>',
      '  <select id="ltDelimiter"><option value="comma">Coma (,)</option><option value="semicolon">Punto y coma (;)</option><option value="tab">Tabulador</option><option value="space">Espacio</option></select>',
      '  <label class="mode-label" for="ltHeaders">Primera fila es encabezado</label>',
      '  <input id="ltHeaders" type="checkbox" />',
      '  <label class="mode-label" for="ltFormat">Formato de salida</label>',
      '  <select id="ltFormat"><option value="html">HTML</option><option value="csv">CSV</option><option value="markdown">Markdown</option></select>',
      '</div>'
    ].join(''), 'Convierte un listado o texto delimitado en una tabla ordenada.');

    wireCommon(cfg, {
      readOptions: function () {
        return {
          delimiter: document.getElementById('ltDelimiter').value,
          addHeaders: document.getElementById('ltHeaders').checked,
          outputFormat: document.getElementById('ltFormat').value
        };
      }
    }, function (file) {
      if (!file) return showPreview('');
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var delim = document.getElementById('ltDelimiter').value;
        var d = delim === 'comma' ? ',' : delim === 'semicolon' ? ';' : delim === 'tab' ? '\t' : /\s+/;
        var lines = text.split('\n').filter(function (l) { return l.trim() !== ''; });
        var rows = lines.map(function (l) { return l.split(d).map(function (c) { return c.trim(); }); });
        var maxCols = 0;
        rows.forEach(function (r) { if (r.length > maxCols) maxCols = r.length; });
        var html = '<table class="preview-table"><tbody>';
        rows.slice(0, 12).forEach(function (r) {
          html += '<tr>';
          for (var i = 0; i < maxCols; i++) html += '<td>' + M.esc(r[i] || '') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
        html += '<p class="mode-preview-note">' + rows.length + ' filas · ' + maxCols + ' columnas</p>';
        showPreview(html);
      };
      reader.readAsText(file);
    });
  }

  /* ── textToUnicodeBraille ────────────────────────────────────────── */
  function initBraille(cfg) {
    var panel = mountPanel(cfg, '', 'Convierte un archivo de texto a Braille Unicode, preservando estructura de líneas.');
    wireCommon(cfg, {}, function (file) {
      if (!file) return showPreview('');
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var braille = window.BrailleES && window.BrailleES.toBraille ? window.BrailleES.toBraille(text) : text;
        var sample = braille.split('\n').slice(0, 10).join('\n');
        showPreview('<pre class="preview-braille">' + M.esc(sample || '(vacío)') + '</pre>'
          + '<p class="mode-preview-note">' + text.length + ' caracteres convertidos · ' + braille.length + ' caracteres braille</p>');
      };
      reader.readAsText(file);
    });
  }

  /* ── txtToEpub ───────────────────────────────────────────────────── */
  function initTxtToEpub(cfg) {
    var panel = mountPanel(cfg, [
      '<div class="mode-form">',
      '  <label class="mode-label" for="epTitle">Título</label><input id="epTitle" type="text" placeholder="Título del libro" />',
      '  <label class="mode-label" for="epAuthor">Autor</label><input id="epAuthor" type="text" placeholder="Autor" />',
      '  <label class="mode-label" for="epLang">Idioma</label><select id="epLang"><option value="es">Español</option><option value="en">Inglés</option><option value="fr">Francés</option></select>',
      '  <label class="mode-label" for="epPattern">Capítulos</label>',
      '  <select id="epPattern"><option value="double-newline">Por párrafos (doble salto de línea)</option><option value="heading">Por encabezados (# Título)</option></select>',
      '</div>'
    ].join(''), 'Convierte texto plano a EPUB estructurado por capítulos.');

    wireCommon(cfg, {
      readOptions: function () {
        return {
          title: document.getElementById('epTitle').value,
          author: document.getElementById('epAuthor').value,
          language: document.getElementById('epLang').value,
          chapterPattern: document.getElementById('epPattern').value
        };
      },
      afterResult: function (res) { M.toast('EPUB generado con capítulos estructurados.'); }
    }, function (file) {
      if (!file) return showPreview('');
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var pattern = document.getElementById('epPattern').value;
        var chapters = 0;
        if (pattern === 'double-newline') {
          chapters = text.split(/\n\s*\n/).filter(function (p) { return p.trim(); }).length;
        } else if (pattern === 'heading') {
          chapters = (text.match(/^#{1,6}\s+/gm) || []).length || 1;
        } else {
          chapters = 1;
        }
        showPreview('<div class="epub-structure"><b>Estructura del EPUB:</b>'
          + '<ul><li>' + chapters + ' capítulos detectados</li>'
          + '<li>Formato: EPUB 3 (OPF + XHTML + CSS)</li>'
          + '<li>Idioma: ' + document.getElementById('epLang').value + '</li></ul></div>');
      };
      reader.readAsText(file);
    });
  }

  M.register({
    name: 'structure',
    toolIds: ['listToTable', 'textToUnicodeBraille', 'txtToEpub'],
    init: function (cfg) {
      if (cfg.toolId === 'listToTable') return initListToTable(cfg);
      if (cfg.toolId === 'textToUnicodeBraille') return initBraille(cfg);
      if (cfg.toolId === 'txtToEpub') return initTxtToEpub(cfg);
    }
  });
})();
