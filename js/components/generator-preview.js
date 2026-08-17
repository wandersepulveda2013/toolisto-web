/* Toolisto/APLUNO — GeneratorPreview: live preview container for QR, barcodes, signatures.
 * Usage: window.ToolistoGP.create(container, { onGenerate })
 * Returns: { showCanvas(canvas), showHtml(html), showImage(blob), clear(), getPreviewBlob() }
 */
(function () {
  'use strict';

  function create(container, opts) {
    if (!container) return null;

    container.innerHTML = '';
    container.className = 'gp-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Vista previa del generador');

    var previewWrap = document.createElement('div');
    previewWrap.className = 'gp-preview-wrap';
    container.appendChild(previewWrap);

    var status = document.createElement('div');
    status.className = 'gp-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    container.appendChild(status);

    var currentBlob = null;
    var debounceTimer = null;

    function clear() {
      previewWrap.innerHTML = '';
      status.textContent = '';
      currentBlob = null;
    }

    function showCanvas(canvas) {
      clear();
      canvas.style.cssText = 'max-width:100%;border-radius:8px;display:block;margin:0 auto';
      previewWrap.appendChild(canvas);
      status.textContent = 'Vista previa actualizada';
      canvas.toBlob(function (blob) { currentBlob = blob; }, 'image/png');
    }

    function showHtml(html) {
      clear();
      var div = document.createElement('div');
      div.className = 'gp-html-content';
      div.innerHTML = html;
      previewWrap.appendChild(div);
      status.textContent = 'Vista previa actualizada';
    }

    function showImage(blob) {
      clear();
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.src = url;
      img.alt = 'Vista previa';
      img.className = 'gp-image';
      img.onload = function () { URL.revokeObjectURL(url); };
      previewWrap.appendChild(img);
      currentBlob = blob;
      status.textContent = 'Vista previa actualizada';
    }

    function getPreviewBlob() { return currentBlob; }

    function debounce(fn, ms) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fn, ms || 200);
    }

    return { showCanvas: showCanvas, showHtml: showHtml, showImage: showImage, clear: clear, getPreviewBlob: getPreviewBlob, debounce: debounce };
  }

  window.ToolistoGP = { create: create };
})();
