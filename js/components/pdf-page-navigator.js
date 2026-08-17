/* Toolisto/APLUNO — PDFPageNavigator: shared page navigator for PDF tools.
 * Usage: window.ToolistoPDFNav.create(container, { file, onSelect, onReorder, onRemove, selectMode, reorderable })
 * selectMode: 'single' | 'multiple' (default 'multiple')
 * Returns: { destroy(), getSelected(): number[], selectAll(), deselectAll(), removePages(pages), getPageCount() }
 */
(function () {
  'use strict';

  var M = window.ToolistoModes;
  if (!M) return;

  function create(container, opts) {
    if (!container) return null;
    var file = opts.file;
    var onSelect = opts.onSelect || function () {};
    var onReorder = opts.onReorder || function () {};
    var onRemove = opts.onRemove || function () {};
    var selectMode = opts.selectMode || 'multiple';
    var reorderable = opts.reorderable !== false;

    var state = {
      pages: [],
      selected: new Set(),
      dragIdx: null,
      pdfDoc: null,
      pageCount: 0,
      thumbsReady: false,
    };

    container.innerHTML = '';
    container.className = 'pdf-nav';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Navegador de páginas PDF');

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'pdf-nav-toolbar';
    toolbar.innerHTML =
      '<button class="quiet-button pdf-nav-select-all" type="button" aria-label="Seleccionar todas las páginas">Todas</button>' +
      '<button class="quiet-button pdf-nav-deselect" type="button" aria-label="Deseleccionar todas">Ninguna</button>' +
      '<span class="pdf-nav-counter" role="status" aria-live="polite"></span>' +
      (reorderable ? '<button class="quiet-button pdf-nav-rotate" type="button" aria-label="Rotar seleccionadas" title="Rotar">↻</button>' : '') +
      '<button class="quiet-button pdf-nav-remove" type="button" aria-label="Eliminar seleccionadas" title="Eliminar">✕</button>';
    container.appendChild(toolbar);

    var selectAllBtn = toolbar.querySelector('.pdf-nav-select-all');
    var deselectBtn = toolbar.querySelector('.pdf-nav-deselect');
    var rotateBtn = toolbar.querySelector('.pdf-nav-rotate');
    var removeBtn = toolbar.querySelector('.pdf-nav-remove');
    var counter = toolbar.querySelector('.pdf-nav-counter');

    selectAllBtn.addEventListener('click', function () { selectAll(); });
    deselectBtn.addEventListener('click', function () { deselectAll(); });
    if (rotateBtn) rotateBtn.addEventListener('click', function () { rotateSelected(); });
    removeBtn.addEventListener('click', function () { removeSelected(); });

    // Grid
    var grid = document.createElement('div');
    grid.className = 'pdf-nav-grid';
    container.appendChild(grid);

    // Status
    var status = document.createElement('div');
    status.className = 'pdf-nav-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    container.appendChild(status);

    function updateCounter() {
      var total = state.pages.length;
      var sel = state.selected.size;
      counter.textContent = total ? sel + '/' + total + ' páginas' : 'Cargando…';
      status.textContent = sel ? sel + ' página' + (sel !== 1 ? 's' : '') + ' seleccionada' + (sel !== 1 ? 's' : '') : '';
    }

    function renderGrid() {
      grid.innerHTML = '';
      state.thumbsReady = true;
      state.pages.forEach(function (pg, idx) {
        var card = document.createElement('div');
        card.className = 'pdf-nav-card' + (state.selected.has(idx) ? ' is-selected' : '');
        card.dataset.idx = idx;
        card.tabIndex = 0;
        card.setAttribute('role', 'checkbox');
        card.setAttribute('aria-checked', state.selected.has(idx) ? 'true' : 'false');
        card.setAttribute('aria-label', 'Página ' + (idx + 1));

        if (pg.canvas) {
          pg.canvas.style.cssText = 'width:100%;border-radius:4px;display:block';
          card.appendChild(pg.canvas);
        }

        var num = document.createElement('span');
        num.className = 'pdf-nav-num';
        num.textContent = idx + 1;
        card.appendChild(num);

        if (pg.rotated) {
          var rotBadge = document.createElement('span');
          rotBadge.className = 'pdf-nav-rot-badge';
          rotBadge.textContent = pg.rotated + '°';
          card.appendChild(rotBadge);
        }

        if (reorderable) card.draggable = true;

        card.addEventListener('click', function (e) {
          if (e.target.closest('.pdf-nav-remove-btn')) return;
          toggleSelect(idx);
        });
        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSelect(idx); }
          if (e.key === 'ArrowRight' && idx < state.pages.length - 1) grid.children[idx + 1]?.focus();
          if (e.key === 'ArrowLeft' && idx > 0) grid.children[idx - 1]?.focus();
        });

        if (reorderable) {
          card.addEventListener('dragstart', function (e) { state.dragIdx = idx; card.style.opacity = '0.5'; e.dataTransfer.effectAllowed = 'move'; });
          card.addEventListener('dragend', function () { state.dragIdx = null; card.style.opacity = '1'; });
          card.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.classList.add('drop-target'); });
          card.addEventListener('dragleave', function () { card.classList.remove('drop-target'); });
          card.addEventListener('drop', function (e) {
            e.preventDefault(); card.classList.remove('drop-target');
            if (state.dragIdx === null || state.dragIdx === idx) return;
            var moved = state.pages.splice(state.dragIdx, 1)[0];
            state.pages.splice(idx, 0, moved);
            // Update selected indices
            var newSelected = new Set();
            state.selected.forEach(function (s) {
              var newIdx = s;
              if (s === state.dragIdx) newIdx = idx;
              else if (state.dragIdx < idx && s > state.dragIdx && s <= idx) newIdx = s - 1;
              else if (state.dragIdx > idx && s >= idx && s < state.dragIdx) newIdx = s + 1;
              newSelected.add(newIdx);
            });
            state.selected = newSelected;
            renderGrid();
            updateCounter();
            onReorder(state.pages.map(function (p) { return p.origIdx; }));
          });
        }

        grid.appendChild(card);
      });
      updateCounter();
    }

    function toggleSelect(idx) {
      if (selectMode === 'single') {
        state.selected.clear();
        state.selected.add(idx);
      } else {
        if (state.selected.has(idx)) state.selected.delete(idx);
        else state.selected.add(idx);
      }
      renderGrid();
      onSelect(getSelected());
    }

    function selectAll() {
      state.pages.forEach(function (_, i) { state.selected.add(i); });
      renderGrid();
      onSelect(getSelected());
    }

    function deselectAll() {
      state.selected.clear();
      renderGrid();
      onSelect(getSelected());
    }

    function rotateSelected() {
      state.selected.forEach(function (idx) {
        var pg = state.pages[idx];
        pg.rotated = ((pg.rotated || 0) + 90) % 360;
      });
      renderGrid();
    }

    function removeSelected() {
      if (!state.selected.size) return;
      var removed = [];
      state.selected.forEach(function (idx) { removed.push(state.pages[idx].origIdx); });
      state.pages = state.pages.filter(function (_, i) { return !state.selected.has(i); });
      state.selected.clear();
      // Re-index remaining
      state.pages.forEach(function (pg, i) { pg.origIdx = i; });
      renderGrid();
      updateCounter();
      onRemove(removed);
      onReorder(state.pages.map(function (p) { return p.origIdx; }));
    }

    function getSelected() {
      return Array.from(state.selected).sort(function (a, b) { return a - b; });
    }

    function getPageCount() { return state.pages.length; }

    function destroy() {
      container.innerHTML = '';
      state.pages = [];
      state.selected.clear();
    }

    // Load PDF
    async function loadPdf() {
      if (!file || !window.pdfjsLib) {
        status.textContent = window.pdfjsLib ? 'No se proporcionó archivo.' : 'Componente PDF no disponible.';
        return;
      }
      status.textContent = 'Cargando páginas…';
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
        var bytes = await file.arrayBuffer();
        var pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        state.pageCount = pdf.numPages;
        state.pages = [];
        for (var i = 1; i <= pdf.numPages; i++) {
          var page = await pdf.getPage(i);
          var vp = page.getViewport({ scale: 0.25 });
          var c = document.createElement('canvas');
          c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          state.pages.push({ origIdx: i - 1, canvas: c, rotated: 0 });
        }
        // Select all by default
        state.pages.forEach(function (_, i) { state.selected.add(i); });
        status.textContent = '';
        renderGrid();
        onSelect(getSelected());
      } catch (err) {
        status.textContent = 'No se pudieron cargar las páginas.';
      }
    }

    loadPdf();

    return {
      destroy: destroy,
      getSelected: getSelected,
      selectAll: selectAll,
      deselectAll: deselectAll,
      removePages: function (indices) {
        state.pages = state.pages.filter(function (_, i) { return indices.indexOf(i) === -1; });
        state.selected.clear();
        renderGrid();
        updateCounter();
      },
      getPageCount: getPageCount,
    };
  }

  window.ToolistoPDFNav = { create: create };
})();
