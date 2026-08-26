'use strict';
// Lazy-load utility for vendor scripts (pdf.min.js, jszip.min.js)
// These are large globals only needed for specific operations.
window.__lazyScriptCache = {};
window.__lazyLoadScript = function (src) {
  if (window.__lazyScriptCache[src]) return window.__lazyScriptCache[src];
  const p = new Promise((resolve, reject) => {
    if (document.querySelector('script[data-src="' + src + '"]')) {
      const existing = document.querySelector('script[data-src="' + src + '"]');
      if (existing.dataset.loaded === 'true') { resolve(); return; }
      existing.addEventListener('load', resolve);
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.src = src;
    s.dataset.loaded = 'false';
    s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
  window.__lazyScriptCache[src] = p;
  return p;
};
window.__ensurePdfJs = function () {
  if (window.pdfjsLib) return Promise.resolve();
  return window.__lazyLoadScript('../vendor/pdfjs/pdf.min.js');
};
window.__ensureJSZip = function () {
  if (window.JSZip) return Promise.resolve();
  return window.__lazyLoadScript('../vendor/jszip/jszip.min.js');
};
