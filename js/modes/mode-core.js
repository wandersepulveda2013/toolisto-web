/* Toolisto — mode-core: registro y utilidades compartidas de los modos certificados.
 * Cada modo (calc, structure, file, qr, excel, epub, word, pdf, editor, media)
 * se registra con `ToolistoModes.register({ name, toolIds, init })`.
 * La UI genérica (drop-zone) se sustituye por el panel propio del modo.
 */
(function () {
  'use strict';

  var modes = [];
  var booted = false;
  var installed = false;

  function toolConfig() {
    var el = document.getElementById('tool-page-config');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function boot() {
    if (booted) return;
    booted = true;
    var cfg = toolConfig();
    if (!cfg || !cfg.toolId) return;
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i];
      if (!m) continue;
      var ids = m.toolIds || [];
      if (ids.indexOf(cfg.toolId) !== -1) {
        try { m.init(cfg); } catch (e) { console.error('[Toolisto mode:' + (m.name || cfg.toolId) + ']', e); }
        return;
      }
    }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatBytes(b) {
    if (!isFinite(b) || b < 0) return '0 B';
    if (b < 1024) return b + ' B';
    var units = ['KB', 'MB', 'GB'];
    var i = -1;
    do { b /= 1024; i++; } while (b >= 1024 && i < units.length - 1);
    return (b >= 100 ? Math.round(b) : Math.round(b * 10) / 10) + ' ' + units[i];
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 3400);
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name || 'toolisto-descarga';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  /* Sustituye la zona de acción genérica por el panel del modo. */
  function mount(panelHTML) {
    if (installed) return document.getElementById('modePanel');
    installed = true;
    var actionPanel = document.querySelector('.tool-action-panel');
    var stepHeader = actionPanel ? actionPanel.querySelector('.tool-step-header') : null;
    var holder = document.createElement('div');
    holder.id = 'modePanel';
    holder.className = 'mode-panel';
    holder.innerHTML = panelHTML || '';
    if (actionPanel) {
      actionPanel.innerHTML = '';
      if (stepHeader) actionPanel.appendChild(stepHeader);
      actionPanel.appendChild(holder);
      actionPanel.classList.add('has-mode');
    }
    var dropZone = document.getElementById('dropZone');
    var strip = document.getElementById('fileStrip');
    var flow = document.getElementById('flowActions');
    var meta = document.querySelector('.tool-input-meta');
    var hint = document.querySelector('.tool-input-hint');
    if (dropZone) dropZone.hidden = true;
    if (strip) strip.hidden = true;
    if (flow) flow.hidden = true;
    if (meta) meta.style.display = 'none';
    if (hint) hint.style.display = 'none';
    return holder;
  }

  window.ToolistoModes = {
    register: function (mode) {
      modes.push(mode);
      if (booted) boot();
    },
    boot: boot,
    esc: esc,
    formatBytes: formatBytes,
    toast: toast,
    downloadBlob: downloadBlob,
    readFileAsText: readFileAsText,
    readFileAsArrayBuffer: readFileAsArrayBuffer,
    toolConfig: toolConfig,
    mount: mount
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
