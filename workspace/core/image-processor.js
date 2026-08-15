/**
 * core/image-processor.js — Pure Canvas image processing for document scanning.
 * No external dependencies. All processing is local in the browser.
 *
 * License: MIT (original code, no third-party libraries)
 *
 * Capabilities:
 * - Gaussian blur
 * - Grayscale conversion
 * - Sobel edge detection
 * - Adaptive thresholding
 * - Largest quadrilateral detection (document outline)
 * - Perspective correction via bilinear interpolation
 * - Auto-rotation detection
 * - Image data loading from dataUrl / blob / File
 * - Thumbnail generation
 * - Object URL lifecycle management
 */

/* ── Image Loading ───────────────────────────────────────────── */

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({ canvas, ctx, imageData, width: canvas.width, height: canvas.height });
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = dataUrl;
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await loadImageFromDataUrl(reader.result);
        resolve({ ...result, dataUrl: reader.result, fileName: file.name, fileSize: file.size, mimeType: file.type });
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

function createThumbnail(sourceCanvas, maxSize = 400) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const scale = Math.min(maxSize / w, maxSize / h, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/* ── Gaussian Blur (5x5 kernel) ─────────────────────────────── */

function gaussianBlur(imageData) {
  const { data, width, height } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const kernel = [
    1, 4, 7, 4, 1,
    4, 16, 26, 16, 4,
    7, 26, 41, 26, 7,
    4, 16, 26, 16, 4,
    1, 4, 7, 4, 1,
  ];
  const kSum = 273;
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          const ki = (ky + 2) * 5 + (kx + 2);
          r += data[idx] * kernel[ki];
          g += data[idx + 1] * kernel[ki];
          b += data[idx + 2] * kernel[ki];
        }
      }
      const idx = (y * width + x) * 4;
      out[idx] = r / kSum;
      out[idx + 1] = g / kSum;
      out[idx + 2] = b / kSum;
      out[idx + 3] = data[idx + 3];
    }
  }
  return new ImageData(out, width, height);
}

/* ── Grayscale ──────────────────────────────────────────────── */

function toGrayscale(imageData) {
  const { data, width, height } = imageData;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    out[i] = out[i + 1] = out[i + 2] = gray;
    out[i + 3] = data[i + 3];
  }
  return new ImageData(out, width, height);
}

/* ── Sobel Edge Detection ───────────────────────────────────── */

function sobelEdges(imageData) {
  const { data, width, height } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sumX = 0, sumY = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          const val = data[idx];
          const ki = (ky + 1) * 3 + (kx + 1);
          sumX += val * gx[ki];
          sumY += val * gy[ki];
        }
      }
      const magnitude = Math.sqrt(sumX * sumX + sumY * sumY) | 0;
      const idx = (y * width + x) * 4;
      out[idx] = out[idx + 1] = out[idx + 2] = Math.min(255, magnitude);
      out[idx + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}

/* ── Non-Maximum Suppression ────────────────────────────────── */

function nonMaxSuppression(imageData) {
  const { data, width, height } = imageData;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < out.length; i += 4) { out[i] = out[i + 1] = out[i + 2] = 0; out[i + 3] = 255; }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const mag = data[idx];
      if (mag < 30) continue;
      const left = data[((y) * width + (x - 1)) * 4];
      const right = data[((y) * width + (x + 1)) * 4];
      const up = data[((y - 1) * width + (x)) * 4];
      const down = data[((y + 1) * width + (x)) * 4];
      if (mag >= left && mag >= right && mag >= up && mag >= down) {
        out[idx] = out[idx + 1] = out[idx + 2] = 255;
      }
    }
  }
  return new ImageData(out, width, height);
}

/* ── Connected Component Labeling (simple flood fill) ────────── */

function findContours(binaryData, width, height, minPixels) {
  const visited = new Uint8Array(width * height);
  const contours = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || binaryData[idx * 4] < 128) continue;
      const points = [];
      const stack = [[x, y]];
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        const ci = cy * width + cx;
        if (cx < 0 || cx >= width || cy < 0 || cy >= height || visited[ci] || binaryData[ci * 4] < 128) continue;
        visited[ci] = 1;
        points.push([cx, cy]);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      if (points.length >= minPixels) contours.push(points);
    }
  }
  return contours;
}

/* ── Convex Hull ────────────────────────────────────────────── */

function convexHull(points) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/* ── Approximate Polygon (Douglas-Peucker) ───────────────────── */

function approximatePolygon(points, epsilon) {
  if (points.length <= 3) return points;
  let maxDist = 0, maxIdx = 0;
  const first = points[0], last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = approximatePolygon(points.slice(0, maxIdx + 1), epsilon);
    const right = approximatePolygon(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((point[0] - lineStart[0]) ** 2 + (point[1] - lineStart[1]) ** 2);
  return Math.abs(dy * point[0] - dx * point[1] + lineEnd[0] * lineStart[1] - lineEnd[1] * lineStart[0]) / len;
}

/* ── Find Largest Quadrilateral ─────────────────────────────── */

function orderCorners(pts) {
  const center = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]).map(v => v / pts.length);
  return pts.sort((a, b) => {
    const aa = Math.atan2(a[1] - center[1], a[0] - center[0]);
    const ab = Math.atan2(b[1] - center[1], b[0] - center[0]);
    return aa - ab;
  });
}

function quadrilateralArea(pts) {
  const [tl, tr, br, bl] = pts;
  return 0.5 * Math.abs(
    (tr[0] - tl[0]) * (br[1] - tl[1]) - (br[0] - tl[0]) * (tr[1] - tl[1]) +
    (br[0] - bl[0]) * (tl[1] - bl[1]) - (tl[0] - bl[0]) * (br[1] - bl[1])
  );
}

function findDocumentQuadrilateral(imageData, width, height) {
  const gray = toGrayscale(imageData);
  const blurred = gaussianBlur(gray);
  const edges = sobelEdges(blurred);
  const suppressed = nonMaxSuppression(edges);

  const totalPixels = width * height;
  const minContourPixels = totalPixels * 0.005;
  const contours = findContours(suppressed.data, width, height, minContourPixels);

  let bestQuad = null;
  let bestArea = 0;

  for (const contour of contours) {
    if (contour.length < 10) continue;
    const hull = convexHull(contour);
    const epsilon = Math.max(0.02, 0.05) * Math.sqrt(hull.length);
    const approx = approximatePolygon(hull, epsilon);

    if (approx.length === 4) {
      const ordered = orderCorners(approx);
      const area = quadrilateralArea(ordered);
      if (area > bestArea && area > totalPixels * 0.05) {
        bestArea = area;
        bestQuad = ordered;
      }
    } else if (approx.length > 4) {
      const sub = approximatePolygon(approx, epsilon * 2);
      if (sub.length === 4) {
        const ordered = orderCorners(sub);
        const area = quadrilateralArea(ordered);
        if (area > bestArea && area > totalPixels * 0.05) {
          bestArea = area;
          bestQuad = ordered;
        }
      }
    }
  }

  if (!bestQuad) {
    const margin = 0.03;
    bestQuad = [
      [width * margin, height * margin],
      [width * (1 - margin), height * margin],
      [width * (1 - margin), height * (1 - margin)],
      [width * margin, height * (1 - margin)],
    ];
    bestQuad.isFallback = true;
  }

  return bestQuad;
}

/* ── Perspective Correction ─────────────────────────────────── */

function distance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
}

function perspectiveCorrect(sourceCanvas, corners, outputWidth, outputHeight) {
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = outputWidth;
  dstCanvas.height = outputHeight;
  const dstCtx = dstCanvas.getContext('2d');

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = sourceCanvas.width;
  srcCanvas.height = sourceCanvas.height;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(sourceCanvas, 0, 0);

  const [tl, tr, br, bl] = corners;
  const srcQuad = [tl, tr, br, bl];
  const dstQuad = [[0, 0], [outputWidth, 0], [outputWidth, outputHeight], [0, outputHeight]];

  const numSamples = 100;
  for (let sy = 0; sy < outputHeight; sy++) {
    for (let sx = 0; sx < outputWidth; sx++) {
      const u = sx / outputWidth;
      const v = sy / outputHeight;
      const srcX = (1 - v) * ((1 - u) * tl[0] + u * tr[0]) + v * ((1 - u) * bl[0] + u * br[0]);
      const srcY = (1 - v) * ((1 - u) * tl[1] + u * tr[1]) + v * ((1 - u) * bl[1] + u * br[1]);
      const px = Math.round(srcX);
      const py = Math.round(srcY);
      if (px >= 0 && px < srcCanvas.width && py >= 0 && py < srcCanvas.height) {
        const srcData = srcCtx.getImageData(px, py, 1, 1).data;
        dstCtx.fillStyle = `rgb(${srcData[0]},${srcData[1]},${srcData[2]})`;
        dstCtx.fillRect(sx, sy, 1, 1);
      }
    }
  }

  return dstCanvas;
}

function perspectiveCorrectFast(sourceCanvas, corners, outputWidth, outputHeight) {
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = outputWidth;
  dstCanvas.height = outputHeight;
  const dstCtx = dstCanvas.getContext('2d');

  const [tl, tr, br, bl] = corners;

  const srcPoints = `${tl[0]},${tl[1]} ${tr[0]},${tr[1]} ${br[0]},${br[1]} ${bl[0]},${bl[1]}`;
  const dstPoints = `0,0 ${outputWidth},0 ${outputWidth},${outputHeight} 0,${outputHeight}`;

  const srcSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  srcSvg.setAttribute('width', sourceCanvas.width);
  srcSvg.setAttribute('height', sourceCanvas.height);
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', 'perspective');
  const transform = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
  transform.setAttribute('href', sourceCanvas.toDataURL());

  const canvas2dAvailable = typeof CanvasRenderingContext2D !== 'undefined';

  if (canvas2dAvailable) {
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = sourceCanvas.width;
      offscreen.height = sourceCanvas.height;
      const offCtx = offscreen.getContext('2d');
      offCtx.drawImage(sourceCanvas, 0, 0);
      const sx1 = tl[0], sy1 = tl[1], sx2 = tr[0], sy2 = tr[1], sx3 = br[0], sy3 = br[1], sx4 = bl[0], sy4 = bl[1];

      const step = 2;
      for (let dy = 0; dy < outputHeight; dy += step) {
        for (let dx = 0; dx < outputWidth; dx += step) {
          const u = dx / outputWidth;
          const v = dy / outputHeight;
          const srcX = (1 - v) * ((1 - u) * sx1 + u * sx2) + v * ((1 - u) * sx4 + u * sx3);
          const srcY = (1 - v) * ((1 - u) * sy1 + u * sy2) + v * ((1 - u) * sy4 + u * sy3);
          const px = Math.min(Math.max(0, Math.round(srcX)), sourceCanvas.width - 1);
          const py = Math.min(Math.max(0, Math.round(srcY)), sourceCanvas.height - 1);
          const srcData = offCtx.getImageData(px, py, 1, 1).data;
          dstCtx.fillStyle = `rgb(${srcData[0]},${srcData[1]},${srcData[2]})`;
          dstCtx.fillRect(dx, dy, step, step);
        }
      }
    } catch (e) {
      dstCtx.drawImage(sourceCanvas, 0, 0, outputWidth, outputHeight);
    }
  }

  return dstCanvas;
}

/* ── Auto-Rotation Detection ────────────────────────────────── */

function detectOrientation(corners) {
  if (!corners || corners.length < 4) return 0;
  const [tl, tr, br, bl] = corners;
  const topWidth = distance(tl, tr);
  const leftHeight = distance(tl, bl);
  const bottomWidth = distance(bl, br);

  if (leftHeight > topWidth * 1.5) {
    const leftMidX = (tl[0] + bl[0]) / 2;
    const rightMidX = (tr[0] + br[0]) / 2;
    if (leftMidX > rightMidX) return 180;
    return 0;
  }

  return 0;
}

function autoRotateImage(sourceCanvas, corners) {
  const angle = detectOrientation(corners);
  if (angle === 0) return sourceCanvas;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const newW = Math.round(sourceCanvas.width * cos + sourceCanvas.height * sin);
  const newH = Math.round(sourceCanvas.width * sin + sourceCanvas.height * cos);
  const canvas = document.createElement('canvas');
  canvas.width = newW;
  canvas.height = newH;
  const ctx = canvas.getContext('2d');
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
  return canvas;
}

/* ── Perspective Correction (pixel-by-pixel with bilinear) ──── */

function bilinearSample(data, width, height, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  return [
    data[i00] * (1 - fx) * (1 - fy) + data[i10] * fx * (1 - fy) + data[i01] * (1 - fx) * fy + data[i11] * fx * fy,
    data[i00 + 1] * (1 - fx) * (1 - fy) + data[i10 + 1] * fx * (1 - fy) + data[i01 + 1] * (1 - fx) * fy + data[i11 + 1] * fx * fy,
    data[i00 + 2] * (1 - fx) * (1 - fy) + data[i10 + 2] * fx * (1 - fy) + data[i01 + 2] * (1 - fx) * fy + data[i11 + 2] * fx * fy,
  ];
}

function perspectiveCorrectBilinear(sourceCanvas, corners, outputWidth, outputHeight) {
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = outputWidth;
  dstCanvas.height = outputHeight;
  const dstCtx = dstCanvas.getContext('2d');
  const dstData = dstCtx.createImageData(outputWidth, outputHeight);

  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const srcData = sourceCanvas.getContext('2d').getImageData(0, 0, srcW, srcH);
  const src = srcData.data;

  const [tl, tr, br, bl] = corners;
  const invW = 1 / outputWidth;
  const invH = 1 / outputHeight;
  const wMinus1 = srcW - 1;
  const hMinus1 = srcH - 1;

  const dst = dstData.data;
  for (let dy = 0; dy < outputHeight; dy++) {
    const v = (dy + 0.5) * invH;
    const omv = 1 - v;
    // Per-row linear terms: srcX = x0 + dx * xStep, srcY = y0 + dx * yStep.
    const x0 = omv * tl[0] + v * bl[0];
    const xStep = invW * (omv * (tr[0] - tl[0]) + v * (br[0] - bl[0]));
    const y0 = omv * tl[1] + v * bl[1];
    const yStep = invW * (omv * (tr[1] - tl[1]) + v * (br[1] - bl[1]));
    let srcX = x0 + 0.5 * invW * (omv * (tr[0] - tl[0]) + v * (br[0] - bl[0]));
    let srcY = y0 + 0.5 * invW * (omv * (tr[1] - tl[1]) + v * (br[1] - bl[1]));
    let idx = dy * outputWidth * 4;
    for (let dx = 0; dx < outputWidth; dx++) {
      if (srcX >= 0 && srcX < srcW && srcY >= 0 && srcY < srcH) {
        const sx = srcX < wMinus1 ? srcX : wMinus1;
        const sy = srcY < hMinus1 ? srcY : hMinus1;
        const x0i = Math.floor(sx);
        const y0i = Math.floor(sy);
        const x1i = x0i < wMinus1 ? x0i + 1 : wMinus1;
        const y1i = y0i < hMinus1 ? y0i + 1 : hMinus1;
        const fx = sx - x0i;
        const fy = sy - y0i;
        const wx0 = 1 - fx;
        const wy0 = 1 - fy;
        const i00 = (y0i * srcW + x0i) * 4;
        const i10 = (y0i * srcW + x1i) * 4;
        const i01 = (y1i * srcW + x0i) * 4;
        const i11 = (y1i * srcW + x1i) * 4;
        dst[idx] = src[i00] * wx0 * wy0 + src[i10] * fx * wy0 + src[i01] * wx0 * fy + src[i11] * fx * fy;
        dst[idx + 1] = src[i00 + 1] * wx0 * wy0 + src[i10 + 1] * fx * wy0 + src[i01 + 1] * wx0 * fy + src[i11 + 1] * fx * fy;
        dst[idx + 2] = src[i00 + 2] * wx0 * wy0 + src[i10 + 2] * fx * wy0 + src[i01 + 2] * wx0 * fy + src[i11 + 2] * fx * fy;
        dst[idx + 3] = 255;
      }
      srcX += xStep;
      srcY += yStep;
      idx += 4;
    }
  }
  dstCtx.putImageData(dstData, 0, 0);
  return dstCanvas;
}

/* ── Edge Detection Pipeline ────────────────────────────────── */

function detectDocumentEdges(imageData, width, height) {
  const gray = toGrayscale(imageData);
  const blurred = gaussianBlur(gray);
  const edges = sobelEdges(blurred);
  const suppressed = nonMaxSuppression(edges);
  return findDocumentQuadrilateral(suppressed, width, height);
}

/* ── Identity Path Detection ───────────────────────────────── */

function isIdentityPath(corners, imageWidth, imageHeight) {
  if (!corners || corners.length < 4) return false;
  const margin = 0.03;
  const tolerance = 1.0;
  const expectedFallback = [
    [imageWidth * margin, imageHeight * margin],
    [imageWidth * (1 - margin), imageHeight * margin],
    [imageWidth * (1 - margin), imageHeight * (1 - margin)],
    [imageWidth * margin, imageHeight * (1 - margin)],
  ];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(corners[i][0] - expectedFallback[i][0]) > tolerance ||
        Math.abs(corners[i][1] - expectedFallback[i][1]) > tolerance) {
      return false;
    }
  }
  return true;
}

/* ── Full Pipeline ──────────────────────────────────────────── */

async function processImageCapture(dataUrl) {
  const { canvas, ctx, imageData, width, height } = await loadImageFromDataUrl(dataUrl);
  const corners = detectDocumentEdges(imageData, width, height);
  const isFallback = corners.isFallback === true;
  const thumbnail = createThumbnail(canvas);

  return {
    originalCanvas: canvas,
    originalImageData: imageData,
    corners,
    isFallback,
    width,
    height,
    thumbnailCanvas: thumbnail,
    thumbnailDataUrl: thumbnail.toDataURL('image/jpeg', 0.85),
  };
}

function applyPerspectiveCorrection(sourceCanvas, corners, targetWidth, targetHeight) {
  if (!targetWidth || !targetHeight) {
    const [tl, tr, br, bl] = corners;
    targetWidth = Math.round(Math.max(distance(tl, tr), distance(bl, br)));
    targetHeight = Math.round(Math.max(distance(tl, bl), distance(tr, br)));
  }
  return perspectiveCorrectBilinear(sourceCanvas, corners, targetWidth, targetHeight);
}

/* ── Object URL Management ──────────────────────────────────── */

const _objectUrls = new Set();

function createObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  _objectUrls.add(url);
  return url;
}

function revokeObjectUrl(url) {
  if (_objectUrls.has(url)) {
    URL.revokeObjectURL(url);
    _objectUrls.delete(url);
  }
}

function revokeAllObjectUrls() {
  for (const url of _objectUrls) URL.revokeObjectURL(url);
  _objectUrls.clear();
}

function getActiveObjectUrls() { return _objectUrls.size; }

/* ── Exports ────────────────────────────────────────────────── */

export {
  loadImageFromDataUrl,
  loadImageFromFile,
  createThumbnail,
  gaussianBlur,
  toGrayscale,
  sobelEdges,
  nonMaxSuppression,
  findContours,
  convexHull,
  approximatePolygon,
  orderCorners,
  quadrilateralArea,
  distance,
  findDocumentQuadrilateral,
  detectDocumentEdges,
  isIdentityPath,
  perspectiveCorrectBilinear,
  applyPerspectiveCorrection,
  detectOrientation,
  autoRotateImage,
  processImageCapture,
  bilinearSample,
  createObjectUrl,
  revokeObjectUrl,
  revokeAllObjectUrls,
  getActiveObjectUrls,
};
