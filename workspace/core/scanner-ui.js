/**
 * core/scanner-ui.js — Interactive document scanner interface.
 * 
 * Renders:
 * - Original image with 4 draggable corner handles
 * - Real-time perspective corrected preview
 * - Auto-detect edges button
 * - Before/after comparison slider
 * - Confirm/cancel actions
 * 
 * Uses core/image-processor.js for all computation.
 */

import {
  processImageCapture,
  applyPerspectiveCorrection,
  createThumbnail,
  distance,
  createObjectUrl,
  revokeObjectUrl,
} from './image-processor.js';

function isValidQuadrilateral(corners, imageWidth, imageHeight) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  const crossProducts = [];
  let doubledArea = 0;

  for (let i = 0; i < 4; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % 4];
    const [x3, y3] = corners[(i + 2) % 4];
    if (![x1, y1, x2, y2, x3, y3].every(Number.isFinite)) return false;
    crossProducts.push((x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2));
    doubledArea += x1 * y2 - y1 * x2;
  }

  const isStrictlyConvex = crossProducts.every(value => value > 0) ||
    crossProducts.every(value => value < 0);
  const minimumArea = Math.max(64, imageWidth * imageHeight * 0.0001);
  return isStrictlyConvex && Math.abs(doubledArea) / 2 >= minimumArea;
}

function createScannerUI(sourceDataUrl, project, options = {}) {
  const { onConfirm, onCancel, processCapture = processImageCapture } = options;
  let state = {
    corners: null,
    isFallback: false,
    cornersModified: false,
    originalCanvas: null,
    originalImageData: null,
    correctedCanvas: null,
    dragging: null,
    width: 0,
    height: 0,
    compareMode: false,
    comparePosition: 50,
    processing: false,
    previewRevision: 0,
    renderedPreviewRevision: 0,
    previewPromise: Promise.resolve(),
    confirming: false,
    cornerIntentRevision: 0,
    pendingCornerIntentRevision: 0,
    active: true,
  };
  let resizeHandler = null;

  const root = document.createElement('div');
  root.className = 'ws-scanner-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Escaneo de documento');

  async function init() {
    root.innerHTML = `
      <div class="ws-scanner-toolbar">
        <div class="ws-scanner-toolbar-left">
          <h3>Escaneo de documento</h3>
          <span class="ws-scanner-status" aria-live="polite">Detectando bordes...</span>
        </div>
        <div class="ws-scanner-toolbar-right">
          <button class="ws-btn ws-btn-ghost ws-btn-sm" data-action="auto-detect">Auto-detectar</button>
          <button class="ws-btn ws-btn-ghost ws-btn-sm" data-action="reset-corners">Restablecer</button>
          <button class="ws-btn ws-btn-ghost ws-btn-sm" data-action="compare">Comparar</button>
        </div>
      </div>
      <div class="ws-scanner-canvas-area">
        <div class="ws-scanner-compare-container" data-compare="false">
          <canvas class="ws-scanner-original"></canvas>
          <div class="ws-scanner-overlay">
            <svg class="ws-scanner-quad"></svg>
            <div class="ws-scanner-corner" data-corner="0" role="slider" aria-label="Esquina superior izquierda" aria-orientation="horizontal" tabindex="0"></div>
            <div class="ws-scanner-corner" data-corner="1" role="slider" aria-label="Esquina superior derecha" aria-orientation="horizontal" tabindex="0"></div>
            <div class="ws-scanner-corner" data-corner="2" role="slider" aria-label="Esquina inferior derecha" aria-orientation="horizontal" tabindex="0"></div>
            <div class="ws-scanner-corner" data-corner="3" role="slider" aria-label="Esquina inferior izquierda" aria-orientation="horizontal" tabindex="0"></div>
          </div>
          <div class="ws-scanner-corrected-line"></div>
          <canvas class="ws-scanner-corrected"></canvas>
        </div>
      </div>
      <div class="ws-scanner-footer">
        <button class="ws-btn ws-btn-ghost" data-action="cancel">Cancelar</button>
        <div class="ws-scanner-info">
          <span class="ws-scanner-dimensions"></span>
        </div>
        <button class="ws-btn ws-btn-primary ws-btn-confirm" data-action="confirm" disabled>
          Aplicar escaneo
        </button>
      </div>
    `;
    root.querySelector('.ws-scanner-status').textContent = 'Cargando imagen...';

    try {
      const result = await processCapture(sourceDataUrl);
      if (!state.active) return;
      state.originalCanvas = result.originalCanvas;
      state.originalImageData = result.originalImageData;
      state.corners = result.corners;
      state.isFallback = result.isFallback;
      state.width = result.width;
      state.height = result.height;

      const originalCanvas = root.querySelector('.ws-scanner-original');
      originalCanvas.width = result.width;
      originalCanvas.height = result.height;
      const ctx = originalCanvas.getContext('2d');
      ctx.drawImage(result.originalCanvas, 0, 0);

      updateCornerPositions();
      updateQuadSvg();
      await updatePreview();
      if (!state.active) return;

      const status = root.querySelector('.ws-scanner-status');
      if (state.isFallback) {
        status.textContent = 'No se detectaron bordes. Ajusta manualmente las esquinas.';
        status.className = 'ws-scanner-status warning';
      } else {
        status.textContent = 'Bordes detectados. Arrastra las esquinas para ajustar.';
        status.className = 'ws-scanner-status success';
      }

      updateDimensions();
      setupDragHandlers();
      setupToolbar();
    } catch (e) {
      if (!state.active) return;
      root.querySelector('.ws-scanner-status').textContent = 'Error: ' + e.message;
      root.querySelector('.ws-scanner-status').className = 'ws-scanner-status error';
      setupRecoveryControls();
    }
  }

  function setupRecoveryControls() {
    const cancel = () => {
      if (!state.confirming && onCancel) onCancel();
    };
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="cancel"]')) cancel();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancel();
    });
  }

  function updateCornerPositions() {
    const canvas = root.querySelector('.ws-scanner-original');
    if (!canvas) return;
    const overlay = root.querySelector('.ws-scanner-overlay');
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / state.width;
    const scaleY = rect.height / state.height;

    root.querySelectorAll('.ws-scanner-corner').forEach((el, i) => {
      if (state.corners[i]) {
        const [x, y] = state.corners[i];
        el.style.left = (x * scaleX) + 'px';
        el.style.top = (y * scaleY) + 'px';
        el.setAttribute('aria-valuemin', '0');
        el.setAttribute('aria-valuemax', String(Math.round(state.width)));
        el.setAttribute('aria-valuenow', String(Math.round(x)));
        el.setAttribute('aria-valuetext', `X: ${Math.round(x)} píxeles; Y: ${Math.round(y)} píxeles`);
      }
    });
  }

  function updateQuadSvg() {
    const svg = root.querySelector('.ws-scanner-quad');
    if (!svg || !state.corners) return;
    const canvas = root.querySelector('.ws-scanner-original');
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / state.width;
    const scaleY = rect.height / state.height;
    const points = state.corners.map(c => `${c[0] * scaleX},${c[1] * scaleY}`).join(' ');
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    svg.replaceChildren();
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', points);
    poly.setAttribute('fill', 'rgba(81,103,232,0.12)');
    poly.setAttribute('stroke', '#5167E8');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-dasharray', '6 3');
    svg.appendChild(poly);
  }

  async function updatePreview() {
    if (!state.active || !state.originalCanvas || !state.corners) return;
    const revision = ++state.previewRevision;
    const corners = state.corners.map(([x, y]) => [x, y]);
    state.processing = true;
    setConfirmEnabled(false);
    try {
      const previewJob = Promise.resolve().then(() => {
        const [tl, tr, br, bl] = corners;
        const outW = Math.round(Math.max(distance(tl, tr), distance(bl, br)));
        const outH = Math.round(Math.max(distance(tl, bl), distance(tr, br)));
        const minDim = 100;
        return applyPerspectiveCorrection(state.originalCanvas, corners, Math.max(outW, minDim), Math.max(outH, minDim));
      });
      state.previewPromise = previewJob;
      const corrected = await previewJob;
      if (!state.active || revision !== state.previewRevision) return false;
      state.correctedCanvas = corrected;
      state.renderedPreviewRevision = revision;

      const previewCanvas = root.querySelector('.ws-scanner-corrected');
      if (previewCanvas) {
        previewCanvas.width = corrected.width;
        previewCanvas.height = corrected.height;
        const ctx = previewCanvas.getContext('2d');
        ctx.drawImage(corrected, 0, 0);
      }
      return true;
    } catch (e) {
      console.error('Scanner preview error:', e);
      if (revision === state.previewRevision) state.correctedCanvas = null;
      return false;
    } finally {
      if (state.active && revision === state.previewRevision && !state.pendingCornerIntentRevision) {
        state.processing = false;
        setConfirmEnabled(!!state.correctedCanvas && !state.confirming);
      }
    }
  }

  function setConfirmEnabled(enabled) {
    const confirmButton = root.querySelector('[data-action="confirm"]');
    if (confirmButton) confirmButton.disabled = !enabled;
  }

  function setCancelEnabled(enabled) {
    const cancelButton = root.querySelector('[data-action="cancel"]');
    if (cancelButton) cancelButton.disabled = !enabled;
  }

  async function confirmScan() {
    if (!state.active || state.confirming) return;
    while (state.processing || state.renderedPreviewRevision !== state.previewRevision) {
      await state.previewPromise;
    }
    if (!state.active || !state.correctedCanvas || !onConfirm) return;

    state.confirming = true;
    setConfirmEnabled(false);
    setCancelEnabled(false);
    const status = root.querySelector('.ws-scanner-status');
    if (status) {
      status.textContent = 'Guardando escaneo...';
      status.className = 'ws-scanner-status';
    }
    try {
      const correctedDataUrl = state.correctedCanvas.toDataURL('image/png');
      const [tl, tr, br, bl] = state.corners;
      const saveResult = await onConfirm({
        correctedDataUrl,
        correctedCanvas: state.correctedCanvas,
        corners: [tl, tr, br, bl].map(([x, y]) => [x, y]),
        originalWidth: state.width,
        originalHeight: state.height,
        outputWidth: state.correctedCanvas.width,
        outputHeight: state.correctedCanvas.height,
        sourceDataUrl,
        autoDetectionFallback: state.isFallback,
        cornersModified: state.cornersModified,
        filterMode: 'original',
        rotation: 0,
      });
      if (saveResult && saveResult.ok === false) {
        const message = saveResult.message || 'No se pudo guardar el escaneo. Inténtalo de nuevo.';
        if (status) {
          status.textContent = message;
          status.className = 'ws-scanner-status error';
        }
      }
    } catch (e) {
      if (state.active && status) {
        status.textContent = 'No se pudo guardar el escaneo. Inténtalo de nuevo.';
        status.className = 'ws-scanner-status error';
      }
    } finally {
      if (!state.active) return;
      state.confirming = false;
      setConfirmEnabled(!!state.correctedCanvas && !state.processing);
      setCancelEnabled(true);
    }
  }

  function updateDimensions() {
    const dimEl = root.querySelector('.ws-scanner-dimensions');
    if (!dimEl || !state.corners) return;
    const [tl, tr, br, bl] = state.corners;
    const w = Math.round(distance(tl, tr));
    const h = Math.round(distance(tl, bl));
    dimEl.textContent = `${w} x ${h} px`;
  }

  function setCornerPosition(index, x, y) {
    if (!state.active || !state.corners || index < 0 || index >= state.corners.length) return false;
    const nextX = Math.max(0, Math.min(state.width, x));
    const nextY = Math.max(0, Math.min(state.height, y));
    const [currentX, currentY] = state.corners[index];
    if (nextX === currentX && nextY === currentY) return false;
    const candidateCorners = state.corners.map(([cornerX, cornerY], cornerIndex) => (
      cornerIndex === index ? [nextX, nextY] : [cornerX, cornerY]
    ));
    if (!isValidQuadrilateral(candidateCorners, state.width, state.height)) {
      const status = root.querySelector('.ws-scanner-status');
      if (status) {
        status.textContent = 'El ajuste debe mantener un documento con cuatro esquinas válidas.';
        status.className = 'ws-scanner-status error';
      }
      return false;
    }
    state.corners[index] = [nextX, nextY];
    state.cornerIntentRevision++;
    state.pendingCornerIntentRevision = 0;
    state.cornersModified = true;
    const status = root.querySelector('.ws-scanner-status');
    if (status && status.classList.contains('error')) {
      status.textContent = 'Ajuste de esquinas listo.';
      status.className = 'ws-scanner-status success';
    }
    updateCornerPositions();
    updateQuadSvg();
    updateDimensions();
    return true;
  }

  function setupDragHandlers() {
    const overlay = root.querySelector('.ws-scanner-overlay');
    const canvas = root.querySelector('.ws-scanner-original');

    root.querySelectorAll('.ws-scanner-corner').forEach((el, i) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        state.dragging = i;
        el.setPointerCapture(e.pointerId);
        el.classList.add('active');
      });
    });

    overlay.addEventListener('pointermove', (e) => {
      if (state.dragging === null) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(state.width, (e.clientX - rect.left) / rect.width * state.width));
      const y = Math.max(0, Math.min(state.height, (e.clientY - rect.top) / rect.height * state.height));
      setCornerPosition(state.dragging, x, y);
    });

    root.querySelectorAll('.ws-scanner-corner').forEach((el, i) => {
      el.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 20 : 5;
        const [x, y] = state.corners[i] || [];
        let nextX = x;
        let nextY = y;
        if (e.key === 'ArrowLeft') nextX -= step;
        else if (e.key === 'ArrowRight') nextX += step;
        else if (e.key === 'ArrowUp') nextY -= step;
        else if (e.key === 'ArrowDown') nextY += step;
        else if (e.key === 'Home') nextX = 0;
        else if (e.key === 'End') nextX = state.width;
        else return;
        e.preventDefault();
        if (setCornerPosition(i, nextX, nextY)) updatePreview();
      });
    });

    const endDrag = () => {
      if (state.dragging !== null) {
        root.querySelectorAll('.ws-scanner-corner').forEach(el => el.classList.remove('active'));
        state.dragging = null;
        updatePreview();
      }
    };

    overlay.addEventListener('pointerup', endDrag);
    overlay.addEventListener('pointercancel', endDrag);

    resizeHandler = () => {
      if (!state.active) return;
      updateCornerPositions();
      updateQuadSvg();
    };
    window.addEventListener('resize', resizeHandler);
  }

  function setupToolbar() {
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'auto-detect' || action === 'reset-corners') {
        await applyDetectedCorners(action);
      } else if (action === 'compare') {
        state.compareMode = !state.compareMode;
        const container = root.querySelector('.ws-scanner-compare-container');
        container.dataset.compare = state.compareMode;
        btn.classList.toggle('active', state.compareMode);
      } else if (action === 'confirm') {
        await confirmScan();
      } else if (action === 'cancel') {
        if (!state.confirming && onCancel) onCancel();
      }
    });

    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!state.confirming && onCancel) onCancel();
      }
      if (e.key === 'Enter' && e.ctrlKey) {
        confirmScan();
      }
    });
  }

  async function applyDetectedCorners(action) {
    const intentRevision = ++state.cornerIntentRevision;
    state.pendingCornerIntentRevision = intentRevision;
    state.processing = true;
    setConfirmEnabled(false);
    const status = root.querySelector('.ws-scanner-status');
    if (status) {
      status.textContent = action === 'auto-detect' ? 'Detectando bordes...' : 'Restableciendo esquinas...';
      status.className = 'ws-scanner-status';
    }
    let detectionJob;
    try {
      detectionJob = Promise.resolve(processCapture(sourceDataUrl));
    } catch (e) {
      detectionJob = Promise.reject(e);
    }
    state.previewPromise = detectionJob;
    try {
      const result = await detectionJob;
      if (!state.active || intentRevision !== state.cornerIntentRevision) return false;
      state.corners = result.corners;
      state.isFallback = result.isFallback;
      state.cornersModified = false;
      updateCornerPositions();
      updateQuadSvg();
      await updatePreview();
      if (!state.active) return false;
      updateDimensions();
      if (action === 'auto-detect' && status) {
        if (state.isFallback) {
          status.textContent = 'No se detectaron bordes. Ajusta manualmente.';
          status.className = 'ws-scanner-status warning';
        } else {
          status.textContent = 'Bordes detectados.';
          status.className = 'ws-scanner-status success';
        }
      }
      return true;
    } catch (e) {
      if (!state.active || intentRevision !== state.cornerIntentRevision) return false;
      if (status) {
        status.textContent = 'Error al detectar bordes: ' + e.message;
        status.className = 'ws-scanner-status error';
      }
      return false;
    } finally {
      if (state.active && intentRevision === state.cornerIntentRevision &&
          state.pendingCornerIntentRevision === intentRevision) {
        state.pendingCornerIntentRevision = 0;
        state.processing = false;
        setConfirmEnabled(!!state.correctedCanvas && !state.confirming);
      }
    }
  }

  function destroy() {
    if (!state.active) return;
    state.active = false;
    state.previewRevision++;
    state.cornerIntentRevision++;
    state.pendingCornerIntentRevision = 0;
    state.dragging = null;
    state.corners = null;
    state.originalCanvas = null;
    state.originalImageData = null;
    state.correctedCanvas = null;
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    root.replaceChildren();
  }

  init();

  return { root, destroy, getState: () => state };
}

export { createScannerUI, isValidQuadrilateral };
