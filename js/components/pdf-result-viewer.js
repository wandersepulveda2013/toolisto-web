/* Toolisto/APLUNO — PDFResultViewer: universal PDF previewer for result dialogs.
 * Usage: window.ToolistoPDFViewer.create(container, { blob, file })
 * Returns: { destroy(), getCurrentPage(), getPageCount(), zoomIn(), zoomOut(), fitWidth() }
 */
(function () {
  'use strict';

  var SCALE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

  function create(container, opts) {
    if (!container) return null;
    var blob = opts.blob || null;
    var file = opts.file || null;

    var state = {
      pdf: null,
      pages: [],
      currentPage: 0,
      pageCount: 0,
      scale: 1,
      fitMode: 'width',
      rendering: false,
    };

    container.innerHTML = '';
    container.className = 'pdf-viewer';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-label', 'Visor de PDF');

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'pdf-viewer-toolbar';
    toolbar.innerHTML =
      '<button class="pdf-viewer-btn" data-action="prev" title="Página anterior" aria-label="Página anterior">‹</button>' +
      '<span class="pdf-viewer-page-info" role="status" aria-live="polite"></span>' +
      '<button class="pdf-viewer-btn" data-action="next" title="Página siguiente" aria-label="Página siguiente">›</button>' +
      '<span class="pdf-viewer-sep"></span>' +
      '<button class="pdf-viewer-btn" data-action="zoom-out" title="Reducir" aria-label="Reducir zoom">−</button>' +
      '<span class="pdf-viewer-zoom-label" role="status"></span>' +
      '<button class="pdf-viewer-btn" data-action="zoom-in" title="Aumentar" aria-label="Aumentar zoom">+</button>' +
      '<button class="pdf-viewer-btn" data-action="fit-width" title="Ajustar al ancho" aria-label="Ajustar al ancho">↔</button>' +
      '<button class="pdf-viewer-btn" data-action="fit-page" title="Ajustar a página" aria-label="Ajustar a página">◻</button>';
    container.appendChild(toolbar);

    var pageInfo = toolbar.querySelector('.pdf-viewer-page-info');
    var zoomLabel = toolbar.querySelector('.pdf-viewer-zoom-label');
    var prevBtn = toolbar.querySelector('[data-action="prev"]');
    var nextBtn = toolbar.querySelector('[data-action="next"]');
    var zoomOutBtn = toolbar.querySelector('[data-action="zoom-out"]');
    var zoomInBtn = toolbar.querySelector('[data-action="zoom-in"]');
    var fitWidthBtn = toolbar.querySelector('[data-action="fit-width"]');
    var fitPageBtn = toolbar.querySelector('[data-action="fit-page"]');

    // Page container
    var pageWrap = document.createElement('div');
    pageWrap.className = 'pdf-viewer-page-wrap';
    container.appendChild(pageWrap);

    var canvas = document.createElement('canvas');
    canvas.className = 'pdf-viewer-canvas';
    pageWrap.appendChild(canvas);

    // Loading status
    var status = document.createElement('div');
    status.className = 'pdf-viewer-status';
    status.textContent = 'Cargando PDF…';
    container.appendChild(status);

    function updateUI() {
      pageInfo.textContent = state.pageCount ? (state.currentPage + 1) + ' / ' + state.pageCount : '—';
      zoomLabel.textContent = Math.round(state.scale * 100) + '%';
      prevBtn.disabled = state.currentPage <= 0;
      nextBtn.disabled = state.currentPage >= state.pageCount - 1;
    }

    async function renderPage() {
      if (!state.pdf || state.rendering) return;
      state.rendering = true;
      try {
        var page = await state.pdf.getPage(state.currentPage + 1);
        var viewport;
        if (state.fitMode === 'width') {
          var containerWidth = pageWrap.clientWidth - 16;
          var baseViewport = page.getViewport({ scale: 1 });
          var autoScale = containerWidth / baseViewport.width;
          viewport = page.getViewport({ scale: autoScale * state.scale });
        } else if (state.fitMode === 'page') {
          var containerWidth = pageWrap.clientWidth - 16;
          var containerHeight = pageWrap.clientHeight - 8;
          var baseViewport2 = page.getViewport({ scale: 1 });
          var scaleX = containerWidth / baseViewport2.width;
          var scaleY = containerHeight / baseViewport2.height;
          var autoScale2 = Math.min(scaleX, scaleY);
          viewport = page.getViewport({ scale: autoScale2 * state.scale });
        } else {
          viewport = page.getViewport({ scale: state.scale });
        }
        var ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      } catch (e) {
        console.warn('PDF render error:', e);
      }
      state.rendering = false;
    }

    function goToPage(idx) {
      if (idx < 0 || idx >= state.pageCount) return;
      state.currentPage = idx;
      updateUI();
      renderPage();
    }

    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'prev') goToPage(state.currentPage - 1);
      else if (action === 'next') goToPage(state.currentPage + 1);
      else if (action === 'zoom-in') {
        var idx = SCALE_STEPS.indexOf(state.scale);
        if (idx < SCALE_STEPS.length - 1) state.scale = SCALE_STEPS[idx + 1];
        else state.scale = SCALE_STEPS[SCALE_STEPS.length - 1];
        state.fitMode = 'custom';
        updateUI();
        renderPage();
      }
      else if (action === 'zoom-out') {
        var idx2 = SCALE_STEPS.indexOf(state.scale);
        if (idx2 > 0) state.scale = SCALE_STEPS[idx2 - 1];
        else state.scale = SCALE_STEPS[0];
        state.fitMode = 'custom';
        updateUI();
        renderPage();
      }
      else if (action === 'fit-width') {
        state.fitMode = 'width';
        state.scale = 1;
        updateUI();
        renderPage();
      }
      else if (action === 'fit-page') {
        state.fitMode = 'page';
        state.scale = 1;
        updateUI();
        renderPage();
      }
    });

    // Keyboard navigation
    container.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') goToPage(state.currentPage - 1);
      else if (e.key === 'ArrowRight') goToPage(state.currentPage + 1);
      else if (e.key === '+' || e.key === '=') { zoomInBtn.click(); }
      else if (e.key === '-') { zoomOutBtn.click(); }
    });

    // Load PDF
    async function loadPdf() {
      try {
        if (!window.pdfjsLib) {
          status.textContent = 'Componente PDF no disponible.';
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
        var arrayBuffer;
        if (blob) arrayBuffer = await blob.arrayBuffer();
        else if (file) arrayBuffer = await file.arrayBuffer();
        else { status.textContent = 'No se proporcionó archivo.'; return; }
        state.pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        state.pageCount = state.pdf.numPages;
        state.currentPage = 0;
        state.pages = [];
        status.textContent = '';
        updateUI();
        renderPage();
      } catch (err) {
        status.textContent = 'Error al cargar el PDF.';
        console.warn('PDF load error:', err);
      }
    }

    loadPdf();

    return {
      destroy: function () { container.innerHTML = ''; state.pdf = null; },
      getCurrentPage: function () { return state.currentPage + 1; },
      getPageCount: function () { return state.pageCount; },
      zoomIn: function () { zoomInBtn.click(); },
      zoomOut: function () { zoomOutBtn.click(); },
      fitWidth: function () { fitWidthBtn.click(); },
    };
  }

  window.ToolistoPDFViewer = { create: create };
})();
