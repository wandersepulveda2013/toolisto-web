'use strict';

(function () {
  var MAGIC = 'TOOLISTOENC';
  var MAGIC_BYTES = new Uint8Array([84, 79, 79, 76, 73, 83, 84, 79, 69, 78, 67]);
  var VERSION = 1;
  var ITERATIONS = 600000;
  var SALT_LENGTH = 32;
  var IV_LENGTH = 12;
  var TAG_LENGTH_BITS = 128;

  var encoder = new TextEncoder();
  var decoder = new TextDecoder();

  async function deriveKey(password, salt, iterations) {
    var passwordKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: iterations,
        hash: 'SHA-256'
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(file, password) {
    var fileBuffer = await file.arrayBuffer();
    var salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    var iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    var key = await deriveKey(password, salt, ITERATIONS);

    var filenameBytes = encoder.encode(file.name);
    var mimeBytes = encoder.encode(file.type || 'application/octet-stream');

    var headerLength = 12 + 1 + 2 + SALT_LENGTH + IV_LENGTH + 1 + filenameBytes.length + 1 + mimeBytes.length;
    var header = new Uint8Array(headerLength);
    var offset = 0;

    header.set(MAGIC_BYTES, offset);
    offset += 12;
    header[offset] = VERSION;
    offset += 1;
    var exp = ITERATIONS / 1000;
    header[offset] = (exp >> 8) & 0xff;
    offset += 1;
    header[offset] = exp & 0xff;
    offset += 1;
    header.set(salt, offset);
    offset += SALT_LENGTH;
    header.set(iv, offset);
    offset += IV_LENGTH;
    header[offset] = filenameBytes.length;
    offset += 1;
    header.set(filenameBytes, offset);
    offset += filenameBytes.length;
    header[offset] = mimeBytes.length;
    offset += 1;
    header.set(mimeBytes, offset);
    offset += mimeBytes.length;

    var encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv, tagLength: TAG_LENGTH_BITS, additionalData: header },
      key,
      fileBuffer
    );

    var output = new Uint8Array(headerLength + encrypted.byteLength);
    output.set(header, 0);
    output.set(new Uint8Array(encrypted), headerLength);

    return {
      blob: new Blob([output], { type: 'application/octet-stream' }),
      originalName: file.name
    };
  }

  async function decrypt(encryptedFile, password) {
    var fileBuffer = await encryptedFile.arrayBuffer();
    var view = new Uint8Array(fileBuffer);

    if (view.length < 60) {
      throw new Error('Archivo demasiado pequeño');
    }

    var magic = decoder.decode(view.slice(0, 12));
    if (magic !== MAGIC) {
      throw new Error('No es un archivo Toolisto cifrado');
    }

    var offset = 12;
    var version = view[offset];
    offset += 1;
    if (version !== VERSION) {
      throw new Error('Versión no soportada: ' + version);
    }

    var exp = (view[offset] << 8) | view[offset + 1];
    offset += 2;
    var iterations = exp * 1000;

    var salt = view.slice(offset, offset + SALT_LENGTH);
    offset += SALT_LENGTH;
    var iv = view.slice(offset, offset + IV_LENGTH);
    offset += IV_LENGTH;

    var filenameLen = view[offset];
    offset += 1;
    var filename = decoder.decode(view.slice(offset, offset + filenameLen));
    offset += filenameLen;

    var mimeLen = view[offset];
    offset += 1;
    var mimeType = decoder.decode(view.slice(offset, offset + mimeLen));
    offset += mimeLen;

    var headerEnd = offset;
    var header = view.slice(0, headerEnd);
    var encryptedData = view.slice(headerEnd);

    var key = await deriveKey(password, salt, iterations);

    var decrypted;
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv, tagLength: TAG_LENGTH_BITS, additionalData: header },
        key,
        encryptedData
      );
    } catch (e) {
      throw new Error('Contraseña incorrecta o archivo corrupto');
    }

    return {
      blob: new Blob([decrypted], { type: mimeType }),
      originalName: filename,
      originalType: mimeType
    };
  }

  function getPasswordStrength(password) {
    if (!password || password.length < 4) {
      return { score: 0, label: 'Muy débil' };
    }
    if (password.length < 8) {
      return { score: 1, label: 'Débil' };
    }
    var hasLetters = /[a-zA-Z]/.test(password);
    var hasNumbers = /[0-9]/.test(password);
    var hasSpecial = /[^a-zA-Z0-9]/.test(password);

    if (hasLetters && hasNumbers && hasSpecial) {
      return { score: 4, label: 'Muy fuerte' };
    }
    if (hasLetters && hasNumbers) {
      return { score: 3, label: 'Fuerte' };
    }
    return { score: 2, label: 'Normal' };
  }

  function isToolistoEnc(arrayBuffer) {
    if (arrayBuffer.byteLength < 12) return false;
    var view = new Uint8Array(arrayBuffer);
    return decoder.decode(view.slice(0, 12)) === MAGIC;
  }

  function getEncryptedInfo(arrayBuffer) {
    var view = new Uint8Array(arrayBuffer);
    if (view.length < 60 || !isToolistoEnc(arrayBuffer)) {
      throw new Error('No es un archivo Toolisto cifrado');
    }

    var offset = 12;
    var version = view[offset];
    offset += 1 + 2 + SALT_LENGTH + IV_LENGTH;

    var filenameLen = view[offset];
    offset += 1;
    var filename = decoder.decode(view.slice(offset, offset + filenameLen));
    offset += filenameLen;

    var mimeLen = view[offset];
    offset += 1;
    var mimeType = decoder.decode(view.slice(offset, offset + mimeLen));

    return { version: version, originalName: filename, originalType: mimeType };
  }

  function cleanup() {}

  window.LocalEncryption = {
    MAGIC: MAGIC,
    VERSION: VERSION,
    ITERATIONS: ITERATIONS,
    encrypt: encrypt,
    decrypt: decrypt,
    getPasswordStrength: getPasswordStrength,
    isToolistoEnc: isToolistoEnc,
    getEncryptedInfo: getEncryptedInfo,
    cleanup: cleanup
  };
})();
