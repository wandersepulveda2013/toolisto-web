/* Toolisto/APLUNO — LiveTextEditor: textarea with live stats, find/replace, undo/redo.
 * Usage: window.ToolistoLTE.create(container, { value, onChange, readonly, placeholder })
 * Returns: { getValue(), setValue(v), destroy(), getStats() }
 */
(function () {
  'use strict';

  function create(container, opts) {
    if (!container) return null;
    var initialValue = opts.value || '';
    var onChange = opts.onChange || function () {};
    var readonly = opts.readonly || false;
    var placeholder = opts.placeholder || 'Escribe o pega texto aquí…';

    var history = [initialValue];
    var historyIdx = 0;

    container.innerHTML = '';
    container.className = 'lte-container';

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'lte-toolbar';
    toolbar.innerHTML =
      '<div class="lte-stats" role="status" aria-live="polite"></div>' +
      '<div class="lte-actions">' +
        '<button class="quiet-button lte-btn" type="button" data-action="undo" title="Deshacer (Ctrl+Z)" aria-label="Deshacer">↩</button>' +
        '<button class="quiet-button lte-btn" type="button" data-action="redo" title="Rehacer (Ctrl+Y)" aria-label="Rehacer">↪</button>' +
        '<button class="quiet-button lte-btn" type="button" data-action="copy" title="Copiar todo" aria-label="Copiar todo">📋</button>' +
        '<button class="quiet-button lte-btn" type="button" data-action="clear" title="Limpiar" aria-label="Limpiar">✕</button>' +
        '<button class="quiet-button lte-btn" type="button" data-action="find" title="Buscar y reemplazar" aria-label="Buscar y reemplazar">🔍</button>' +
      '</div>';
    container.appendChild(toolbar);

    var statsEl = toolbar.querySelector('.lte-stats');

    // Find/replace panel
    var findPanel = document.createElement('div');
    findPanel.className = 'lte-find-panel';
    findPanel.hidden = true;
    findPanel.innerHTML =
      '<input type="search" class="lte-find-input" placeholder="Buscar…" aria-label="Buscar" />' +
      '<input type="text" class="lte-replace-input" placeholder="Reemplazar por…" aria-label="Reemplazar por" />' +
      '<button class="quiet-button" type="button" data-action="findNext" aria-label="Buscar siguiente">↓</button>' +
      '<button class="quiet-button" type="button" data-action="replaceAll" aria-label="Reemplazar todo">Reemplazar todo</button>' +
      '<span class="lte-find-count" role="status" aria-live="polite"></span>' +
      '<button class="quiet-button" type="button" data-action="closeFind" aria-label="Cerrar búsqueda">✕</button>';
    container.appendChild(findPanel);

    // Textarea
    var textarea = document.createElement('textarea');
    textarea.className = 'lte-textarea';
    textarea.value = initialValue;
    textarea.placeholder = placeholder;
    textarea.readOnly = readonly;
    textarea.spellcheck = true;
    textarea.setAttribute('aria-label', 'Editor de texto');
    container.appendChild(textarea);

    // State
    var findInput = findPanel.querySelector('.lte-find-input');
    var replaceInput = findPanel.querySelector('.lte-replace-input');
    var findCount = findPanel.querySelector('.lte-find-count');

    function updateStats() {
      var text = textarea.value;
      var chars = text.length;
      var words = text.trim() ? text.trim().split(/\s+/).length : 0;
      var lines = text ? text.split('\n').length : 0;
      statsEl.textContent = chars + ' caracteres · ' + words + ' palabras · ' + lines + ' líneas';
    }

    function pushHistory(value) {
      if (history[historyIdx] === value) return;
      history = history.slice(0, historyIdx + 1);
      history.push(value);
      historyIdx = history.length - 1;
      if (history.length > 200) { history.shift(); historyIdx--; }
    }

    function undo() {
      if (historyIdx <= 0) return;
      historyIdx--;
      textarea.value = history[historyIdx];
      updateStats();
      onChange(textarea.value);
    }

    function redo() {
      if (historyIdx >= history.length - 1) return;
      historyIdx++;
      textarea.value = history[historyIdx];
      updateStats();
      onChange(textarea.value);
    }

    textarea.addEventListener('input', function () {
      pushHistory(textarea.value);
      updateStats();
      onChange(textarea.value);
    });

    textarea.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
      else if (e.ctrlKey && e.key === 'f') { e.preventDefault(); toggleFind(); }
    });

    // Toolbar actions
    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('.lte-btn');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'copy') {
        navigator.clipboard.writeText(textarea.value).then(function () {
          var toast = document.getElementById('toast');
          if (toast) { toast.textContent = 'Texto copiado'; toast.classList.add('show'); setTimeout(function () { toast.classList.remove('show'); }, 2000); }
        });
      }
      else if (action === 'clear') { textarea.value = ''; pushHistory(''); updateStats(); onChange(''); textarea.focus(); }
      else if (action === 'find') toggleFind();
    });

    function toggleFind() {
      findPanel.hidden = !findPanel.hidden;
      if (!findPanel.hidden) findInput.focus();
    }

    findPanel.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'findNext') findNext();
      else if (action === 'replaceAll') replaceAll();
      else if (action === 'closeFind') { findPanel.hidden = true; textarea.focus(); }
    });

    findInput.addEventListener('input', function () {
      highlightMatches();
    });

    function highlightMatches() {
      var query = findInput.value;
      if (!query) { findCount.textContent = ''; return; }
      var text = textarea.value;
      var regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      var matches = text.match(regex);
      findCount.textContent = matches ? matches.length + ' coincidencia' + (matches.length !== 1 ? 's' : '') : 'Sin resultados';
    }

    function findNext() {
      var query = findInput.value;
      if (!query) return;
      var text = textarea.value;
      var start = textarea.selectionEnd;
      var idx = text.indexOf(query, start);
      if (idx === -1) idx = text.indexOf(query, 0);
      if (idx === -1) return;
      textarea.focus();
      textarea.setSelectionRange(idx, idx + query.length);
    }

    function replaceAll() {
      var query = findInput.value;
      var replacement = replaceInput.value;
      if (!query) return;
      var regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      textarea.value = textarea.value.replace(regex, replacement);
      pushHistory(textarea.value);
      updateStats();
      onChange(textarea.value);
      highlightMatches();
    }

    function getValue() { return textarea.value; }
    function setValue(v) { textarea.value = v; pushHistory(v); updateStats(); onChange(v); }
    function getStats() {
      var text = textarea.value;
      return {
        chars: text.length,
        words: text.trim() ? text.trim().split(/\s+/).length : 0,
        lines: text ? text.split('\n').length : 0,
      };
    }
    function destroy() { container.innerHTML = ''; }

    updateStats();

    return { getValue: getValue, setValue: setValue, destroy: destroy, getStats: getStats };
  }

  window.ToolistoLTE = { create: create };
})();
