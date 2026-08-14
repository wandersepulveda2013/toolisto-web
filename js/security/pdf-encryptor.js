'use strict';

/**
 * PDFEncryptor — Standard Security Handler (ISO 32000-1 §7.6) para Toolisto.
 *
 * pdf-lib (único escritor PDF vendoreado) NO implementa el security handler
 * estándar: su opción save({ userPassword }) es ignorada y produce un PDF sin
 * cifrar. Este módulo aporta la "capa de serialización propia" necesaria:
 *
 *  1. Recibe el PDF re-serializado por pdf-lib (useObjectStreams:false,
 *     xref clásico y trailer con la palabra clave "trailer").
 *  2. Re-parsea el documento, calcula el material criptográfico estándar
 *     (O, U, P, clave de archivo) y vuelve a serializar todo el archivo con
 *     cifrado real:
 *        - AES-128 (V=4, R=4, AESV2) cuando crypto.subtle está disponible.
 *        - RC4-128 (V=2, R=3) como respaldo sin dependencia de WebCrypto.
 *  3. Cifra todos los strings y streams del documento (excepto el dict /Encrypt
 *     y el /ID del trailer, como exige el estándar) y reescribe xref + trailer.
 *
 * Salida compatible con lectores PDF estándar (se valida en E2E con pdf.js).
 */

(function () {
  // =====================================================================
  // Helpers de bytes (representación latin1 lossless para parsing)
  // =====================================================================
  function toBytes(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function fromBytes(u) {
    var s = '';
    for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return s;
  }

  function concat(arrays) {
    var len = 0;
    for (var i = 0; i < arrays.length; i++) len += arrays[i].length;
    var out = new Uint8Array(len);
    var o = 0;
    for (var j = 0; j < arrays.length; j++) { out.set(arrays[j], o); o += arrays[j].length; }
    return out;
  }

  function toHex(u) {
    var hex = '0123456789abcdef';
    var s = '';
    for (var i = 0; i < u.length; i++) s += hex[u[i] >> 4] + hex[u[i] & 0x0f];
    return s;
  }

  function hexVal(c) {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
    return -1;
  }

  function pad10(n) {
    var s = String(n);
    while (s.length < 10) s = '0' + s;
    return s;
  }

  // =====================================================================
  // MD5 (implementación pura, algoritmo estándar RFC 1321)
  // =====================================================================
  var MD5_T = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];
  var MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  function rol(x, c) { return (x << c) | (x >>> (32 - c)); }

  function md5(input) {
    var bitLen = input.length * 8;
    var paddedLen = (((input.length + 8) >> 6) + 1) << 6;
    var buf = new Uint8Array(paddedLen);
    buf.set(input, 0);
    buf[input.length] = 0x80;
    var lo = bitLen >>> 0;
    var hi = Math.floor(bitLen / 4294967296);
    buf[paddedLen - 8] = lo & 0xff;
    buf[paddedLen - 7] = (lo >>> 8) & 0xff;
    buf[paddedLen - 6] = (lo >>> 16) & 0xff;
    buf[paddedLen - 5] = (lo >>> 24) & 0xff;
    buf[paddedLen - 4] = hi & 0xff;
    buf[paddedLen - 3] = (hi >>> 8) & 0xff;
    buf[paddedLen - 2] = (hi >>> 16) & 0xff;
    buf[paddedLen - 1] = (hi >>> 24) & 0xff;

    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (var block = 0; block < paddedLen; block += 64) {
      var M = new Int32Array(16);
      for (var j = 0; j < 16; j++) {
        var o = block + j * 4;
        M[j] = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24);
      }
      var A = a0, B = b0, C = c0, D = d0;
      for (var i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + MD5_T[i] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + rol(F, MD5_S[i])) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    function le(x) { return new Uint8Array([x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff]); }
    return concat([le(a0), le(b0), le(c0), le(d0)]);
  }

  // =====================================================================
  // RC4 (puro, para el handler estándar)
  // =====================================================================
  function rc4(key, data) {
    var S = new Uint8Array(256);
    var i, j = 0, t;
    for (i = 0; i < 256; i++) S[i] = i;
    for (i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 0xff;
      t = S[i]; S[i] = S[j]; S[j] = t;
    }
    var out = new Uint8Array(data.length);
    var a = 0, b = 0;
    for (i = 0; i < data.length; i++) {
      a = (a + 1) & 0xff;
      b = (b + S[a]) & 0xff;
      t = S[a]; S[a] = S[b]; S[b] = t;
      out[i] = data[i] ^ S[(S[a] + S[b]) & 0xff];
    }
    return out;
  }

  // =====================================================================
  // AES-128-CBC vía WebCrypto (con IV aleatorio + PKCS7)
  // =====================================================================
  var supportsAes = typeof crypto !== 'undefined' && !!crypto.subtle &&
    typeof crypto.subtle.importKey === 'function' && typeof crypto.subtle.encrypt === 'function';

  async function aesCbcEncrypt(keyBytes, data) {
    var iv = crypto.getRandomValues(new Uint8Array(16));
    var key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
    var padLen = 16 - (data.length % 16);
    var padded = new Uint8Array(data.length + padLen);
    padded.set(data, 0);
    for (var i = data.length; i < padded.length; i++) padded[i] = padLen;
    var ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv }, key, padded);
    var out = new Uint8Array(16 + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), 16);
    return out;
  }

  async function encryptBytes(key, data, useAes) {
    if (useAes) return aesCbcEncrypt(key, data);
    return rc4(key, data);
  }

  // =====================================================================
  // Material criptográfico (algoritmos 2, 3 y 5 de ISO 32000-1)
  // =====================================================================
  var PAD_BYTES = new Uint8Array([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
    0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
    0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
  ]);

  function padPassword(pw) {
    var b = toBytes(pw || '');
    var out = new Uint8Array(32);
    if (b.length >= 32) { out.set(b.slice(0, 32)); return out; }
    out.set(b, 0);
    for (var i = 0; i < 32 - b.length; i++) out[b.length + i] = PAD_BYTES[i];
    return out;
  }

  function xorKey(key, i) {
    var k = new Uint8Array(key.length);
    for (var j = 0; j < key.length; j++) k[j] = key[j] ^ i;
    return k;
  }

  // Algoritmo 3 — valor O (owner password), R >= 3
  function computeO(ownerPadded, userPadded, keylen) {
    var d = md5(ownerPadded);
    for (var i = 0; i < 50; i++) d = md5(d);
    var key = d.slice(0, keylen);
    var out = rc4(key, userPadded);
    for (var i2 = 1; i2 <= 19; i2++) out = rc4(xorKey(key, i2), out);
    return out;
  }

  // Algoritmo 2 — clave de archivo K a partir de la contraseña de usuario
  // ISO 32000-1 7.6.3.3: para R >= 3 el hash combina paddedUser + O + P(LE) + ID[0:16].
  // En R = 4 (AESV2) la derivación es la misma que en R = 3; la cadena "sAlT" solo
  // se usa en R = 6 (AES-256), nunca aquí.
  function computeK(userPadded, O, P, id0, keylen) {
    var parts = [
      userPadded,
      O,
      new Uint8Array([P & 0xff, (P >>> 8) & 0xff, (P >>> 16) & 0xff, (P >>> 24) & 0xff]),
      id0
    ];
    var d = md5(concat(parts));
    for (var i = 0; i < 50; i++) d = md5(d.slice(0, keylen));
    return d.slice(0, keylen);
  }

  // Algoritmo 5 — valor U (user password), R >= 3
  // El hash de U combina la cadena de padding FIJA de 32 bytes + fileID[0]
  // (ISO 32000-1 7.6.3.3 Algoritmo 5; los lectores reales, pdf.js y PyPDF2,
  // validan Algo 6 con MD5(PAD + ID) — la variación por contraseña entra
  // únicamente vía la clave de archivo K en el RC4). Luego 20 pasadas RC4 con
  // la clave de archivo (iteración i XOR 1..19). Los primeros 16 bytes son U.
  function computeU(K, id0) {
    var h = md5(concat([PAD_BYTES, id0]));
    var out = rc4(K, h);
    for (var i = 1; i <= 19; i++) out = rc4(xorKey(K, i), out);
    var U = new Uint8Array(32);
    U.set(out, 0);
    return U;
  }

  // Clave por objeto (para cifrar strings y streams)
  // ISO 32000-1 7.6.3.2 Algoritmo 1: para AES el hash incluye "sAlT" y se
  // truncan n + 5 bytes; para RC4 no hay sal y se usan n bytes.
  function objectKey(K, num, gen, keylen, useAes) {
    var parts = [
      K,
      new Uint8Array([num & 0xff, (num >>> 8) & 0xff, (num >>> 16) & 0xff]),
      new Uint8Array([gen & 0xff, (gen >>> 8) & 0xff])
    ];
    if (useAes) parts.push(new Uint8Array([0x73, 0x41, 0x6c, 0x54])); // "sAlT"
    var d = md5(concat(parts));
    return d.slice(0, useAes ? keylen + 5 : keylen);
  }

  function buildPermissions(o) {
    var P = 0xffffffff;
    var allowPrint = o.allowPrint !== false;
    var allowCopy = o.allowCopy === true;
    var allowModify = o.allowModify === true;
    if (!allowPrint) { P &= ~(1 << 3); P &= ~(1 << 12); }
    if (!allowCopy) { P &= ~(1 << 5); P &= ~(1 << 10); }
    if (!allowModify) { P &= ~(1 << 4); P &= ~(1 << 6); P &= ~(1 << 9); P &= ~(1 << 11); }
    return P >>> 0;
  }

  // =====================================================================
  // Parser del documento (formato de salida de pdf-lib con xref clásico)
  // =====================================================================
  function isWs(c) { return c === 0x20 || c === 0x09 || c === 0x0d || c === 0x0a || c === 0x00; }
  function isEol(s, i) {
    var c = s.charCodeAt(i);
    return c === 0x0a || c === 0x0d;
  }
  function skipWs(s, i) {
    while (i < s.length && isWs(s.charCodeAt(i))) i++;
    return i;
  }
  function skipOneEol(s, i) {
    if (s.charCodeAt(i) === 0x0d) return s.charCodeAt(i + 1) === 0x0a ? i + 2 : i + 1;
    if (s.charCodeAt(i) === 0x0a) return i + 1;
    return i;
  }
  function skipLiteralString(s, i) {
    var n = s.length, depth = 1;
    i++;
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c === 0x5c) { i += 2; continue; }
      if (c === 0x28) depth++;
      else if (c === 0x29) { depth--; if (depth === 0) return i + 1; }
      i++;
    }
    throw new Error('PDF inválido: string literal sin cerrar.');
  }
  function skipHexString(s, i) {
    var n = s.length;
    i++; // tras '<'
    while (i < n && s.charCodeAt(i) !== 0x3e) i++;
    if (i >= n) throw new Error('PDF inválido: string hex sin cerrar.');
    return i + 1;
  }
  // Devuelve la posición justo después de '>>' del dict que empieza en `start`
  function scanDictEnd(s, start) {
    var i = start, n = s.length, depth = 0;
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c === 0x3c) {
        if (s.charCodeAt(i + 1) === 0x3c) { depth++; i += 2; }
        else i = skipHexString(s, i);
      } else if (c === 0x3e) {
        if (s.charCodeAt(i + 1) === 0x3e) { depth--; i += 2; if (depth === 0) return i; }
        else i++;
      } else if (c === 0x28) {
        i = skipLiteralString(s, i);
      } else if (c === 0x25) {
        while (i < n && !isEol(s, i)) i++;
      } else {
        i++;
      }
    }
    throw new Error('PDF inválido: dict no balanceado.');
  }
  // Lee el /Length directo de un dict de stream (pdf-lib usa longitud directa)
  function readStreamLength(dictText) {
    var m = dictText.match(/\/Length\s+(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  // Escanea un objeto desde `start` (justo después de "N G obj")
  function scanObject(s, start) {
    var dictEnd = scanDictEnd(s, start);
    var dictText = s.slice(start, dictEnd);
    var j = skipWs(s, dictEnd);
    if (s.slice(j, j + 6) === 'stream' && isEol(s, j + 6)) {
      var dataStart = skipOneEol(s, j + 6);
      var len = readStreamLength(dictText);
      var dataEnd;
      if (len > 0) {
        // /Length es autoritativo: el último byte del stream comprimido es
        // arbitrario y NO debe recortarse por coincidir con un EOL.
        dataEnd = dataStart + len;
      } else {
        var endIdx = s.indexOf('endstream', dataStart);
        if (endIdx < 0) throw new Error('PDF inválido: stream sin endstream.');
        dataEnd = endIdx;
        if (dataEnd > dataStart && s.charCodeAt(dataEnd - 1) === 0x0a) dataEnd--;
        if (dataEnd > dataStart && s.charCodeAt(dataEnd - 1) === 0x0d) dataEnd--;
      }
      var stream = toBytes(s.slice(dataStart, dataEnd));
      var eo = s.indexOf('endobj', dataEnd);
      if (eo < 0) throw new Error('PDF inválido: falta endobj.');
      return { dictEnd: dictEnd, stream: stream, objEnd: eo + 6 };
    }
    var e = skipWs(s, dictEnd);
    var eo2 = s.indexOf('endobj', e);
    if (eo2 < 0) throw new Error('PDF inválido: falta endobj.');
    return { dictEnd: dictEnd, stream: null, objEnd: eo2 + 6 };
  }
  function parseObjects(s) {
    var objects = [];
    var re = /(\d+)\s+(\d+)\s+obj\b/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var num = parseInt(m[1], 10), gen = parseInt(m[2], 10);
      var bodyStart = re.lastIndex;
      var scan = scanObject(s, bodyStart);
      objects.push({ num: num, gen: gen, dictText: s.slice(bodyStart, scan.dictEnd), stream: scan.stream });
      re.lastIndex = scan.objEnd;
    }
    return objects;
  }

  // Lee los bytes de un string literal (descodificando escapes)
  function readLiteralBytes(s, i) {
    var out = [];
    var n = s.length, depth = 1;
    i++;
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c === 0x5c) {
        var nx = s.charCodeAt(i + 1);
        if (nx === 0x6e) { out.push(0x0a); i += 2; }
        else if (nx === 0x72) { out.push(0x0d); i += 2; }
        else if (nx === 0x74) { out.push(0x09); i += 2; }
        else if (nx === 0x62) { out.push(0x08); i += 2; }
        else if (nx === 0x66) { out.push(0x0c); i += 2; }
        else if (nx >= 0x30 && nx <= 0x37) {
          var val = 0, cnt = 0;
          while (cnt < 3 && i + 1 + cnt < n && s.charCodeAt(i + 1 + cnt) >= 0x30 && s.charCodeAt(i + 1 + cnt) <= 0x37) {
            val = val * 8 + (s.charCodeAt(i + 1 + cnt) - 0x30);
            cnt++;
          }
          out.push(val & 0xff);
          i += 1 + cnt;
        }
        else if (nx === 0x0a) { i += 2; }
        else if (nx === 0x0d) { i += 2; if (s.charCodeAt(i) === 0x0a) i++; }
        else { out.push(nx & 0xff); i += 2; }
        continue;
      }
      if (c === 0x28) { depth++; out.push(0x28); i++; }
      else if (c === 0x29) { depth--; if (depth === 0) return { bytes: new Uint8Array(out), end: i + 1 }; out.push(0x29); i++; }
      else { out.push(c & 0xff); i++; }
    }
    throw new Error('PDF inválido: string literal sin cerrar.');
  }
  function readHexBytes(s, i) {
    var out = [], n = s.length, nib = -1;
    i++; // tras '<'
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c === 0x3e) break;
      var v = hexVal(c);
      if (v >= 0) {
        if (nib < 0) nib = v;
        else { out.push((nib << 4) | v); nib = -1; }
      }
      i++;
    }
    if (nib >= 0) out.push(nib << 4);
    return { bytes: new Uint8Array(out), end: Math.min(i + 1, n) };
  }

  // Re-serializa el dict de un objeto cifrando cada string
  async function encryptDictText(s, key, useAes) {
    var out = '';
    var i = 0, n = s.length;
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c === 0x25) {
        var ce = i;
        while (ce < n && !isEol(s, ce)) ce++;
        out += s.slice(i, ce);
        i = ce;
        continue;
      }
      if (c === 0x28) {
        var r = readLiteralBytes(s, i);
        out += '<' + toHex(await encryptBytes(key, r.bytes, useAes)) + '>';
        i = r.end;
        continue;
      }
      if (c === 0x3c) {
        if (s.charCodeAt(i + 1) === 0x3c) { out += '<<'; i += 2; continue; }
        var r2 = readHexBytes(s, i);
        out += '<' + toHex(await encryptBytes(key, r2.bytes, useAes)) + '>';
        i = r2.end;
        continue;
      }
      var j = i;
      while (j < n) {
        var ch = s.charCodeAt(j);
        if (ch <= 0x20 || ch === 0x28 || ch === 0x29 || ch === 0x3c || ch === 0x3e ||
            ch === 0x5b || ch === 0x5d || ch === 0x7b || ch === 0x7d || ch === 0x2f || ch === 0x25) break;
        j++;
      }
      if (j === i) { out += s[i]; i++; continue; }
      out += s.slice(i, j);
      i = j;
    }
    return out;
  }

  // =====================================================================
  // API principal
  // =====================================================================
  function readRef(dict, key) {
    var re = new RegExp('/' + key + '\\s+(\\d+)\\s+(\\d+)\\s+R');
    var m = dict.match(re);
    return m ? (parseInt(m[1], 10) + ' ' + parseInt(m[2], 10) + ' R') : null;
  }
  function readSize(dict) {
    var m = dict.match(/\/Size\s+(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function readId0(dict) {
    var m = dict.match(/\/ID\s*\[\s*<([0-9a-fA-F]*)>/);
    if (!m || !m[1]) return null;
    var hex = m[1];
    var b = new Uint8Array(hex.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return b.length === 16 ? b : null;
  }

  function isEncrypted(inputBytes) {
    var s = fromBytes(inputBytes);
    var trailerPos = s.lastIndexOf('trailer');
    var region = trailerPos >= 0 ? s.slice(trailerPos) : s;
    return /\/Encrypt\b/.test(region);
  }

  /**
   * Cifra un PDF.
   * @param {Uint8Array} inputBytes PDF re-serializado por pdf-lib (xref clásico).
   * @param {object} opts { userPassword, ownerPassword, allowPrint, allowCopy, allowModify, cipher: 'auto'|'aes128'|'rc4' }
   * @returns {Promise<Uint8Array>} PDF cifrado.
   */
  async function encrypt(inputBytes, opts) {
    opts = opts || {};
    var s = fromBytes(inputBytes);

    var hm = s.match(/^%PDF-(\d+\.\d+)/);
    if (!hm) throw new Error('El archivo no es un PDF válido.');
    var version = hm[1];

    var trailerPos = s.lastIndexOf('trailer');
    if (trailerPos < 0) throw new Error('Formato PDF no soportado (no se encontró el trailer clásico).');
    if (/\/Encrypt\b/.test(s.slice(trailerPos))) {
      throw new Error('El PDF ya está protegido con contraseña.');
    }

    var objects = parseObjects(s);

    var tStart = trailerPos + 7;
    var trailerDictEnd = scanDictEnd(s, tStart);
    var trailerDict = s.slice(tStart, trailerDictEnd);

    var rootRef = readRef(trailerDict, 'Root');
    var infoRef = readRef(trailerDict, 'Info');
    var id0 = readId0(trailerDict) || (supportsAes ? crypto.getRandomValues(new Uint8Array(16)) : randomBytes());
    var size = readSize(trailerDict);

    var cipher = opts.cipher || 'auto';
    var useAes = cipher === 'aes128' ? true : (cipher === 'rc4' ? false : supportsAes);
    var keylen = 16; // AES-128 y RC4-128
    var rev = useAes ? 4 : 3;
    var v = useAes ? 4 : 2;

    var userPassword = opts.userPassword || '';
    var ownerPassword = opts.ownerPassword == null ? '' : String(opts.ownerPassword);
    if (ownerPassword === '' ) ownerPassword = userPassword;

    var userPadded = padPassword(userPassword);
    var ownerPadded = padPassword(ownerPassword);
    var P = buildPermissions(opts);

    var O = computeO(ownerPadded, userPadded, keylen);
    var K = computeK(userPadded, O, P, id0, keylen);
    var U = computeU(K, id0);

    var encObjects = [];
    for (var oi = 0; oi < objects.length; oi++) {
      var obj = objects[oi];
      var ok = objectKey(K, obj.num, obj.gen, keylen, useAes);
      var newDict = await encryptDictText(obj.dictText, ok, useAes);
      var newStream = obj.stream ? await encryptBytes(ok, obj.stream, useAes) : null;
      if (newStream) {
        // AES alarga el stream (padding PKCS7 + IV de 16 bytes); /Length debe
        // reflejar la longitud del CIFRADO. RC4 conserva la longitud original.
        // Se preserva una eventual cola indirecta ("/Length N G R").
        newDict = newDict.replace(/\/Length\s+(\d+)(\s+\d+\s+R)?/, '/Length ' + newStream.length + '$2');
      }
      encObjects.push({ num: obj.num, gen: obj.gen, dict: newDict, stream: newStream });
    }

    var maxNum = 0;
    for (var m = 0; m < encObjects.length; m++) if (encObjects[m].num > maxNum) maxNum = encObjects[m].num;
    var encryptObjNum = (size > maxNum ? size : maxNum) + 1;
    var total = encryptObjNum + 1;

    // --- serialización ---
    var body = '%PDF-' + version + '\n%\x81\x81\x81\x81\n';
    var map = {};
    for (var b = 0; b < encObjects.length; b++) {
      var ob = encObjects[b];
      var off = body.length;
      map[ob.num] = off;
      body += ob.num + ' ' + ob.gen + ' obj\n' + ob.dict + '\n';
      if (ob.stream) body += 'stream\n' + fromBytes(ob.stream) + '\nendstream\n';
      body += 'endobj\n';
    }

    var encDict = useAes
      ? '<< /Filter /Standard /V 4 /R 4 /Length 128 /CF << /StdCF << /CFM /AESV2 /Length 16 /AuthEvent /DocOpen >> >> /StmF /StdCF /StrF /StdCF /EncryptMetadata true /O <' + toHex(O) + '> /U <' + toHex(U) + '> /P ' + (P >>> 0) + ' >>'
      : '<< /Filter /Standard /V 2 /R 3 /Length 128 /O <' + toHex(O) + '> /U <' + toHex(U) + '> /P ' + (P >>> 0) + ' >>';
    var encOff = body.length;
    map[encryptObjNum] = encOff;
    body += encryptObjNum + ' 0 obj\n' + encDict + '\nendobj\n';

    var xrefOffset = body.length;
    var xref = 'xref\n0 ' + total + '\n';
    for (var k = 0; k < total; k++) {
      if (k === 0) xref += '0000000000 65535 f \n';
      else if (map[k] != null) xref += pad10(map[k]) + ' 00000 n \n';
      else xref += '0000000000 65535 f \n';
    }
    var trailer = 'trailer\n<<\n/Size ' + total + '\n/Root ' + rootRef + '\n' +
      (infoRef ? '/Info ' + infoRef + '\n' : '') +
      '/ID [<' + toHex(id0) + '> <' + toHex(id0) + '>]\n' +
      '/Encrypt ' + encryptObjNum + ' 0 R\n>>\n' +
      'startxref\n' + xrefOffset + '\n%%EOF\n';

    return toBytes(body + xref + trailer);
  }

  function randomBytes() {
    var b = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }

  window.PDFEncryptor = {
    encrypt: encrypt,
    isEncrypted: isEncrypted,
    supportsAes: supportsAes,
    PAD_BYTES: PAD_BYTES,
    md5: md5,
    rc4: rc4,
    toBytes: toBytes,
    toHex: toHex
  };
})();
