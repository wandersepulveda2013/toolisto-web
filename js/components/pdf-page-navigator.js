/* Toolisto/APLUNO — PDFPageNavigator v4: split layout — compact thumbnails left, large viewer right.
 * window.ToolistoPDFNav.create(container, { file, size, selectMode, reorderable, allowRotation, allowDelete, showInfo, onSelect, onReorder, onRemove })
 * Returns: { destroy(), getSelected(), selectAll(), deselectAll(), removePages(), getPageCount(), getPageOrder(), getRotationMap(), undo(), redo(), canUndo(), canRedo(), setSize() }
 */
(function () {
  'use strict';
  var HOVER_MS = 160;
  var MAX_UNDO = 50;
  var SCALES = { compact: 0.18, medium: 0.24, large: 0.30 };
  var CARD_W = { compact: 60, medium: 80, large: 100 };

  function create(container, opts) {
    if (!container) return null;
    var file = opts.file;
    var onSelect = opts.onSelect || function () {};
    var onReorder = opts.onReorder || function () {};
    var onRemove = opts.onRemove || function () {};
    var size = opts.size || 'medium';
    var selectMode = opts.selectMode || 'multiple';
    var reorderable = opts.reorderable !== false;
    var allowRotation = opts.allowRotation !== false;
    var allowDelete = opts.allowDelete !== false;
    var showInfo = opts.showInfo !== false;

    var st = {
      pages: [], selected: new Set(), dragIdx: null, pageCount: 0,
      undoStack: [], redoStack: [], rotationMap: new Map(),
      lastClick: -1, hoverIdx: -1, hoverTimer: null,
      renderToken: 0, destroyed: false
    };

    container.innerHTML = '';
    container.className = 'pdf-nav pdf-nav--' + size;

    if (showInfo) {
      var infoBar = el('div', 'pdf-nav-info', 'Cargando PDF...');
      container.appendChild(infoBar);
    }

    var tb = el('div', 'pdf-nav-toolbar');
    tb.innerHTML =
      '<span class="pdf-nav-view-group">' +
        vb('compact', size === 'compact') + vb('medium', size === 'medium') + vb('large', size === 'large') +
      '</span><span class="pdf-nav-sep"></span>' +
      '<button class="quiet-button pdf-nav-sel-all" type="button" aria-label="Seleccionar todas">Todas</button>' +
      '<button class="quiet-button pdf-nav-desel" type="button" aria-label="Deseleccionar todas">Ninguna</button>' +
      (allowRotation ? '<span class="pdf-nav-sep"></span>' +
        '<button class="quiet-button pdf-nav-rot-l" type="button" title="Rotar izquierda" aria-label="Rotar izquierda">\u21BA</button>' +
        '<button class="quiet-button pdf-nav-rot-r" type="button" title="Rotar derecha" aria-label="Rotar derecha">\u21BB</button>' : '') +
      (allowDelete ? '<button class="quiet-button pdf-nav-del" type="button" title="Eliminar" aria-label="Eliminar página seleccionada">\u2715</button>' : '') +
      '<span class="pdf-nav-sep"></span>' +
      '<button class="quiet-button pdf-nav-undo" type="button" disabled title="Deshacer" aria-label="Deshacer">\u21B6</button>' +
      '<button class="quiet-button pdf-nav-redo" type="button" disabled title="Rehacer" aria-label="Rehacer">\u21B7</button>' +
      (reorderable ? '<span class="pdf-nav-sep"></span>' +
        '<button class="quiet-button pdf-nav-mv-s" type="button" disabled title="Inicio" aria-label="Mover al inicio">\u21E4</button>' +
        '<button class="quiet-button pdf-nav-mv-b" type="button" disabled title="Antes" aria-label="Mover antes">\u25C2</button>' +
        '<button class="quiet-button pdf-nav-mv-a" type="button" disabled title="Despues" aria-label="Mover después">\u25B8</button>' +
        '<button class="quiet-button pdf-nav-mv-e" type="button" disabled title="Final" aria-label="Mover al final">\u21E5</button>' : '') +
      '<span class="pdf-nav-counter" role="status" aria-live="polite"></span>';
    container.appendChild(tb);

    var split = el('div', 'pdf-nav-split');
    var left = el('div', 'pdf-nav-left');
    var grid = el('div', 'pdf-nav-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Miniaturas de páginas');
    left.appendChild(grid);

    var right = el('div', 'pdf-nav-right');
    var vHdr = el('div', 'pdf-nav-viewer-header');
    vHdr.innerHTML = '<span class="pdf-nav-viewer-page-label"></span>';
    var vWrap = el('div', 'pdf-nav-viewer-wrap');
    var vCanvas = document.createElement('canvas');
    vCanvas.className = 'pdf-nav-viewer-canvas';
    vWrap.appendChild(vCanvas);
    var vPlaceholder = el('div', 'pdf-nav-viewer-placeholder', 'Pasa el cursor sobre una miniatura para ver la pagina en grande');
    var vTb = el('div', 'pdf-nav-viewer-toolbar');
    vTb.innerHTML =
      '<button class="pdf-nav-viewer-btn" data-v="prev" title="Anterior" aria-label="Página anterior">\u25C0</button>' +
      '<button class="pdf-nav-viewer-btn" data-v="next" title="Siguiente" aria-label="Página siguiente">\u25B6</button>' +
      '<span class="pdf-nav-viewer-sep"></span>' +
      '<button class="pdf-nav-viewer-btn" data-v="zo" title="Zoom -" aria-label="Reducir zoom">\u2212</button>' +
      '<span class="pdf-nav-viewer-zoom-label" aria-live="polite">100%</span>' +
      '<button class="pdf-nav-viewer-btn" data-v="zi" title="Zoom +" aria-label="Aumentar zoom">+</button>' +
      '<span class="pdf-nav-viewer-sep"></span>' +
      '<button class="pdf-nav-viewer-btn" data-v="fw" title="Ajustar ancho" aria-label="Ajustar al ancho">\u2194</button>' +
      '<button class="pdf-nav-viewer-btn" data-v="fp" title="Ajustar pagina" aria-label="Ajustar a página">\u2B0D</button>' +
      '<button class="pdf-nav-viewer-btn" data-v="r1" title="100%" aria-label="Zoom 100%">1:1</button>' +
      '<span class="pdf-nav-viewer-sep"></span>' +
      '<button class="pdf-nav-viewer-btn" data-v="fs" title="Pantalla completa" aria-label="Pantalla completa">\u26F6</button>';
    right.appendChild(vHdr);
    right.appendChild(vWrap);
    right.appendChild(vPlaceholder);
    right.appendChild(vTb);
    split.appendChild(left);
    split.appendChild(right);
    container.appendChild(split);

    var status = el('div', 'pdf-nav-status');
    status.setAttribute('role', 'status');
    container.appendChild(status);

    var infoEl = container.querySelector('.pdf-nav-info');
    var counter = tb.querySelector('.pdf-nav-counter');
    var viewerLabel = vHdr.querySelector('.pdf-nav-viewer-page-label');
    var viewerZoom = vTb.querySelector('.pdf-nav-viewer-zoom-label');
    var selAllBtn = tb.querySelector('.pdf-nav-sel-all');
    var deselBtn = tb.querySelector('.pdf-nav-desel');
    var rotL = tb.querySelector('.pdf-nav-rot-l');
    var rotR = tb.querySelector('.pdf-nav-rot-r');
    var delBtn = tb.querySelector('.pdf-nav-del');
    var undoB = tb.querySelector('.pdf-nav-undo');
    var redoB = tb.querySelector('.pdf-nav-redo');
    var mvS = tb.querySelector('.pdf-nav-mv-s');
    var mvB = tb.querySelector('.pdf-nav-mv-b');
    var mvA = tb.querySelector('.pdf-nav-mv-a');
    var mvE = tb.querySelector('.pdf-nav-mv-e');
    var viewBtns = tb.querySelectorAll('.pdf-nav-view-btn');

    var vState = { fitMode: 'fit-width', zoom: 1.0, displayIdx: -1 };

    selAllBtn.onclick = selAll;
    deselBtn.onclick = desel;
    if (rotL) rotL.onclick = function () { rotate(-90); };
    if (rotR) rotR.onclick = function () { rotate(90); };
    if (delBtn) delBtn.onclick = del;
    undoB.onclick = undo;
    redoB.onclick = redo;
    if (mvS) mvS.onclick = function () { move('start'); };
    if (mvB) mvB.onclick = function () { move('before'); };
    if (mvA) mvA.onclick = function () { move('after'); };
    if (mvE) mvE.onclick = function () { move('end'); };

    viewBtns.forEach(function (b) {
      b.onclick = function () {
        size = b.dataset.size;
        container.className = 'pdf-nav pdf-nav--' + size;
        viewBtns.forEach(function (x) { x.classList.toggle('is-active', x === b); });
        rerenderThumbs();
      };
    });

    vTb.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-v]');
      if (!btn) return;
      var a = btn.dataset.v;
      if (a === 'prev') navViewer(-1);
      else if (a === 'next') navViewer(1);
      else if (a === 'zi') { vState.fitMode = null; vState.zoom = Math.min(5, vState.zoom * 1.25); renderViewer(); }
      else if (a === 'zo') { vState.fitMode = null; vState.zoom = Math.max(0.1, vState.zoom / 1.25); renderViewer(); }
      else if (a === 'fw') { vState.fitMode = 'fit-width'; vState.zoom = 1.0; renderViewer(); }
      else if (a === 'fp') { vState.fitMode = 'fit-page'; vState.zoom = 1.0; renderViewer(); }
      else if (a === 'r1') { vState.fitMode = null; vState.zoom = 1.0; renderViewer(); }
      else if (a === 'fs') openFS(vState.displayIdx >= 0 ? vState.displayIdx : 0);
    });

    grid.addEventListener('mouseleave', function () {
      clearTimeout(st.hoverTimer);
    });

    function el(tag, cls, txt) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (txt) e.textContent = txt;
      return e;
    }
    function vb(sz, active) {
      return '<button class="pdf-nav-view-btn' + (active ? ' is-active' : '') + '" data-size="' + sz + '" type="button">' +
        (sz === 'compact' ? '\u25FB' : sz === 'medium' ? '\u25FB\u25FB' : '\u25FB\u25FB\u25FB') + '</button>';
    }
    function isMobile() { return window.innerWidth < 768; }

    function updateCounter() {
      var t = st.pages.length, s = st.selected.size;
      counter.textContent = t ? s + '/' + t : '...';
      var has = s > 0;
      if (delBtn) delBtn.disabled = !has;
      if (rotL) rotL.disabled = !has;
      if (rotR) rotR.disabled = !has;
      if (mvS) { mvS.disabled = !has; mvB.disabled = !has; mvA.disabled = !has; mvE.disabled = !has; }
      undoB.disabled = !st.undoStack.length;
      redoB.disabled = !st.redoStack.length;
      status.textContent = s ? s + ' seleccionada' + (s !== 1 ? 's' : '') : '';
    }

    function pushUndo() {
      st.undoStack.push(st.pages.map(function (p) { return p.origIdx; }));
      st.redoStack = [];
      if (st.undoStack.length > MAX_UNDO) st.undoStack.shift();
    }
    function undo() {
      if (!st.undoStack.length) return;
      st.redoStack.push(st.pages.map(function (p) { return p.origIdx; }));
      restore(st.undoStack.pop());
    }
    function redo() {
      if (!st.redoStack.length) return;
      st.undoStack.push(st.pages.map(function (p) { return p.origIdx; }));
      restore(st.redoStack.pop());
    }
    function restore(arr) {
      var m = {};
      st.pages.forEach(function (p) { m[p.origIdx] = p; });
      st.pages = arr.map(function (i) { return m[i]; }).filter(Boolean);
      st.selected.clear();
      renderGrid();
      updateCounter();
      onReorder(getOrder());
    }

    function rerenderThumbs() {
      var sc = SCALES[size] || 0.24;
      var chain = Promise.resolve();
      st.pages.forEach(function (pg) {
        chain = chain.then(function () {
          if (st.destroyed) return;
          return renderThumb(pg, sc);
        });
      });
      chain.then(function () { if (!st.destroyed) { renderGrid(); } });
    }

    function renderThumb(pg, sc) {
      if (pg._ts === sc && pg._tc) { pg.canvas = pg._tc; return Promise.resolve(); }
      if (!file || !window.pdfjsLib) return Promise.resolve();
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      return file.arrayBuffer().then(function (b) {
        return window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
      }).then(function (pdf) { return pdf.getPage(pg.origIdx + 1); }).then(function (page) {
        var vp = page.getViewport({ scale: sc });
        var c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
          pg.canvas = c; pg._tc = c; pg._ts = sc;
        });
      }).catch(function () {});
    }

    function renderGrid() {
      grid.innerHTML = '';
      st.pages.forEach(function (pg, idx) {
        var card = el('div', 'pdf-nav-card');
        if (st.selected.has(idx)) card.classList.add('is-selected');
        card.dataset.idx = idx;
        card.tabIndex = 0;
        card.setAttribute('role', 'checkbox');
        card.setAttribute('aria-checked', st.selected.has(idx) ? 'true' : 'false');
        card.setAttribute('aria-label', 'Pagina ' + (idx + 1) + (pg.rotated ? ' girada ' + pg.rotated + '\u00B0' : ''));

        if (pg.canvas) {
          var cc = pg.canvas.cloneNode(true);
          cc.getContext('2d').drawImage(pg.canvas, 0, 0);
          cc.style.cssText = 'width:100%;border-radius:3px;display:block';
          card.appendChild(cc);
        }
        var nm = el('span', 'pdf-nav-num');
        nm.textContent = idx + 1;
        card.appendChild(nm);
        if (pg.rotated) {
          var rb = el('span', 'pdf-nav-rot-badge');
          rb.textContent = pg.rotated + '\u00B0';
          card.appendChild(rb);
        }
        if (reorderable) card.draggable = true;

        card.addEventListener('mouseenter', function () {
          if (isMobile() || st.dragIdx !== null) return;
          clearTimeout(st.hoverTimer);
          st.hoverTimer = setTimeout(function () {
            vState.displayIdx = idx;
            renderViewer();
          }, HOVER_MS);
        });

        card.addEventListener('click', function (e) {
          if (e.shiftKey && st.lastClick >= 0) {
            var lo = Math.min(st.lastClick, idx), hi = Math.max(st.lastClick, idx);
            if (!e.ctrlKey && !e.metaKey) st.selected.clear();
            for (var i = lo; i <= hi; i++) st.selected.add(i);
          } else if (e.ctrlKey || e.metaKey) {
            if (st.selected.has(idx)) st.selected.delete(idx); else st.selected.add(idx);
          } else {
            st.selected.clear();
            st.selected.add(idx);
          }
          st.lastClick = idx;
          renderGrid();
          onSelect(getSelected());
        });

        card.addEventListener('dblclick', function (e) {
          e.preventDefault();
          openFS(idx);
        });

        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
          if (e.key === 'Delete') { e.preventDefault(); del(); }
        });

        if (reorderable) {
          card.addEventListener('dragstart', function (e) {
            st.dragIdx = idx; card.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx));
            vState.displayIdx = idx; renderViewer();
          });
          card.addEventListener('dragend', function () {
            st.dragIdx = null; card.classList.remove('is-dragging');
            grid.querySelectorAll('.drop-target').forEach(function (x) { x.classList.remove('drop-target'); });
          });
          card.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.classList.add('drop-target'); });
          card.addEventListener('dragleave', function () { card.classList.remove('drop-target'); });
          card.addEventListener('drop', function (e) {
            e.preventDefault(); card.classList.remove('drop-target');
            if (st.dragIdx === null || st.dragIdx === idx) return;
            pushUndo();
            var moved = st.pages.splice(st.dragIdx, 1)[0];
            st.pages.splice(idx, 0, moved);
            var ns = new Set();
            st.selected.forEach(function (s) {
              var n = s;
              if (s === st.dragIdx) n = idx;
              else if (st.dragIdx < idx && s > st.dragIdx && s <= idx) n = s - 1;
              else if (st.dragIdx > idx && s >= idx && s < st.dragIdx) n = s + 1;
              ns.add(n);
            });
            st.selected = ns; st.dragIdx = null;
            renderGrid(); updateCounter(); onReorder(getOrder());
          });
        }
        grid.appendChild(card);
      });
      updateCounter();
    }

    function renderViewer() {
      var di = vState.displayIdx;
      if (di < 0 || di >= st.pages.length) {
        vPlaceholder.style.display = '';
        vCanvas.style.display = 'none';
        viewerLabel.textContent = '';
        return;
      }
      vPlaceholder.style.display = 'none';
      vCanvas.style.display = '';
      var pg = st.pages[di];
      viewerLabel.textContent = 'Pagina ' + (di + 1) + ' de ' + st.pages.length;
      if (!file || !window.pdfjsLib) return;
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      var token = ++st.renderToken;
      file.arrayBuffer().then(function (b) {
        return window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
      }).then(function (pdf) { return pdf.getPage(pg.origIdx + 1); }).then(function (page) {
        if (token !== st.renderToken) return;
        var base = page.getViewport({ scale: 1.0 });
        var ww = vWrap.clientWidth - 24;
        var wh = vWrap.clientHeight - 16;
        if (ww < 80) ww = 400; if (wh < 80) wh = 300;
        var sc;
        if (vState.fitMode === 'fit-width') { sc = ww / base.width; }
        else if (vState.fitMode === 'fit-page') { sc = Math.min(ww / base.width, wh / base.height); }
        else { sc = vState.zoom * (ww / base.width); }
        var vp = page.getViewport({ scale: sc });
        vCanvas.width = vp.width; vCanvas.height = vp.height;
        var ctx = vCanvas.getContext('2d');
        ctx.clearRect(0, 0, vp.width, vp.height);
        var rot = pg.rotated || 0;
        ctx.save();
        if (rot) { ctx.translate(vp.width / 2, vp.height / 2); ctx.rotate(rot * Math.PI / 180); ctx.translate(-vp.width / 2, -vp.height / 2); }
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
          ctx.restore();
          if (token !== st.renderToken) return;
          if (vState.fitMode) { viewerZoom.textContent = Math.round(sc * 100) + '%'; }
          else { viewerZoom.textContent = Math.round(vState.zoom * 100) + '%'; }
        });
      }).catch(function () {});
    }

    function navViewer(d) {
      var n = vState.displayIdx + d;
      if (n < 0 || n >= st.pages.length) return;
      vState.displayIdx = n; renderViewer();
      var card = grid.children[n];
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function openFS(startIdx) {
      var ov = document.createElement('div');
      ov.className = 'pdf-nav-preview-overlay'; ov.tabIndex = 0;
      var ps = { idx: startIdx, zoom: 1.0 };
      var tb2 = document.createElement('div');
      tb2.className = 'pdf-nav-preview-toolbar';
      tb2.innerHTML =
        '<button class="pdf-nav-preview-btn" data-f="prev" title="Anterior">\u25C0</button>' +
        '<span class="pdf-nav-preview-page-info"></span>' +
        '<button class="pdf-nav-preview-btn" data-f="next" title="Siguiente">\u25B6</button>' +
        '<span class="pdf-nav-preview-sep"></span>' +
        '<button class="pdf-nav-preview-btn" data-f="zo" title="Zoom -">\u2212</button>' +
        '<span class="pdf-nav-preview-zoom-label"></span>' +
        '<button class="pdf-nav-preview-btn" data-f="zi" title="Zoom +">+</button>' +
        '<button class="pdf-nav-preview-btn" data-f="fw" title="Ajustar ancho">\u2194</button>' +
        '<button class="pdf-nav-preview-btn" data-f="fp" title="Ajustar pagina">\u2B0D</button>' +
        '<button class="pdf-nav-preview-btn" data-f="r1" title="100%">1:1</button>' +
        '<span class="pdf-nav-preview-sep"></span>' +
        '<button class="pdf-nav-preview-btn pdf-nav-preview-close" data-f="close" title="Cerrar (ESC)">\u2715</button>';
      var pw = document.createElement('div');
      pw.className = 'pdf-nav-preview-page-wrap';
      var cv = document.createElement('canvas');
      cv.className = 'pdf-nav-preview-canvas';
      pw.appendChild(cv);
      ov.appendChild(tb2); ov.appendChild(pw);
      document.body.appendChild(ov); ov.focus();
      var pi = tb2.querySelector('.pdf-nav-preview-page-info');
      var zl = tb2.querySelector('.pdf-nav-preview-zoom-label');

      function render() {
        var pg = st.pages[ps.idx]; if (!pg) return;
        pi.textContent = (ps.idx + 1) + ' / ' + st.pages.length;
        zl.textContent = Math.round(ps.zoom * 100) + '%';
        if (!file || !window.pdfjsLib) return;
        file.arrayBuffer().then(function (b) { return window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
        }).then(function (pdf) { return pdf.getPage(pg.origIdx + 1); }).then(function (page) {
          var base = page.getViewport({ scale: 1.0 });
          var fw = (window.innerWidth * 0.85) / base.width;
          var fh = (window.innerHeight * 0.85) / base.height;
          var sc = Math.min(fw, fh) * ps.zoom;
          var vp = page.getViewport({ scale: sc });
          cv.width = vp.width; cv.height = vp.height;
          return page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        }).catch(function () {});
      }
      function close() { ov.remove(); document.removeEventListener('keydown', onK); }
      function onK(e) {
        if (e.key === 'Escape') { close(); return; }
        if (e.key === 'ArrowLeft') { if (ps.idx > 0) { ps.idx--; render(); } return; }
        if (e.key === 'ArrowRight') { if (ps.idx < st.pages.length - 1) { ps.idx++; render(); } return; }
        if (e.key === '+' || e.key === '=') { ps.zoom = Math.min(5, ps.zoom * 1.2); render(); }
        if (e.key === '-') { ps.zoom = Math.max(0.1, ps.zoom / 1.2); render(); }
      }
      tb2.addEventListener('click', function (e) {
        var b = e.target.closest('[data-f]'); if (!b) return;
        var a = b.dataset.f;
        if (a === 'prev' && ps.idx > 0) { ps.idx--; render(); }
        else if (a === 'next' && ps.idx < st.pages.length - 1) { ps.idx++; render(); }
        else if (a === 'zi') { ps.zoom = Math.min(5, ps.zoom * 1.25); render(); }
        else if (a === 'zo') { ps.zoom = Math.max(0.1, ps.zoom / 1.25); render(); }
        else if (a === 'fw') { ps.zoom = 1.0; render(); }
        else if (a === 'fp') { ps.zoom = 0.5; render(); }
        else if (a === 'r1') { ps.zoom = 1.0; render(); }
        else if (a === 'close') close();
      });
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.addEventListener('keydown', onK);
      render();
    }

    function selAll() { st.pages.forEach(function (_, i) { st.selected.add(i); }); renderGrid(); onSelect(getSelected()); }
    function desel() { st.selected.clear(); renderGrid(); onSelect(getSelected()); }

    function rotate(deg) {
      if (!st.selected.size) return;
      pushUndo();
      st.selected.forEach(function (i) {
        var pg = st.pages[i];
        pg.rotated = ((pg.rotated || 0) + deg + 360) % 360;
        st.rotationMap.set(pg.origIdx, pg.rotated);
      });
      renderGrid();
      if (vState.displayIdx >= 0) renderViewer();
      updateCounter();
    }

    function del() {
      if (!st.selected.size) return;
      pushUndo();
      var rem = [];
      st.selected.forEach(function (i) { rem.push(st.pages[i].origIdx); });
      st.pages = st.pages.filter(function (_, i) { return !st.selected.has(i); });
      st.selected.clear();
      if (vState.displayIdx >= st.pages.length) vState.displayIdx = st.pages.length - 1;
      renderGrid();
      if (vState.displayIdx >= 0) renderViewer(); else { vPlaceholder.style.display = ''; vCanvas.style.display = 'none'; }
      updateCounter();
      onRemove(rem); onReorder(getOrder());
    }

    function move(pos) {
      if (!st.selected.size || !reorderable) return;
      var sa = Array.from(st.selected).sort(function (a, b) { return a - b; });
      var moved = sa.map(function (i) { return st.pages[i]; });
      var rest = st.pages.filter(function (_, i) { return !st.selected.has(i); });
      pushUndo();
      var ins;
      if (pos === 'start') ins = 0;
      else if (pos === 'end') ins = rest.length;
      else if (pos === 'before') ins = sa[0];
      else ins = sa[sa.length - 1] + 1;
      st.pages = rest.slice(0, ins).concat(moved, rest.slice(ins));
      st.selected.clear();
      moved.forEach(function (_, mi) { st.selected.add(ins + mi); });
      renderGrid(); updateCounter(); onReorder(getOrder());
    }

    function getSelected() { return Array.from(st.selected).sort(function (a, b) { return a - b; }); }
    function getPageCount() { return st.pages.length; }
    function getOrder() { return st.pages.map(function (p) { return p.origIdx; }); }
    function getRotationMap() { return st.rotationMap; }

    function destroy() {
      st.destroyed = true;
      clearTimeout(st.hoverTimer);
      container.innerHTML = '';
      st.pages = []; st.selected.clear();
      st.undoStack = []; st.redoStack = [];
    }

    function loadPdf() {
      if (!file || !window.pdfjsLib) {
        if (infoEl) infoEl.textContent = window.pdfjsLib ? 'No se proporciono archivo.' : 'Componente PDF no disponible.';
        return;
      }
      if (infoEl) infoEl.textContent = 'Cargando paginas...';
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
      file.arrayBuffer().then(function (b) {
        return window.pdfjsLib.getDocument({ data: new Uint8Array(b) }).promise;
      }).then(function (pdf) {
        st.pageCount = pdf.numPages; st.pages = [];
        var sc = SCALES[size] || 0.24;
        var chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (pn) {
            chain = chain.then(function () {
              if (st.destroyed) return;
              return pdf.getPage(pn).then(function (page) {
                var vp = page.getViewport({ scale: sc });
                var c = document.createElement('canvas');
                c.width = vp.width; c.height = vp.height;
                return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
                  if (st.destroyed) return;
                  st.pages.push({ origIdx: pn - 1, canvas: c, _tc: c, _ts: sc, rotated: 0 });
                });
              });
            });
          })(i);
        }
        chain.then(function () {
          if (st.destroyed) return;
          st.pages.forEach(function (_, i) { st.selected.add(i); });
          if (infoEl) infoEl.textContent = file.name + ' \u00B7 ' + st.pageCount + ' pagina' + (st.pageCount !== 1 ? 's' : '');
          renderGrid();
          onSelect(getSelected());
          if (vState.displayIdx < 0 && st.pages.length > 0) {
            vState.displayIdx = 0;
            renderViewer();
          }
        });
      }).catch(function (err) {
        if (infoEl) infoEl.textContent = err && err.message && err.message.includes('password') ? 'PDF protegido.' : 'No se pudieron cargar las paginas.';
      });
    }

    var ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () { if (!st.destroyed && vState.displayIdx >= 0) renderViewer(); });
      ro.observe(vWrap);
    }

    loadPdf();

    return {
      destroy: function () { if (ro) ro.disconnect(); destroy(); },
      getSelected: getSelected,
      selectAll: selAll,
      deselectAll: desel,
      removePages: function (idx) { pushUndo(); st.pages = st.pages.filter(function (_, i) { return idx.indexOf(i) === -1; }); st.selected.clear(); renderGrid(); updateCounter(); },
      getPageCount: getPageCount,
      getPageOrder: getOrder,
      getRotationMap: getRotationMap,
      undo: undo, redo: redo,
      canUndo: function () { return st.undoStack.length > 0; },
      canRedo: function () { return st.redoStack.length > 0; },
      setSize: function (ns) { size = ns; container.className = 'pdf-nav pdf-nav--' + ns; viewBtns.forEach(function (b) { b.classList.toggle('is-active', b.dataset.size === ns); }); rerenderThumbs(); }
    };
  }
  window.ToolistoPDFNav = { create: create };
})();
