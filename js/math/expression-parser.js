(function () {
  'use strict';
  var MAX_NUMBER = 1e308;
  var MIN_NUMBER = -1e308;

  function isNaN(val) {
    return val !== val;
  }

  function isFiniteNum(val) {
    return typeof val === 'number' && isFinite(val);
  }

  function replaceCommas(expr) {
    var result = '';
    var i;
    for (i = 0; i < expr.length; i++) {
      if (expr[i] === ',') {
        result += '.';
      } else {
        result += expr[i];
      }
    }
    return result;
  }

  function tokenize(expr) {
    if (typeof expr !== 'string') {
      expr = String(expr);
    }
    expr = expr.replace(/\s+/g, '');
    if (expr.length === 0) {
      return [];
    }
    expr = replaceCommas(expr);
    var tokens = [];
    var i = 0;
    var current = '';
    var len = expr.length;
    var prevToken = null;
    var prevChar = '';

    while (i < len) {
      var ch = expr[i];
      if (ch >= '0' && ch <= '9') {
        current += ch;
        i++;
        while (i < len && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
          current += expr[i];
          i++;
        }
        var numVal = parseFloat(current);
        tokens.push({ type: 'number', value: numVal });
        prevToken = { type: 'number', value: numVal };
        current = '';
      } else if (ch === '.') {
        current = '';
        current += ch;
        i++;
        while (i < len && expr[i] >= '0' && expr[i] <= '9') {
          current += expr[i];
          i++;
        }
        var decVal = parseFloat(current);
        tokens.push({ type: 'number', value: decVal });
        prevToken = { type: 'number', value: decVal };
        current = '';
      } else if (ch === '%') {
        if (prevToken && prevToken.type === 'number') {
          var lastNum = tokens[tokens.length - 1];
          lastNum.value = lastNum.value / 100;
          prevToken = { type: 'number', value: lastNum.value };
          i++;
        } else {
          return { error: 'Expresión inválida' };
        }
      } else if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '^') {
        var isUnary = false;
        if (ch === '-' || ch === '+') {
          if (prevToken === null || prevToken.type === 'operator' || (prevToken.type === 'paren' && prevToken.value === '(')) {
            isUnary = true;
          }
        }
        if (isUnary) {
          tokens.push({ type: 'operator', value: 'u' + ch });
          prevToken = { type: 'operator', value: 'u' + ch };
        } else {
          tokens.push({ type: 'operator', value: ch });
          prevToken = { type: 'operator', value: ch };
        }
        i++;
      } else if (ch === '(' || ch === ')') {
        tokens.push({ type: 'paren', value: ch });
        prevToken = { type: 'paren', value: ch };
        i++;
      } else {
        return { error: 'Expresión inválida' };
      }
    }

    var fixed = [];
    var j;
    for (j = 0; j < tokens.length; j++) {
      var t = tokens[j];
      fixed.push(t);
      if (j < tokens.length - 1) {
        var curr = tokens[j];
        var next = tokens[j + 1];
        var currIsNum = curr.type === 'number';
        var currIsParenClose = curr.type === 'paren' && curr.value === ')';
        var nextIsNum = next.type === 'number';
        var nextIsParenOpen = next.type === 'paren' && next.value === '(';
        if ((currIsNum || currIsParenClose) && (nextIsNum || nextIsParenOpen)) {
          fixed.push({ type: 'operator', value: '*' });
        }
      }
    }

    return fixed;
  }

  var precedence = {};
  precedence['+'] = 1;
  precedence['-'] = 1;
  precedence['*'] = 2;
  precedence['/'] = 2;
  precedence['^'] = 4;
  precedence['u-'] = 5;
  precedence['u+'] = 5;

  var rightAssoc = {};
  rightAssoc['^'] = true;
  rightAssoc['u-'] = true;
  rightAssoc['u+'] = true;

  function applyOp(op, a, b) {
    if (op === '+') {
      return a + b;
    }
    if (op === '-') {
      return a - b;
    }
    if (op === '*') {
      return a * b;
    }
    if (op === '/') {
      if (b === 0) {
        return { error: 'División por cero' };
      }
      return a / b;
    }
    if (op === '^') {
      return Math.pow(a, b);
    }
    return { error: 'Expresión inválida' };
  }

  function applyUnary(op, val) {
    if (op === 'u-') {
      return -val;
    }
    if (op === 'u+') {
      return val;
    }
    return { error: 'Expresión inválida' };
  }

  function evaluate(tokens) {
    var output = [];
    var opStack = [];
    var i;

    for (i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (token.type === 'number') {
        output.push(token);
      } else if (token.type === 'operator') {
        var o1 = token.value;
        while (opStack.length > 0) {
          var top = opStack[opStack.length - 1];
          if (top.type === 'operator') {
            var o2 = top.value;
            var o1Prec = precedence[o1];
            var o2Prec = precedence[o2];
            if (rightAssoc[o1]) {
              if (o1Prec < o2Prec) {
                output.push(opStack.pop());
              } else {
                break;
              }
            } else {
              if (o1Prec <= o2Prec) {
                output.push(opStack.pop());
              } else {
                break;
              }
            }
          } else {
            break;
          }
        }
        opStack.push(token);
      } else if (token.type === 'paren') {
        if (token.value === '(') {
          opStack.push(token);
        } else {
          var found = false;
          while (opStack.length > 0) {
            var topOp = opStack.pop();
            if (topOp.type === 'paren' && topOp.value === '(') {
              found = true;
              break;
            }
            output.push(topOp);
          }
          if (!found) {
            return { error: 'Paréntesis desbalanceados' };
          }
        }
      }
    }

    while (opStack.length > 0) {
      var remaining = opStack.pop();
      if (remaining.type === 'paren') {
        return { error: 'Paréntesis desbalanceados' };
      }
      output.push(remaining);
    }

    var evalStack = [];
    for (i = 0; i < output.length; i++) {
      var t = output[i];
      if (t.type === 'number') {
        evalStack.push(t.value);
      } else if (t.type === 'operator') {
        if (t.value === 'u-' || t.value === 'u+') {
          if (evalStack.length < 1) {
            return { error: 'Expresión inválida' };
          }
          var val = evalStack.pop();
          var result = applyUnary(t.value, val);
          if (typeof result === 'object' && result.error) {
            return result;
          }
          evalStack.push(result);
        } else {
          if (evalStack.length < 2) {
            return { error: 'Expresión inválida' };
          }
          var b = evalStack.pop();
          var a = evalStack.pop();
          var res = applyOp(t.value, a, b);
          if (typeof res === 'object' && res.error) {
            return res;
          }
          evalStack.push(res);
        }
      }
    }

    if (evalStack.length !== 1) {
      return { error: 'Expresión inválida' };
    }

    var finalVal = evalStack[0];
    if (!isFiniteNum(finalVal)) {
      if (Math.abs(finalVal) > MAX_NUMBER) {
        return { value: null, error: 'Resultado demasiado grande' };
      }
      return { value: null, error: 'Resultado no finito' };
    }
    return { value: finalVal, error: null };
  }

  function parse(expr) {
    if (typeof expr !== 'string' && typeof expr !== 'number') {
      return { value: 0, error: null };
    }
    if (typeof expr === 'number') {
      if (!isFiniteNum(expr)) {
        return { value: null, error: 'Resultado no finito' };
      }
      return { value: expr, error: null };
    }
    var cleaned = expr.replace(/\s+/g, '');
    if (cleaned.length === 0) {
      return { value: 0, error: null };
    }
    var result = tokenize(expr);
    if (result.error) {
      return { value: null, error: result.error };
    }
    if (result.length === 0) {
      return { value: 0, error: null };
    }
    var evalResult = evaluate(result);
    if (evalResult.error) {
      return { value: null, error: evalResult.error };
    }
    return { value: evalResult.value, error: null };
  }

  window.ExpressionParser = {
    parse: parse,
    tokenize: function (expr) {
      if (typeof expr !== 'string') {
        return { value: null, error: 'Expresión inválida' };
      }
      var result = tokenize(expr);
      if (result.error) {
        return [];
      }
      return result;
    }
  };
})();
