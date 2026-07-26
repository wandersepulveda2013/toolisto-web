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

  function buildToolMeta() {
    const meta = {};
    $$('.tool-card').forEach((card) => {
      const toolId = card.dataset.tool;
      if (!toolId) return;
      const icon = card.querySelector('.tool-icon');
      const strong = card.querySelector('strong');
      const small = card.querySelector('small');
      meta[toolId] = {
        icon: icon ? icon.textContent.trim() : '',
        title: strong ? strong.textContent.trim() : toolId,
        description: small ? small.textContent.trim() : '',
        accepts: card.dataset.category === 'pdf' ? 'pdf' : card.dataset.category === 'images' ? 'image' : 'image',
        category: card.dataset.category || 'images',
      };
    });
    return meta;
  }

  let toolMeta = buildToolMeta();

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

  function init() {
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('toolisto-theme'); } catch (_) { /* storage may be blocked */ }
    if (savedTheme) document.documentElement.dataset.theme = savedTheme;

    els.themeToggle.addEventListener('click', toggleTheme);
    els.menuToggle.addEventListener('click', toggleMenu);
    $$('.mobile-nav a').forEach((a) => a.addEventListener('click', closeMenu));

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
      document.querySelector('#inicio').scrollIntoView({ behavior: 'smooth' });
      if (!state.files.length) {
        setTimeout(() => els.fileInput.click(), 450);
      }
    }));

    const toolPageConfig = $('#tool-page-config');
    if (toolPageConfig) {
      const toolId = toolPageConfig.dataset.toolId;
      if (toolId) {
        state.forcedTool = toolId;
        state.tool = toolId;
        chooseTool(toolId, true);
      }
    }
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
      const hidden = card.hidden;
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
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const validType = file.type.startsWith('image/') || file.type === 'application/pdf'
        || file.type.startsWith('audio/') || file.type.startsWith('video/')
        || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        || file.type === 'application/msword' || file.type === 'application/vnd.ms-excel'
        || file.type === 'application/vnd.ms-powerpoint'
        || file.type === 'application/zip'
        || ['mp3','ogg','wav','flac','aac','m4a','wma','opus','mp4','webm','avi','mkv','mov','wmv','docx','xlsx','pptx','doc','xls','ppt'].includes(ext);
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
    if (/tamano|resize|dimension/.test(q) && images.length) return 'resizeImage';
    if (/rotar|girar/.test(q) && pdfs.length) return 'rotatePdf';
    if (/separar|dividir|split/.test(q) && pdfs.length) return 'splitPdf';
    if (/extraer|extract/.test(q) && pdfs.length) return 'extractPdf';
    if (/marca de agua|watermark|marca/.test(q) && pdfs.length) return 'watermarkPdf';
    if (/numerar|numeros|page number/.test(q) && pdfs.length) return 'addPageNumbersPdf';
    if (/encabezado|pie|header|footer/.test(q) && pdfs.length) return 'addHeaderFooterPdf';
    if (/cuadernillo|booklet|impresion/.test(q) && pdfs.length) return 'bookletPdf';
    if (/cortar pagina|dividir doble|split double/.test(q) && pdfs.length) return 'splitDoublePdf';
    if (/mejorar|enhance|brillo|contraste/.test(q) && images.length) return 'enhanceImage';
    if (/fondo|background|remove/.test(q) && images.length) return 'removeBackground';
    if (/lote|varias|batch/.test(q) && images.length) return 'batchConvert';
    if (/marca.*imagen|watermark.*image/.test(q) && images.length) return 'watermarkImage';
    if (/pdf.*imagen|pdf a imagen/.test(q) && pdfs.length) return 'pdfToImages';
    if (/metadatos|metadata|inspeccionar|exif|info.*archivo/.test(q)) return 'inspectMetadata';

    if (pdfs.length >= 2) return 'mergePdf';
    if (images.length >= 2) return 'imagesPdf';
    if (images.length === 1) return 'compress';
    return pdfs.length ? 'mergePdf' : 'compress';
  }

  function chooseTool(tool, forced = false) {
    state.tool = tool;
    state.forcedTool = forced ? tool : null;
    const meta = toolMeta[tool];
    if (!meta) return;
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
    if (['compress', 'signature', 'crop', 'resizeImage', 'watermarkImage', 'enhanceImage', 'removeBackground'].includes(tool) && images.length !== 1) {
      return { ok: false, message: 'Esta herramienta necesita exactamente una imagen.' };
    }
    if (['convert', 'imagesPdf', 'batchConvert'].includes(tool) && (images.length !== files.length || images.length < 1)) {
      return { ok: false, message: 'Selecciona una o varias imágenes compatibles.' };
    }
    if (tool === 'mergePdf' && (pdfs.length !== files.length || pdfs.length < 1)) {
      return { ok: false, message: 'Selecciona uno o varios archivos PDF.' };
    }
    if (tool === 'inspectMetadata') {
      if (files.length < 1) return { ok: false, message: 'Selecciona al menos un archivo para inspeccionar.' };
      return { ok: true, message: '' };
    }
    if (['rotatePdf', 'splitPdf', 'extractPdf', 'pdfToImages', 'splitDoublePdf', 'bookletPdf', 'watermarkPdf', 'addPageNumbersPdf', 'addHeaderFooterPdf'].includes(tool) && pdfs.length !== 1) {
      return { ok: false, message: 'Esta herramienta necesita exactamente un archivo PDF.' };
    }
    return { ok: true, message: '' };
  }

  function availableTools() {
    const images = state.files.filter((file) => file.type.startsWith('image/'));
    const pdfs = state.files.filter((file) => file.type === 'application/pdf');
    const tools = [];
    if (images.length === 1 && pdfs.length === 0) tools.push('compress', 'signature', 'crop', 'convert', 'imagesPdf', 'resizeImage', 'watermarkImage', 'enhanceImage', 'removeBackground');
    if (images.length > 1 && pdfs.length === 0) tools.push('imagesPdf', 'convert', 'batchConvert');
    if (pdfs.length === 1 && images.length === 0) tools.push('rotatePdf', 'splitPdf', 'extractPdf', 'pdfToImages', 'splitDoublePdf', 'bookletPdf', 'watermarkPdf', 'addPageNumbersPdf', 'addHeaderFooterPdf');
    if (pdfs.length >= 2 && images.length === 0) tools.push('mergePdf');
    if (files.length >= 1) tools.push('inspectMetadata');
    return tools;
  }

  function openPicker() {
    els.pickerGrid.innerHTML = '';
    availableTools().forEach((tool) => {
      const meta = toolMeta[tool];
      if (!meta) return;
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
      resizeImage: `
        ${controlNumber('resizeWidth', 'Ancho (px)', 800, 1, 10000)}
        ${controlNumber('resizeHeight', 'Alto (px)', 600, 1, 10000)}
        <div class="control" style="grid-column:1/-1"><label><input type="checkbox" id="resizeKeepRatio" checked /> Mantener proporción</label></div>
        ${controlSelect('resizeFormat', 'Formato', [['image/jpeg','JPG'],['image/png','PNG'],['image/webp','WebP']])}
        ${controlNumber('resizeQuality', 'Calidad (%)', 92, 10, 100)}
      `,
      rotatePdf: `
        ${controlSelect('rotateDegrees', 'Rotación', [['90','90° derecha'],['180','180°'],['270','90° izquierda']])}
      `,
      splitPdf: `
        <div class="control" style="grid-column:1/-1"><label>Resultado</label><div style="color:var(--muted);font-size:.9rem">Cada página se separará en un archivo individual.</div></div>
      `,
      extractPdf: `
        ${controlNumber('extractPages', 'Páginas (ej: 1-3,5)', 1, 1, 100)}
      `,
      watermarkImage: `
        <div class="control"><label for="wmText">Texto de marca</label><input id="wmText" type="text" value="BORRADOR" maxlength="100" /></div>
        ${controlSelect('wmPosition', 'Posición', [['center','Centro'],['top-left','Superior izquierda'],['top-right','Superior derecha'],['bottom-left','Inferior izquierda'],['bottom-right','Inferior derecha'],['tiled','Mosaico']])}
        ${controlNumber('wmSize', 'Tamaño de fuente', 48, 8, 200)}
        ${controlNumber('wmOpacity', 'Opacidad (%)', 30, 5, 100)}
        ${controlNumber('wmMargin', 'Margen (px)', 20, 0, 200)}
        ${controlColor('wmColor', 'Color', '#888888')}
      `,
      enhanceImage: `
        ${controlNumber('enhBrightness', 'Brillo (%)', 0, -100, 100)}
        ${controlNumber('enhContrast', 'Contraste (%)', 0, -100, 100)}
        ${controlNumber('enhSaturation', 'Saturación (%)', 0, -100, 100)}
        ${controlNumber('enhSharpness', 'Nitidez (%)', 0, 0, 100)}
        <div class="control" style="grid-column:1/-1"><label><input type="checkbox" id="enhAuto" /> Corrección automática</label></div>
      `,
      removeBackground: `
        ${controlNumber('rbThreshold', 'Tolerancia de color', 30, 1, 128)}
        ${controlSelect('rbSample', 'Muestrear fondo de', [['topleft','Esquina superior izquierda'],['topright','Esquina superior derecha'],['bottomleft','Esquina inferior izquierda'],['bottomright','Esquina inferior derecha'],['center','Centro']])}
        ${controlNumber('rbSoftness', 'Suavizado de borde', 5, 0, 30)}
        <div class="control" style="grid-column:1/-1"><label><div style="color:var(--muted);font-size:.85rem">Modo por color: elimina píxeles similares al color de fondo. Funciona mejor con fondos uniformes. No es eliminación inteligente con IA.</div></label></div>
      `,
      batchConvert: `
        ${controlSelect('batchFormat', 'Formato', [['image/webp','WebP'],['image/jpeg','JPG'],['image/png','PNG']])}
        ${controlNumber('batchQuality', 'Calidad (%)', 86, 25, 100)}
      `,
      pdfToImages: `
        ${controlSelect('ptiFormat', 'Formato', [['image/png','PNG'],['image/jpeg','JPG']])}
        ${controlNumber('ptiScale', 'Escala (%)', 100, 50, 300)}
      `,
      splitDoublePdf: `
        ${controlSelect('splitDir', 'Dirección', [['vertical','Vertical (por la mitad)'],['horizontal','Horizontal (por la mitad)']])}
      `,
      bookletPdf: `
        <div class="control" style="grid-column:1/-1"><label>Configuración</label><div style="color:var(--muted);font-size:.9rem">Las páginas se reordenarán para impresión en cuadernillo. Se añadirán páginas en blanco si es necesario.</div></div>
      `,
      watermarkPdf: `
        ${controlNumber('wmPdfText', 'Texto de marca', 'BORRADOR', 1, 100)}
        ${controlNumber('wmPdfOpacity', 'Opacidad (%)', 30, 5, 100)}
        ${controlNumber('wmPdfSize', 'Tamaño de fuente', 60, 10, 200)}
      `,
      addPageNumbersPdf: `
        ${controlSelect('numStyle', 'Estilo', [['normal','Normal (1, 2, 3...)'],['roman','Romano (I, II, III...)']])}
      `,
      addHeaderFooterPdf: `
        ${controlNumber('hfHeader', 'Encabezado', 'Documento Confidencial', 1, 200)}
        ${controlNumber('hfFooter', 'Pie de página', 'Toolisto', 1, 200)}
      `,
      inspectMetadata: `
        <div class="control" style="grid-column:1/-1"><label><div style="color:var(--muted);font-size:.85rem">Análisis local: los archivos nunca salen de tu navegador. Se detectan metadatos EXIF, IPTC, XMP, PDF y Office.</div></label></div>
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
      const processors = window.ToolProcessors || {};

      switch (state.tool) {
        case 'compress': result = await processCompress(); break;
        case 'signature': result = await processSignature(); break;
        case 'imagesPdf': result = await processImagesToPdf(); break;
        case 'mergePdf': result = await processMergePdf(); break;
        case 'crop': result = await processCrop(); break;
        case 'convert': result = await processConvert(); break;
        case 'splitDoublePdf':
          result = await processPdfWithProcessor(processors.splitDoublePdf, state.files[0], { direction: valueOf('splitDir', 'vertical') });
          break;
        case 'bookletPdf':
          result = await processPdfWithProcessor(processors.bookletPdf, state.files[0], {});
          break;
        case 'watermarkPdf':
          result = await processPdfWithProcessor(processors.watermarkPdf, state.files[0], {
            text: valueOf('wmPdfText', 'BORRADOR'),
            opacity: numberValue('wmPdfOpacity', 30) / 100,
            fontSize: numberValue('wmPdfSize', 60),
          });
          break;
        case 'addPageNumbersPdf':
          result = await processPdfWithProcessor(processors.addPageNumbersPdf, state.files[0], {
            style: valueOf('numStyle', 'normal'),
          });
          break;
        case 'addHeaderFooterPdf':
          result = await processPdfWithProcessor(processors.addHeaderFooterPdf, state.files[0], {
            header: valueOf('hfHeader', 'Documento Confidencial'),
            footer: valueOf('hfFooter', 'Toolisto'),
            showHeader: !!valueOf('hfHeader', ''),
            showFooter: !!valueOf('hfFooter', ''),
          });
          break;
        case 'rotatePdf':
          result = await processPdfWithProcessor(processors.rotatePdf, state.files[0], {
            degrees: numberValue('rotateDegrees', 90),
          });
          break;
        case 'splitPdf':
          result = await processPdfWithProcessor(processors.splitPdf, state.files[0], {});
          break;
        case 'extractPdf':
          result = await processPdfWithProcessor(processors.extractPdf, state.files[0], {
            pages: valueOf('extractPages', '1-5'),
          });
          break;
        case 'resizeImage': result = await processResizeImage(); break;
        case 'watermarkImage': result = await processWatermarkImage(); break;
        case 'enhanceImage': result = await processEnhanceImage(); break;
        case 'removeBackground': result = await processRemoveBackground(); break;
        case 'batchConvert': result = await processBatchConvert(); break;
        case 'pdfToImages': result = await processPdfToImages(); break;
        case 'inspectMetadata': result = await processInspectMetadata(); break;
        default: throw new Error('Selecciona una herramienta.');
      }
      if (result) {
        if (state.tool === 'inspectMetadata' && result.metadata) {
          presentMetadataResult(result);
        } else {
          presentResult(result);
        }
      }
    } catch (error) {
      console.error(error);
      showToast(error?.message || 'No pudimos procesar el archivo.');
    } finally {
      state.processing = false;
      els.runButton.innerHTML = originalText;
      els.runButton.disabled = false;
    }
  }

  async function processPdfWithProcessor(processorFn, file, options) {
    if (!processorFn) throw new Error('Procesador no disponible.');
    const result = await processorFn(file, options);
    const blob = new Blob([result.data], { type: 'application/pdf' });
    return {
      blob,
      name: result.name,
      title: result.title,
      message: result.message,
      stats: result.stats,
    };
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
      const source = await PDFDocument.load(await file.arrayBuffer());
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

  async function processResizeImage() {
    const file = state.files[0];
    const image = await loadImage(file);
    let width = clamp(numberValue('resizeWidth', 800), 1, 10000);
    let height = clamp(numberValue('resizeHeight', 600), 1, 10000);
    const keepRatio = document.getElementById('resizeKeepRatio')?.checked;
    const mime = valueOf('resizeFormat', 'image/jpeg');
    const quality = clamp(numberValue('resizeQuality', 92) / 100, 0.1, 1);

    if (keepRatio) {
      const ratio = image.naturalWidth / image.naturalHeight;
      if (width / height > ratio) {
        width = Math.round(height * ratio);
      } else {
        height = Math.round(width / ratio);
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, mime, quality);

    return {
      blob,
      name: `${baseName(file.name)}-${width}x${height}.${extensionForMime(mime)}`,
      title: 'Imagen redimensionada',
      message: `La imagen se redimensionó a ${width} × ${height} píxeles.`,
      preview: blob,
      stats: [
        ['Original', `${image.naturalWidth} × ${image.naturalHeight}`],
        ['Resultado', `${width} × ${height}`],
        ['Formato', extensionForMime(mime).toUpperCase()],
        ['Tamaño', formatBytes(blob.size)],
      ],
    };
  }

  async function processWatermarkImage() {
    const file = state.files[0];
    const image = await loadImage(file);
    const text = valueOf('wmText', 'BORRADOR');
    const position = valueOf('wmPosition', 'center');
    const fontSize = clamp(numberValue('wmSize', 48), 8, 200);
    const opacity = clamp(numberValue('wmOpacity', 30) / 100, 0.05, 1);
    const margin = clamp(numberValue('wmMargin', 20), 0, 200);
    const color = valueOf('wmColor', '#888888');

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';

    if (position === 'tiled') {
      ctx.textAlign = 'center';
      const metrics = ctx.measureText(text);
      const textW = metrics.width;
      const textH = fontSize * 1.2;
      const angle = -Math.PI / 6;
      for (let y = -canvas.height; y < canvas.height * 2; y += textH * 2.5) {
        for (let x = -canvas.width; x < canvas.width * 2; x += textW * 2) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
    } else {
      const metrics = ctx.measureText(text);
      const textW = metrics.width;
      const textH = fontSize;
      let x, y;
      if (position === 'top-left') { x = margin; y = margin + textH / 2; }
      else if (position === 'top-right') { x = canvas.width - margin - textW; y = margin + textH / 2; }
      else if (position === 'bottom-left') { x = margin; y = canvas.height - margin - textH / 2; }
      else if (position === 'bottom-right') { x = canvas.width - margin - textW; y = canvas.height - margin - textH / 2; }
      else { x = (canvas.width - textW) / 2; y = canvas.height / 2; }
      ctx.textAlign = 'left';
      ctx.fillText(text, x, y);
    }
    ctx.restore();

    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, 0.92);
    return {
      blob,
      name: `${baseName(file.name)}-marcadeagua.${extensionForMime(mime)}`,
      title: 'Marca de agua añadida',
      message: `Marca de agua "${text}" añadida en posición ${position}.`,
      preview: blob,
      stats: [
        ['Posición', position],
        ['Opacidad', `${Math.round(opacity * 100)}%`],
        ['Dimensiones', `${canvas.width} × ${canvas.height}`],
        ['Tamaño', formatBytes(blob.size)],
      ],
    };
  }

  async function processEnhanceImage() {
    const file = state.files[0];
    const image = await loadImage(file);
    const brightness = clamp(numberValue('enhBrightness', 0), -100, 100);
    const contrast = clamp(numberValue('enhContrast', 0), -100, 100);
    const saturation = clamp(numberValue('enhSaturation', 0), -100, 100);
    const sharpness = clamp(numberValue('enhSharpness', 0), 0, 100);
    const autoCorrect = document.getElementById('enhAuto')?.checked;

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (autoCorrect) {
      let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
      for (let i = 0; i < imgData.data.length; i += 4) {
        minR = Math.min(minR, imgData.data[i]); maxR = Math.max(maxR, imgData.data[i]);
        minG = Math.min(minG, imgData.data[i+1]); maxG = Math.max(maxG, imgData.data[i+1]);
        minB = Math.min(minB, imgData.data[i+2]); maxB = Math.max(maxB, imgData.data[i+2]);
      }
      const avgMin = (minR + minG + minB) / 3;
      const avgMax = (maxR + maxG + maxB) / 3;
      const range = avgMax - avgMin || 1;
      const autoContrast = Math.min(50, Math.max(-50, ((128 - avgMin) / range - 0.5) * 60));
      const autoBright = Math.min(30, Math.max(-30, (128 - (avgMin + avgMax) / 2) * 0.4));
      applyEnhancements(imgData, autoBright, autoContrast, 0);
      ctx.putImageData(imgData, 0, 0);
      imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    applyEnhancements(imgData, brightness, contrast, saturation);
    ctx.putImageData(imgData, 0, 0);

    if (sharpness > 0) {
      const factor = sharpness / 100;
      const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const blurred = gaussianBlur(srcData, canvas.width, canvas.height);
      const sd = srcData.data;
      const bd = blurred.data;
      for (let i = 0; i < sd.length; i += 4) {
        sd[i] = clamp(Math.round(sd[i] + factor * (sd[i] - bd[i])), 0, 255);
        sd[i+1] = clamp(Math.round(sd[i+1] + factor * (sd[i+1] - bd[i+1])), 0, 255);
        sd[i+2] = clamp(Math.round(sd[i+2] + factor * (sd[i+2] - bd[i+2])), 0, 255);
      }
      ctx.putImageData(srcData, 0, 0);
    }

    const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await canvasToBlob(canvas, mime, 0.95);
    return {
      blob,
      name: `${baseName(file.name)}-mejorada.${extensionForMime(mime)}`,
      title: 'Imagen mejorada',
      message: `Se aplicaron ajustes: brillo ${brightness}%, contraste ${contrast}%, saturación ${saturation}%, nitidez ${sharpness}%.`,
      preview: blob,
      stats: [
        ['Brillo', `${brightness}%`],
        ['Contraste', `${contrast}%`],
        ['Saturación', `${saturation}%`],
        ['Nitidez', `${sharpness}%`],
        ['Tamaño', formatBytes(blob.size)],
      ],
    };
  }

  function applyEnhancements(imgData, brightness, contrast, saturation) {
    const d = imgData.data;
    const bFactor = 1 + brightness / 100;
    const cFactor = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
    const sFactor = 1 + saturation / 100;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i+1], b = d[i+2];
      r = r * bFactor; g = g * bFactor; b = b * bFactor;
      r = cFactor * (r - 128) + 128; g = cFactor * (g - 128) + 128; b = cFactor * (b - 128) + 128;
      if (saturation !== 0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + sFactor * (r - gray); g = gray + sFactor * (g - gray); b = gray + sFactor * (b - gray);
      }
      d[i] = clamp(Math.round(r), 0, 255);
      d[i+1] = clamp(Math.round(g), 0, 255);
      d[i+2] = clamp(Math.round(b), 0, 255);
    }
  }

  function gaussianBlur(srcData, w, h) {
    const dst = new ImageData(w, h);
    const src = srcData.data;
    const out = dst.data;
    const k = [1, 4, 6, 4, 1];
    const kSum = 16;
    const temp = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0;
          for (let ki = 0; ki < 5; ki++) {
            const sx = clamp(x + ki - 2, 0, w - 1);
            val += src[(y * w + sx) * 4 + c] * k[ki];
          }
          temp[(y * w + x) * 4 + c] = val / kSum;
        }
        temp[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0;
          for (let ki = 0; ki < 5; ki++) {
            const sy = clamp(y + ki - 2, 0, h - 1);
            val += temp[(sy * w + x) * 4 + c] * k[ki];
          }
          out[(y * w + x) * 4 + c] = val / kSum;
        }
        out[(y * w + x) * 4 + 3] = temp[(y * w + x) * 4 + 3];
      }
    }
    return dst;
  }

  async function processRemoveBackground() {
    const file = state.files[0];
    const image = await loadImage(file);
    const threshold = clamp(numberValue('rbThreshold', 30), 1, 128);
    const samplePos = valueOf('rbSample', 'topleft');
    const softness = clamp(numberValue('rbSoftness', 5), 0, 30);

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;

    let sampleX, sampleY;
    if (samplePos === 'topright') { sampleX = canvas.width - 1; sampleY = 0; }
    else if (samplePos === 'bottomleft') { sampleX = 0; sampleY = canvas.height - 1; }
    else if (samplePos === 'bottomright') { sampleX = canvas.width - 1; sampleY = canvas.height - 1; }
    else if (samplePos === 'center') { sampleX = Math.floor(canvas.width / 2); sampleY = Math.floor(canvas.height / 2); }
    else { sampleX = 0; sampleY = 0; }

    const si = (sampleY * canvas.width + sampleX) * 4;
    const bgR = d[si], bgG = d[si + 1], bgB = d[si + 2];

    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
      if (dist <= threshold) {
        d[i + 3] = 0;
      } else if (softness > 0 && dist <= threshold + softness) {
        const alpha = Math.round(255 * ((dist - threshold) / softness));
        d[i + 3] = Math.min(d[i + 3], alpha);
      }
    }
    ctx.putImageData(imgData, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/png', 1);
    return {
      blob,
      name: `${baseName(file.name)}-sin-fondo.png`,
      title: 'Fondo eliminado',
      message: `Fondo eliminado por color (tolerancia ${threshold}). Resultado en PNG transparente.`,
      preview: blob,
      stats: [
        ['Modo', 'Color uniforme'],
        ['Tolerancia', String(threshold)],
        ['Suavizado', String(softness)],
        ['Dimensiones', `${canvas.width} × ${canvas.height}`],
        ['Tamaño', formatBytes(blob.size)],
      ],
    };
  }

  async function processBatchConvert() {
    const files = state.files;
    if (!files.length) throw new Error('Agrega al menos una imagen para convertir.');
    const mime = valueOf('batchFormat', 'image/webp');
    const quality = clamp(numberValue('batchQuality', 86), 25, 100) / 100;
    const ext = mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'png';
    const hasJSZip = !!window.JSZip;
    const zip = hasJSZip ? new JSZip() : null;
    let ok = 0, fail = 0, totalSize = 0;

    for (const file of files) {
      try {
        const image = await loadImage(file);
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        const blob = await canvasToBlob(canvas, mime, quality);
        totalSize += blob.size;
        const outName = `${baseName(file.name)}.${ext}`;
        if (zip) zip.file(outName, blob);
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = outName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
        ok++;
      } catch (e) { fail++; }
    }

    if (zip) {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      return {
        blob: zipBlob,
        name: `toolisto-lote-${ok}archivos.zip`,
        title: `Conversión por lotes completada`,
        message: `${ok} archivo(s) convertidos a ${ext.toUpperCase()}${fail ? `, ${fail} fallidos` : ''}.`,
        preview: null,
        stats: [
          ['Convertidos', String(ok)],
          ['Fallidos', String(fail)],
          ['Formato', ext.toUpperCase()],
          ['Calidad', `${Math.round(quality * 100)}%`],
          ['Tamaño total', formatBytes(totalSize)],
        ],
      };
    }
    return {
      blob: null,
      name: '',
      title: `Conversión por lotes completada`,
      message: `${ok} archivo(s) convertidos a ${ext.toUpperCase()}${fail ? `, ${fail} fallidos` : ''}. Descargas individuales realizadas.`,
      preview: null,
      stats: [
        ['Convertidos', String(ok)],
        ['Fallidos', String(fail)],
        ['Formato', ext.toUpperCase()],
        ['Calidad', `${Math.round(quality * 100)}%`],
      ],
    };
  }

  async function processPdfToImages() {
    const file = state.files[0];
    if (!file) throw new Error('Selecciona un archivo PDF.');
    if (!window.pdfjsLib) throw new Error('PDF.js no está cargado. Verifica tu conexión.');
    const mime = valueOf('ptiFormat', 'image/png');
    const scalePct = clamp(numberValue('ptiScale', 100), 50, 300) / 100;
    const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
    const pdfData = new Uint8Array(await file.arrayBuffer());
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const pdf = await pdfjsLib.getDocument({ data: pdfData, useWorker: false }).promise;
    const numPages = pdf.numPages;
    const hasJSZip = !!window.JSZip;
    const zip = hasJSZip ? new JSZip() : null;
    let totalPages = 0;
    const base = baseName(file.name);

    for (let i = 1; i <= numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: scalePct });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const blob = await canvasToBlob(canvas, mime, 1);
        const name = `${base}-pagina${i}.${ext}`;
        if (zip) zip.file(name, blob);
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
        totalPages++;
      } catch (e) { /* skip failed page */ }
    }

    if (zip) {
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      return {
        blob: zipBlob,
        name: `${base}-${totalPages}paginas.zip`,
        title: 'PDF convertido a imágenes',
        message: `${totalPages} página(s) exportadas como ${ext.toUpperCase()}${scalePct !== 1 ? ` (escala ${Math.round(scalePct * 100)}%)` : ''}.`,
        preview: null,
        stats: [
          ['Páginas', String(totalPages)],
          ['Formato', ext.toUpperCase()],
          ['Escala', `${Math.round(scalePct * 100)}%`],
          ['Tamaño', formatBytes(zipBlob.size)],
        ],
      };
    }
    return {
      blob: null,
      name: '',
      title: 'PDF convertido a imágenes',
      message: `${totalPages} página(s) exportadas como ${ext.toUpperCase()}. Descargas individuales realizadas.`,
      preview: null,
      stats: [
        ['Páginas', String(totalPages)],
        ['Formato', ext.toUpperCase()],
        ['Escala', `${Math.round(scalePct * 100)}%`],
      ],
    };
  }

  function presentMetadataResult(result) {
    state.metadataResult = result;
    els.resultTitle.textContent = result.title;
    els.resultMessage.textContent = result.message;
    els.resultStats.innerHTML = '';
    els.previewArea.innerHTML = '';
    els.previewArea.hidden = false;

    const r = result.metadata;
    const sections = [];

    sections.push(`<div class="metadata-section"><h3 style="margin:0 0 .5rem;color:var(--accent)">A. Información general</h3>`);
    sections.push(`<table class="metadata-table"><tbody>`);
    r.general.forEach(([k, v]) => {
      sections.push(`<tr><td class="meta-label">${escapeHtml(k)}</td><td>${escapeHtml(String(v ?? 'No encontrado'))}</td></tr>`);
    });
    sections.push(`</tbody></table></div>`);

    if (r.metadataEntries.length) {
      sections.push(`<div class="metadata-section"><h3 style="margin:1rem 0 .5rem;color:var(--accent)">B. Metadatos encontrados</h3>`);
      sections.push(`<table class="metadata-table"><thead><tr><th>Campo</th><th>Valor</th><th>Categoría</th></tr></thead><tbody>`);
      r.metadataEntries.forEach(([field, value, category]) => {
        sections.push(`<tr><td class="meta-label">${escapeHtml(field)}</td><td>${escapeHtml(String(value ?? 'No encontrado'))}</td><td><span class="meta-badge">${escapeHtml(category)}</span></td></tr>`);
      });
      sections.push(`</tbody></table></div>`);
    }

    if (r.sensitive.length) {
      sections.push(`<div class="metadata-section metadata-warn"><h3 style="margin:1rem 0 .5rem;color:#e74c3c">C. Información sensible</h3>`);
      r.sensitive.forEach(([field, value, risk]) => {
        const color = risk === 'alto' ? '#e74c3c' : risk === 'medio' ? '#f39c12' : '#3498db';
        sections.push(`<div class="sensitive-item" style="border-left:3px solid ${color};padding:.4rem .8rem;margin:.3rem 0;background:var(--card);border-radius:4px"><strong>${escapeHtml(field)}</strong>: ${escapeHtml(String(value))} <span class="meta-badge" style="background:${color};color:#fff">${escapeHtml(risk)}</span></div>`);
      });
      sections.push(`</div>`);
    } else {
      sections.push(`<div class="metadata-section"><h3 style="margin:1rem 0 .5rem;color:var(--accent)">C. Información sensible</h3><p style="color:var(--muted)">No se detectaron metadatos sensibles conocidos.</p></div>`);
    }

    if (r.technical.length) {
      sections.push(`<div class="metadata-section"><h3 style="margin:1rem 0 .5rem;color:var(--accent)">D. Vista técnica</h3>`);
      sections.push(`<div class="metadata-table-wrap"><table class="metadata-table"><thead><tr><th>Campo</th><th>Valor</th><th>Categoría</th><th>Riesgo</th></tr></thead><tbody>`);
      r.technical.forEach(([field, value, category, risk]) => {
        const rColor = risk === 'alto' ? '#e74c3c' : risk === 'medio' ? '#f39c12' : '#27ae60';
        sections.push(`<tr><td class="meta-label">${escapeHtml(field)}</td><td>${escapeHtml(String(value ?? ''))}</td><td><span class="meta-badge">${escapeHtml(category)}</span></td><td><span class="meta-badge" style="background:${rColor};color:#fff">${escapeHtml(risk)}</span></td></tr>`);
      });
      sections.push(`</tbody></table></div></div>`);
    }

    sections.push(`<div class="metadata-actions" style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:.5rem">`);
    sections.push(`<button type="button" class="btn-secondary" onclick="window._metaCopy()">Copiar resultados</button>`);
    sections.push(`<button type="button" class="btn-secondary" onclick="window._metaDownloadJSON()">Descargar JSON</button>`);
    sections.push(`<button type="button" class="btn-secondary" onclick="window._metaDownloadTXT()">Descargar TXT</button>`);
    if (r.canClean) sections.push(`<button type="button" class="btn-secondary" onclick="window._metaClean()" style="border-color:#e74c3c;color:#e74c3c">Limpiar metadatos</button>`);
    sections.push(`<button type="button" class="btn-secondary" onclick="window._metaReset()">Analizar otro archivo</button>`);
    sections.push(`</div>`);

    els.previewArea.innerHTML = `<div class="metadata-result" style="width:100%;max-height:60vh;overflow-y:auto;padding:.5rem">${sections.join('')}</div>`;
    els.resultDialog.showModal();
  }

  window._metaCopy = function() {
    const r = state.metadataResult;
    if (!r) return;
    const lines = [r.title, r.message, ''];
    r.metadata.general.forEach(([k, v]) => lines.push(`${k}: ${v ?? 'No encontrado'}`));
    lines.push('', '--- Metadatos ---');
    r.metadata.metadataEntries.forEach(([f, v, c]) => lines.push(`[${c}] ${f}: ${v ?? ''}`));
    if (r.metadata.sensitive.length) { lines.push('', '--- Sensible ---'); r.metadata.sensitive.forEach(([f, v, risk]) => lines.push(`[${risk.toUpperCase()}] ${f}: ${v}`)); }
    navigator.clipboard.writeText(lines.join('\n')).then(() => showToast('Copiado al portapapeles'));
  };

  window._metaDownloadJSON = function() {
    const r = state.metadataResult;
    if (!r) return;
    const obj = { title: r.title, general: Object.fromEntries(r.metadata.general), metadata: Object.fromEntries(r.metadata.metadataEntries.map(([f,v,c]) => [f, { value: v, category: c }])), sensitive: r.metadata.sensitive.map(([f,v,r]) => ({ field: f, value: v, risk: r })), technical: Object.fromEntries(r.metadata.technical.map(([f,v,c,r]) => [f, { value: v, category: c, risk: r }])) };
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${r.metadata.fileName || 'metadatos'}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  window._metaDownloadTXT = function() {
    const r = state.metadataResult;
    if (!r) return;
    const lines = [r.title, '='.repeat(r.title.length), '', r.message, '', 'INFORMACIÓN GENERAL', '-'.repeat(20)];
    r.metadata.general.forEach(([k, v]) => lines.push(`  ${k}: ${v ?? 'No encontrado'}`));
    lines.push('', 'METADATOS ENCONTRADOS', '-'.repeat(20));
    r.metadata.metadataEntries.forEach(([f, v, c]) => lines.push(`  [${c}] ${f}: ${v ?? ''}`));
    if (r.metadata.sensitive.length) { lines.push('', 'INFORMACIÓN SENSIBLE', '-'.repeat(20)); r.metadata.sensitive.forEach(([f, v, risk]) => lines.push(`  [${risk.toUpperCase()}] ${f}: ${v}`)); }
    lines.push('', 'VISTA TÉCNICA', '-'.repeat(20));
    r.metadata.technical.forEach(([f, v, c, risk]) => lines.push(`  [${c}] ${f}: ${v ?? ''} (${risk})`));
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${r.metadata.fileName || 'metadatos'}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  window._metaClean = async function() {
    const r = state.metadataResult;
    if (!r || !state.files.length) return;
    const file = state.files[0];
    try {
      if (file.type === 'image/jpeg') {
        const buf = new Uint8Array(await file.arrayBuffer());
        const cleaned = stripJpegExif(buf);
        const blob = new Blob([cleaned], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = file.name.replace(/\.[^.]+$/, '') + '-sin-metadatos.jpg'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
        showToast('Metadatos eliminados. Descargando copia limpia.');
      } else {
        showToast('Limpieza disponible solo para JPEG por ahora.');
      }
    } catch (e) { showToast('Error al limpiar: ' + e.message); }
  };

  window._metaReset = function() {
    els.resultDialog.close();
    clearPreviousOutput();
    state.files = [];
    state.metadataResult = null;
    els.fileInput.value = '';
    els.intentInput.value = '';
    els.advancedPanel.open = false;
    renderFiles();
    updateRecommendation();
    document.querySelector('#inicio').scrollIntoView({ behavior: 'smooth' });
  };

  function stripJpegExif(buf) {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return buf;
    const out = [0xFF, 0xD8];
    let i = 2;
    while (i < buf.length - 1) {
      if (buf[i] !== 0xFF) break;
      const marker = buf[i + 1];
      if (marker === 0xDA) { out.push(...buf.slice(i)); break; }
      if (marker === 0xE1 || marker === 0xED || marker === 0xFE) { i += 2 + (buf[i+2] << 8 | buf[i+3]); continue; }
      out.push(buf[i], buf[i + 1]);
      i += 2;
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        const len = buf[i] << 8 | buf[i + 1];
        out.push(...buf.slice(i, i + len));
        i += len;
      } else if (marker === 0xC4 || marker === 0xC8 || marker === 0xCC) {
        const len = buf[i] << 8 | buf[i + 1];
        i += len;
      } else if (marker === 0xD9 || marker === 0xD0 || marker === 0xD1 || marker === 0xD2 || marker === 0xD3 || marker === 0xD4 || marker === 0xD5 || marker === 0xD6 || marker === 0xD7 || marker === 0xD8) {
        /* no payload */
      } else {
        const len = buf[i] << 8 | buf[i + 1];
        i += len;
      }
    }
    return new Uint8Array(out);
  }

  function parseExifFromBuffer(buf) {
    const view = new DataView(buf);
    if (view.getUint16(0) !== 0xFFD8) return null;
    let offset = 2;
    while (offset < buf.byteLength - 1) {
      if (view.getUint8(offset) !== 0xFF) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xE1) {
        const len = view.getUint16(offset + 2);
        const header = String.fromCharCode(...new Uint8Array(buf, offset + 4, 4));
        if (header.startsWith('Exif')) return parseExifData(buf, offset + 4 + 6, len - 8);
        offset += 2 + len;
      } else if (marker === 0xD9 || marker === 0xDA) {
        break;
      } else {
        offset += 2 + (view.getUint16(offset + 2) || 2);
      }
    }
    return null;
  }

  function parseExifData(buf, start, length) {
    try {
      const view = new DataView(buf);
      const bo = view.getUint16(start);
      const le = bo === 0x4949;
      const read16 = (off) => le ? view.getUint16(off, true) : view.getUint16(off);
      const read32 = (off) => le ? view.getUint32(off, true) : view.getUint32(off);
      const readAscii = (off, len) => {
        let s = '';
        for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
        return s.replace(/\0+$/, '');
      };
      const tags = {};
      const dirStart = start + 2 + 2;
      const count = read16(dirStart - 2);
      for (let i = 0; i < count; i++) {
        const entry = dirStart + i * 12;
        if (entry + 12 > start + length) break;
        const tag = read16(entry);
        const type = read16(entry + 2);
        const num = read32(entry + 4);
        let val;
        const voff = entry + 8;
        if (type === 2) {
          const strLen = num > 4 ? read32(voff) : num;
          const strOff = num > 4 ? (read32(voff) & 0x0FFFFFFF) + start : voff;
          val = readAscii(strOff, strLen);
        } else if (type === 3) { val = read16(voff); }
        else if (type === 4) { val = read32(voff); }
        else if (type === 5 || type === 10) {
          const numOff = num > 4 ? (read32(voff) & 0x0FFFFFFF) + start : voff;
          const n = read32(numOff); const d = read32(numOff + 4);
          val = d ? n / d : n;
        }
        else { val = num; }
        tags[tag] = val;
      }
      return tags;
    } catch (e) { return null; }
  }

  const EXIF_TAGS = {
    0x010F: 'Fabricante', 0x0110: 'Modelo', 0x0112: 'Orientación', 0x011A: 'Resolución X',
    0x011B: 'Resolución Y', 0x0131: 'Software', 0x0132: 'Fecha modificación', 0x013B: 'Autor',
    0x8298: 'Copyright', 0x8769: 'IFD Exif', 0x8825: 'GPS IFD',
    0xA005: 'Exif IFD', 0x010E: 'Descripción', 0x0213: 'Posición YCC',
    0xA430: 'Cámara owner', 0xA431: 'Serial number', 0xA432: 'Lens info',
    0xA433: 'Lens make', 0xA434: 'Lens model',
  };

  const GPS_TAGS = {
    1: 'GPS Lat Ref', 2: 'GPS Lat', 3: 'GPS Lon Ref', 4: 'GPS Lon',
    5: 'GPS Alt Ref', 6: 'GPS Altitud',
  };

  function formatExifValue(tag, val) {
    if (tag === 0x0112) { const o = {1:'Normal',2:'Volteado horizontal',3:'Rotado 180°',4:'Volteado vertical',5:'Rotado 90° CW',6:'Rotado 90° CCW',7:'No estándar',8:'Rotado 270°'}; return o[val] || String(val); }
    if (tag === 0xA001 || tag === 0x0106) { const s = {1:'sRGB',2:'Adobe RGB',65535:'No definido'}; return s[val] || String(val); }
    if (Array.isArray(val)) return val.join('/');
    return String(val);
  }

  function getImageDimensions(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function analyzeImageMetadata(file) {
    const general = [['Nombre', file.name], ['Tipo', file.type], ['Tamaño', formatBytes(file.size)], ['Última modificación', new Date(file.lastModified).toLocaleString('es')]];
    const dims = await getImageDimensions(file);
    if (dims) general.push(['Dimensiones', `${dims.width} × ${dims.height} px`]);
    general.push(['Análisis', 'Local en navegador']);

    const metadataEntries = [];
    const sensitive = [];
    const technical = [];

    const buf = await file.arrayBuffer();
    const exifTags = parseExifFromBuffer(buf);

    if (exifTags) {
      const tagMap = { 0x010F: 'Fabricante', 0x0110: 'Modelo', 0x0112: 'Orientación', 0x0131: 'Software', 0x013B: 'Autor', 0x8298: 'Copyright', 0x010E: 'Descripción', 0xA430: 'Propietario', 0xA431: 'Número de serie', 0xA432: 'Info lente', 0xA433: 'Fabricante lente', 0xA434: 'Modelo lente' };
      for (const [tag, name] of Object.entries(tagMap)) {
        const t = parseInt(tag);
        if (exifTags[t] !== undefined) {
          const v = formatExifValue(t, exifTags[t]);
          metadataEntries.push([name, v, 'EXIF']);
          technical.push([name, v, 'EXIF', 'medio']);
        }
      }
      if (exifTags[0x9003]) metadataEntries.push(['Fecha de captura', exifTags[0x9003], 'EXIF']);
      if (exifTags[0x9004]) metadataEntries.push(['Fecha original', exifTags[0x9004], 'EXIF']);
      if (exifTags[0xA001]) metadataEntries.push(['Perfil de color', formatExifValue(0xA001, exifTags[0xA001]), 'EXIF']);
      if (exifTags[0xA420]) metadataEntries.push(['Versión unique image', String(exifTags[0xA420]), 'EXIF']);

      if (exifTags[0x8825]) {
        metadataEntries.push(['Datos GPS presentes', 'Sí', 'GPS']);
        sensitive.push(['Ubicación GPS', 'GPS disponible en archivo', 'alto']);
        technical.push(['GPS', 'Coordenadas incrustadas', 'GPS', 'alto']);
      }

      if (exifTags[0x010F]) sensitive.push(['Fabricante de cámara', formatExifValue(0x010F, exifTags[0x010F]), 'medio']);
      if (exifTags[0x0110]) sensitive.push(['Modelo de cámara', formatExifValue(0x0110, exifTags[0x0110]), 'medio']);
      if (exifTags[0x0131]) sensitive.push(['Software utilizado', formatExifValue(0x0131, exifTags[0x0131]), 'medio']);
      if (exifTags[0x013B]) sensitive.push(['Autor', formatExifValue(0x013B, exifTags[0x013B]), 'medio']);
      if (exifTags[0x8298]) sensitive.push(['Copyright', formatExifValue(0x8298, exifTags[0x8298]), 'bajo']);
      if (exifTags[0xA430]) sensitive.push(['Propietario de cámara', formatExifValue(0xA430, exifTags[0xA430]), 'medio']);
      if (exifTags[0xA431]) sensitive.push(['Número de serie', formatExifValue(0xA431, exifTags[0xA431]), 'alto']);
      if (exifTags[0x9003] || exifTags[0x9004]) sensitive.push(['Fecha de captura', exifTags[0x9003] || exifTags[0x9004], 'medio']);
    }

    if (dims) { technical.push(['Dimensiones', `${dims.width} × ${dims.height}`, 'Imagen', 'bajo']); technical.push(['Píxeles totales', formatBytes(dims.width * dims.height * 4).replace(' bytes','').trim(), 'Imagen', 'bajo']); }
    technical.push(['Tamaño archivo', formatBytes(file.size), 'General', 'bajo']);
    technical.push(['Tipo MIME', file.type || 'No detectado', 'General', 'bajo']);

    return { general, metadataEntries, sensitive, technical, canClean: file.type === 'image/jpeg', fileName: file.name };
  }

  async function analyzePdfMetadata(file) {
    const general = [['Nombre', file.name], ['Tipo', file.type], ['Tamaño', formatBytes(file.size)], ['Última modificación', new Date(file.lastModified).toLocaleString('es')], ['Análisis', 'Local en navegador']];

    const metadataEntries = [];
    const sensitive = [];
    const technical = [];

    try {
      if (window.PDFLib) {
        const pdfDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
        const title = pdfDoc.getTitle();
        const author = pdfDoc.getAuthor();
        const subject = pdfDoc.getSubject();
        const keywords = pdfDoc.getKeywords();
        const creator = pdfDoc.getCreator();
        const producer = pdfDoc.getProducer();
        const creationDate = pdfDoc.getCreationDate();
        const modDate = pdfDoc.getModificationDate();
        const pages = pdfDoc.getPageCount();
        const isEnc = pdfDoc.isEncrypted;

        const pdfFields = [
          ['Título', title], ['Autor', author], ['Asunto', subject], ['Palabras clave', keywords],
          ['Creador', creator], ['Productor', producer], ['Fecha creación', creationDate?.toLocaleString?.('es') || null],
          ['Fecha modificación', modDate?.toLocaleString?.('es') || null], ['Páginas', pages], ['Cifrado', isEnc ? 'Sí' : 'No'],
        ];
        pdfFields.forEach(([k, v]) => {
          if (v !== null && v !== '' && v !== undefined) metadataEntries.push([k, String(v), 'PDF']);
        });

        if (author) sensitive.push(['Autor', author, 'medio']);
        if (creator) sensitive.push(['Software creador', creator, 'medio']);
        if (producer) sensitive.push(['Software productor', producer, 'medio']);
        if (creationDate) sensitive.push(['Fecha creación', creationDate.toLocaleString('es'), 'medio']);

        technical.push(['Páginas', pages, 'PDF', 'bajo']);
        if (isEnc) technical.push(['Cifrado', 'Sí', 'PDF', 'medio']);
        if (creator) technical.push(['Creador', creator, 'PDF', 'medio']);
        if (producer) technical.push(['Productor', producer, 'PDF', 'medio']);
        technical.push(['Tamaño', formatBytes(file.size), 'General', 'bajo']);
      }
    } catch (e) {
      metadataEntries.push(['Error', e.message, 'Error']);
    }

    return { general, metadataEntries, sensitive, technical, canClean: false, fileName: file.name };
  }

  async function analyzeOfficeMetadata(file) {
    const general = [['Nombre', file.name], ['Tipo', file.type], ['Tamaño', formatBytes(file.size)], ['Última modificación', new Date(file.lastModified).toLocaleString('es')], ['Análisis', 'Local en navegador']];

    const metadataEntries = [];
    const sensitive = [];
    const technical = [];

    try {
      if (!window.JSZip) throw new Error('JSZip no disponible');
      const zip = await JSZip.loadAsync(await file.arrayBuffer());

      const propFiles = ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml'];
      const propTags = {
        'dc:creator': 'Autor', 'cp:lastModifiedBy': 'Último autor', 'cp:company': 'Empresa',
        'cp:manager': 'Administrador', 'dc:title': 'Título', 'dc:subject': 'Asunto',
        'dc:description': 'Comentarios', 'cp:keywords': 'Palabras clave',
        'dcterms:created': 'Fecha creación', 'dcterms:modified': 'Fecha modificación',
        'cp:revision': 'Revisiones', 'Application': 'Aplicación', 'TotalTime': 'Tiempo edición',
        'Pages': 'Páginas', 'Words': 'Palabras', 'Characters': 'Caracteres',
      };

      for (const pf of propFiles) {
        const f = zip.file(pf);
        if (!f) continue;
        const xml = await f.async('text');
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'text/xml');
        doc.querySelectorAll('*').forEach((el) => {
          const tag = el.tagName.split(':').pop();
          const val = el.textContent?.trim();
          if (val && propTags[tag]) {
            const name = propTags[tag];
            metadataEntries.push([name, val, 'Office']);
            if (['Autor', 'Último autor', 'Empresa', 'Administrador'].includes(name)) sensitive.push([name, val, 'medio']);
            if (['Fecha creación', 'Fecha modificación'].includes(name)) sensitive.push([name, val, 'medio']);
            if (['Aplicación', 'Revisiones', 'Tiempo edición'].includes(name)) technical.push([name, val, 'Office', 'bajo']);
          }
        });
      }

      technical.push(['Tamaño', formatBytes(file.size), 'General', 'bajo']);
    } catch (e) {
      metadataEntries.push(['Error', e.message, 'Error']);
    }

    return { general, metadataEntries, sensitive, technical, canClean: false, fileName: file.name };
  }

  async function analyzeAudioMetadata(file) {
    const general = [['Nombre', file.name], ['Tipo', file.type], ['Tamaño', formatBytes(file.size)], ['Última modificación', new Date(file.lastModified).toLocaleString('es')], ['Análisis', 'Local en navegador']];

    const metadataEntries = [];
    const sensitive = [];
    const technical = [];

    try {
      const buf = new Uint8Array(await file.arrayBuffer());

      if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
        const version = buf[3];
        const size = ((buf[6] & 0x7F) << 21) | ((buf[7] & 0x7F) << 14) | ((buf[8] & 0x7F) << 7) | (buf[9] & 0x7F);
        general.push(['Formato', `ID3v2.${version}`]);

        const maxLen = Math.min(size + 10, buf.length);
        let offset = 10;
        let safety = 0;
        while (offset < maxLen - 10 && safety < 100) {
          safety++;
          const frameId = String.fromCharCode(buf[offset], buf[offset+1], buf[offset+2], buf[offset+3]);
          if (buf[offset] === 0) break;
          let frameSize;
          if (version === 4) {
            frameSize = ((buf[offset+4] & 0x7F) << 21) | ((buf[offset+5] & 0x7F) << 14) | ((buf[offset+6] & 0x7F) << 7) | (buf[offset+7] & 0x7F);
          } else {
            frameSize = (buf[offset+4] << 24) | (buf[offset+5] << 16) | (buf[offset+6] << 8) | buf[offset+7];
          }
          if (frameSize <= 0 || frameSize > buf.length) break;

          const encoding = buf[offset + 10];
          const textBytes = buf.slice(offset + 11, offset + 10 + frameSize);
          let text;
          if (encoding === 0 || encoding === 3) text = new TextDecoder('utf-8').decode(textBytes);
          else text = new TextDecoder('iso-8859-1').decode(textBytes);
          text = text.replace(/\0+$/, '');

          const id3Map = { TIT2: 'Título', TPE1: 'Artista', TALB: 'Álbum', TCON: 'Género', TDRC: 'Año', TYER: 'Año', COMM: 'Comentarios', TENC: 'Software', TSSE: 'Software' };
          if (id3Map[frameId] && text) {
            metadataEntries.push([id3Map[frameId], text, 'ID3']);
            if (['Software'].includes(id3Map[frameId])) sensitive.push([id3Map[frameId], text, 'medio']);
          }

          offset += 10 + frameSize;
        }

        if (buf[128] === 0x54 && buf[129] === 0x41 && buf[130] === 0x47) {
          const title = new TextDecoder('iso-8859-1').decode(buf.slice(133, 163)).replace(/\0+$/, '');
          const artist = new TextDecoder('iso-8859-1').decode(buf.slice(163, 193)).replace(/\0+$/, '');
          const album = new TextDecoder('iso-8859-1').decode(buf.slice(193, 223)).replace(/\0+$/, '');
          if (title && !metadataEntries.find(([k]) => k === 'Título')) metadataEntries.push(['Título (ID3v1)', title, 'ID3']);
          if (artist && !metadataEntries.find(([k]) => k === 'Artista')) metadataEntries.push(['Artista (ID3v1)', artist, 'ID3']);
          if (album && !metadataEntries.find(([k]) => k === 'Álbum')) metadataEntries.push(['Álbum (ID3v1)', album, 'ID3']);
        }
      } else if (buf[0] === 0x66 && buf[1] === 0x4C && buf[2] === 0x61 && buf[3] === 0x43) {
        general.push(['Formato', 'FLAC']);
        let pos = 4;
        while (pos < Math.min(buf.length, 10000)) {
          const isLast = (buf[pos] & 0x80) !== 0;
          const blockType = buf[pos] & 0x7F;
          const blockSize = (buf[pos+1] << 16) | (buf[pos+2] << 8) | buf[pos+3];
          if (blockType === 4 && blockSize > 0) {
            const tagData = new TextDecoder('utf-8').decode(buf.slice(pos + 4, pos + 4 + blockSize));
            const pairs = tagData.split('\n').filter(Boolean);
            pairs.forEach((p) => {
              const [k, ...vParts] = p.split('=');
              const v = vParts.join('=');
              const map = { TITLE: 'Título', ARTIST: 'Artista', ALBUM: 'Álbum', GENRE: 'Género', DATE: 'Año', COMMENT: 'Comentarios', SOFTWARE: 'Software' };
              if (map[k] && v) metadataEntries.push([map[k], v, 'Vorbis']);
            });
          }
          pos += 4 + blockSize;
          if (isLast) break;
        }
      } else {
        general.push(['Formato', file.type || 'Desconocido']);
        metadataEntries.push(['Etiquetas', 'Formato no reconocido para análisis ID3/Vorbis', 'Info']);
      }

      technical.push(['Tamaño', formatBytes(file.size), 'General', 'bajo']);
      technical.push(['Tipo MIME', file.type || 'No detectado', 'General', 'bajo']);
    } catch (e) {
      metadataEntries.push(['Error al analizar audio', e.message, 'Error']);
    }

    return { general, metadataEntries, sensitive, technical, canClean: false, fileName: file.name };
  }

  async function analyzeVideoMetadata(file) {
    const general = [['Nombre', file.name], ['Tipo', file.type], ['Tamaño', formatBytes(file.size)], ['Última modificación', new Date(file.lastModified).toLocaleString('es')], ['Análisis', 'Local en navegador']];

    const metadataEntries = [];
    const sensitive = [];
    const technical = [];

    try {
      const buf = new Uint8Array(await file.arrayBuffer());

      if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
        const brand = new TextDecoder('ascii').decode(buf.slice(8, 12)).replace(/\0+$/g, '');
        general.push(['Formato', `MP4 (${brand})`]);

        const findBox = (data, type, start = 0, end = data.length) => {
          let pos = start;
          while (pos < end - 8) {
            const sz = (data[pos] << 24) | (data[pos+1] << 16) | (data[pos+2] << 8) | data[pos+3];
            if (sz <= 0 || sz > end - pos) return null;
            const boxType = String.fromCharCode(data[pos+4], data[pos+5], data[pos+6], data[pos+7]);
            if (boxType === type) return { offset: pos, size: sz };
            pos += sz;
          }
          return null;
        };

        const readBox = (data, type) => {
          const box = findBox(data, type);
          if (!box) return null;
          return data.slice(box.offset + 8, box.offset + box.size);
        };

        const parseString = (data, encoding) => {
          const decoder = new TextDecoder(encoding || 'utf-8');
          return decoder.decode(data).replace(/\0+$/g, '');
        };

        const mvhd = readBox(buf, 'mvhd');
        if (mvhd) {
          const version = mvhd[0];
          let ts;
          if (version === 0) ts = (mvhd[12] << 24) | (mvhd[13] << 16) | (mvhd[14] << 8) | mvhd[15];
          else ts = ((mvhd[16] & 0xFF) << 56) | ((mvhd[17] & 0xFF) << 48) | ((mvhd[18] & 0xFF) << 40) | ((mvhd[19] & 0xFF) << 32) | (mvhd[20] << 24) | (mvhd[21] << 16) | (mvhd[22] << 8) | mvhd[23];
          const timescale = version === 0 ? (mvhd[16] << 24 | mvhd[17] << 16 | mvhd[18] << 8 | mvhd[19]) : 1;
          if (timescale > 0 && ts > 0) {
            const dur = ts / timescale;
            general.push(['Duración', `${Math.floor(dur / 60)}m ${Math.floor(dur % 60)}s`]);
            technical.push(['Duración', `${dur.toFixed(1)}s`, 'Video', 'bajo']);
          }
        }

        const meta = readBox(buf, 'meta');
        if (meta) {
          const udta = (() => {
            let pos = 0;
            while (pos < meta.length - 8) {
              const sz = (meta[pos] << 24) | (meta[pos+1] << 16) | (meta[pos+2] << 8) | meta[pos+3];
              const t = String.fromCharCode(meta[pos+4], meta[pos+5], meta[pos+6], meta[pos+7]);
              if (t === 'udta') return meta.slice(pos + 8, pos + sz);
              if (sz <= 0) break;
              pos += sz;
            }
            return null;
          })();
          if (udta) {
            let pos = 0;
            while (pos < udta.length - 8) {
              const sz = (udta[pos] << 24) | (udta[pos+1] << 16) | (udta[pos+2] << 8) | udta[pos+3];
              const t = String.fromCharCode(udta[pos+4], udta[pos+5], udta[pos+6], udta[pos+7]);
              if (sz <= 0 || sz > udta.length - pos) break;
              const tagMap = { '\xA9nam': 'Título', '\xA9ART': 'Artista', '\xA9alb': 'Álbum', '\xA9gen': 'Género', '\xA9day': 'Año', '\xA9cmt': 'Comentarios', '\xA9too': 'Software', '©nam': 'Título', '©ART': 'Artista', '©alb': 'Álbum', '©gen': 'Género', '©day': 'Año', '©cmt': 'Comentarios', '©too': 'Software' };
              if (tagMap[t]) {
                const val = parseString(udta.slice(pos + 8, pos + sz));
                if (val) { metadataEntries.push([tagMap[t], val, 'MP4']); if (tagMap[t] === 'Software') sensitive.push(['Software', val, 'medio']); }
              }
              pos += sz;
            }
          }
        }

        const trak = findBox(buf, 'trak');
        if (trak) {
          const tkhd = readBox(buf, 'tkhd');
          if (tkhd && tkhd.length > 24) {
            const w = (tkhd[20] << 8) | tkhd[21];
            const h = (tkhd[22] << 8) | tkhd[23];
            if (w && h) general.push(['Resolución', `${w} × ${h} px`]);
          }
        }
      } else {
        general.push(['Formato', file.type || 'Desconocido']);
        metadataEntries.push(['Etiquetas', 'Formato MP4/ISOBMFF requerido para análisis detallado', 'Info']);
      }

      technical.push(['Tamaño', formatBytes(file.size), 'General', 'bajo']);
      technical.push(['Tipo MIME', file.type || 'No detectado', 'General', 'bajo']);
    } catch (e) {
      metadataEntries.push(['Error al analizar video', e.message, 'Error']);
    }

    return { general, metadataEntries, sensitive, technical, canClean: false, fileName: file.name };
  }

  async function processInspectMetadata() {
    const files = state.files;
    if (!files.length) throw new Error('Selecciona al menos un archivo.');
    const allResults = [];

    for (const file of files) {
      let metadata;
      const mime = file.type || '';
      if (mime.startsWith('image/')) metadata = await analyzeImageMetadata(file);
      else if (mime === 'application/pdf') metadata = await analyzePdfMetadata(file);
      else if (mime.includes('word') || mime.includes('document') || file.name.match(/\.docx?$/i)) metadata = await analyzeOfficeMetadata(file);
      else if (mime.startsWith('audio/')) metadata = await analyzeAudioMetadata(file);
      else if (mime.startsWith('video/')) metadata = await analyzeVideoMetadata(file);
      else metadata = {
        general: [['Nombre', file.name], ['Tipo', file.type || 'Desconocido'], ['Tamaño', formatBytes(file.size)], ['Última modificación', new Date(file.lastModified).toLocaleString('es')]],
        metadataEntries: [['Formato', 'Tipo de archivo no reconocido para análisis detallado', 'Info']],
        sensitive: [], technical: [['Tamaño', formatBytes(file.size), 'General', 'bajo']], canClean: false, fileName: file.name,
      };
      allResults.push(metadata);
    }

    if (allResults.length === 1) {
      const m = allResults[0];
      return {
        metadata: m,
        blob: null, name: '',
        title: 'Metadatos inspeccionados',
        message: `${m.metadataEntries.length} campo(s) detectado(s) en "${m.fileName}".`,
        preview: null, stats: [],
      };
    }

    const merged = { general: [], metadataEntries: [], sensitive: [], technical: [], canClean: false, fileName: `${allResults.length} archivos` };
    for (const m of allResults) {
      merged.metadataEntries.push([`--- ${m.fileName} ---`, '', '']);
      merged.metadataEntries.push(...m.metadataEntries);
      merged.sensitive.push(...m.sensitive);
      merged.technical.push(...m.technical);
    }
    merged.canClean = allResults.some(m => m.canClean);

    return {
      metadata: merged,
      blob: null, name: '',
      title: 'Metadatos inspeccionados',
      message: `${allResults.length} archivo(s) analizado(s).`,
      preview: null, stats: [],
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
    state.tool = state.forcedTool || null;
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
