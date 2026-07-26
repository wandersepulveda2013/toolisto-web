/**
 * EngineLoader - Carga diferida de motores WASM pesados (FFmpeg.wasm, Tesseract.js)
 * Los motores se cargan solo cuando el usuario abre una herramienta que los necesita.
 * No se carga nada en la carga inicial de la página.
 */
(function () {
  'use strict';

  var BASE = (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('engine-loader.js') !== -1) {
        return src.replace(/vendor\/js\/engine-loader\.js.*$/, '');
      }
    }
    return './';
  })();

  var FFMPEG_PATHS = {
    ffmpeg: BASE + 'vendor/ffmpeg/ffmpeg.js',
    util: BASE + 'vendor/ffmpeg/util.js',
    coreJS: BASE + 'vendor/ffmpeg/ffmpeg-core.js',
    coreWASM: BASE + 'vendor/ffmpeg/ffmpeg-core.wasm'
  };

  var TESSERACT_PATHS = {
    main: BASE + 'vendor/tesseract/tesseract.min.js',
    worker: BASE + 'vendor/tesseract/worker.min.js',
    core: BASE + 'vendor/tesseract/tesseract-core-simd.wasm.js',
    langData: 'https://tessdata.projectnaptha.com/4.0.0',
    langDataFallback: BASE + 'vendor/tesseract/lang-data'
  };

  var FFMPEG_STATE = { status: 'idle', instance: null, promise: null };
  var TESSERACT_STATE = { status: 'idle', workers: {}, promise: null };

  /* ── Utilidades de carga ────────────────────────────────────────────── */

  function toBlobURL(url, mimeType) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('Error al descargar: ' + url + ' (' + res.status + ')');
      }
      return res.arrayBuffer();
    }).then(function (buf) {
      var blob = new Blob([buf], { type: mimeType });
      return URL.createObjectURL(blob);
    });
  }

  function loadScriptTag(url) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        reject(new Error('No se pudo cargar el script: ' + url));
      };
      document.head.appendChild(script);
    });
  }

  function loadESMModule(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        throw new Error('Error al descargar módulo ESM: ' + url + ' (' + res.status + ')');
      }
      return res.text();
    }).then(function (code) {
      var blob = new Blob([code], { type: 'text/javascript' });
      var blobURL = URL.createObjectURL(blob);
      return import(blobURL).then(function (mod) {
        URL.revokeObjectURL(blobURL);
        return mod;
      });
    });
  }

  /* ── FFmpeg.wasm ────────────────────────────────────────────────────── */

  function doLoadFFmpeg(onProgress) {
    if (FFMPEG_STATE.status === 'ready') {
      return Promise.resolve(FFMPEG_STATE.instance);
    }
    if (FFMPEG_STATE.status === 'loading') {
      return FFMPEG_STATE.promise;
    }

    FFMPEG_STATE.status = 'loading';

    FFMPEG_STATE.promise = (function () {
      var step = 0;
      var total = 5;

      function progress(msg) {
        step++;
        if (onProgress) onProgress(Math.round((step / total) * 100), msg);
      }

      progress('Cargando módulo FFmpeg...');
      return loadESMModule(FFMPEG_PATHS.ffmpeg).then(function (ffmpegMod) {
        progress('Cargando utilidades...');
        return loadESMModule(FFMPEG_PATHS.util).then(function (utilMod) {
          var FFmpegClass = ffmpegMod.FFmpeg;
          var fetchFile = utilMod.fetchFile;
          var toBlobURLFn = utilMod.toBlobURL || toBlobURL;

          if (!FFmpegClass) {
            throw new Error('No se encontró la clase FFmpeg en el módulo');
          }

          var ffmpeg = new FFmpegClass();
          ffmpeg.on('log', function () {});
          ffmpeg.on('progress', function () {});

          progress('Cargando núcleo FFmpeg (hilo único)...');
          return toBlobURLFn(FFMPEG_PATHS.coreJS, 'text/javascript').then(function (coreURL) {
            progress('Cargando motor WASM (~8 MB)...');
            return toBlobURLFn(FFMPEG_PATHS.coreWASM, 'application/wasm').then(function (wasmURL) {
              progress('Inicializando FFmpeg...');
              return ffmpeg.load({
                coreURL: coreURL,
                wasmURL: wasmURL
              }).then(function () {
                FFMPEG_STATE.status = 'ready';
                FFMPEG_STATE.instance = ffmpeg;
                progress('FFmpeg listo');
                return ffmpeg;
              });
            });
          });
        });
      });
    })();

    return FFMPEG_STATE.promise.catch(function (err) {
      FFMPEG_STATE.status = 'error';
      FFMPEG_STATE.instance = null;
      FFMPEG_STATE.promise = null;
      throw new Error('Error al cargar FFmpeg: ' + (err.message || err));
    });
  }

  /* ── Tesseract.js ───────────────────────────────────────────────────── */

  function loadTesseractLib() {
    if (typeof window.Tesseract !== 'undefined') {
      return Promise.resolve();
    }
    return loadScriptTag(TESSERACT_PATHS.main);
  }

  function doLoadTesseract(lang, onProgress) {
    lang = lang || 'eng';
    var workerKey = lang;

    if (TESSERACT_STATE.workers[workerKey]) {
      return Promise.resolve(TESSERACT_STATE.workers[workerKey]);
    }
    if (TESSERACT_STATE.status === 'loading' && TESSERACT_STATE.promise) {
      return TESSERACT_STATE.promise;
    }

    TESSERACT_STATE.status = 'loading';

    TESSERACT_STATE.promise = (function () {
      var step = 0;
      var total = 4;

      function progress(msg) {
        step++;
        if (onProgress) onProgress(Math.round((step / total) * 100), msg);
      }

      progress('Cargando biblioteca Tesseract...');
      return loadTesseractLib().then(function () {
        if (typeof window.Tesseract === 'undefined') {
          throw new Error('Tesseract no está disponible');
        }

        progress('Creando worker de OCR...');
        return window.Tesseract.createWorker(lang, 1, {
          workerPath: TESSERACT_PATHS.worker,
          corePath: TESSERACT_PATHS.core,
          langPath: TESSERACT_PATHS.langData,
          logger: function (info) {
            if (onProgress && info.status) {
              var pct = Math.round((step / total) * 100);
              if (info.progress !== undefined) {
                pct = Math.round(((step - 1 + info.progress) / total) * 100);
              }
              onProgress(Math.min(pct, 99), info.status);
            }
          }
        }).then(function (worker) {
          TESSERACT_STATE.workers[workerKey] = worker;
          TESSERACT_STATE.status = 'ready';
          progress('Tesseract listo (' + lang + ')');
          return worker;
        });
      });
    })();

    return TESSERACT_STATE.promise.catch(function (err) {
      TESSERACT_STATE.status = 'error';
      TESSERACT_STATE.promise = null;
      throw new Error('Error al cargar Tesseract (' + lang + '): ' + (err.message || err));
    });
  }

  /* ── API pública ────────────────────────────────────────────────────── */

  window.EngineLoader = {
    loadFFmpeg: function (onProgress) {
      return doLoadFFmpeg(onProgress);
    },

    loadTesseract: function (lang, onProgress) {
      if (typeof lang === 'function') {
        onProgress = lang;
        lang = 'eng';
      }
      return doLoadTesseract(lang, onProgress);
    },

    destroyAll: function () {
      if (FFMPEG_STATE.instance) {
        try { FFMPEG_STATE.instance.terminate(); } catch (e) {}
        try { FFMPEG_STATE.instance.exit(); } catch (e) {}
      }
      FFMPEG_STATE.status = 'idle';
      FFMPEG_STATE.instance = null;
      FFMPEG_STATE.promise = null;

      var keys = Object.keys(TESSERACT_STATE.workers);
      for (var i = 0; i < keys.length; i++) {
        try {
          TESSERACT_STATE.workers[keys[i]].terminate();
        } catch (e) {}
      }
      TESSERACT_STATE.status = 'idle';
      TESSERACT_STATE.workers = {};
      TESSERACT_STATE.promise = null;
    }
  };
})();
