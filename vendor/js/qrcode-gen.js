/**
 * QR Code Generator - ISO/IEC 18004 compliant
 * Self-contained library. Exposes window.QRCodeGenerator.
 * Supports versions 1-40, EC levels L/M/Q/H, alphanumeric + byte (UTF-8) encoding.
 * Renders to Canvas (PNG) and SVG.
 */
(function () {
  'use strict';

  /* ── GF(256) arithmetic ─────────────────────────────────────────────── */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 256) x ^= 0x11d;
    }
    for (var i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* ── Reed-Solomon encoder ──────────────────────────────────────────── */
  function rsEncode(data, ecLen) {
    var gen = [1];
    for (var i = 0; i < ecLen; i++) {
      var ng = new Uint8Array(gen.length + 1);
      for (var j = 0; j < gen.length; j++) ng[j] = gen[j];
      for (var j = gen.length - 1; j >= 0; j--) {
        ng[j + 1] ^= gen[j];
        ng[j] = gfMul(gen[j], EXP[i]);
      }
      gen = ng;
    }
    var msg = new Uint8Array(data.length + ecLen);
    for (var i = 0; i < data.length; i++) msg[i] = data[i];
    for (var i = 0; i < data.length; i++) {
      var coef = msg[i];
      if (coef !== 0) {
        for (var j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return msg.slice(data.length);
  }

  /* ── EC tables (indexed by version 1-40, level 0-3 = L,M,Q,H) ────── */
  var EC_CODEWORDS = [
    null,
    [7,10,13,17],[10,16,22,28],[15,26,18,22],[20,18,26,16],
    [26,24,18,22],[18,16,24,28],[20,18,18,26],[24,22,22,26],
    [30,22,24,24],[18,26,28,30],[20,30,28,24],[24,22,26,28],
    [26,22,24,30],[30,24,28,24],[22,24,28,28],[24,28,28,30],
    [28,28,30,28],[30,26,28,30],[28,26,28,30],[28,26,28,30],
    [28,26,28,30],[30,28,30,30],[28,28,30,30],[30,28,30,30],
    [30,28,30,30],[26,28,30,30],[28,28,30,30],[30,28,30,30],
    [30,28,30,30],[30,28,30,30],[30,28,30,30],[30,28,30,30],
    [30,28,30,30],[30,28,30,30],[30,28,30,30],[30,28,30,30],
    [30,28,30,30],[30,28,30,30],[30,28,30,30],[30,28,30,30]
  ];
  var EC_BLOCKS = [
    null,
    [1,1,1,1],[1,1,1,2],[1,1,2,2],[1,2,2,4],
    [1,2,4,4],[2,4,4,4],[2,4,6,5],[2,4,6,6],
    [2,5,8,8],[4,5,8,8],[4,5,8,10],[4,8,10,10],
    [4,9,12,10],[4,9,16,12],[4,10,16,12],[4,10,18,12],
    [4,11,18,14],[4,13,18,14],[4,14,20,16],[4,16,20,16],
    [4,17,24,18],[4,18,24,18],[2,19,26,22],[2,20,28,22],
    [4,21,30,24],[4,23,32,24],[4,25,34,28],[4,26,34,28],
    [4,28,36,30],[4,29,38,30],[4,31,40,32],[4,33,42,34],
    [4,35,44,34],[4,36,46,38],[4,38,48,38],[4,39,50,40],
    [4,40,52,42],[4,42,54,42],[4,44,56,46],[4,46,58,48]
  ];

  /* ── Alignment pattern centre positions (version 2+) ──────────────── */
  var ALIGN_POS = [
    null, null,
    [6,18],[6,22],[6,26],[6,30],[6,34],
    [6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],
    [6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],
    [6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],
    [6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],
    [6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],
    [6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],
    [6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],
    [6,34,62,90,118,146],[6,30,54,78,102,126,150],
    [6,24,50,76,102,128,154],[6,28,54,80,106,132,158],
    [6,32,58,84,110,136,162],[6,26,54,82,110,138,166],
    [6,30,58,86,114,142,170]
  ];

  /* ── Format information BCH(15,5) + XOR mask 0x5412 ────────────────── */
  var FORMAT_INFO = (function () {
    var tbl = {};
    var levels = { L: 1, M: 0, Q: 3, H: 2 };
    var maskPoly = 0x5412;
    for (var name in levels) {
      for (var m = 0; m < 8; m++) {
        var d = (levels[name] << 3) | m;
        var rem = d << 10;
        for (var b = 4; b >= 0; b--)
          if (rem & (1 << (b + 10))) rem ^= 0x537 << b;
        var info = ((d << 10) | rem) ^ maskPoly;
        tbl[name + m] = info;
      }
    }
    return tbl;
  })();

  /* ── Version information BCH(18,6) for version >= 7 ────────────────── */
  var VER_INFO = (function () {
    var tbl = {};
    for (var v = 7; v <= 40; v++) {
      var rem = v << 12;
      for (var b = 5; b >= 0; b--)
        if (rem & (1 << (b + 12))) rem ^= 0x1F25 << b;
      tbl[v] = (v << 12) | rem;
    }
    return tbl;
  })();

  /* ── Module counts per version ─────────────────────────────────────── */
  function modCount(ver) { return 17 + ver * 4; }

  /* ── Matrix helpers ────────────────────────────────────────────────── */
  function makeMatrix(n) {
    var m = [];
    for (var i = 0; i < n; i++) {
      m[i] = [];
      for (var j = 0; j < n; j++) m[i][j] = 0;
    }
    return m;
  }
  function makeRes(n) {
    var r = [];
    for (var i = 0; i < n; i++) {
      r[i] = [];
      for (var j = 0; j < n; j++) r[i][j] = false;
    }
    return r;
  }

  /* ── Finder pattern (7×7) ──────────────────────────────────────────── */
  function placeFinder(mat, res, row, col) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var r = row + dr, c = col + dc;
        if (r < 0 || r >= mat.length || c < 0 || c >= mat.length) continue;
        res[r][c] = true;
        if (dr === -1 || dr === 7 || dc === -1 || dc === 7) {
          mat[r][c] = 0;
        } else if (dr === 0 || dr === 6 || dc === 0 || dc === 6) {
          mat[r][c] = 1;
        } else if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) {
          mat[r][c] = 1;
        } else {
          mat[r][c] = 0;
        }
      }
    }
  }

  /* ── Alignment pattern (5×5) ───────────────────────────────────────── */
  function placeAlign(mat, res, cr, cc) {
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var r = cr + dr, c = cc + dc;
        if (res[r][c]) continue;
        res[r][c] = true;
        if (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0))
          mat[r][c] = 1;
        else mat[r][c] = 0;
      }
    }
  }

  /* ── Build all function patterns ────────────────────────────────────── */
  function buildFunc(mat, res) {
    var n = mat.length, ver = (n - 17) / 4;

    // Finder + separator
    placeFinder(mat, res, 0, 0);
    placeFinder(mat, res, 0, n - 7);
    placeFinder(mat, res, n - 7, 0);

    // Timing
    for (var i = 8; i < n - 8; i++) {
      if (!res[6][i]) { res[6][i] = true; mat[6][i] = (i + 1) & 1; }
      if (!res[i][6]) { res[i][6] = true; mat[i][6] = (i + 1) & 1; }
    }

    // Alignment
    if (ver >= 2) {
      var ap = ALIGN_POS[ver];
      for (var i = 0; i < ap.length; i++)
        for (var j = 0; j < ap.length; j++)
          if (!res[ap[i]][ap[j]])
            placeAlign(mat, res, ap[i], ap[j]);
    }

    // Dark module
    mat[n - 8][8] = 1;
    res[n - 8][8] = true;

    // Format info positions (skip for now, mark reserved)
    for (var i = 0; i <= 8; i++) {
      if (!res[8][i]) { res[8][i] = true; }
      if (!res[i][8]) { res[i][8] = true; }
      if (!res[8][n - 1 - i]) { res[8][n - 1 - i] = true; }
      if (!res[n - 1 - i][8]) { res[n - 1 - i][8] = true; }
    }
    res[8][8] = true;

    // Version info (version >= 7)
    if (ver >= 7) {
      for (var i = 0; i < 6; i++)
        for (var j = 0; j < 3; j++) {
          res[i][n - 11 + j] = true;
          res[n - 11 + j][i] = true;
        }
    }
  }

  /* ── Place format information bits ──────────────────────────────────── */
  function placeFormat(mat, level, mask) {
    var n = mat.length;
    var info = FORMAT_INFO[level + mask];
    var bits = [];
    for (var i = 14; i >= 0; i--) bits.push((info >> i) & 1);

    // Around top-left finder
    var pos1 = [
      [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
      [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]
    ];
    for (var i = 0; i < 15; i++) mat[pos1[i][0]][pos1[i][1]] = bits[i];

    // Split: bottom-left and top-right
    for (var i = 0; i < 7; i++) mat[n - 1 - i][8] = bits[i];
    for (var i = 0; i < 8; i++) mat[8][n - 8 + i] = bits[14 - i];
  }

  /* ── Place version information (version >= 7) ───────────────────────── */
  function placeVersion(mat, ver) {
    if (ver < 7) return;
    var n = mat.length;
    var info = VER_INFO[ver];
    for (var i = 0; i < 18; i++) {
      var bit = (info >> i) & 1;
      var r = Math.floor(i / 3), c = i % 3;
      mat[r][n - 11 + c] = bit;
      mat[n - 11 + c][r] = bit;
    }
  }

  /* ── Masking ────────────────────────────────────────────────────────── */
  function maskBit(pat, r, c) {
    switch (pat) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      case 7: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
    }
  }

  function penalty(mat) {
    var n = mat.length, p = 0;
    // Rule 1 – consecutive same-colour modules in row/column
    for (var r = 0; r < n; r++) {
      var run = 1;
      for (var c = 1; c < n; c++) {
        if (mat[r][c] === mat[r][c - 1]) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
    for (var c = 0; c < n; c++) {
      var run = 1;
      for (var r = 1; r < n; r++) {
        if (mat[r][c] === mat[r - 1][c]) run++;
        else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
    // Rule 2 – 2×2 blocks
    for (var r = 0; r < n - 1; r++)
      for (var c = 0; c < n - 1; c++) {
        var v = mat[r][c];
        if (v === mat[r][c + 1] && v === mat[r + 1][c] && v === mat[r + 1][c + 1]) p += 3;
      }
    // Rule 3 – finder-like patterns
    for (var r = 0; r < n; r++)
      for (var c = 0; c < n - 10; c++) {
        if (mat[r][c]===1&&mat[r][c+1]===0&&mat[r][c+2]===1&&mat[r][c+3]===1&&
            mat[r][c+4]===0&&mat[r][c+5]===1&&mat[r][c+6]===0&&mat[r][c+7]===0&&
            mat[r][c+8]===0&&mat[r][c+9]===0&&mat[r][c+10]===0) p += 40;
        if (mat[r][c]===0&&mat[r][c+1]===0&&mat[r][c+2]===0&&mat[r][c+3]===0&&
            mat[r][c+4]===0&&mat[r][c+5]===1&&mat[r][c+6]===0&&mat[r][c+7]===1&&
            mat[r][c+8]===1&&mat[r][c+9]===0&&mat[r][c+10]===1) p += 40;
      }
    for (var c = 0; c < n; c++)
      for (var r = 0; r < n - 10; r++) {
        if (mat[r][c]===1&&mat[r+1][c]===0&&mat[r+2][c]===1&&mat[r+3][c]===1&&
            mat[r+4][c]===0&&mat[r+5][c]===1&&mat[r+6][c]===0&&mat[r+7][c]===0&&
            mat[r+8][c]===0&&mat[r+9][c]===0&&mat[r+10][c]===0) p += 40;
        if (mat[r][c]===0&&mat[r+1][c]===0&&mat[r+2][c]===0&&mat[r+3][c]===0&&
            mat[r+4][c]===0&&mat[r+5][c]===1&&mat[r+6][c]===0&&mat[r+7][c]===1&&
            mat[r+8][c]===1&&mat[r+9][c]===0&&mat[r+10][c]===1) p += 40;
      }
    // Rule 4 – proportion of dark modules
    var dark = 0;
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (mat[r][c]) dark++;
    var pct = dark * 100 / (n * n);
    var prev5 = Math.floor(pct / 5) * 5, next5 = prev5 + 5;
    p += Math.min(Math.abs(prev5 - 50) / 5, Math.abs(next5 - 50) / 5) * 10;
    return p;
  }

  /* ── Data analysis & encoding ───────────────────────────────────────── */
  function isNumeric(s) { return /^\d+$/.test(s); }

  var ALPHASET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  function isAlpha(s) {
    for (var i = 0; i < s.length; i++)
      if (ALPHASET.indexOf(s[i]) === -1) return false;
    return true;
  }

  function ccBits(ver, mode) {
    if (mode === 1) return ver <= 9 ? 10 : ver <= 26 ? 12 : 14;
    if (mode === 2) return ver <= 9 ? 9 : ver <= 26 ? 11 : 13;
    return ver <= 9 ? 8 : ver <= 26 ? 16 : 16;
  }

  function dataCap(ver, ec, mode) {
    var ecLvl = { L: 0, M: 1, Q: 2, H: 3 }[ec];
    var n = modCount(ver);
    var total = n * n;
    var used = 0;
    // Finders
    used += 3 * 64;
    // Separators (thin borders around finders that overlap)
    used += 2 * (n - 7 * 2) + 2 * 15;  // approximate; safe to over-count
    // Actually let's compute it properly:
    used = 0;
    // Top-left finder + sep: rows 0-7, cols 0-7 = 64, but col 8 & row 8 are separators
    // Let's just count function pattern area properly
    // Finder + sep occupies 8x8 in three corners, minus overlaps
    used = 3 * 64 + 2 * (n - 16); // separators on two sides minus corners
    // Actually, let's be more precise about function patterns:
    // This is getting complex. Let's use the standard formula:
    // total data modules = (total modules) - (function pattern modules) - (format/version modules)
    // Then data codewords = floor(data modules / 8)
    // Then actual data capacity = data codewords - EC codewords
    
    // Standard method: total codewords for version, minus EC codewords
    var ecLvl2 = { L: 0, M: 1, Q: 2, H: 3 }[ec];
    var ecPerBlock = EC_CODEWORDS[ver][ecLvl2];
    var numBlocks = EC_BLOCKS[ver][ecLvl2];
    
    // Total data codewords = total codewords - total EC codewords
    // Total codewords = floor(total_data_modules / 8)
    // Let's compute total data modules more carefully
    
    // Function pattern modules
    var fpModules = 0;
    // Three finder patterns: 8x8 each (including separator) but corners overlap
    // Top-left: rows 0-7, cols 0-7 = 64
    // Top-right: rows 0-7, cols n-8 to n-1 = 64
    // Bottom-left: rows n-8 to n-1, cols 0-7 = 64
    fpModules = 64 * 3;
    // Separators along top and left (already included in 8x8)
    // Separator along right of top-right: rows 0-7, col n-8 (already in 64)
    // Separator along bottom of bottom-left: row n-8, cols 0-7 (already in 64)
    // Additional separator: row 7, cols 8 to n-8-1 ... no wait
    // Let me think again. The separator is the row/column of white modules
    // adjacent to the finder patterns.
    
    // Actually, the standard approach: 
    // Finder patterns: 3 × (7×7) = 147
    // Separators: top-left has right sep (1×7) + bottom sep (7×1) = 13
    //             top-right has left sep (1×7) + bottom sep (7×1) = 13
    //             bottom-left has right sep (1×7) + top sep (7×1) = 13
    // But separators adjacent to timing/other overlap.
    // Easier: count 8×8 blocks for three corners = 192, then subtract overlaps
    // Top-left & top-right share row 0-7 → overlap is 0 (they're at opposite sides)
    // Actually no overlap between the 8×8 regions since they're in corners.
    // But: separators extend to form a border, not full 8×8.
    // Top-left: finder 7×7 + right sep 1×7 + bottom sep 7×1 = 49+7+7 = 63
    // Plus corner (row 7, col 7) = 1 → 64? Yes, 8×8 = 64.
    // Top-right similarly = 64.
    // Bottom-left similarly = 64.
    // Total so far: 192
    // Timing patterns: row 6 from col 8 to col n-9, and col 6 from row 8 to row n-9
    // Length of each: n - 16. Two of them. But timing is ON function pattern,
    // so modules that overlap with alignment patterns or other things are already counted.
    // Actually timing doesn't overlap with finders/separators since it starts at col 8.
    var timingLen = n - 16; // modules between separators
    fpModules += 2 * timingLen; // but subtract where alignment patterns are
    // Alignment patterns: each 5×5 = 25, but those overlapping timing are already excluded
    // Total alignment patterns (excluding those overlapping finders):
    if (ver >= 2) {
      var ap = ALIGN_POS[ver];
      var count = 0;
      for (var i = 0; i < ap.length; i++)
        for (var j = 0; j < ap.length; j++) {
          // Skip if overlaps with finder pattern area (rows 0-8 or cols 0-8 for top-left, etc.)
          var r = ap[i], c = ap[j];
          if (r <= 8 && c <= 8) continue; // top-left finder area
          if (r <= 8 && c >= n - 9) continue; // top-right
          if (r >= n - 9 && c <= 8) continue; // bottom-left
          count++;
        }
      fpModules += count * 25;
    }
    // Subtract timing modules that overlap with alignment patterns
    // This is getting really messy. Let me just use a direct formula.
    
    // OK, simpler approach: for version v, total codewords (data + EC) is known.
    // It's available in the spec tables. Let me compute it from the module count.
    
    // Total modules = n²
    // Function pattern modules = 3×64 + separators + timing + alignment + format + version
    // Let me compute it by actually counting.
    
    // Actually, the simplest correct approach: build a blank matrix, mark all
    // function patterns, and count the remaining modules. But that's O(n²).
    // For the capacity calculation, let's use pre-computed total data codewords.
    
    // Total data codewords per version (all EC levels have same total, different EC/data split):
    // v1=26, v2=44, v3=70, v4=100, v5=134, v6=172, v7=196, v8=242, v9=292, v10=346
    // v11=404, v12=466, v13=532, v14=581, v15=655, v16=733, v17=815, v18=901, v19=991
    // v20=1085, v21=1156, v22=1258, v23=1364, v24=1474, v25=1588, v26=1706, v27=1828
    // v28=1921, v29=2051, v30=2185, v31=2323, v32=2465, v33=2611, v34=2761
    // v35=2876, v36=3034, v37=3196, v38=3362, v39=3532, v40=3706
    var TOTAL_CW = [
      0,26,44,70,100,134,172,196,242,292,346,
      404,466,532,581,655,733,815,901,991,1085,
      1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,
      2323,2465,2611,2761,2876,3034,3196,3362,3532,3706
    ];
    
    var totalCW = TOTAL_CW[ver];
    var totalEC = ecPerBlock * numBlocks;
    var dataCW = totalCW - totalEC;
    var dataBits = dataCW * 8;
    
    // Subtract mode indicator (4 bits) and character count indicator
    var overhead = 4 + ccBits(ver, mode);
    
    if (mode === 1) {
      // Numeric: 3 digits = 10 bits, remainder = 7 or 4
      var trios = Math.floor(data.length / 3);
      var rem = data.length % 3;
      var payloadBits = trios * 10 + (rem === 2 ? 7 : rem === 1 ? 4 : 0);
      return dataBits >= overhead + payloadBits;
    } else if (mode === 2) {
      // Alphanumeric: 2 chars = 11 bits, remainder = 6
      var pairs = Math.floor(data.length / 2);
      var payloadBits = pairs * 11 + (data.length & 1) * 6;
      return dataBits >= overhead + payloadBits;
    } else {
      // Byte: 8 bits per char
      return dataBits >= overhead + data.length * 8;
    }
  }

  function bestVersion(len, ec) {
    for (var v = 1; v <= 40; v++) {
      if (isNumeric(len + '')) {
        if (dataCap(v, ec, 1)) return v;
      } else if (isAlpha(len + '')) {
        if (dataCap(v, ec, 2)) return v;
      }
      if (dataCap(v, ec, 4)) return v;
    }
    return -1;
  }

  // Overload: bestVersion with actual data string
  function bestVersionFor(text, ec) {
    var u8 = new TextEncoder().encode(text);
    if (isNumeric(text)) {
      for (var v = 1; v <= 40; v++) if (dataCap(v, ec, 1)) return { ver: v, mode: 1 };
    }
    if (isAlpha(text)) {
      for (var v = 1; v <= 40; v++) if (dataCap(v, ec, 2)) return { ver: v, mode: 2 };
    }
    for (var v = 1; v <= 40; v++) if (dataCap(v, ec, 4)) return { ver: v, mode: 4 };
    return null;
  }

  /* ── Encode data to bit stream ──────────────────────────────────────── */
  function encodeData(text, ver, ecLvl) {
    var u8 = new TextEncoder().encode(text);
    var mode;
    if (isNumeric(text)) mode = 1;
    else if (isAlpha(text)) mode = 2;
    else mode = 4;

    var ecLvlIdx = { L: 0, M: 1, Q: 2, H: 3 }[ecLvl];
    var ecPer = EC_CODEWORDS[ver][ecLvlIdx];
    var numBlocks = EC_BLOCKS[ver][ecLvlIdx];
    var totalCW = [0,26,44,70,100,134,172,196,242,292,346,
      404,466,532,581,655,733,815,901,991,1085,
      1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,
      2323,2465,2611,2761,2876,3034,3196,3362,3532,3706][ver];
    var totalEC = ecPer * numBlocks;
    var dataCW = totalCW - totalEC;

    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }

    // Mode indicator
    push(mode, 4);

    // Character count
    var ccLen = ccBits(ver, mode);
    if (mode === 1) push(u8.length, ccLen);
    else if (mode === 2) push(text.length, ccLen);
    else push(u8.length, ccLen);

    // Data
    if (mode === 1) {
      for (var i = 0; i + 2 < u8.length; i += 3)
        push((u8[i] - 48) * 100 + (u8[i + 1] - 48) * 10 + (u8[i + 2] - 48), 10);
      if (u8.length % 3 === 2) push((u8[u8.length - 2] - 48) * 10 + (u8[u8.length - 1] - 48), 7);
      else if (u8.length % 3 === 1) push(u8[u8.length - 1] - 48, 4);
    } else if (mode === 2) {
      var s = text.toUpperCase();
      for (var i = 0; i + 1 < s.length; i += 2)
        push(ALPHASET.indexOf(s[i]) * 45 + ALPHASET.indexOf(s[i + 1]), 11);
      if (s.length & 1) push(ALPHASET.indexOf(s[s.length - 1]), 6);
    } else {
      for (var i = 0; i < u8.length; i++) push(u8[i], 8);
    }

    // Terminator (up to 4 zero bits)
    var maxBits = dataCW * 8;
    var termLen = Math.min(4, maxBits - bits.length);
    push(0, termLen);

    // Byte-align to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    // Pad bytes
    var padBytes = [0xEC, 0x11];
    var pi = 0;
    while (bits.length < maxBits) {
      push(padBytes[pi], 8);
      pi = 1 - pi;
    }

    // Convert to bytes
    var data = new Uint8Array(dataCW);
    for (var i = 0; i < dataCW; i++) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
      data[i] = b;
    }

    // Interleave data blocks
    var dataBlocks = [];
    var ecBlocks = [];
    var cwPerBlock = Math.floor(dataCW / numBlocks);
    var longBlocks = dataCW - cwPerBlock * numBlocks; // first N blocks have +1

    var offset = 0;
    for (var i = 0; i < numBlocks; i++) {
      var len = cwPerBlock + (i < longBlocks ? 1 : 0);
      var block = data.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecPer));
    }

    // Interleave data codewords
    var result = [];
    var maxDataLen = cwPerBlock + (longBlocks > 0 ? 1 : 0);
    for (var i = 0; i < maxDataLen; i++) {
      for (var b = 0; b < numBlocks; b++) {
        if (i < dataBlocks[b].length) result.push(dataBlocks[b][i]);
      }
    }
    // Interleave EC codewords
    for (var i = 0; i < ecPer; i++) {
      for (var b = 0; b < numBlocks; b++) {
        result.push(ecBlocks[b][i]);
      }
    }

    return new Uint8Array(result);
  }

  /* ── Place data bits into matrix (two-column upward/downward) ───────── */
  function placeData(mat, reserved, codewords) {
    var n = mat.length;
    var bitIdx = 0;
    var totalBits = codewords.length * 8;

    // Right-to-left, two columns at a time
    for (var right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // Skip timing column

      for (var vert = 0; vert < n; vert++) {
        for (var j = 0; j < 2; j++) {
          var col = right - j;
          // Direction alternates per two-column band
          var upward = ((n - 1 - right) / 2) % 2 === 0;
          var row = upward ? n - 1 - vert : vert;

          if (row < 0 || row >= n || col < 0 || col >= n) continue;
          if (reserved[row][col]) continue;

          if (bitIdx < totalBits) {
            var byteIdx = bitIdx >> 3;
            var bitPos = 7 - (bitIdx & 7);
            mat[row][col] = (codewords[byteIdx] >> bitPos) & 1;
            bitIdx++;
          } else {
            mat[row][col] = 0;
          }
        }
      }
    }
  }

  /* ── Build complete QR matrix ────────────────────────────────────────── */
  function buildQR(text, ecLvl) {
    var info = bestVersionFor(text, ecLvl);
    if (!info) throw new Error('Data too long for any QR version');
    var ver = info.ver;
    var n = modCount(ver);
    var mat = makeMatrix(n);
    var reserved = makeRes(n);

    buildFunc(mat, reserved);
    placeVersion(mat, ver);

    var codewords = encodeData(text, ver, ecLvl);
    placeData(mat, reserved, codewords);

    // Try all 8 masks, pick lowest penalty
    var best = null, bestP = Infinity;
    for (var m = 0; m < 8; m++) {
      var trial = makeMatrix(n);
      for (var r = 0; r < n; r++)
        for (var c = 0; c < n; c++)
          trial[r][c] = reserved[r][c] ? mat[r][c] : (mat[r][c] ^ (maskBit(m, r, c) ? 1 : 0));
      placeFormat(trial, ecLvl, m);
      var p = penalty(trial);
      if (p < bestP) { bestP = p; best = trial; }
    }
    return best;
  }

  /* ── Canvas renderer ────────────────────────────────────────────────── */
  function renderCanvas(matrix, opts) {
    var n = matrix.length;
    var margin = (opts.margin || 4) * (opts.size / (n + (opts.margin || 4) * 2));
    var cellSize = (opts.size - margin * 2) / n;

    var canvas = document.createElement('canvas');
    canvas.width = opts.size;
    canvas.height = opts.size;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = opts.background || '#ffffff';
    ctx.fillRect(0, 0, opts.size, opts.size);

    ctx.fillStyle = opts.foreground || '#000000';
    for (var r = 0; r < n; r++)
      for (var c = 0; c < n; c++)
        if (matrix[r][c])
          ctx.fillRect(
            Math.round(margin + c * cellSize),
            Math.round(margin + r * cellSize),
            Math.ceil(cellSize),
            Math.ceil(cellSize)
          );
    return canvas;
  }

  /* ── SVG renderer ────────────────────────────────────────────────────── */
  function renderSVG(matrix, opts) {
    var n = matrix.length;
    var m = opts.margin || 4;
    var size = n + m * 2;

    var rects = '';
    for (var r = 0; r < n; r++)
      for (var c = 0; c < n; c++)
        if (matrix[r][c])
          rects += '<rect x="' + (c + m) + '" y="' + (r + m) + '" width="1" height="1"/>';

    var fill = opts.transparent ? 'none' : (opts.background || '#ffffff');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
      '" shape-rendering="crispEdges" width="' + opts.size + '" height="' + opts.size + '">' +
      '<rect width="' + size + '" height="' + size + '" fill="' + fill + '"/>' +
      '<g fill="' + (opts.foreground || '#000000') + '">' + rects + '</g></svg>';
  }

  /* ── Public API ─────────────────────────────────────────────────────── */
  window.QRCodeGenerator = {
    generate: function (text, options) {
      var opts = {
        size: (options && options.size) || 256,
        margin: options && options.margin !== undefined ? options.margin : 4,
        errorCorrection: (options && options.errorCorrection) || 'M',
        foreground: (options && options.foreground) || '#000000',
        background: (options && options.background) || '#ffffff',
        transparent: options && !!options.transparent
      };
      var matrix = buildQR(text, opts.errorCorrection);

      var canvas = renderCanvas(matrix, opts);
      var svgString = renderSVG(matrix, opts);

      return {
        canvas: canvas,
        svg: svgString,
        toPNG: function () {
          return new Promise(function (resolve) {
            canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
          });
        },
        toSVG: function () { return svgString; },
        getDataURL: function () { return canvas.toDataURL('image/png'); }
      };
    },

    toPNG: function (text, options) {
      return window.QRCodeGenerator.generate(text, options).toPNG();
    },

    toSVG: function (text, options) {
      return window.QRCodeGenerator.generate(text, options).toSVG();
    },

    getDataURL: function (text, options) {
      return window.QRCodeGenerator.generate(text, options).getDataURL();
    }
  };
})();
