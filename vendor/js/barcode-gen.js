/**
 * Barcode Generator - Supports Code128, Code39, EAN-13, EAN-8, UPC-A, ITF, Codabar
 * Self-contained library. Exposes window.BarcodeGenerator.
 */
(function () {
  'use strict';

  var DEFAULTS = { width: 2, height: 100, showText: true, margin: 10, foreground: '#000000', background: '#ffffff' };

  /* ── Encoding tables ────────────────────────────────────────────────── */

  var CODE128_CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

  var CODE128_A = [
    '11011001100','11001101100','11001100110','10010011000','10010001100','10001001100','10011001000','10011000100','10001100100','11001001000',
    '11001000100','11000100100','10110011100','10011011100','10011001110','10111001100','10011101100','10011100110','11001110010','11001011100',
    '11001001110','11011100100','11001110100','11101101110','11101001100','11100101100','11100100110','11101100100','11100110100','11100110010',
    '11011011000','11011000110','11000110110','10100011000','10001011000','10001000110','10110001000','10001101000','10001100010','11010001000',
    '11000101000','11000100010','10110111000','10110001110','10001101110','10111011000','10111000110','10001110110','11101110110','11010001110',
    '11000101110','11011101000','11011100010','11011101110','11101011000','11101000110','11100010110','11101101000','11101100010','11100011010',
    '11101111010','11001000010','11110001010','10100110000','10100001100','10010110000','10010000110','10000101100','10000100110','10110010000',
    '10110000100','10011010000','10011000010','10000110100','10000110010','11000010010','11001010000','11110111010','11000010100','10001111010',
    '10100111100','10010111100','10010011110','10111100100','10011110100','10011110010','11110100100','11110010100','11110010010','11011011110',
    '11011110110','11110110110','10101111000','10100011110','10001011110','10111101000','10111100010','11110101000','11110100010','10111011110',
    '10111101110','11101011110','11110101110','11010000100','11010010000','11010011100','11000111010','11'
  ];

  var CODE128_B = CODE128_A;

  var CODE39_MAP = {
    '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
    'A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
    'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn','P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn',
    'U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnnnn',' ':'nwwnnnnwn','$':'nwnwnwnnn','/':'nwnnnwnwn','+':'nwnwnwnnn','%':'nnnwnwnwn'
  };

  var EAN_L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  var EAN_R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
  var EAN_G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  var EAN_PARITY = [
    [0,0,0,0,0,0],[0,0,1,0,1,1],[0,0,1,1,0,1],[0,0,1,1,1,0],[0,1,0,0,1,1],
    [0,1,1,0,0,1],[0,1,1,1,1,0],[0,1,0,1,0,1],[0,1,1,0,1,0],[0,0,0,1,0,1]
  ];

  var CODABAR_MAP = {
    '0':'1010100011','1':'1010001110','2':'1000101110','3':'1010111000','4':'1000111010',
    '5':'1110101000','6':'1110100010','7':'1110001010','8':'1100101010','9':'1000110110',
    '-':'1000111000','/':'1000011010','$':'1000011110',':':'1110001000','.':'1100001010',
    '+':'1101000110','A':'1010001110','B':'1000101110','C':'1010111000','D':'1000111010'
  };

  /* ── Helpers ────────────────────────────────────────────────────────── */

  function computeCheckDigit(digits) {
    var sum = 0;
    for (var i = 0; i < digits.length; i++) {
      sum += digits[i] * (i % 2 === 0 ? 1 : 3);
    }
    return (10 - (sum % 10)) % 10;
  }

  function validateDigits(text, len, name) {
    if (!/^\d+$/.test(text)) return { valid: false, error: name + ' solo acepta dígitos' };
    if (text.length !== len && text.length !== len - 1) return { valid: false, error: name + ' requiere exactamente ' + len + ' dígitos (recibidos: ' + text.length + ')' };
    return { valid: true };
  }

  function normalize(text) { return String(text || '').trim(); }

  /* ── Canvas rendering ───────────────────────────────────────────────── */

  function renderCanvas(patterns, opts) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    if (opts) for (var k in opts) if (opts[k] !== undefined) o[k] = opts[k];

    var totalWidth = 0;
    for (var i = 0; i < patterns.length; i++) totalWidth += patterns[i];
    var canvasWidth = totalWidth * o.width + o.margin * 2;
    var canvasHeight = o.height + o.margin * 2 + (o.showText ? 16 : 0);

    var canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.fillStyle = o.foreground;
    var x = o.margin;
    var isBar = true;
    for (var i = 0; i < patterns.length; i++) {
      if (isBar) {
        ctx.fillRect(x, o.margin, patterns[i] * o.width, o.height);
      }
      x += patterns[i] * o.width;
      isBar = !isBar;
    }
    return canvas;
  }

  function canvasToPNG(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
    });
  }

  /* ── Format implementations ─────────────────────────────────────────── */

  function encodeCode128(text) {
    text = normalize(text);
    if (!text) return null;
    var useB = true;
    var startCode = useB ? 104 : 103;
    var patterns = [];
    var code = startCode;
    for (var i = 0; i < text.length; i++) {
      var idx = CODE128_CHARS.indexOf(text[i]);
      if (idx === -1) return null;
      code += idx * (i + 1);
      patterns.push(CODE128_A[idx]);
    }
    code = code % 103;
    patterns.push(CODE128_A[code]);
    patterns.push('1100011101011');
    return CODE128_A[startCode] + patterns.join('');
  }

  function encodeCode39(text) {
    text = normalize(text).toUpperCase();
    var result = '';
    for (var i = 0; i < text.length; i++) {
      var enc = CODE39_MAP[text[i]];
      if (!enc) return null;
      result += enc + 'n';
    }
    return result;
  }

  function encodeEAN13(text) {
    text = normalize(text);
    var v = validateDigits(text, 13, 'EAN-13');
    if (!v.valid) return v;
    if (text.length === 12) text = text + computeCheckDigit(text.split('').map(Number));
    var digits = text.split('').map(Number);
    var parity = EAN_PARITY[digits[0]];
    var result = '101';
    for (var i = 0; i < 6; i++) {
      var d = digits[i + 1];
      result += parity[i] === 0 ? EAN_L[d] : EAN_G[d];
    }
    result += '01010';
    for (var i = 0; i < 6; i++) {
      result += EAN_R[digits[i + 7]];
    }
    result += '101';
    return { valid: true, data: result };
  }

  function encodeEAN8(text) {
    text = normalize(text);
    var v = validateDigits(text, 8, 'EAN-8');
    if (!v.valid) return v;
    if (text.length === 7) text = text + computeCheckDigit(text.split('').map(Number));
    var digits = text.split('').map(Number);
    var result = '101';
    for (var i = 0; i < 4; i++) result += EAN_L[digits[i]];
    result += '01010';
    for (var i = 0; i < 4; i++) result += EAN_R[digits[i + 4]];
    result += '101';
    return { valid: true, data: result };
  }

  function encodeUPCA(text) {
    text = normalize(text);
    var v = validateDigits(text, 12, 'UPC-A');
    if (!v.valid) return v;
    if (text.length === 11) text = text + computeCheckDigit(text.split('').map(Number));
    var digits = text.split('').map(Number);
    var result = '101';
    for (var i = 0; i < 6; i++) result += EAN_L[digits[i]];
    result += '01010';
    for (var i = 0; i < 6; i++) result += EAN_R[digits[i + 6]];
    result += '101';
    return { valid: true, data: result };
  }

  function encodeITF(text) {
    text = normalize(text);
    if (!/^\d+$/.test(text)) return { valid: false, error: 'ITF solo acepta dígitos' };
    if (text.length % 2 !== 0) text = '0' + text;
    var result = '';
    for (var i = 0; i < text.length; i += 2) {
      var d1 = parseInt(text[i], 10);
      var d2 = parseInt(text[i + 1], 10);
      var bars = [
        ['nnww','wnnn','nnwn','wwnn','nwnw','wnwn','nnnw','nwnn','wnnn','nnnw'],
        ['nnnn','wwww','nwwn','wnnw','nnww','wwnn','nwbn','wnnw','nwwn','nnnn']
      ];
      for (var b = 0; b < 4; b++) {
        result += bars[0][d1][b] + bars[1][d2][b];
      }
    }
    return { valid: true, data: result };
  }

  function encodeCodabar(text) {
    text = normalize(text).toUpperCase();
    if (!text.match(/^[0-9A-D\-\/$:.\+]+$/)) return { valid: false, error: 'Codabar solo acepta: 0-9, A-D, -, /, $, :, ., +' };
    if (text[0] !== 'A' && text[0] !== 'B' && text[0] !== 'C' && text[0] !== 'D') text = 'A' + text;
    var last = text[text.length - 1];
    if (last !== 'A' && last !== 'B' && last !== 'C' && last !== 'D') text = text + 'D';
    var result = '';
    for (var i = 0; i < text.length; i++) {
      var enc = CODABAR_MAP[text[i]];
      if (!enc) return { valid: false, error: 'Carácter no válido: ' + text[i] };
      result += enc + '0';
    }
    return { valid: true, data: result };
  }

  /* ── Public API ─────────────────────────────────────────────────────── */

  var FORMAT_INFO = [
    { id: 'code128', name: 'Code 128', example: 'ABC-123', maxLength: 80 },
    { id: 'code39', name: 'Code 39', example: 'CODE39', maxLength: 40 },
    { id: 'ean13', name: 'EAN-13', example: '590123412345', maxLength: 13 },
    { id: 'ean8', name: 'EAN-8', example: '96385074', maxLength: 8 },
    { id: 'upca', name: 'UPC-A', example: '01234567890', maxLength: 12 },
    { id: 'itf', name: 'ITF', example: '1234567890', maxLength: 40 },
    { id: 'codabar', name: 'Codabar', example: 'A12345B', maxLength: 40 }
  ];

  function validate(text, format) {
    text = normalize(text);
    if (!text) return { valid: false, error: 'El texto está vacío' };
    switch (format) {
      case 'code128': return { valid: true };
      case 'code39': return /^[A-Z0-9 \-.$/+%]+$/.test(text) ? { valid: true } : { valid: false, error: 'Code 39 solo acepta A-Z, 0-9 y - . $ / + %' };
      case 'ean13': return validateDigits(text, 13, 'EAN-13');
      case 'ean8': return validateDigits(text, 8, 'EAN-8');
      case 'upca': return validateDigits(text, 12, 'UPC-A');
      case 'itf': return /^\d+$/.test(text) ? (text.length % 2 === 0 ? { valid: true } : { valid: false, error: 'ITF requiere cantidad par de dígitos' }) : { valid: false, error: 'ITF solo acepta dígitos' };
      case 'codabar': return /^[0-9A-D\-\/$:.\+]+$/.test(text) ? { valid: true } : { valid: false, error: 'Codabar: caracteres no válidos' };
      default: return { valid: false, error: 'Formato no soportado: ' + format };
    }
  }

  function patternsToBars(patternStr) {
    var bars = [];
    var isBlack = true;
    for (var i = 0; i < patternStr.length; i++) {
      var ch = patternStr[i];
      if (ch === 'n' || ch === 'w') {
        var w = ch === 'n' ? 1 : ch === 'w' ? 3 : parseInt(ch, 10);
        bars.push({ width: w, black: isBlack });
        isBlack = !isBlack;
      } else if (ch === '0' || ch === '1') {
        bars.push({ width: 1, black: ch === '1' });
      }
    }
    return bars;
  }

  function renderBars(patternStr, opts) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    if (opts) for (var k in opts) if (opts[k] !== undefined) o[k] = opts[k];

    var bars = patternsToBars(patternStr);
    var totalModules = 0;
    for (var i = 0; i < bars.length; i++) totalModules += bars[i].width;

    var canvasWidth = totalModules * o.width + o.margin * 2;
    var canvasHeight = o.height + o.margin * 2 + (o.showText ? 18 : 0);

    var canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.fillStyle = o.foreground;
    var x = o.margin;
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].black) {
        ctx.fillRect(x, o.margin, bars[i].width * o.width, o.height);
      }
      x += bars[i].width * o.width;
    }

    return canvas;
  }

  function renderBarsSVG(patternStr, opts) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    if (opts) for (var k in opts) if (opts[k] !== undefined) o[k] = opts[k];

    var bars = patternsToBars(patternStr);
    var totalModules = 0;
    for (var i = 0; i < bars.length; i++) totalModules += bars[i].width;

    var svgWidth = totalModules * o.width + o.margin * 2;
    var svgHeight = o.height + o.margin * 2;

    var rects = '';
    var x = o.margin;
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].black) {
        rects += '<rect x="' + x + '" y="' + o.margin + '" width="' + (bars[i].width * o.width) + '" height="' + o.height + '" fill="' + o.foreground + '"/>';
      }
      x += bars[i].width * o.width;
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + svgWidth + ' ' + svgHeight + '" width="' + svgWidth + '" height="' + svgHeight + '">' +
      '<rect width="100%" height="100%" fill="' + o.background + '"/>' +
      rects + '</svg>';
  }

  function renderEANBars(patternStr, opts) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    if (opts) for (var k in opts) if (opts[k] !== undefined) o[k] = opts[k];

    var canvasWidth = patternStr.length * o.width + o.margin * 2;
    var canvasHeight = o.height + o.margin * 2 + (o.showText ? 18 : 0);

    var canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.fillStyle = o.foreground;
    for (var i = 0; i < patternStr.length; i++) {
      if (patternStr[i] === '1') {
        ctx.fillRect(o.margin + i * o.width, o.margin, o.width, o.height);
      }
    }
    return canvas;
  }

  function renderEANSVGBars(patternStr, opts) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    if (opts) for (var k in opts) if (opts[k] !== undefined) o[k] = opts[k];

    var svgWidth = patternStr.length * o.width + o.margin * 2;
    var svgHeight = o.height + o.margin * 2;

    var rects = '';
    for (var i = 0; i < patternStr.length; i++) {
      if (patternStr[i] === '1') {
        rects += '<rect x="' + (o.margin + i * o.width) + '" y="' + o.margin + '" width="' + o.width + '" height="' + o.height + '" fill="' + o.foreground + '"/>';
      }
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + svgWidth + ' ' + svgHeight + '" width="' + svgWidth + '" height="' + svgHeight + '">' +
      '<rect width="100%" height="100%" fill="' + o.background + '"/>' + rects + '</svg>';
  }

  window.BarcodeGenerator = {
    getSupportedFormats: function () { return FORMAT_INFO; },
    validate: validate,

    toPNG: function (text, format, opts) {
      var canvas = generateCanvas(text, format, opts);
      if (!canvas) return Promise.reject(new Error('No se pudo generar el código de barras'));
      return canvasToPNG(canvas);
    },

    toSVG: function (text, format, opts) {
      var patternStr = generatePatterns(text, format);
      if (!patternStr) throw new Error('No se pudo generar el código de barras');
      var isEAN = format === 'ean13' || format === 'ean8' || format === 'upca';
      return isEAN ? renderEANSVGBars(patternStr, opts) : renderBarsSVG(patternStr, opts);
    },

    getDataURL: function (text, format, opts) {
      var canvas = generateCanvas(text, format, opts);
      if (!canvas) return null;
      return canvas.toDataURL('image/png');
    },

    generate: function (text, format, opts) {
      var v = validate(text, format);
      if (!v.valid) return { canvas: null, valid: false, error: v.error, toPNG: function () { return Promise.reject(new Error(v.error)); }, toSVG: function () { return ''; }, getDataURL: function () { return null; } };
      var canvas = generateCanvas(text, format, opts);
      return {
        canvas: canvas,
        valid: true,
        toPNG: function () { return canvasToPNG(canvas); },
        toSVG: function () { var ps = generatePatterns(text, format); var isEAN = format === 'ean13' || format === 'ean8' || format === 'upca'; return isEAN ? renderEANSVGBars(ps, opts) : renderBarsSVG(ps, opts); },
        getDataURL: function () { return canvas.toDataURL('image/png'); }
      };
    }
  };

  function generatePatterns(text, format) {
    text = normalize(text);
    if (!text) return null;
    switch (format) {
      case 'code128': return encodeCode128(text);
      case 'code39': return encodeCode39(text);
      case 'ean13': { var r = encodeEAN13(text); return r && r.valid ? r.data : null; }
      case 'ean8': { var r = encodeEAN8(text); return r && r.valid ? r.data : null; }
      case 'upca': { var r = encodeUPCA(text); return r && r.valid ? r.data : null; }
      case 'itf': { var r = encodeITF(text); return r && r.valid ? r.data : null; }
      case 'codabar': { var r = encodeCodabar(text); return r && r.valid ? r.data : null; }
      default: return null;
    }
  }

  function generateCanvas(text, format, opts) {
    var patternStr = generatePatterns(text, format);
    if (!patternStr) return null;
    var isEAN = format === 'ean13' || format === 'ean8' || format === 'upca';
    return isEAN ? renderEANBars(patternStr, opts) : renderBars(patternStr, opts);
  }

})();
