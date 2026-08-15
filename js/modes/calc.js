/* Toolisto — modo Calculadoras (simpleCalculator, scientificCalculator).
 * Criterio: flujo form-first con vista previa en vivo, validación de expresión,
 * historial y descarga en texto.
 */
(function () {
  'use strict';
  var M = window.ToolistoModes;
  if (!M) return;

  var SCIENTIFIC = 'scientificCalculator';
  var history = [];

  function scientificExpression(expr, factorialOwner) {
    var functions = ['asin', 'acos', 'atan', 'sqrt', 'cbrt', 'ceil', 'floor', 'round', 'sin', 'cos', 'tan', 'log', 'ln', 'abs'];
    var processed = expr;
    functions.forEach(function (name) {
      var mathName = name === 'log' ? 'log10' : name === 'ln' ? 'log' : name;
      processed = processed.replace(new RegExp('\\b' + name + '\\s*\\(', 'gi'), 'Math.' + mathName + '(');
    });
    return processed
      .replace(/\^/g, '**')
      .replace(/\u03C0/g, 'Math.PI')
      .replace(/\bpi\b/gi, 'Math.PI')
      .replace(/\be\b/gi, 'Math.E')
      .replace(/(\d+)!/g, factorialOwner + '($1)');
  }

  function isSafeScientificExpression(processed, factorialOwner) {
    var allowedMath = /Math\.(?:sin|cos|tan|asin|acos|atan|log10|log|sqrt|cbrt|abs|ceil|floor|round|PI|E)/g;
    return processed.replace(allowedMath, '').replace(new RegExp(factorialOwner.replace('.', '\\.').replace('_', '\\_') + '\\(', 'g'), '')
      .replace(/[0-9+\-*/().%\s,]/g, '').length === 0;
  }

  function livePreview(expr, isScientific) {
    try {
      if (!expr.trim()) return '';
      if (isScientific) {
        var processed = scientificExpression(expr, 'ToolistoModes._factorial');
        if (!isSafeScientificExpression(processed, 'ToolistoModes._factorial')) return '';
        var v = Function('"use strict"; return (' + processed + ')')();
        if (!isFinite(v)) return '';
        return String(v);
      }
      var res = window.ExpressionParser ? window.ExpressionParser.parse(expr) : null;
      if (!res || res.error || !isFinite(res.value)) return '';
      return String(res.value);
    } catch (e) {
      return '';
    }
  }

  function downloadResult(expr, value, name, fileName) {
    var out = 'Expresi\u00f3n: ' + expr + '\nResultado: ' + value;
    M.downloadBlob(new Blob([out], { type: 'text/plain;charset=utf-8' }), fileName);
  }

  M.register({
    name: 'calculadoras',
    toolIds: ['simpleCalculator', 'scientificCalculator'],
    init: function (cfg) {
      var isScientific = cfg.toolId === SCIENTIFIC;
      var panel = M.mount([
        '<div class="mode-calc">',
        '  <label class="mode-label" for="calcExpr">Expresi\u00f3n matem\u00e1tica</label>',
        '  <textarea id="calcExpr" rows="3" autocomplete="off" spellcheck="false"',
        '    aria-label="Expresi\u00f3n matem\u00e1tica" placeholder="Ej. (120 + 30) * 2 / 5' + (isScientific ? '  o  sqrt(144) + sin(30 * pi / 180)' : '') + '"></textarea>',
        '  <div class="calc-live" id="calcLive" role="status" aria-live="polite"><span class="calc-live-empty">Ingresa una expresi\u00f3n para ver el resultado en vivo.</span></div>',
        '  <div class="calc-row">',
        '    <button class="primary-button" id="calcRun" type="button">Calcular</button>',
        '    <button class="quiet-button" id="calcClear" type="button">Limpiar</button>',
        '  </div>',
        '  <div class="calc-history" id="calcHistory"></div>',
        '</div>'
      ].join(''));

      var exprEl = panel.querySelector('#calcExpr');
      var liveEl = panel.querySelector('#calcLive');
      var histEl = panel.querySelector('#calcHistory');
      var runBtn = panel.querySelector('#calcRun');
      var clearBtn = panel.querySelector('#calcClear');

      function renderHistory() {
        if (!history.length) { histEl.innerHTML = ''; return; }
        var items = history.slice(0, 12).map(function (h) {
          return '<button type="button" class="calc-hist-item" data-expr="' + M.esc(h.expr) + '">'
            + '<span class="calc-hist-expr">' + M.esc(h.expr) + '</span>'
            + '<span class="calc-hist-val">= ' + M.esc(h.value) + '</span></button>';
        }).join('');
        histEl.innerHTML = '<div class="calc-hist-title">Historial</div>' + items;
      }

      function updateLive() {
        var v = livePreview(exprEl.value, isScientific);
        if (!exprEl.value.trim()) {
          liveEl.innerHTML = '<span class="calc-live-empty">Ingresa una expresi\u00f3n para ver el resultado en vivo.</span>';
        } else if (v === '') {
          liveEl.innerHTML = '<span class="calc-live-error">Expresi\u00f3n no v\u00e1lida. Revisa par\u00e9ntesis y operadores.</span>';
        } else {
          liveEl.innerHTML = '<span class="calc-live-ok">Resultado en vivo: <b>' + M.esc(v) + '</b></span>';
        }
        return v;
      }

      var timer = null;
      exprEl.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(updateLive, 180);
      });
      exprEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runBtn.click(); }
      });
      runBtn.addEventListener('click', function () {
        var expr = exprEl.value.trim();
        if (!expr) { M.toast('Ingresa una expresi\u00f3n matem\u00e1tica.'); exprEl.focus(); return; }
        if (updateLive() === '') {
          M.toast('Expresi\u00f3n no v\u00e1lida.');
          return;
        }
        var proc = window.ToolProcessors && window.ToolProcessors[cfg.toolId];
        if (!proc) { M.toast('Procesador no disponible.'); return; }
        runBtn.disabled = true;
        runBtn.innerHTML = '<span>Calculando\u2026</span>';
        proc([], { expression: expr }, function () {}).then(function (result) {
          if (!result || !result.files || !result.files.length) {
            M.toast(result && result.message ? result.message : 'No se pudo calcular.');
            return;
          }
          var value = (result.message || '').replace(/^Resultado:\s*/, '');
          history.unshift({ expr: expr, value: value || 'ok' });
          renderHistory();
          M.toast('Resultado calculado.');
          downloadResult(expr, value || result.files[0].name, cfg.toolId, result.files[0].name);
        }).catch(function (err) {
          M.toast(err && err.message ? err.message : 'No se pudo calcular.');
        }).then(function () {
          runBtn.disabled = false;
          runBtn.innerHTML = '<span>Calcular</span>';
        });
      });
      clearBtn.addEventListener('click', function () {
        exprEl.value = '';
        updateLive();
        exprEl.focus();
      });
      histEl.addEventListener('click', function (e) {
        var b = e.target.closest('.calc-hist-item');
        if (b) { exprEl.value = b.getAttribute('data-expr'); updateLive(); exprEl.focus(); }
      });
      renderHistory();
      exprEl.focus();
    }
  });

  window.ToolistoModes._factorial = function (n) {
    if (n < 0) return NaN;
    if (n === 0 || n === 1) return 1;
    var r = 1;
    for (var i = 2; i <= n; i++) r *= i;
    return r;
  };
})();
