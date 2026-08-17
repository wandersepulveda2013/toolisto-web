/* Toolisto/APLUNO — BeforeAfterViewer: slider comparison for image/PDF results.
 * Usage: window.ToolistoBAV.create(container, { before: blob, after: blob, labelBefore, labelAfter })
 * Returns: { destroy(), setBefore(blob), setAfter(blob) }
 */
(function () {
  'use strict';

  function create(container, opts) {
    if (!container) return null;
    var beforeBlob = opts.before || null;
    var afterBlob = opts.after || null;
    var labelA = opts.labelBefore || 'Original';
    var labelB = opts.labelAfter || 'Resultado';

    var state = { slider: 0.5, dragging: false, imgA: null, imgB: null, canvas: null, ctx: null };

    container.innerHTML = '';
    container.className = 'bav-container';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', 'Comparación antes y después');

    var canvas = document.createElement('canvas');
    canvas.className = 'bav-canvas';
    canvas.style.cssText = 'width:100%;border-radius:10px;display:block;touch-action:none;cursor:col-resize';
    container.appendChild(canvas);
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');

    var labelRow = document.createElement('div');
    labelRow.className = 'bav-labels';
    labelRow.innerHTML = '<span class="bav-label bav-label-left">' + esc(labelA) + '</span><span class="bav-label bav-label-right">' + esc(labelB) + '</span>';
    container.appendChild(labelRow);

    var sliderLine = document.createElement('div');
    sliderLine.className = 'bav-slider-line';
    container.appendChild(sliderLine);

    var sliderHandle = document.createElement('div');
    sliderHandle.className = 'bav-slider-handle';
    sliderHandle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 4l-6 8 6 8M16 4l6 8-6 8"/></svg>';
    container.appendChild(sliderHandle);

    canvas.addEventListener('pointerdown', function (e) { state.dragging = true; updateSlider(e); e.preventDefault(); });
    canvas.addEventListener('pointermove', function (e) { if (!state.dragging) return; updateSlider(e); e.preventDefault(); });
    canvas.addEventListener('pointerup', function () { state.dragging = false; });
    canvas.addEventListener('pointerleave', function () { state.dragging = false; });
    canvas.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { state.slider = Math.max(0, state.slider - 0.05); render(); }
      else if (e.key === 'ArrowRight') { state.slider = Math.min(1, state.slider + 0.05); render(); }
    });
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'slider');
    canvas.setAttribute('aria-label', 'Control de comparación antes/después');
    canvas.setAttribute('aria-valuemin', '0');
    canvas.setAttribute('aria-valuemax', '100');
    canvas.setAttribute('aria-valuenow', '50');

    function updateSlider(e) {
      var rect = canvas.getBoundingClientRect();
      state.slider = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      render();
    }

    function render() {
      if (!state.imgA || !state.imgB) return;
      var w = canvas.width, h = canvas.height;
      var splitX = Math.round(w * state.slider);

      state.ctx.clearRect(0, 0, w, h);

      // Draw 'after' full
      state.ctx.drawImage(state.imgB, 0, 0, w, h);

      // Draw 'before' clipped to left side
      state.ctx.save();
      state.ctx.beginPath();
      state.ctx.rect(0, 0, splitX, h);
      state.ctx.clip();
      state.ctx.drawImage(state.imgA, 0, 0, w, h);
      state.ctx.restore();

      // Slider line
      sliderLine.style.left = (state.slider * 100) + '%';
      sliderHandle.style.left = (state.slider * 100) + '%';

      var pct = Math.round(state.slider * 100);
      canvas.setAttribute('aria-valuenow', String(pct));
    }

    function loadBlobToImg(blob) {
      return new Promise(function (resolve, reject) {
        if (!blob) return reject(new Error('No blob'));
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
        img.src = url;
      });
    }

    function fitAndRender() {
      if (!state.imgA || !state.imgB) return;
      var maxW = container.clientWidth || 600;
      var w = Math.max(state.imgA.naturalWidth, state.imgB.naturalWidth);
      var h = Math.max(state.imgA.naturalHeight, state.imgB.naturalHeight);
      var scale = Math.min(maxW / w, 400 / h, 1);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      render();
    }

    function setBefore(blob) {
      beforeBlob = blob;
      if (!blob) { state.imgA = null; return; }
      loadBlobToImg(blob).then(function (img) { state.imgA = img; fitAndRender(); }).catch(function () {});
    }

    function setAfter(blob) {
      afterBlob = blob;
      if (!blob) { state.imgB = null; return; }
      loadBlobToImg(blob).then(function (img) { state.imgB = img; fitAndRender(); }).catch(function () {});
    }

    function destroy() {
      container.innerHTML = '';
      state.imgA = null;
      state.imgB = null;
    }

    // Initial load
    if (beforeBlob) setBefore(beforeBlob);
    if (afterBlob) setAfter(afterBlob);

    return { destroy: destroy, setBefore: setBefore, setAfter: setAfter };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.ToolistoBAV = { create: create };
})();
