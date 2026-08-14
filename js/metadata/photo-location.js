'use strict';

(function () {

  function readUint16(view, offset, littleEndian) {
    return view.getUint16(offset, littleEndian);
  }

  function readUint32(view, offset, littleEndian) {
    return view.getUint32(offset, littleEndian);
  }

  function readAscii(view, offset, count) {
    var str = '';
    for (var i = 0; i < count; i++) {
      var ch = view.getUint8(offset + i);
      if (ch === 0) break;
      str += String.fromCharCode(ch);
    }
    return str;
  }

  function parseRational(view, offset, littleEndian) {
    var num = readUint32(view, offset, littleEndian);
    var den = readUint32(view, offset + 4, littleEndian);
    if (den === 0) return 0;
    return num / den;
  }

  function dmsToDecimal(dms, ref) {
    var deg = dms[0];
    var min = dms[1];
    var sec = dms[2];
    var decimal = deg + min / 60 + sec / 3600;
    if (ref === 'S' || ref === 'W') {
      decimal = -decimal;
    }
    return Math.round(decimal * 1000000) / 1000000;
  }

  function getMapUrl(lat, lng) {
    return 'https://www.google.com/maps?q=' + lat + ',' + lng;
  }

  function readIfdEntries(view, ifdOffset, entryCount, littleEndian, valueReader) {
    var entries = {};
    for (var i = 0; i < entryCount; i++) {
      var entryOffset = ifdOffset + (i * 12);
      var tag = readUint16(view, entryOffset, littleEndian);
      var type = readUint16(view, entryOffset + 2, littleEndian);
      var count = readUint32(view, entryOffset + 4, littleEndian);
      var valueRaw = readUint32(view, entryOffset + 8, littleEndian);

      var typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      var typeSize = typeSizes[type] || 0;
      var totalBytes = count * typeSize;

      var valueOffset;
      if (totalBytes <= 4) {
        valueOffset = entryOffset + 8;
      } else {
        valueOffset = valueRaw;
      }

      if (valueReader) {
        valueReader(tag, type, count, valueOffset);
      }
    }
  }

  function extractFromJpeg(arrayBuffer) {
    try {
      var view = new DataView(arrayBuffer);

      if (arrayBuffer.byteLength < 2) {
        return { success: false, error: 'File too small to be a JPEG' };
      }

      var soi = view.getUint16(0, false);
      if (soi !== 0xFFD8) {
        return { success: false, error: 'Not a valid JPEG file' };
      }

      var offset = 2;
      var app1Offset = -1;

      while (offset < arrayBuffer.byteLength - 1) {
        var marker = view.getUint16(offset, false);
        if ((marker & 0xFF00) !== 0xFF00) {
          return { success: false, error: 'Invalid JPEG marker at offset ' + offset };
        }

        if (marker === 0xFFE1) {
          app1Offset = offset;
          break;
        }

        if (marker === 0xFFDA) {
          break;
        }

        var segmentLength = view.getUint16(offset + 2, false);
        offset += 2 + segmentLength;
      }

      if (app1Offset === -1) {
        return { success: false, error: 'No APP1 segment found' };
      }

      var app1Length = view.getUint16(app1Offset + 2, false);
      var exifStart = app1Offset + 4;

      var exifHeader = readAscii(view, exifStart, 4);
      if (exifHeader !== 'Exif') {
        return { success: false, error: 'Invalid EXIF header' };
      }

      var tiffStart = exifStart + 6;
      var byteOrder1 = String.fromCharCode(view.getUint8(tiffStart));
      var byteOrder2 = String.fromCharCode(view.getUint8(tiffStart + 1));
      var littleEndian = byteOrder1 === 'I';

      if (byteOrder1 !== 'I' && byteOrder1 !== 'M') {
        return { success: false, error: 'Invalid TIFF byte order' };
      }

      var ifd0Offset = readUint32(view, tiffStart + 4, littleEndian);
      var absoluteIfd0 = tiffStart + ifd0Offset;
      var ifd0Count = readUint16(view, absoluteIfd0, littleEndian);

      var exifIFDOffset = -1;
      var gpsIFDOffset = -1;
      var make = '';
      var model = '';
      var dateTimeOriginal = '';

      readIfdEntries(view, absoluteIfd0 + 2, ifd0Count, littleEndian, function (tag, type, count, valueOffset) {
        if (tag === 0x8769) {
          exifIFDOffset = tiffStart + readUint32(view, valueOffset, littleEndian);
        }
        if (tag === 0x010F && type === 2) {
          make = readAscii(view, valueOffset, count);
        }
        if (tag === 0x0110 && type === 2) {
          model = readAscii(view, valueOffset, count);
        }
        if (tag === 0x9003 && type === 2) {
          dateTimeOriginal = readAscii(view, valueOffset, count);
        }
      });

      if (exifIFDOffset > 0) {
        var exifIFDCount = readUint16(view, exifIFDOffset, littleEndian);

        readIfdEntries(view, exifIFDOffset + 2, exifIFDCount, littleEndian, function (tag, type, count, valueOffset) {
          if (tag === 0x8825) {
            gpsIFDOffset = tiffStart + readUint32(view, valueOffset, littleEndian);
          }
        });
      }

      if (gpsIFDOffset <= 0) {
        return {
          success: true,
          data: {
            gps: null,
            camera: { make: make, model: model },
            datetime: dateTimeOriginal || null,
            image: { width: null, height: null }
          }
        };
      }

      var gpsIFDCount = readUint16(view, gpsIFDOffset, littleEndian);
      var gps = {
        latitudeRef: null,
        latitude: null,
        longitudeRef: null,
        longitude: null,
        altitudeRef: null,
        altitude: null,
        timeStamp: null,
        dateStamp: null,
        lat: null,
        lng: null,
        alt: null
      };

      readIfdEntries(view, gpsIFDOffset + 2, gpsIFDCount, littleEndian, function (tag, type, count, valueOffset) {
        if (tag === 0x0001 && type === 2) {
          gps.latitudeRef = readAscii(view, valueOffset, count);
        }
        if (tag === 0x0002 && type === 5 && count === 3) {
          gps.latitude = [
            parseRational(view, valueOffset, littleEndian),
            parseRational(view, valueOffset + 8, littleEndian),
            parseRational(view, valueOffset + 16, littleEndian)
          ];
        }
        if (tag === 0x0003 && type === 2) {
          gps.longitudeRef = readAscii(view, valueOffset, count);
        }
        if (tag === 0x0004 && type === 5 && count === 3) {
          gps.longitude = [
            parseRational(view, valueOffset, littleEndian),
            parseRational(view, valueOffset + 8, littleEndian),
            parseRational(view, valueOffset + 16, littleEndian)
          ];
        }
        if (tag === 0x0005 && type === 1) {
          gps.altitudeRef = view.getUint8(valueOffset);
        }
        if (tag === 0x0006 && type === 5) {
          gps.altitude = parseRational(view, valueOffset, littleEndian);
        }
        if (tag === 0x0007 && type === 5 && count === 3) {
          gps.timeStamp = [
            parseRational(view, valueOffset, littleEndian),
            parseRational(view, valueOffset + 8, littleEndian),
            parseRational(view, valueOffset + 16, littleEndian)
          ];
        }
        if (tag === 0x001D && type === 2) {
          gps.dateStamp = readAscii(view, valueOffset, count);
        }
      });

      if (gps.latitude && gps.latitudeRef) {
        gps.lat = dmsToDecimal(gps.latitude, gps.latitudeRef);
      }
      if (gps.longitude && gps.longitudeRef) {
        gps.lng = dmsToDecimal(gps.longitude, gps.longitudeRef);
      }
      if (gps.altitude !== null) {
        gps.alt = gps.altitudeRef === 1 ? -gps.altitude : gps.altitude;
      }

      return {
        success: true,
        data: {
          gps: gps,
          camera: { make: make, model: model },
          datetime: dateTimeOriginal || null,
          image: { width: null, height: null }
        }
      };

    } catch (e) {
      return { success: false, error: 'Failed to parse EXIF data: ' + e.message };
    }
  }

  window.PhotoLocation = {
    extractFromJpeg: extractFromJpeg,
    dmsToDecimal: dmsToDecimal,
    getMapUrl: getMapUrl
  };

})();
