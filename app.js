(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const state = {
    files: [],
    tool: null,
    forcedTool: null,
    outputBlob: null,
    outputName: '',
    previewUrl: '',
    processing: false,
    activeFilter: 'all',
  };

  const toolMeta = {
    compress: {
      icon: '↘', title: 'Reducir imagen',
      description: 'Reduciremos el peso conservando una calidad equilibrada.',
      accepts: 'image',
    },
    signature: {
      icon: '✦', title: 'Firma transparente',
      description: 'Quitaremos el fondo claro y exportaremos un PNG transparente.',
      accepts: 'image',
    },
    imagesPdf: {
      icon: '▤', title: 'Imágenes a PDF',
      description: 'Crearemos un solo PDF respetando el orden visible.',
      accepts: 'images',
    },
    mergePdf: {
      icon: '⊕', title: 'Unir PDF',
      description: 'Combinaremos los PDF en el orden visible.',
      accepts: 'pdfs',
    },
    crop: {
      icon: '⌗', title: 'Recortar y redimensionar',
      description: 'Prepararemos la imagen con dimensiones exactas.',
      accepts: 'image',
    },
    convert: {
      icon: '⇄', title: 'Convertir imagen',
      description: 'Convertiremos las imágenes al formato elegido.',
      accepts: 'images',
    },
  };

  const els = {
    themeToggle: $('#themeToggle'),
    menuToggle: $('#menuToggle'),
    mobileNav: $('#mobileNav'),
    intentInput: $('#intentInput'),
    dropZone: $('#dropZone'),
    fileInput: $('#fileInput'),
    browseButton: $('#browseButton'),
    fileStrip: $('#fileStrip'),
    smartResult: $('#smartResult'),
    smartIcon: $('#smartIcon'),
    smartTitle: $('#smartTitle'),
    smartDescription: $('#smartDescription'),
    changeToolButton: $('#changeToolButton'),
    advancedPanel: $('#advancedPanel'),
    advancedControls: $('#advancedControls'),
    flowActions: $('#flowActions'),
    runButton: $('#runButton'),
    clearFilesButton: $('#clearFilesButton'),
    toolSearch: $('#toolSearch'),
    emptyTools: $('#emptyTools'),
    resultDialog: $('#resultDialog'),
    dialogClose: $('#dialogClose'),
    resultTitle: $('#resultTitle'),
    resultMessage: $('#resultMessage'),
    resultStats: $('#resultStats'),
    previewArea: $('#previewArea'),
    downloadButton: $('#downloadButton'),
    resetButton: $('#resetButton'),
    pickerDialog: $('#pickerDialog'),
    pickerClose: $('#pickerClose'),
    pickerGrid: $('#pickerGrid'),
    toast: $('#toast'),
  };

  init();

  const splashEl = document.getElementById('introSplash');
  if (splashEl) {
    let shown = false;
    try { shown = sessionStorage.getItem('toolistoIntroShown'); } catch (_) {}
    if (!shown) {
      document.body.classList.add('intro-active');
      try { sessionStorage.setItem('toolistoIntroShown', '1'); } catch (_) {}
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const exitDelay = reducedMotion ? 150 : 700;
      const cleanupDelay = reducedMotion ? 250 : 1050;
      setTimeout(() => { splashEl.classList.add('intro-out'); }, exitDelay);
      setTimeout(() => {
        document.body.classList.remove('intro-active');
        splashEl.remove();
      }, cleanupDelay);
    } else {
      splashEl.remove();
    }
  }

  function init() {
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('toolisto-theme'); } catch (_) { /* storage may be blocked */ }
    if (savedTheme) document.documentElement.dataset.theme = savedTheme;

    els.themeToggle.addEventListener('click', toggleTheme);
    els.menuToggle.addEventListener('click', toggleMenu);
    $$('.mobile-nav a').forEach((a) => a.addEventListener('click', closeMenu));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.mobileNav.hidden) closeMenu();
    });

    document.addEventListener('click', (event) => {
      if (!els.mobileNav.hidden && !els.mobileNav.contains(event.target) && !els.menuToggle.contains(event.target)) {
        closeMenu();
      }
    });

    els.browseButton.addEventListener('click', (event) => {
      event.stopPropagation();
      els.fileInput.click();
    });
    els.dropZone.addEventListener('click', () => els.fileInput.click());
    els.dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        els.fileInput.click();
      }
    });
    els.fileInput.addEventListener('change', () => addFiles([...els.fileInput.files]));

    ['dragenter', 'dragover'].forEach((name) => els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach((name) => els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove('dragging');
    }));
    els.dropZone.addEventListener('drop', (event) => addFiles([...event.dataTransfer.files]));

    window.addEventListener('paste', handlePaste);
    els.intentInput.addEventListener('input', () => {
      if (!state.forcedTool) updateRecommendation();
    });

    els.changeToolButton.addEventListener('click', openPicker);
    els.pickerClose.addEventListener('click', () => els.pickerDialog.close());
    els.dialogClose.addEventListener('click', () => els.resultDialog.close());
    els.resetButton.addEventListener('click', resetAll);
    els.downloadButton.addEventListener('click', downloadResult);
    els.runButton.addEventListener('click', runCurrentTool);
    els.clearFilesButton?.addEventListener('click', clearSelectedFiles);
    els.toolSearch?.addEventListener('input', filterTools);

    $$('.filter-chip').forEach((chip) => chip.addEventListener('click', () => {
      setToolFilter(chip.dataset.filter || 'all');
    }));

    $$('[data-nav-filter]').forEach((link) => link.addEventListener('click', () => {
      setToolFilter(link.dataset.navFilter || 'all');
      closeMenu();
    }));

    $$('.tool-card').forEach((card) => card.addEventListener('click', () => {
      chooseTool(card.dataset.tool, true);
      const target = document.querySelector('#inicio');
      target.scrollIntoView({ behavior: 'smooth' });
      if (!state.files.length) {
        setTimeout(() => {
          els.fileInput.click();
          els.dropZone.focus();
        }, 450);
      }
    }));
  }


  function setToolFilter(filter) {
    state.activeFilter = filter;
    $$('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === filter));
    filterTools();
  }

  function filterTools() {
    const query = String(els.toolSearch?.value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let visible = 0;

    $$('.tool-card').forEach((card) => {
      const categoryMatches = state.activeFilter === 'all' || card.dataset.category === state.activeFilter;
      const text = card.textContent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const searchMatches = !query || text.includes(query);
      card.hidden = !(categoryMatches && searchMatches);
      if (!card.hidden) visible += 1;
    });

    if (els.emptyTools) els.emptyTools.hidden = visible > 0;
  }

  function clearSelectedFiles() {
    state.files = [];
    state.tool = state.forcedTool || null;
    els.fileInput.value = '';
    renderFiles();
    updateRecommendation();
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('toolisto-theme', next); } catch (_) { /* storage may be blocked */ }
  }

  function toggleMenu() {
    const isOpen = !els.mobileNav.hidden;
    els.mobileNav.hidden = isOpen;
    els.menuToggle.setAttribute('aria-expanded', String(!isOpen));
  }

  function closeMenu() {
    els.mobileNav.hidden = true;
    els.menuToggle.setAttribute('aria-expanded', 'false');
    els.menuToggle.focus();
  }

  function handlePaste(event) {
    const pasted = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (pasted.length) addFiles(pasted);
  }

  function addFiles(incoming) {
    const allowed = incoming.filter((file) => {
      const validType = file.type.startsWith('image/') || file.type === 'application/pdf';
      const validSize = file.size <= 25 * 1024 * 1024;
      if (!validType) showToast(`${file.name}: formato no compatible`);
      if (validType && !validSize) showToast(`${file.name}: supera 25 MB`);
      return validType && validSize;
    });

    if (!allowed.length) return;
    state.files = [...state.files, ...allowed].slice(0, 20);
    renderFiles();
    updateRecommendation();
  }

  function renderFiles() {
    els.fileStrip.innerHTML = '';
    els.fileStrip.hidden = !state.files.length;

    state.files.forEach((file, index) => {
      const pill = document.createElement('div');
      pill.className = 'file-pill';
      pill.innerHTML = `
        <span>${file.type === 'application/pdf' ? 'PDF' : 'IMG'}</span>
        <strong title="${escapeHtml(file.name)}">${escapeHtml(shorten(file.name, 24))}</strong>
        <small>${formatBytes(file.size)}</small>
        ${index > 0 ? `<button type="button" data-action="up" aria-label="Mover ${escapeHtml(file.name)} hacia atrás">←</button>` : ''}
        ${index < state.files.length - 1 ? `<button type="button" data-action="down" aria-label="Mover ${escapeHtml(file.name)} hacia delante">→</button>` : ''}
        <button type="button" data-action="remove" aria-label="Quitar ${escapeHtml(file.name)}">×</button>
      `;
      pill.addEventListener('click', (event) => {
        event.stopPropagation();
        const action = event.target.dataset.action;
        if (!action) return;
        if (action === 'remove') state.files.splice(index, 1);
        if (action === 'up' && index > 0) [state.files[index - 1], state.files[index]] = [state.files[index], state.files[index - 1]];
        if (action === 'down' && index < state.files.length - 1) [state.files[index + 1], state.files[index]] = [state.files[index], state.files[index + 1]];
        renderFiles();
        updateRecommendation();
      });
      els.fileStrip.appendChild(pill);
    });

    if (els.clearFilesButton) els.clearFilesButton.hidden = !state.files.length;
  }

  function updateRecommendation() {
    if (!state.files.length) {
      state.tool = state.forcedTool || null;
      els.smartResult.hidden = true;
      els.advancedPanel.hidden = true;
      if (els.flowActions) els.flowActions.hidden = true;
      els.runButton.disabled = true;
      els.advancedControls.innerHTML = '';
      return;
    }

    const recommended = state.forcedTool || inferTool(els.intentInput.value, state.files);
    chooseTool(recommended, Boolean(state.forcedTool));
  }

  function inferTool(intent, files) {
    const q = intent.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const images = files.filter((file) => file.type.startsWith('image/'));
    const pdfs = files.filter((file) => file.type === 'application/pdf');

    if (/firma|rubrica|fondo transparente|quitar fondo/.test(q) && images.length) return 'signature';
    if (/recort|redimension|tamano|dimension|tiktok|reel|historia|2x2|35x45|pasaporte|visa|perfil/.test(q) && images.length) return 'crop';
    if (/convert|pasar a|webp|png|jpg|jpeg|formato/.test(q) && images.length) return 'convert';
    if (/unir|combinar|juntar|fusionar|ordenar pdf/.test(q) && pdfs.length) return 'mergePdf';
    if (/crear pdf|imagenes a pdf|fotos a pdf|escaneo/.test(q) && images.length) return 'imagesPdf';
    if (/reduc|comprim|menos de|kb|mb|peso|liger/.test(q) && images.length) return 'compress';

    if (pdfs.length >= 2) return 'mergePdf';
    if (images.length >= 2) return 'imagesPdf';
    if (images.length === 1) return 'compress';
    return pdfs.length ? 'mergePdf' : 'compress';
  }

  function chooseTool(tool, forced = false) {
    state.tool = tool;
    state.forcedTool = forced ? tool : null;
    const meta = toolMeta[tool];
    els.smartResult.hidden = false;
    els.advancedPanel.hidden = false;
    if (els.flowActions) els.flowActions.hidden = false;
    els.smartIcon.textContent = meta.icon;
    els.smartTitle.textContent = meta.title;
    els.smartDescription.textContent = meta.description;
    renderAdvancedControls(tool);
    const validation = validateToolFiles(tool, state.files);
    els.runButton.disabled = !validation.ok;
    if (!validation.ok) els.smartDescription.textContent = validation.message;
  }

  function validateToolFiles(tool, files) {
    const images = files.filter((file) => file.type.startsWith('image/'));
    const pdfs = files.filter((file) => file.type === 'application/pdf');
    if (!files.length) return { ok: false, message: 'Selecciona al menos un archivo.' };
    if (['compress', 'signature', 'crop'].includes(tool) && images.length !== 1) return { ok: false, message: 'Esta herramienta necesita exactamente una imagen.' };
    if (tool === 'convert' && (images.length !== files.length || images.length < 1)) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    if (tool === 'imagesPdf' && (images.length !== files.length || images.length < 1)) return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    if (tool === 'mergePdf' && (pdfs.length !== files.length || pdfs.length < 1)) return { ok: false, message: 'Selecciona uno o varios archivos PDF.' };
    return { ok: true, message: '' };
  }

  function availableTools() {
    const images = state.files.filter((file) => file.type.startsWith('image/'));
    const pdfs = state.files.filter((file) => file.type === 'application/pdf');
    const tools = [];
    if (images.length === 1 && pdfs.length === 0) tools.push('compress', 'signature', 'crop', 'convert', 'imagesPdf');
    if (images.length > 1 && pdfs.length === 0) tools.push('imagesPdf', 'convert');
    if (pdfs.length && images.length === 0) tools.push('mergePdf');
    return tools;
  }

  function openPicker() {
    els.pickerGrid.innerHTML = '';
    availableTools().forEach((tool) => {
      const meta = toolMeta[tool];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'picker-option';
      button.innerHTML = `<strong>${meta.icon} ${meta.title}</strong><span>${meta.description}</span>`;
      button.addEventListener('click', () => {
        chooseTool(tool, true);
        els.pickerDialog.close();
      });
      els.pickerGrid.appendChild(button);
    });
    els.pickerDialog.showModal();
  }

  function renderAdvancedControls(tool) {
    const original = state.files[0]?.size || 0;
    const suggestedKb = Math.max(150, Math.min(1200, Math.round((original / 1024) * 0.58)));
    const targetFromIntent = parseTargetKb(els.intentInput.value);

    const htmlByTool = {
      compress: `
        ${controlNumber('targetKb', 'Peso máximo objetivo (KB)', targetFromIntent || suggestedKb, 20, 10000)}
        ${controlSelect('compressFormat', 'Formato de salida', [['auto','Automático'],['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
        ${controlNumber('compressWidth', 'Ancho máximo (0 = automático)', 0, 0, 10000)}
        ${controlNumber('compressQuality', 'Calidad inicial (%)', 84, 25, 100)}
      `,
      signature: `
        ${controlNumber('signatureThreshold', 'Blanco a eliminar', 215, 120, 250)}
        ${controlNumber('signatureSoftness', 'Suavidad del borde', 26, 1, 80)}
        ${controlColor('signatureInk', 'Color de tinta', '#173b62')}
        ${controlNumber('signaturePadding', 'Margen final (px)', 18, 0, 100)}
      `,
      imagesPdf: `
        ${controlSelect('pdfPageSize', 'Tamaño de página', [['a4','A4'],['letter','Carta'],['image','Ajustar a cada imagen']])}
        ${controlSelect('pdfOrientation', 'Orientación', [['auto','Automática'],['portrait','Vertical'],['landscape','Horizontal']])}
        ${controlNumber('pdfMargin', 'Margen (pt)', 24, 0, 100)}
      `,
      mergePdf: `
        <div class="control" style="grid-column:1/-1"><label>Orden final</label><div style="color:var(--muted);font-size:.9rem">Usaremos el orden visible en la lista. Puedes mover cada archivo con las flechas.</div></div>
      `,
      crop: `
        ${controlSelect('cropPreset', 'Formato', [['square','Cuadrada 1080 × 1080'],['tiktok','TikTok / Reels 1080 × 1920'],['twoByTwo','Foto 2 × 2 · 600 × 600'],['visa','35 × 45 mm · 413 × 531'],['custom','Personalizado']])}
        ${controlSelect('cropFormat', 'Formato de salida', [['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        ${controlNumber('cropWidth', 'Ancho personalizado (px)', 1080, 50, 8000)}
        ${controlNumber('cropHeight', 'Alto personalizado (px)', 1080, 50, 8000)}
        ${controlNumber('cropZoom', 'Zoom (%)', 100, 100, 300)}
        ${controlNumber('cropOffsetX', 'Mover horizontal (%)', 0, -100, 100)}
        ${controlNumber('cropOffsetY', 'Mover vertical (%)', 0, -100, 100)}
      `,
      convert: `
        ${controlSelect('convertFormat', 'Formato de salida', [['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
        ${controlNumber('convertQuality', 'Calidad (%)', 86, 25, 100)}
        ${controlNumber('convertWidth', 'Ancho máximo (0 = conservar)', 0, 0, 10000)}
      `,
    };

    els.advancedControls.innerHTML = htmlByTool[tool] || '';
    const preset = $('#cropPreset');
    if (preset) preset.addEventListener('change', syncCropPreset);
  }

  function controlNumber(id, label, value, min, max) {
    return `<div class="control"><label for="${id}">${label}</label><input id="${id}" type="number" value="${value}" min="${min}" max="${max}" /></div>`;
  }

  function controlSelect(id, label, options) {
    return `<div class="control"><label for="${id}">${label}</label><select id="${id}">${options.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></div>`;
  }

  function controlColor(id, label, value) {
    return `<div class="control"><label for="${id}">${label}</label><input id="${id}" type="color" value="${value}" /></div>`;
  }

  function syncCropPreset() {
    const preset = $('#cropPreset')?.value;
    const sizes = { square:[1080,1080], tiktok:[1080,1920], twoByTwo:[600,600], visa:[413,531] };
    if (sizes[preset]) {
      $('#cropWidth').value = sizes[preset][0];
      $('#cropHeight').value = sizes[preset][1];
    }
  }

  async function runCurrentTool() {
    if (state.processing) return;
    const validation = validateToolFiles(state.tool, state.files);
    if (!validation.ok) return showToast(validation.message);

    state.processing = true;
    els.runButton.disabled = true;
    const originalText = els.runButton.innerHTML;
    els.runButton.innerHTML = '<span>Procesando…</span><span>•••</span>';

    try {
      clearPreviousOutput();
      let result;
      switch (state.tool) {
        case 'compress': result = await processCompress(); break;
        case 'signature': result = await processSignature(); break;
        case 'imagesPdf': result = await processImagesToPdf(); break;
        case 'mergePdf': result = await processMergePdf(); break;
        case 'crop': result = await processCrop(); break;
        case 'convert': result = await processConvert(); break;
        default: throw new Error('Selecciona una herramienta.');
      }
      presentResult(result);
    } catch (error) {
      console.error(error);
      showToast(error?.message || 'No pudimos procesar el archivo.');
    } finally {
      state.processing = false;
      els.runButton.innerHTML = originalText;
      els.runButton.disabled = false;
    }
  }

  async function processCompress() {
    const file = state.files[0];
    const image = await loadImage(file);
    const targetBytes = clamp(numberValue('targetKb', 500), 20, 10000) * 1024;
    const requestedMime = valueOf('compressFormat', 'auto');
    const maxWidth = clamp(numberValue('compressWidth', 0), 0, 10000);
    const initialQuality = clamp(numberValue('compressQuality', 84) / 100, .25, 1);
    const mime = requestedMime === 'auto' ? (file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp') : requestedMime;

    let width = image.naturalWidth;
    let height = image.naturalHeight;
    if (maxWidth > 0 && width > maxWidth) {
      height = Math.round(height * maxWidth / width);
      width = maxWidth;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
    let blob = null;

    for (let scalePass = 0; scalePass < 7; scalePass++) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      if (mime === 'image/png') {
        blob = await canvasToBlob(canvas, mime, 1);
      } else {
        let low = .22;
        let high = initialQuality;
        let best = await canvasToBlob(canvas, mime, low);
        for (let i = 0; i < 9; i++) {
          const quality = (low + high) / 2;
          const candidate = await canvasToBlob(canvas, mime, quality);
          if (candidate.size <= targetBytes) {
            best = candidate;
            low = quality;
          } else {
            high = quality;
          }
        }
        blob = best;
      }

      if (blob.size <= targetBytes || Math.min(width, height) < 320) break;
      const factor = Math.max(.62, Math.min(.92, Math.sqrt(targetBytes / blob.size) * .94));
      width *= factor;
      height *= factor;
    }

    const extension = extensionForMime(mime);
    return {
      blob,
      name: `${baseName(file.name)}-optimizada.${extension}`,
      title: 'Imagen optimizada',
      message: blob.size <= targetBytes ? 'La imagen quedó por debajo del peso máximo indicado.' : 'La imagen se redujo todo lo posible sin hacerla demasiado pequeña.',
      preview: blob,
      stats: [
        ['Antes', formatBytes(file.size)],
        ['Después', formatBytes(blob.size)],
        ['Reducción', `${Math.max(0, Math.round((1 - blob.size / file.size) * 100))}%`],
      ],
    };
  }

  async function processSignature() {
    const file = state.files[0];
    const image = await loadImage(file);
    const threshold = clamp(numberValue('signatureThreshold', 215), 120, 250);
    const softness = clamp(numberValue('signatureSoftness', 26), 1, 80);
    const ink = hexToRgb(valueOf('signatureInk', '#173b62'));
    const padding = clamp(numberValue('signaturePadding', 18), 0, 100);

    const source = document.createElement('canvas');
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    const sctx = source.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(image, 0, 0);
    const imgData = sctx.getImageData(0, 0, source.width, source.height);
    const d = imgData.data;
    let minX = source.width, minY = source.height, maxX = -1, maxY = -1;

    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const i = (y * source.width + x) * 4;
        const brightness = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
        const alpha = clamp((threshold + softness - brightness) / (2 * softness), 0, 1);
        d[i] = ink.r;
        d[i + 1] = ink.g;
        d[i + 2] = ink.b;
        d[i + 3] = Math.round(alpha * 255);
        if (alpha > .08) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    sctx.putImageData(imgData, 0, 0);
    if (maxX < minX || maxY < minY) throw new Error('No se detectó suficiente tinta. Baja el nivel de blanco a eliminar.');

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    const output = document.createElement('canvas');
    output.width = cropW + padding * 2;
    output.height = cropH + padding * 2;
    output.getContext('2d').drawImage(source, minX, minY, cropW, cropH, padding, padding, cropW, cropH);
    const blob = await canvasToBlob(output, 'image/png', 1);

    return {
      blob,
      name: `${baseName(file.name)}-firma-transparente.png`,
      title: 'Firma transparente lista',
      message: 'Se eliminó el fondo claro y se recortó el espacio sobrante.',
      preview: blob,
      stats: [['Formato','PNG'],['Dimensiones',`${output.width} × ${output.height}`],['Fondo','Transparente']],
    };
  }

  async function processImagesToPdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const pdf = await PDFDocument.create();
    const pageSetting = valueOf('pdfPageSize', 'a4');
    const orientationSetting = valueOf('pdfOrientation', 'auto');
    const margin = clamp(numberValue('pdfMargin', 24), 0, 100);

    for (const file of state.files) {
      const normalized = await normalizeImageForPdf(file);
      const bytes = await normalized.blob.arrayBuffer();
      const embedded = normalized.mime === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      const imgW = embedded.width;
      const imgH = embedded.height;
      let pageW, pageH;

      if (pageSetting === 'image') {
        pageW = imgW;
        pageH = imgH;
      } else {
        const base = pageSetting === 'letter' ? [612, 792] : [595.28, 841.89];
        const landscape = orientationSetting === 'landscape' || (orientationSetting === 'auto' && imgW > imgH);
        [pageW, pageH] = landscape ? [base[1], base[0]] : base;
      }

      const page = pdf.addPage([pageW, pageH]);
      const availableW = Math.max(1, pageW - margin * 2);
      const availableH = Math.max(1, pageH - margin * 2);
      const scale = Math.min(availableW / imgW, availableH / imgH, pageSetting === 'image' ? 1 : Infinity);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      page.drawImage(embedded, { x:(pageW-drawW)/2, y:(pageH-drawH)/2, width:drawW, height:drawH });
    }

    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type:'application/pdf' });
    return {
      blob,
      name: 'toolisto-imagenes.pdf',
      title: 'PDF creado',
      message: `Se generó un documento con ${state.files.length} página${state.files.length === 1 ? '' : 's'}.`,
      stats: [['Archivos',String(state.files.length)],['Páginas',String(state.files.length)],['Tamaño',formatBytes(blob.size)]],
    };
  }

  async function processMergePdf() {
    ensurePdfLib();
    const { PDFDocument } = window.PDFLib;
    const merged = await PDFDocument.create();
    let pageCount = 0;

    for (const file of state.files) {
      const source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false });
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
      pageCount += pages.length;
    }

    const bytes = await merged.save();
    const blob = new Blob([bytes], { type:'application/pdf' });
    return {
      blob,
      name: 'toolisto-pdf-unido.pdf',
      title: 'PDF combinado',
      message: 'Los documentos se unieron respetando el orden visible.',
      stats: [['Documentos',String(state.files.length)],['Páginas',String(pageCount)],['Tamaño',formatBytes(blob.size)]],
    };
  }

  async function processCrop() {
    const file = state.files[0];
    const image = await loadImage(file);
    const preset = valueOf('cropPreset', 'square');
    const presetSizes = { square:[1080,1080], tiktok:[1080,1920], twoByTwo:[600,600], visa:[413,531] };
    const [targetW, targetH] = presetSizes[preset] || [clamp(numberValue('cropWidth',1080),50,8000), clamp(numberValue('cropHeight',1080),50,8000)];
    const mime = valueOf('cropFormat', 'image/jpeg');
    const zoom = clamp(numberValue('cropZoom',100)/100,1,3);
    const offsetX = clamp(numberValue('cropOffsetX',0)/100,-1,1);
    const offsetY = clamp(numberValue('cropOffsetY',0)/100,-1,1);

    const targetRatio = targetW / targetH;
    const imageRatio = image.naturalWidth / image.naturalHeight;
    let cropW, cropH;
    if (imageRatio > targetRatio) {
      cropH = image.naturalHeight / zoom;
      cropW = cropH * targetRatio;
    } else {
      cropW = image.naturalWidth / zoom;
      cropH = cropW / targetRatio;
    }
    cropW = Math.min(cropW, image.naturalWidth);
    cropH = Math.min(cropH, image.naturalHeight);
    const maxX = (image.naturalWidth - cropW) / 2;
    const maxY = (image.naturalHeight - cropH) / 2;
    const sx = maxX + offsetX * maxX;
    const sy = maxY + offsetY * maxY;

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,targetW,targetH);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, sx, sy, cropW, cropH, 0, 0, targetW, targetH);
    const blob = await canvasToBlob(canvas, mime, .92);

    return {
      blob,
      name: `${baseName(file.name)}-${targetW}x${targetH}.${extensionForMime(mime)}`,
      title: 'Imagen preparada',
      message: `La imagen se recortó y exportó a ${targetW} × ${targetH} píxeles.`,
      preview: blob,
      stats: [['Dimensiones',`${targetW} × ${targetH}`],['Formato',extensionForMime(mime).toUpperCase()],['Tamaño',formatBytes(blob.size)]],
    };
  }

  async function processConvert() {
    if (!window.JSZip && state.files.length > 1) throw new Error('No se pudo cargar el componente para crear ZIP.');
    const mime = valueOf('convertFormat', 'image/webp');
    const quality = clamp(numberValue('convertQuality',86)/100,.25,1);
    const maxWidth = clamp(numberValue('convertWidth',0),0,10000);
    const converted = [];

    for (const file of state.files) {
      const image = await loadImage(file);
      let width = image.naturalWidth;
      let height = image.naturalHeight;
      if (maxWidth > 0 && width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha:mime !== 'image/jpeg' });
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0,0,width,height);
      }
      ctx.drawImage(image,0,0,width,height);
      const blob = await canvasToBlob(canvas,mime,quality);
      converted.push({ blob, name:`${baseName(file.name)}.${extensionForMime(mime)}` });
    }

    if (converted.length === 1) {
      const single = converted[0];
      return {
        blob:single.blob,
        name:single.name,
        title:'Imagen convertida',
        message:`El archivo se convirtió a ${extensionForMime(mime).toUpperCase()}.`,
        preview:single.blob,
        stats:[['Formato',extensionForMime(mime).toUpperCase()],['Tamaño',formatBytes(single.blob.size)],['Archivos','1']],
      };
    }

    const zip = new window.JSZip();
    converted.forEach((item) => zip.file(item.name,item.blob));
    const blob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 } });
    return {
      blob,
      name:'toolisto-imagenes-convertidas.zip',
      title:'Lote convertido',
      message:`Se convirtieron ${converted.length} imágenes y se reunieron en un ZIP.`,
      stats:[['Archivos',String(converted.length)],['Formato',extensionForMime(mime).toUpperCase()],['ZIP',formatBytes(blob.size)]],
    };
  }

  function presentResult(result) {
    state.outputBlob = result.blob;
    state.outputName = result.name;
    els.resultTitle.textContent = result.title;
    els.resultMessage.textContent = result.message;
    els.resultStats.innerHTML = (result.stats || []).map(([label,value]) => `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    els.previewArea.innerHTML = '';
    if (result.preview) {
      state.previewUrl = URL.createObjectURL(result.preview);
      const img = document.createElement('img');
      img.src = state.previewUrl;
      img.alt = 'Vista previa del resultado';
      els.previewArea.appendChild(img);
      els.previewArea.hidden = false;
    } else {
      els.previewArea.hidden = true;
    }
    els.resultDialog.showModal();
  }

  function downloadResult() {
    if (!state.outputBlob) return;
    const url = URL.createObjectURL(state.outputBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.outputName || 'toolisto-resultado';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function resetAll() {
    els.resultDialog.close();
    clearPreviousOutput();
    state.files = [];
    state.tool = null;
    state.forcedTool = null;
    els.fileInput.value = '';
    els.intentInput.value = '';
    els.advancedPanel.open = false;
    renderFiles();
    updateRecommendation();
    document.querySelector('#inicio').scrollIntoView({ behavior:'smooth' });
  }

  function clearPreviousOutput() {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = '';
    state.outputBlob = null;
    state.outputName = '';
  }

  async function normalizeImageForPdf(file) {
    if (file.type === 'image/jpeg' || file.type === 'image/png') return { blob:file, mime:file.type };
    const image = await loadImage(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image,0,0);
    return { blob:await canvasToBlob(canvas,'image/png',1), mime:'image/png' };
  }

  function ensurePdfLib() {
    if (!window.PDFLib) throw new Error('No se pudo cargar el componente PDF. Revisa tu conexión e inténtalo de nuevo.');
  }

  function loadImage(fileOrBlob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('El navegador no pudo generar el archivo.')), mime, quality));
  }

  function parseTargetKb(text) {
    const q = String(text || '').toLowerCase().replace(/,/g,'.');
    const kb = q.match(/(\d+(?:\.\d+)?)\s*kb/);
    if (kb) return Math.round(Number(kb[1]));
    const mb = q.match(/(\d+(?:\.\d+)?)\s*mb/);
    if (mb) return Math.round(Number(mb[1]) * 1024);
    return 0;
  }

  function valueOf(id, fallback) {
    return document.getElementById(id)?.value ?? fallback;
  }

  function numberValue(id, fallback) {
    const value = Number(valueOf(id, fallback));
    return Number.isFinite(value) ? value : fallback;
  }

  function extensionForMime(mime) {
    return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  }

  function baseName(name) {
    return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9áéíóúüñ _-]/gi,'').trim() || 'toolisto';
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    const units = ['B','KB','MB','GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** i);
    return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }

  function shorten(text, length) {
    return text.length > length ? `${text.slice(0, length - 1)}…` : text;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hexToRgb(hex) {
    const clean = hex.replace('#','');
    const value = parseInt(clean,16);
    return { r:(value >> 16) & 255, g:(value >> 8) & 255, b:value & 255 };
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  }

  let toastTimer;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }
})();
