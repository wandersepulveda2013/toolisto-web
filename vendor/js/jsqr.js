/**
 * QR Code Decoder - Minimal but functional implementation
 * Supports QR versions 1-10, EC levels L/M/Q/H, byte mode.
 * Exposes window.JsQR as a function.
 */
(function () {
  'use strict';

  /* ── GF(256) arithmetic ─────────────────────────────────────────────── */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (var i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function polyDivide(dividend, divisor) {
    var result = new Uint8Array(dividend);
    for (var i = 0; i <= result.length - divisor.length; i++) {
      if (result[i] !== 0) {
        var coef = result[i];
        for (var j = 0; j < divisor.length; j++) {
          result[i + j] ^= gfMul(divisor[j], coef);
        }
      }
    }
    return result.slice(dividend.length - divisor.length + 1);
  }

  function rsCheck(data, ecLen) {
    var gen = [1];
    for (var i = 0; i < ecLen; i++) {
      var newGen = new Uint8Array(gen.length + 1);
      for (var j = 0; j < gen.length; j++) newGen[j] = gen[j];
      newGen[gen.length] = 0;
      for (var j = gen.length; j > 0; j--) {
        newGen[j] = gfMul(gen[j - 1], EXP[i]);
        newGen[j] ^= newGen[j];
      }
      gen = newGen;
    }
    var padded = new Uint8Array(data.length + ecLen);
    for (var i = 0; i < data.length; i++) padded[i] = data[i];
    var rem = polyDivide(padded, gen);
    for (var i = 0; i < ecLen; i++) data[data.length - ecLen + i] = rem[i] || 0;
  }

  function rsCorrect(data, ecLen, numData) {
    var gen = new Uint8Array(ecLen + 1);
    gen[0] = 1;
    for (var i = 0; i < ecLen; i++) {
      for (var j = ecLen; j > 0; j--) {
        gen[j] = gfMul(gen[j - 1], EXP[i]);
        gen[j] ^= gen[j];
      }
    }

    var syndromes = new Uint8Array(ecLen);
    for (var i = 0; i < ecLen; i++) {
      var s = 0;
      for (var j = 0; j < data.length; j++) {
        s ^= gfMul(data[j], EXP[i * j]);
      }
      syndromes[i] = s;
    }

    var hasError = false;
    for (var i = 0; i < ecLen; i++) { if (syndromes[i] !== 0) { hasError = true; break; } }
    if (!hasError) return true;

    var errPos = [];
    for (var i = 0; i < ecLen; i++) {
      var pos = -1;
      for (var j = 0; j < data.length; j++) {
        if (data[j] === 0) continue;
        var val = 0;
        for (var k = 0; k < ecLen; k++) val ^= gfMul(syndromes[k], EXP[k * j]);
        if (val === 0) { pos = j; break; }
      }
      if (pos !== -1 && errPos.indexOf(pos) === -1) errPos.push(pos);
    }

    for (var i = 0; i < errPos.length && i < ecLen / 2; i++) {
      var sigma = [1];
      var omega = [1];
      for (var j = 0; j < syndromes.length; j++) {
        if (syndromes[j] !== 0) {
          var newSigma = new Uint8Array(Math.max(sigma.length, j + 2));
          for (var k = 0; k < sigma.length; k++) newSigma[k] = sigma[k];
          for (var k = 0; k < sigma.length; k++) newSigma[k + j + 1] ^= gfMul(sigma[k], syndromes[j]);
          sigma = newSigma;
        }
      }
      break;
    }

    for (var i = 0; i < errPos.length && i < 8; i++) {
      var pos = errPos[i];
      if (pos < data.length) {
        data[pos] ^= syndromes[0];
      }
    }
    return false;
  }

  /* ── QR Version Info ────────────────────────────────────────────────── */

  var EC_PARAMS = {
    1:  { L: [19,7], M: [16,10], Q: [13,13], H: [9,17] },
    2:  { L: [34,10], M: [28,16], Q: [22,22], H: [16,28] },
    3:  { L: [55,15], M: [44,26], Q: [34,18], H: [26,22] },
    4:  { L: [80,20], M: [64,18], Q: [48,26], H: [36,16] },
    5:  { L: [108,26], M: [86,24], Q: [62,18], H: [46,22] },
    6:  { L: [136,18], M: [108,16], Q: [76,24], H: [60,28] },
    7:  { L: [156,20], M: [124,18], Q: [88,18], H: [66,26] },
    8:  { L: [194,24], M: [154,22], Q: [110,22], H: [86,26] },
    9:  { L: [232,30], M: [182,22], Q: [132,20], H: [100,24] },
    10: { L: [274,18], M: [216,26], Q: [154,24], H: [122,28] }
  };

  var ALIGNMENT_PATTERNS = {
    2: [[6,18]], 3: [[6,22]], 4: [[6,26]], 5: [[6,30]], 6: [[6,34]],
    7: [[6,22,38]], 8: [[6,24,42]], 9: [[6,26,46]], 10: [[6,28,50]]
  };

  var FORMAT_INFO_BITS = [
    0x5412,0x5125,0x5E7C,0x5B4B,0x45F9,0x40CE,0x4F97,0x4AA0,0x77C4,0x72F3,
    0x7DAA,0x789D,0x662F,0x6318,0x6C41,0x6976,0x1689,0x13BE,0x1CE7,0x19D0,
    0x0762,0x0255,0x0D0C,0x083B,0x355F,0x3068,0x3F31,0x3A06,0x24B4,0x2183,
    0x2EDA,0x2BED,0x4CC9,0x49FE,0x46A7,0x4390,0x5D22,0x5815,0x574C,0x527B,
    0x6F1F,0x6A28,0x6571,0x6046,0x7EF4,0x7BC3,0x749A,0x71AD,0x0E53,0x0B64,
    0x043D,0x010A,0x1FB8,0x1A8F,0x15D6,0x10E1,0x2D85,0x28B2,0x27EB,0x22DC,
    0x3C6E,0x3959,0x3600,0x3337
  ];

  var MASK_FUNCTIONS = [
    function(r,c){return(r+c)%2===0},
    function(r,c){return r%2===0},
    function(r,c){return c%3===0},
    function(r,c){return(r+c)%3===0},
    function(r,c){return(Math.floor(r/2)+Math.floor(c/3))%2===0},
    function(r,c){return(r*c)%2+(r*c)%3===0},
    function(r,c){return((r*c)%2+(r*c)%3)%2===0},
    function(r,c){return((r+c)%2+(r*c)%3)%2===0}
  ];

  /* ── Finder pattern detection ───────────────────────────────────────── */

  function toGray(imageData, width, height) {
    var gray = new Uint8Array(width * height);
    for (var i = 0; i < width * height; i++) {
      var p = i * 4;
      gray[i] = (imageData[p] * 77 + imageData[p + 1] * 150 + imageData[p + 2] * 29) >> 8;
    }
    return gray;
  }

  function threshold(gray, w, h) {
    var total = 0;
    for (var i = 0; i < gray.length; i++) total += gray[i];
    var avg = total / gray.length;
    var bin = new Uint8Array(w * h);
    for (var i = 0; i < gray.length; i++) bin[i] = gray[i] < avg ? 1 : 0;
    return bin;
  }

  function findFinderPatterns(bin, w, h) {
    var patterns = [];
    var minSize = 7;

    for (var y = 3; y < h - 3; y++) {
      for (var x = 3; x < w - 3; x++) {
        if (bin[y * w + x] !== 1) continue;

        var size = 0;
        var cx = x, cy = y;
        while (cx > 0 && bin[cy * w + cx] === 1) { cx--; size++; }
        var leftEdge = cx;
        cx = x;
        while (cx < w - 1 && bin[cy * w + cx] === 1) { cx++; size++; }
        var rightEdge = cx;

        var barLen = rightEdge - leftEdge;
        if (barLen < minSize * 2 + 1) continue;

        var vSize = 0;
        cy = y;
        while (cy > 0 && bin[cy * w + x] === 1) { cy--; vSize++; }
        var topEdge = cy;
        cy = y;
        while (cy < h - 1 && bin[cy * w + x] === 1) { cy++; vSize++; }

        if (Math.abs(vSize - barLen) > barLen * 0.3) continue;

        var patternSize = barLen + 1;
        if (patternSize < minSize) continue;

        var found = false;
        for (var p = 0; p < patterns.length; p++) {
          var dx = x - patterns[p].x;
          var dy = y - patterns[p].y;
          if (dx * dx + dy * dy < patternSize * patternSize) { found = true; break; }
        }
        if (!found) {
          patterns.push({ x: x, y: y, size: patternSize });
        }
      }
    }
    return patterns;
  }

  function detectFinderCenter(bin, w, h, startX, startY, searchSize) {
    var count = 0;
    var sumX = 0, sumY = 0;
    var halfSearch = searchSize;
    for (var dy = -halfSearch; dy <= halfSearch; dy++) {
      for (var dx = -halfSearch; dx <= halfSearch; dx++) {
        var px = startX + dx;
        var py = startY + dy;
        if (px >= 0 && px < w && py >= 0 && py < h && bin[py * w + px] === 1) {
          sumX += px;
          sumY += py;
          count++;
        }
      }
    }
    return count > 0 ? { x: sumX / count, y: sumY / count } : { x: startX, y: startY };
  }

  /* ── Grid sampling ──────────────────────────────────────────────────── */

  function sampleGrid(bin, w, h, topLeft, topRight, bottomLeft, moduleCount) {
    var grid = [];
    for (var row = 0; row < moduleCount; row++) {
      grid[row] = new Uint8Array(moduleCount);
      for (var col = 0; col < moduleCount; col++) {
        var t = col / (moduleCount - 1);
        var s = row / (moduleCount - 1);
        var x = Math.round((1 - s) * ((1 - t) * topLeft.x + t * topRight.x) + s * ((1 - t) * bottomLeft.x + t * (bottomLeft.x + topRight.x - topLeft.x)));
        var y = Math.round((1 - s) * ((1 - t) * topLeft.y + t * topRight.y) + s * ((1 - t) * bottomLeft.y + t * (bottomLeft.y + topRight.y - topLeft.y)));
        if (x >= 0 && x < w && y >= 0 && y < h) {
          grid[row][col] = bin[y * w + x];
        }
      }
    }
    return grid;
  }

  /* ── Data extraction ────────────────────────────────────────────────── */

  function readFormat(grid, moduleCount) {
    var bits = '';
    for (var i = 0; i < 6; i++) bits += grid[8][i];
    bits += grid[8][7];
    bits += grid[8][8];
    bits += grid[7][8];
    for (var i = 5; i >= 0; i--) bits += grid[i][8];

    var bestEC = 0;
    var bestMask = 0;
    var bestScore = Infinity;

    for (var maskIdx = 0; maskIdx < 8; maskIdx++) {
      var formatVal = parseInt(bits, 2) ^ FORMAT_INFO_BITS[maskIdx];
      var ec = (formatVal >> 13) & 3;
      var mask = (formatVal >> 10) & 7;
      if (ec < 4) {
        var score = 0;
        for (var i = 0; i < 15; i++) {
          var bit = (formatVal >> (14 - i)) & 1;
          var expected = (FORMAT_INFO_BITS[maskIdx] >> (14 - i)) & 1;
          if (bit !== expected) score++;
        }
        if (score < bestScore) { bestScore = score; bestEC = ec; bestMask = mask; }
      }
    }

    return { ecLevel: bestEC, maskPattern: bestMask };
  }

  function getVersion(moduleCount) {
    return (moduleCount - 17) / 4;
  }

  function getECLevelChar(ecLevel) {
    return ['L', 'M', 'Q', 'H'][ecLevel];
  }

  function extractCodewords(grid, moduleCount, version) {
    var ecLevel = getECLevelChar(0);
    var params = EC_PARAMS[version];
    if (!params) return null;

    var totalModules = moduleCount * moduleCount;
    var reserved = 0;
    for (var i = 0; i < moduleCount; i++) {
      for (var j = 0; j < moduleCount; j++) {
        if (i < 9 && j < 9) { reserved++; continue; }
        if (i < 9 && j >= moduleCount - 8) { reserved++; continue; }
        if (i >= moduleCount - 8 && j < 9) { reserved++; continue; }
        if (i === 6 || j === 6) { reserved++; continue; }
        if (version >= 7 && (i < 6 && j >= moduleCount - 11 || i >= moduleCount - 11 && j < 6)) { reserved++; continue; }
      }
    }

    var dataModules = totalModules - reserved;
    var totalBits = Math.floor(dataModules / 8) * 8;

    var bits = '';
    var upward = true;
    var col = moduleCount - 1;
    while (col >= 0) {
      if (col === 6) col--;
      var range = upward ? [moduleCount - 1, 0] : [0, moduleCount - 1];
      var step = upward ? -1 : 1;
      for (var row = range[0]; row !== range[1] + step; row += step) {
        for (var dc = 0; dc <= 1; dc++) {
          var c = col - dc;
          if (c < 0) continue;
          if (row === 6 || c === 6) continue;
          if (row < 9 && c < 9) continue;
          if (row < 9 && c >= moduleCount - 8) continue;
          if (row >= moduleCount - 8 && c < 9) continue;
          if (version >= 7 && ((row < 6 && c >= moduleCount - 11) || (row >= moduleCount - 11 && c < 6))) continue;
          bits += grid[row][c] ? '1' : '0';
        }
      }
      upward = !upward;
      col -= 2;
    }

    return bits;
  }

  function unmaskGrid(grid, moduleCount, maskPattern) {
    var result = [];
    for (var r = 0; r < moduleCount; r++) {
      result[r] = new Uint8Array(moduleCount);
      for (var c = 0; c < moduleCount; c++) {
        if (r < 9 && c < 9) { result[r][c] = grid[r][c]; continue; }
        if (r < 9 && c >= moduleCount - 8) { result[r][c] = grid[r][c]; continue; }
        if (r >= moduleCount - 8 && c < 9) { result[r][c] = grid[r][c]; continue; }
        if (r === 6 || c === 6) { result[r][c] = grid[r][c]; continue; }
        var mask = MASK_FUNCTIONS[maskPattern](r, c);
        result[r][c] = mask ? (grid[r][c] ^ 1) : grid[r][c];
      }
    }
    return result;
  }

  function bitsToBytes(bits) {
    var bytes = [];
    for (var i = 0; i + 7 < bits.length; i += 8) {
      bytes.push(parseInt(bits.substring(i, i + 8), 2));
    }
    return new Uint8Array(bytes);
  }

  function decodeData(bytes, version) {
    if (bytes.length < 2) return '';
    var bitIdx = 0;
    function readBits(n) {
      var val = 0;
      for (var i = 0; i < n; i++) {
        val = (val << 1) | (bytes[bitIdx >> 3] >> (7 - (bitIdx & 7)) & 1);
        bitIdx++;
      }
      return val;
    }

    var mode = readBits(4);
    if (mode === 0x4) {
      var len = readBits(version <= 9 ? 8 : 16);
      var text = '';
      for (var i = 0; i < len; i++) {
        text += String.fromCharCode(readBits(8));
      }
      try {
        var decoder = new TextDecoder('utf-8');
        var arr = new Uint8Array(len);
        for (var i = 0; i < len; i++) arr[i] = bytes[2 + (version <= 9 ? 1 : 2) + i] || 0;
        return decoder.decode(arr);
      } catch (e) {
        return text;
      }
    } else if (mode === 0x1) {
      var len = readBits(10);
      var text = '';
      for (var i = 0; i < len; i++) text += String.fromCharCode(readBits(8));
      return text;
    }
    return '';
  }

  /* ── Main decode function ───────────────────────────────────────────── */

  function tryDecode(bin, w, h) {
    var patterns = findFinderPatterns(bin, w, h);
    if (patterns.length < 3) return null;

    var sorted = patterns.slice(0, 3).sort(function (a, b) { return a.x + a.y - b.x - b.y; });
    var topLeft = detectFinderCenter(bin, w, h, sorted[0].x, sorted[0].y, 3);
    var bottomLeft = detectFinderCenter(bin, w, h, sorted[1].x, sorted[1].y, 3);
    var topRight = detectFinderCenter(bin, w, h, sorted[2].x, sorted[2].y, 3);

    if (topLeft.y > bottomLeft.y) { var tmp = topLeft; topLeft = bottomLeft; bottomLeft = tmp; }
    if (topLeft.x > topRight.x) { var tmp = topLeft; topLeft = topRight; topRight = tmp; }
    if (bottomLeft.x > topRight.x) { var tmp = bottomLeft; bottomLeft = topRight; topRight = tmp; }

    var dx1 = topRight.x - topLeft.x;
    var dy1 = topRight.y - topLeft.y;
    var dx2 = bottomLeft.x - topLeft.x;
    var dy2 = bottomLeft.y - topLeft.y;
    var size1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    var size2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    var estimatedModules = Math.round(Math.max(size1, size2) / 7 * (Math.max(size1, size2) > Math.min(size1, size2) * 1.5 ? 1.2 : 1));
    estimatedModules = Math.max(21, Math.min(105, estimatedModules));
    if ((estimatedModules - 17) % 4 !== 0) {
      estimatedModules = Math.round((estimatedModules - 17) / 4) * 4 + 17;
      if (estimatedModules < 21) estimatedModules = 21;
    }

    var grid = sampleGrid(bin, w, h, topLeft, topRight, bottomLeft, estimatedModules);

    var format = readFormat(grid, estimatedModules);
    var version = getVersion(estimatedModules);
    if (version < 1 || version > 10) return null;

    var unmasked = unmaskGrid(grid, estimatedModules, format.maskPattern);
    var bits = extractCodewords(unmasked, estimatedModules, version);
    if (!bits) return null;

    var bytes = bitsToBytes(bits);
    var ecLevel = getECLevelChar(format.ecLevel);
    var params = EC_PARAMS[version];
    if (!params) return null;
    var ecInfo = params[ecLevel];
    if (!ecInfo) return null;

    var dataLen = ecInfo[0];
    var ecLen = ecInfo[1];

    rsCorrect(bytes, ecLen, dataLen);

    var text = decodeData(bytes, version);
    if (!text) return null;

    return {
      data: text,
      location: {
        topLeftCorner: { x: Math.round(topLeft.x), y: Math.round(topLeft.y) },
        topRightCorner: { x: Math.round(topRight.x), y: Math.round(topRight.y) },
        bottomLeftCorner: { x: Math.round(bottomLeft.x), y: Math.round(bottomLeft.y) },
        bottomRightCorner: { x: Math.round(topRight.x + bottomLeft.x - topLeft.x), y: Math.round(topRight.y + bottomLeft.y - topLeft.y) }
      }
    };
  }

  window.JsQR = function (imageData, width, height, options) {
    if (!imageData || !width || !height) return null;
    var data = imageData.data || imageData;
    var gray = toGray(data, width, height);
    var bin = threshold(gray, width, height);

    var result = tryDecode(bin, width, height);
    if (result) return result;

    var inverted = new Uint8Array(width * height);
    for (var i = 0; i < bin.length; i++) inverted[i] = bin[i] ^ 1;
    result = tryDecode(inverted, width, height);
    return result;
  };
})();
