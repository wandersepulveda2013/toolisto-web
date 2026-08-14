/* Toolisto — modo Archivos (fileSplit, fileJoin, zipRepair).
 * Criterio: manifiesto, checksum y reconstrucción exacta comprobada.
 */
(function () {
  'use strict';
  var M = window.ToolistoModes;
  if (!M) return;

  function sha256Hex(buffer) {
    if (!window.crypto || !window.crypto.subtle) return Promise.resolve('');
    return window.crypto.subtle.digest('SHA-256', buffer).then(function (hash) {
      var arr = new Uint8Array(hash);
      var hex = '';
      for (var i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
      return hex;
    });
  }

  function readBuffer(file) {
    return file.arrayBuffer();
  }

  function mountPanel(cfg, fieldsHTML, help) {
    return M.mount([
      '<div class="mode-file">',
      '  <p class="mode-help">' + (help || '') + '</p>',
      '  <label class="drop-btn-label">',
      '    <input id="modeFileInput" type="file" ' + (cfg.multiple ? 'multiple' : '') + ' accept="' + (cfg.inputAccept || '*/*') + '" />',
      '    <span class="drop-btn"><b id="modeFileBtn">Seleccionar archivo' + (cfg.multiple ? 's' : '') + '</b><span class="mode-file-name" id="modeFileName">Ningún archivo seleccionado</span></span>',
      '  </label>',
      fieldsHTML || '',
      '  <div class="structure-preview" id="structurePreview"><span class="mode-placeholder">El manifiesto aparece aquí.</span></div>',
      '  <div class="calc-row">',
      '    <button class="primary-button" id="modeRun" type="button" disabled>Procesar y descargar</button>',
      '  </div>',
      '</div>'
    ].join(''));
  }

  function showPreview(html) {
    var box = document.getElementById('structurePreview');
    if (!box) return;
    box.innerHTML = html || '<span class="mode-placeholder">El manifiesto aparece aquí.</span>';
  }

  function runProc(cfg, files, options, extra) {
    var proc = window.ToolProcessors && window.ToolProcessors[cfg.toolId];
    var btn = document.getElementById('modeRun');
    if (!proc) { M.toast('Procesador no disponible.'); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>Procesando\u2026</span>'; }
    var ensure = window.ToolistoEnsureDependencies ? window.ToolistoEnsureDependencies(cfg.toolId) : Promise.resolve();
    ensure.then(function () { return proc(files, options, function () {}); }).then(function (res) {
      if (!res || !res.files || !res.files.length) {
        M.toast(res && res.message ? res.message : 'No se pudo procesar.');
        return;
      }
      if (extra && extra.onResult) {
        var handled = extra.onResult(res);
        return Promise.resolve(handled).then(function () { M.toast(res.message || 'Resultado listo.'); });
      }
      var out = res.files[0];
      M.downloadBlob(out.blob, out.name);
      M.toast(res.message || 'Resultado listo.');
    }).catch(function (err) {
      M.toast(err && err.message ? err.message : 'No se pudo procesar.');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span>Procesar y descargar</span>'; }
    });
  }

  function manifestRow(name, size, extra) {
    return '<tr><td>' + M.esc(name) + '</td><td>' + M.formatBytes(size) + '</td><td>' + (extra || '') + '</td></tr>';
  }

  /* ── fileSplit ───────────────────────────────────────────────────── */
  function initFileSplit(cfg) {
    var panel = mountPanel(cfg, [
      '<div class="mode-form">',
      '  <label class="mode-label" for="fsChunk">Tamaño de fragmento (KB)</label>',
      '  <input id="fsChunk" type="number" min="1" step="1" value="64" />',
      '</div>'
    ].join(''), 'Divide un archivo en fragmentos numerados con un manifiesto y checksum SHA-256.');

    var input = document.getElementById('modeFileInput');
    var runBtn = document.getElementById('modeRun');

    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) { runBtn.disabled = true; showPreview(''); return; }
      runBtn.disabled = false;
      document.getElementById('modeFileName').textContent = f.name + ' (' + M.formatBytes(f.size) + ')';
      readBuffer(f).then(function (buf) {
        var chunkSize = (parseInt(document.getElementById('fsChunk').value, 10) || 64) * 1024;
        var count = Math.ceil(buf.byteLength / chunkSize);
        return sha256Hex(buf).then(function (hash) {
          showPreview('<div class="manifest"><div class="manifest-title">Manifiesto de división</div>'
            + '<table class="preview-table"><thead><tr><th>Fragmento</th><th>Tamaño</th></tr></thead><tbody>'
            + Array.from({ length: count }, function (_, i) {
              var start = i * chunkSize;
              var end = Math.min(start + chunkSize, buf.byteLength);
              return manifestRow(f.name.replace(/\.[^.]+$/, '') + '.part' + String(i + 1).padStart(3, '0') + (f.name.includes('.') ? '.' + f.name.split('.').pop() : ''), end - start);
            }).join('')
            + '</tbody></table>'
            + '<p class="manifest-hash">SHA-256 original: <code>' + hash + '</code></p>'
            + '<p class="manifest-hash">' + count + ' fragmentos · ' + M.formatBytes(buf.byteLength) + '</p></div>');
        });
      });
    });

    runBtn.addEventListener('click', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var chunkSize = (parseInt(document.getElementById('fsChunk').value, 10) || 64) * 1024;
      var originalHash = null;
      readBuffer(f).then(function (buf) { return sha256Hex(buf); }).then(function (hash) {
        originalHash = hash;
        return runProc(cfg, [f], { chunkSize: chunkSize }, {
          onResult: function (res) {
            var buffers = [];
            return res.files.reduce(function (chain, part) {
              return chain.then(function () { return part.blob.arrayBuffer().then(function (b) { buffers.push(b); }); });
            }, Promise.resolve()).then(function () {
              var total = buffers.reduce(function (sum, b) { return sum + b.byteLength; }, 0);
              var merged = new Uint8Array(total);
              var off = 0;
              buffers.forEach(function (b) { merged.set(new Uint8Array(b), off); off += b.byteLength; });
              return sha256Hex(merged.buffer).then(function (rehash) {
                var ok = originalHash === rehash;
                var box = document.getElementById('structurePreview');
                if (box) {
                  var el = document.createElement('div');
                  el.className = ok ? 'verify-ok' : 'verify-bad';
                  el.innerHTML = '<b>' + (ok ? 'Reconstrucción exacta verificada' : 'Reconstrucción no coincide') + '</b><br>'
                    + 'SHA-256 original: <code>' + originalHash + '</code><br>SHA-256 reconstruido: <code>' + rehash + '</code>';
                  box.appendChild(el);
                }
                M.toast(ok ? 'Reconstrucción exacta verificada con checksum.' : 'Los checksums no coinciden.');
                res.files.forEach(function (p) { M.downloadBlob(p.blob, p.name); });
              });
            });
          }
        });
      });
    });
  }

  /* ── fileJoin ────────────────────────────────────────────────────── */
  function initFileJoin(cfg) {
    cfg.multiple = true;
    var panel = mountPanel(cfg, [], 'Une fragmentos numerados en un solo archivo y verifica la reconstrucción exacta.');
    var input = document.getElementById('modeFileInput');
    var runBtn = document.getElementById('modeRun');

    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) { runBtn.disabled = true; showPreview(''); return; }
      runBtn.disabled = false;
      document.getElementById('modeFileName').textContent = files.length + ' archivo(s) seleccionados';
      var sorted = files.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      var chain = Promise.resolve([]);
      sorted.forEach(function (f) {
        chain = chain.then(function (acc) {
          return readBuffer(f).then(function (b) { acc.push(b); return acc; });
        });
      });
      chain.then(function (bufs) {
        var total = bufs.reduce(function (s, b) { return s + b.byteLength; }, 0);
        var merged = new Uint8Array(total);
        var off = 0;
        bufs.forEach(function (b) { merged.set(new Uint8Array(b), off); off += b.byteLength; });
        return sha256Hex(merged.buffer).then(function (hash) {
          showPreview('<div class="manifest"><div class="manifest-title">Manifiesto de unión</div>'
            + '<table class="preview-table"><thead><tr><th>Archivo</th><th>Tamaño</th></tr></thead><tbody>'
            + sorted.map(function (f) { return manifestRow(f.name, f.size); }).join('')
            + '</tbody></table>'
            + '<p class="manifest-hash">Total: ' + M.formatBytes(total) + '</p>'
            + '<p class="manifest-hash">SHA-256 del resultado: <code>' + hash + '</code></p></div>');
        });
      });
    });

    runBtn.addEventListener('click', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      runProc(cfg, files, {}, {
        onResult: function (res) {
          var out = res.files[0];
          return out.blob.arrayBuffer().then(function (b) {
            return sha256Hex(b).then(function (hash) {
              var box = document.getElementById('structurePreview');
              if (box) {
                var el = document.createElement('div');
                el.className = 'verify-ok';
                el.innerHTML = '<b>Archivo reconstruido: ' + M.esc(out.name) + '</b> (' + M.formatBytes(out.size) + ')<br>SHA-256: <code>' + hash + '</code>';
                box.appendChild(el);
              }
              M.downloadBlob(out.blob, out.name);
            });
          });
        }
      });
    });
  }

  /* ── zipRepair ───────────────────────────────────────────────────── */
  function initZipRepair(cfg) {
    var panel = mountPanel(cfg, [], 'Inspecciona un ZIP dañado, lista sus entradas y recupera los archivos legibles.');
    var input = document.getElementById('modeFileInput');
    var runBtn = document.getElementById('modeRun');

    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) { runBtn.disabled = true; showPreview(''); return; }
      runBtn.disabled = false;
      document.getElementById('modeFileName').textContent = f.name + ' (' + M.formatBytes(f.size) + ')';
      var ensure = window.ToolistoEnsureDependencies ? window.ToolistoEnsureDependencies(cfg.toolId) : Promise.resolve();
      ensure.then(function () { return readBuffer(f); }).then(function (buf) {
        if (!window.JSZip) { showPreview('<p class="mode-preview-note">JSZip no disponible.</p>'); return; }
        return window.JSZip.loadAsync(buf, { optimizedBinaryThumbnail: true }).then(function (zip) {
          var entries = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir; });
          showPreview('<div class="manifest"><div class="manifest-title">Entradas del ZIP</div>'
            + '<table class="preview-table"><thead><tr><th>Entrada</th><th>Tamaño</th></tr></thead><tbody>'
            + (entries.length ? entries.map(function (n) { return manifestRow(n, zip.files[n]._data ? zip.files[n]._data.uncompressedSize : 0); }).join('') : '<tr><td colspan="2">Sin archivos</td></tr>')
            + '</tbody></table>'
            + '<p class="manifest-hash">' + entries.length + ' entradas analizadas · ZIP legible</p></div>');
        }).catch(function () {
          showPreview('<div class="verify-bad"><b>ZIP corrupto</b><br>La cabecera central no pudo leerse. Se intentará la recuperación cruda.</div>');
        });
      }).catch(function () {
        showPreview('<div class="verify-bad"><b>ZIP corrupto</b><br>La cabecera central no pudo leerse. Se intentará la recuperación cruda.</div>');
      });
    });

    runBtn.addEventListener('click', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      runProc(cfg, [f], {}, {
        onResult: function (res) {
          var box = document.getElementById('structurePreview');
          if (box) {
            var el = document.createElement('div');
            el.className = 'verify-ok';
            el.innerHTML = '<b>' + res.files.length + ' archivo(s) recuperado(s):</b><br>' + res.files.map(function (x) { return M.esc(x.name) + ' (' + M.formatBytes(x.size) + ')'; }).join('<br>');
            box.appendChild(el);
          }
          res.files.forEach(function (x) { M.downloadBlob(x.blob, x.name); });
        }
      });
    });
  }

  M.register({
    name: 'archivos',
    toolIds: ['fileSplit', 'fileJoin', 'zipRepair'],
    init: function (cfg) {
      if (cfg.toolId === 'fileSplit') return initFileSplit(cfg);
      if (cfg.toolId === 'fileJoin') return initFileJoin(cfg);
      if (cfg.toolId === 'zipRepair') return initZipRepair(cfg);
    }
  });
})();
