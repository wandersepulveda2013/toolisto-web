/* Toolisto — modo QR y códigos (qrGenerate, qrWifi, qrVcard, barcodeGenerate,
 * qrReadFromImage, barcodeReadFromImage, qrBatchFromCsv).
 * Criterio: formulario primero, vista previa en vivo, validación estándar y
 * resultado comprobado.
 */
(function () {
  'use strict';
  var M = window.ToolistoModes;
  if (!M) return;

  function buildFields(fields) {
    return fields.map(function (f) {
      var attrs = 'id="' + f.id + '" name="' + f.id + '"';
      if (f.required) attrs += ' required';
      if (f.placeholder) attrs += ' placeholder="' + M.esc(f.placeholder) + '"';
      if (f.min !== undefined) attrs += ' min="' + f.min + '"';
      if (f.step !== undefined) attrs += ' step="' + f.step + '"';
      var label = '<label class="mode-label" for="' + f.id + '">' + M.esc(f.label) + (f.required ? ' <span class="req">*</span>' : '') + '</label>';
      if (f.type === 'textarea') {
        return label + '<textarea ' + attrs + ' rows="3" spellcheck="false"></textarea>';
      }
      if (f.type === 'select') {
        var opts = f.options.map(function (o) {
          return '<option value="' + M.esc(Array.isArray(o) ? o[0] : o) + '"' + (f.value === (Array.isArray(o) ? o[0] : o) ? ' selected' : '') + '>' + M.esc(Array.isArray(o) ? o[1] : o) + '</option>';
        }).join('');
        return label + '<select ' + attrs + '>' + opts + '</select>';
      }
      return label + '<input ' + attrs + ' type="' + (f.type || 'text') + '" value="' + M.esc(f.value || '') + '" />';
    }).join('');
  }

  function readOptions(ids) {
    var opts = {};
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) opts[id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return opts;
  }

  function mountPanel(cfg, title, fields, help) {
    var panel = M.mount([
      '<div class="mode-qr">',
      '  <p class="mode-help">' + (help || '') + '</p>',
      '  <form id="qrForm" class="mode-form" novalidate>' + buildFields(fields) + '</form>',
      '  <div class="qr-preview-wrap">',
      '    <div class="qr-preview" id="qrPreview"><span class="mode-placeholder">Vista previa</span></div>',
      '    <div class="qr-preview-meta" id="qrPreviewMeta"></div>',
      '  </div>',
      '  <div class="calc-row">',
      '    <button class="primary-button" id="qrRun" type="button">Generar y descargar</button>',
      '  </div>',
      '</div>'
    ].join(''));
    return panel;
  }

  function previewCanvas(canvas, metaText) {
    var box = document.getElementById('qrPreview');
    var meta = document.getElementById('qrPreviewMeta');
    if (!box) return;
    box.innerHTML = '';
    if (!canvas) {
      box.innerHTML = '<span class="mode-placeholder">Completa el formulario para ver la vista previa.</span>';
      if (meta) meta.textContent = '';
      return;
    }
    canvas.className = 'qr-canvas';
    box.appendChild(canvas);
    if (meta) meta.textContent = metaText || '';
  }

  function downloadBlobFromResult(result, cfg) {
    if (!result || !result.files || !result.files.length) {
      M.toast(result && result.message ? result.message : 'No se pudo generar el resultado.');
      return false;
    }
    var f = result.files[0];
    M.downloadBlob(f.blob, f.name);
    M.toast(result.message || 'Resultado listo.');
    return true;
  }

  function runProcessor(cfg, options, files) {
    var proc = window.ToolProcessors && window.ToolProcessors[cfg.toolId];
    if (!proc) { M.toast('Procesador no disponible.'); return; }
    var btn = document.getElementById('qrRun');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>Procesando\u2026</span>'; }
    var ensure = window.ToolistoEnsureDependencies ? window.ToolistoEnsureDependencies(cfg.toolId) : Promise.resolve();
    ensure.then(function () { return proc(files || [], options, function () {}); }).then(function (res) {
      downloadBlobFromResult(res, cfg);
    }).catch(function (err) {
      M.toast(err && err.message ? err.message : 'No se pudo procesar.');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span>Generar y descargar</span>'; }
    });
  }

  var FORM_TOOLS = {
    qrGenerate: {
      title: 'Generar código QR',
      help: 'Ingresa el texto, URL o dato que quieres codificar.',
      fields: function () {
        return [
          { id: 'text', type: 'textarea', label: 'Texto o URL', required: true, placeholder: 'https://toolisto.app' },
          { id: 'ecLevel', type: 'select', label: 'Corrección de error', options: [['L', 'L (7%)'], ['M', 'M (15%)'], ['Q', 'Q (25%)'], ['H', 'H (30%)']], value: 'M' },
          { id: 'qrSize', type: 'number', label: 'Tamaño (px)', min: 64, value: 300 }
        ];
      },
      preview: function (opts) {
        var text = (opts.text || '').trim();
        if (!text) return null;
        return window.QRCodeGenerator.generate(text, { size: parseInt(opts.qrSize, 10) || 300, errorCorrection: opts.ecLevel || 'M' }).canvas;
      },
      meta: function (opts) { return (opts.text || '').trim().length + ' caracteres codificados'; }
    },
    qrWifi: {
      title: 'QR de Wi-Fi',
      help: 'Genera un QR que conecta dispositivos a tu red Wi-Fi sin escribir la contraseña.',
      fields: function () {
        return [
          { id: 'wifiSsid', type: 'text', label: 'Nombre de la red (SSID)', required: true, placeholder: 'MiRedWiFi' },
          { id: 'wifiPassword', type: 'text', label: 'Contraseña', placeholder: '••••••••' },
          { id: 'wifiAuth', type: 'select', label: 'Seguridad', options: [['WPA', 'WPA/WPA2'], ['WEP', 'WEP'], ['nopass', 'Abierta (sin contraseña)']], value: 'WPA' }
        ];
      },
      preview: function (opts) {
        var ssid = (opts.wifiSsid || '').trim();
        if (!ssid) return null;
        var str = 'WIFI:T:' + (opts.wifiAuth || 'WPA') + ';S:' + ssid + ';P:' + (opts.wifiPassword || '') + ';;';
        return window.QRCodeGenerator.generate(str, { size: 300, errorCorrection: 'M' }).canvas;
      },
      meta: function (opts) { return 'Red: ' + (opts.wifiSsid || '') + ' · Seguridad: ' + (opts.wifiAuth || 'WPA'); }
    },
    qrVcard: {
      title: 'QR de contacto',
      help: 'Genera un QR vCard para compartir tus datos de contacto.',
      fields: function () {
        return [
          { id: 'vcardName', type: 'text', label: 'Nombre completo', required: true, placeholder: 'María García' },
          { id: 'vcardOrg', type: 'text', label: 'Organización', placeholder: 'Toolisto' },
          { id: 'vcardPhone', type: 'text', label: 'Teléfono', placeholder: '+34 600 000 000' },
          { id: 'vcardEmail', type: 'text', label: 'Email', placeholder: 'maria@toolisto.app' }
        ];
      },
      preview: function (opts) {
        var name = (opts.vcardName || '').trim();
        if (!name) return null;
        var vcard = 'BEGIN:VCARD\nVERSION:3.0\nN:' + name + ';;;;\nFN:' + name;
        if (opts.vcardOrg) vcard += '\nORG:' + opts.vcardOrg;
        if (opts.vcardPhone) vcard += '\nTEL:' + opts.vcardPhone;
        if (opts.vcardEmail) vcard += '\nEMAIL:' + opts.vcardEmail;
        vcard += '\nEND:VCARD';
        return window.QRCodeGenerator.generate(vcard, { size: 300, errorCorrection: 'M' }).canvas;
      },
      meta: function (opts) { return 'Contacto: ' + (opts.vcardName || ''); }
    },
    barcodeGenerate: {
      title: 'Generar código de barras',
      help: 'Crea códigos de barras lineales en formato Code128, Code39, EAN y más.',
      fields: function () {
        return [
          { id: 'barcodeText', type: 'text', label: 'Contenido', required: true, placeholder: '1234567890128' },
          { id: 'barcodeFormat', type: 'select', label: 'Formato', options: [['CODE128', 'Code 128'], ['CODE39', 'Code 39'], ['EAN13', 'EAN-13'], ['EAN8', 'EAN-8'], ['UPC-A', 'UPC-A'], ['ITF', 'ITF'], ['CODABAR', 'Codabar']], value: 'CODE128' },
          { id: 'barcodeWidth', type: 'number', label: 'Ancho de barra (px)', min: 1, value: 2 },
          { id: 'barcodeHeight', type: 'number', label: 'Alto (px)', min: 20, value: 80 }
        ];
      },
      preview: function (opts) {
        var text = (opts.barcodeText || '').trim();
        if (!text) return null;
        var res = window.BarcodeGenerator.generate(text, (opts.barcodeFormat || 'CODE128').toLowerCase(), {
          width: parseInt(opts.barcodeWidth, 10) || 2,
          height: parseInt(opts.barcodeHeight, 10) || 80
        });
        return res.valid ? res.canvas : null;
      },
      meta: function (opts) { return 'Formato: ' + (opts.barcodeFormat || 'CODE128'); }
    }
  };

  function initFormTool(cfg, conf) {
    var panel = mountPanel(cfg, conf.title, conf.fields(), conf.help);
    var fieldIds = conf.fields().map(function (f) { return f.id; });
    var form = panel.querySelector('#qrForm');

    function refresh() {
      var opts = readOptions(fieldIds);
      var canvas = null;
      var err = null;
      try { canvas = conf.preview(opts); } catch (e) { err = e; }
      if (canvas) {
        previewCanvas(canvas, conf.meta ? conf.meta(opts) : '');
      } else if (err) {
        previewCanvas(null, '');
        M.toast('Contenido no válido para el formato elegido.');
      } else {
        previewCanvas(null, '');
      }
    }

    var t = null;
    form.addEventListener('input', function () {
      clearTimeout(t); t = setTimeout(refresh, 120);
    });
    form.addEventListener('change', refresh);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { M.toast('Completa los campos obligatorios.'); return; }
      runProcessor(cfg, readOptions(fieldIds), []);
    });
    panel.querySelector('#qrRun').addEventListener('click', function () {
      if (!form.checkValidity()) { M.toast('Completa los campos obligatorios.'); return; }
      runProcessor(cfg, readOptions(fieldIds), []);
    });
    refresh();
  }

  function initReadTool(cfg, hint) {
    var panel = mountPanel(cfg, 'Leer código', [
      { id: 'readFile', type: 'file', label: 'Imagen con el código', required: true, accept: 'image/*' }
    ], hint || 'Sube una imagen que contenga un código QR o de barras.');
    var input = panel.querySelector('#readFile');
    var form = panel.querySelector('#qrForm');
    var previewBox = panel.querySelector('#qrPreview');

    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        previewBox.innerHTML = '';
        var c = document.createElement('canvas');
        c.width = Math.min(img.naturalWidth, 480);
        c.height = img.naturalHeight * (c.width / img.naturalWidth);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.className = 'qr-canvas';
        previewBox.appendChild(c);
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); M.toast('No se pudo cargar la imagen.'); };
      img.src = url;
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var file = input.files && input.files[0];
      if (!file) { M.toast('Selecciona una imagen.'); return; }
      runProcessor(cfg, {}, [file]);
    });
    panel.querySelector('#qrRun').addEventListener('click', function () {
      var file = input.files && input.files[0];
      if (!file) { M.toast('Selecciona una imagen.'); return; }
      runProcessor(cfg, {}, [file]);
    });
  }

  function initBatchTool(cfg) {
    var panel = mountPanel(cfg, 'QR por lotes desde CSV', [
      { id: 'csvFile', type: 'file', label: 'Archivo CSV', required: true, accept: '.csv,text/csv' },
      { id: 'csvTextCol', type: 'select', label: 'Columna con el contenido', options: [], value: '' }
    ], 'Cada fila del CSV se convierte en un código QR. La primera fila debe ser el encabezado.');
    var form = panel.querySelector('#qrForm');
    var fileInput = panel.querySelector('#csvFile');
    var colSelect = panel.querySelector('#csvTextCol');
    var meta = document.getElementById('qrPreviewMeta');
    var box = document.getElementById('qrPreview');

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (!lines.length) { M.toast('El CSV está vacío.'); return; }
        var sep = lines[0].indexOf(';') !== -1 ? ';' : ',';
        var headers = lines[0].split(sep).map(function (h) { return h.trim().replace(/^"|"$/g, ''); });
        colSelect.innerHTML = headers.map(function (h, i) {
          return '<option value="' + i + '"' + (i === 0 ? ' selected' : '') + '>' + M.esc(h) + '</option>';
        }).join('');
        if (box) {
          box.innerHTML = '<div class="batch-summary"><b>' + (lines.length - 1) + '</b> filas de datos detectadas en ' + headers.length + ' columnas.</div>';
        }
        if (meta) meta.textContent = 'Encabezados: ' + headers.join(' · ');
      };
      reader.readAsText(file);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var file = fileInput.files && fileInput.files[0];
      if (!file) { M.toast('Selecciona un archivo CSV.'); return; }
      runProcessor(cfg, { csvTextCol: colSelect.value }, [file]);
    });
    panel.querySelector('#qrRun').addEventListener('click', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) { M.toast('Selecciona un archivo CSV.'); return; }
      runProcessor(cfg, { csvTextCol: colSelect.value }, [file]);
    });
  }

  M.register({
    name: 'qr',
    toolIds: ['qrGenerate', 'qrWifi', 'qrVcard', 'barcodeGenerate', 'qrReadFromImage', 'barcodeReadFromImage', 'qrBatchFromCsv'],
    init: function (cfg) {
      if (cfg.toolId === 'qrReadFromImage') return initReadTool(cfg);
      if (cfg.toolId === 'barcodeReadFromImage') return initReadTool(cfg);
      if (cfg.toolId === 'qrBatchFromCsv') return initBatchTool(cfg);
      return initFormTool(cfg, FORM_TOOLS[cfg.toolId]);
    }
  });
})();
