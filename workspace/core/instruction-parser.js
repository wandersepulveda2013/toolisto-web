export function createInstructionParser() {
  const DIMENSION_RE = /(\d+)\s*(?:px)?\s*(?:x\s*(\d+))?\s*(?:px)?/i;
  const ROTATION_RE = /(\d+)\s*(?:grados?|°)/i;
  const QUALITY_RE = /calidad\s*(?:al\s*)?(\d+)\s*(?:\s*%)?/i;
  const WIDTH_RE = /(?:ancho|width)\s*(?:de\s*)?(\d+)\s*(?:px)?/i;
  const HEIGHT_RE = /(?:alto|height)\s*(?:de\s*)?(\d+)\s*(?:px)?/i;
  const SINGLE_DIM_RE = /(?:déjal[ao]s?\s*(?:en|a)\s*|dej[ao]s?\s*(?:en|a)\s*|pon(?:lo|la|los|las)?\s*(?:en|a)\s*|a\s*)(\d+)\s*(?:px)?\s*(?:de\s*(?:ancho|width))?/i;

  const SPELLING_CORRECTIONS = {
    'conbierte': 'convierte', 'conbertir': 'convertir', 'conbertilo': 'convertirlo',
    'imajen': 'imagen', 'imajenes': 'imagenes', 'imajens': 'imagenes',
    'wepb': 'webp', 'webp': 'webp', 'jpegs': 'jpeg', 'jpge': 'jpeg',
    'redimensiónalas': 'redimensiona', 'redimensionarlo': 'redimensionar',
    'descargan': 'descargar', 'descarga': 'descargar', 'descargalo': 'descargar',
    'descargalos': 'descargar', 'bajalo': 'descargar', 'bajalos': 'descargar',
    'sácale': 'saca', 'sacale': 'saca', 'sacarle': 'sacar',
    'júntame': 'junta', 'juntalos': 'juntar', 'junta': 'unir',
    'ponlo': 'pon', 'ponla': 'pon', 'ponlos': 'pon', 'ponlas': 'pon',
    'créame': 'crea', 'hazme': 'haz', 'hágame': 'haz',
    'bájame': 'baja', 'bajar': 'descargar',
    'pásame': 'pasa', 'pasame': 'pasa',
  };

  const SYNONYMS = {
    'rotate': ['rotar', 'rota', 'rotad', 'girar', 'gira', 'gíralo', 'gírala', 'voltear', 'voltea', 'rotacion', 'rotación', 'dale vuelta', 'dar vuelta'],
    'resize': ['redimensionar', 'redimensiona', 'redimensionarlo', 'redimensionarla', 'cambiar tamaño', 'cambia el tamaño', 'cambie el tamaño', 'cambiar de tamaño', 'escalar', 'escala', 'escalalo', 'escalala', 'ajustar tamaño', 'ajusta el tamaño', 'cambiar dimensiones', 'cambia las dimensiones', 'haz más grande', 'hacer más grande', 'haz más pequeños', 'hacer más pequeños'],
    'convert': ['convertir', 'convertirlo', 'convertirla', 'convierte', 'conviertelo', 'conviertela', 'pasar a', 'pasa a', 'pasa imagen a', 'pasa esta imagen a', 'pasa estas imagenes a', 'transformar', 'transforma', 'pon en formato', 'ponlo en', 'ponlas en'],
    'enhance': ['mejorar', 'mejora', 'mejore', 'mejorarlo', 'mejorarla', 'aumentar calidad', 'corregir', 'realzar', 'corregir brillo', 'aumentar contraste', 'ponlo bonito', 'poner bonito', 'mejora la calidad', 'mejorar calidad', 'optimizar', 'optimiza'],
    'strip-metadata': ['quitar metadatos', 'quita los metadatos', 'quitar los metadatos', 'eliminar metadatos', 'elimina los metadatos', 'borrar metadatos', 'borra los metadatos', 'quitar exif', 'limpiar metadatos', 'limpia los metadatos', 'eliminar exif'],
    'ocr': ['extraer texto', 'extrae el texto', 'extrae texto', 'sacar texto', 'saca el texto', 'aplicar ocr', 'reconocer texto', 'reconoce el texto', 'leer texto', 'lee el texto', 'escanea texto', 'escanea el texto', 'ocr', 'sácale el texto', 'sacarle el texto', 'extraele el texto', 'reconocer texto'],
    'to-table': ['convertir en tabla', 'convertirlo en tabla', 'convertirla en tabla', 'convierte en tabla', 'convierte a tabla', 'convierte este texto en tabla', 'convierte este texto en una tabla', 'conviertelo en tabla', 'conviertela en tabla', 'tabla', 'hacer tabla', 'crear tabla', 'crea una tabla', 'hazme una tabla', 'ponlo en tabla', 'pasar a tabla'],
    'to-document': ['crear documento', 'crea un documento', 'hacer documento', 'haz un documento', 'generar documento', 'genera un documento', 'nuevo documento', 'crea documento', 'creame un documento'],
    'report': ['crear informe', 'crea un informe', 'generar informe', 'genera un informe', 'hacer informe', 'haz un informe', 'crear reporte', 'informe', 'creame un informe', 'prepara un informe', 'preparar informe'],
    'chart': ['crear grafico', 'crea un grafico', 'generar grafico', 'genera un grafico', 'hacer grafico', 'haz un grafico', 'graficar', 'grafico', 'grafica', 'crear un grafico', 'creame un grafico', 'prepara un grafico', 'preparar grafico'],
    'export-text': ['exportar texto', 'exporta texto', 'exporta el texto', 'exporta este texto', 'descargar texto', 'descarga texto', 'descarga el texto', 'guardar texto', 'guarda texto', 'guarda el texto'],
    'compress': ['comprimir', 'comprime', 'reducir peso', 'reduce el peso', 'comprimirlo', 'comprimirlos', 'bajar peso', 'baja el peso'],
    'zip': ['crear zip', 'crea un zip', 'comprimir en zip', 'comprime en zip', 'empaquetar', 'empaqueta', 'descargar zip', 'descarga zip', 'zip', 'todo junto', 'todas juntas', 'todos juntos', 'en un zip', 'bajalo todo junto', 'descargar todo junto', 'crear un paquete', 'comprimirlos en zip', 'descargar todas juntas'],
    'add-to-workspace': ['añadir al workspace', 'añade al workspace', 'agregar al workspace', 'agrega al workspace', 'guardar en workspace', 'guarda en workspace', 'añadir resultado', 'dejar en el proyecto', 'déjalos en el proyecto', 'dejalos aqui', 'guardar aqui', 'guárdalos aquí', 'dejalos en el workspace', 'agrégalos al espacio de trabajo', 'quedate con ellos', 'guardar los resultados', 'incorporar al workspace'],
    'merge-pdf': ['unir pdf', 'une los pdf', 'fusionar pdf', 'fusiona los pdf', 'combinar pdf', 'combina los pdf', 'unirlos', 'fusionarlos', 'junta los pdf', 'júntame esos pdf', 'unir estos pdf'],
    'pdf-to-images': ['convertir pdf en imagenes', 'convierte pdf en imagenes', 'pdf a imagenes', 'pasar pdf a imagenes', 'extraer paginas como imagenes'],
    'extract-pages': ['extraer paginas', 'extrae las paginas', 'separar paginas', 'separa las paginas', 'dividir pdf'],
    'rotate-pdf': ['rotar pdf', 'rota pdf', 'girar pdf', 'gira pdf', 'voltear pdf', 'voltea pdf'],
    'to-pdf': ['convertir a pdf', 'convierte a pdf', 'convertir en pdf', 'convierte en pdf', 'pasar a pdf', 'pasa a pdf', 'exportar a pdf', 'exporta a pdf', 'a pdf', 'en pdf'],
    'download': ['descargar', 'descarga', 'descargalo', 'descargarlos', 'descargalas', 'bajar', 'baja', 'bajalo', 'bajarlos', 'bajar los archivos', 'guardar en mi equipo', 'descarga los resultados'],
    'replace': ['reemplazar originales', 'reemplaza los originales', 'sustituir archivos', 'sustituye los archivos', 'reemplazar', 'reemplaza', 'usar nuevos en vez', 'usa los nuevos en vez de los anteriores', 'sobrescribir', 'sobrescribe'],
  };

  const FORMAT_ALIASES = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp',
    'svg': 'image/svg+xml', 'gif': 'image/gif', 'bmp': 'image/bmp', 'pdf': 'application/pdf',
  };

  const KNOWN_SHORT_WORDS = ['y','e','o','a','el','la','los','las','un','una','en','con','por','para','de','del','al','que','se','no','lo','su','sus','como','más','menos','todo','todos','este','esta','cada','sin','pero','este','estos','estas','esa','esas','esos','ya','le','te','me','se','ni','es','fue','era','son','han','has','he','ha'];

  function applySpellingCorrections(text) {
    let t = text;
    for (const [wrong, correct] of Object.entries(SPELLING_CORRECTIONS)) {
      const re = new RegExp('\\b' + wrong + '\\b', 'gi');
      t = t.replace(re, correct);
    }
    return t;
  }

  function normalize(text) {
    return (text || '').toLowerCase().replace(/[.,;:!?¿¡()'"]+/g, ' ')
      .replace(/[´`¨]/g, '')
      .replace(/[áäàâ]/g, 'a').replace(/[éëèê]/g, 'e').replace(/[íïìî]/g, 'i')
      .replace(/[óöòô]/g, 'o').replace(/[úüùû]/g, 'u').replace(/ñ/g, 'n')
      .replace(/\s+/g, ' ').trim();
  }

  function correctText(text) {
    return applySpellingCorrections(text || '');
  }

  function detectFormat(text) {
    const t = (text || '').toLowerCase();
    for (const [alias, mime] of Object.entries(FORMAT_ALIASES)) {
      if (t.includes(alias)) return mime;
    }
    return null;
  }

  function detectDimension(text) {
    const m = DIMENSION_RE.exec(text);
    if (m && m[1] && m[2]) return { width: parseInt(m[1]), height: parseInt(m[2]) };
    const wm = WIDTH_RE.exec(text);
    const hm = HEIGHT_RE.exec(text);
    if (wm || hm) return { width: wm ? parseInt(wm[1]) : undefined, height: hm ? parseInt(hm[1]) : undefined };
    const sm = SINGLE_DIM_RE.exec(text);
    if (sm && sm[1]) return { width: parseInt(sm[1]) };
    if (m && m[1]) return { width: parseInt(m[1]) };
    return null;
  }

  function detectRotation(text) {
    const m = ROTATION_RE.exec(text);
    if (m) return parseInt(m[1]) % 360;
    if (/\bgira\w*\s+(a\s+)?la\s+derecha\b/i.test(text) || /\bvoltea\w*\s+(a\s+)?la\s+derecha\b/i.test(text) || /para\s+la\s+derecha/i.test(text) || /sentido\s+horario/i.test(text)) return 90;
    if (/\bgira\w*\s+(a\s+)?la\s+izquierda\b/i.test(text) || /\bvoltea\w*\s+(a\s+)?la\s+izquierda\b/i.test(text) || /para\s+la\s+izquierda/i.test(text) || /sentido\s+antihorario/i.test(text)) return 270;
    return null;
  }

  function detectQuality(text) {
    const m = QUALITY_RE.exec(text);
    if (m) return Math.max(10, Math.min(100, parseInt(m[1])));
    return null;
  }

  function findActions(normalized) {
    const actions = [];
    const matchedSpans = [];

    for (const [action, syns] of Object.entries(SYNONYMS)) {
      for (const syn of syns) {
        const nsyn = normalize(syn);
        let idx = normalized.indexOf(nsyn);
        if (idx !== -1) {
          matchedSpans.push({ start: idx, end: idx + nsyn.length, action });
          break;
        }
      }
    }

    matchedSpans.sort((a, b) => a.start - b.start);

    const merged = [];
    for (const span of matchedSpans) {
      if (merged.length > 0 && span.start < merged[merged.length - 1].end) {
        const last = merged[merged.length - 1];
        if (span.end > last.end) last.action = span.action;
        continue;
      }
      merged.push({ ...span });
    }

    for (const span of merged) {
      actions.push(span.action);
    }
    return { actions, matchedSpans: merged };
  }

  function detectAmbiguities(normalized, originalText, actions) {
    const ambiguities = [];
    if (/mas\s+pequen[oas]/.test(normalized) && !actions.includes('resize') && !actions.includes('compress')) {
      ambiguities.push({
        id: 'reduce-meaning',
        question: '¿Qué quieres reducir?',
        options: [
          { id: 'dimensions', label: 'Dimensiones' },
          { id: 'file-size', label: 'Peso del archivo' },
        ],
      });
    }
    if (actions.includes('enhance') && !normalized.includes('imagen') && !normalized.includes('imajen') && !normalized.includes('foto') && !normalized.includes('imagenes') && !normalized.includes('imajenes')) {
      ambiguities.push({
        id: 'enhance-ambiguous',
        question: '¿Qué tipo de archivo quieres mejorar? (imagen, documento…)',
        options: [
          { id: 'image', label: 'Imagen' },
          { id: 'document', label: 'Documento' },
        ],
      });
    }
    if (actions.includes('rotate') && detectRotation(normalized) === null) {
      ambiguities.push({
        id: 'rotate-angle',
        question: '¿En qué dirección quieres rotar?',
        options: [
          { id: '90', label: '90°' },
          { id: '180', label: '180°' },
          { id: '270', label: '270° (izquierda)' },
        ],
      });
    }
    if (actions.includes('convert') && !normalized.includes(' a ') && !detectFormat(normalized)) {
      ambiguities.push({
        id: 'convert-format',
        question: '¿A qué formato quieres convertir?',
        options: [
          { id: 'webp', label: 'WebP' },
          { id: 'jpeg', label: 'JPEG' },
          { id: 'png', label: 'PNG' },
        ],
      });
    }
    return ambiguities;
  }

  function parse(text, sessionContext) {
    const warnings = [];
    const unknownSegments = [];
    const corrections = [];

    if (!text || !text.trim()) {
      return { originalText: '', normalizedText: '', intents: [], outputPreferences: {}, warnings: ['Instrucción vacía'], unknownSegments: [], corrections: [] };
    }

    const originalText = text.trim();
    const correctedText = correctText(originalText);
    if (correctedText !== originalText) {
      corrections.push({ from: originalText, to: correctedText });
    }
    const normalized = normalize(correctedText);

    const { actions, matchedSpans } = findActions(normalized);

    const ambiguities = detectAmbiguities(normalized, originalText, actions);

    if (actions.length === 0) {
      return { originalText, normalizedText: normalized, intents: [], outputPreferences: {}, warnings: ['No se reconoció ninguna operación en esta instrucción'], unknownSegments: [normalized], ambiguities, corrections };
    }

    const resultIntents = [];
    const outputActions = [];

    for (const action of actions) {
      if (action === 'download' || action === 'replace') {
        outputActions.push(action);
        continue;
      }
      if (action === 'add-to-workspace') {
        outputActions.push('add-to-workspace');
        continue;
      }

      const intent = { action, target: guessTarget(action), options: {} };

      if (action === 'convert' || action === 'compress' || action === 'to-pdf') {
        const fmt = detectFormat(normalized);
        if (fmt) intent.options.format = fmt;
        else if (action === 'convert' && action !== 'to-pdf') warnings.push('No se indicó el formato de destino. Se usará PNG por defecto.');
      }

      if (action === 'resize') {
        const dim = detectDimension(normalized);
        if (dim) {
          if (dim.width) intent.options.width = dim.width;
          if (dim.height) intent.options.height = dim.height;
        } else {
          warnings.push('No se indicaron las dimensiones. Se usará 800 px de ancho.');
          intent.options.width = 800;
        }
      }

      if (action === 'rotate') {
        const angle = detectRotation(normalized);
        if (angle !== null) intent.options.angle = angle;
        else warnings.push('No se indicó el ángulo de rotación. Se usará 90°.');
      }

      if (action === 'enhance') {
        const q = detectQuality(normalized);
        if (q) { intent.options.contrast = 1.2; intent.options.brightness = q / 100; }
      }

      if (action === 'strip-metadata') {
        const fmt = detectFormat(normalized);
        if (fmt) intent.options.format = fmt;
      }

      if (action === 'ocr') {
        intent.options.language = 'spa';
        if (normalized.includes('factura') || normalized.includes('facturas') || normalized.includes('recibo') || normalized.includes('recibos')) {
          intent.options._extractFields = true;
        }
      }

      if (action === 'report') {
        if (/no\s+incluyas?\s+(la\s+)?fecha/i.test(originalText)) intent.options.includeDate = false;
        else intent.options.includeDate = true;
      }

      if (action === 'zip') {
        intent.options.name = 'resultados.zip';
      }

      resultIntents.push(intent);
    }

    // Detect output preferences from output actions and tokens
    const outputPreferences = {};
    if (outputActions.includes('download') || /\bdescarg/.test(normalized) || normalized.includes('download') || /bajar\b/.test(normalized)) {
      outputPreferences.download = true;
    }
    if (outputActions.includes('add-to-workspace') || normalized.includes('workspace') || /\banad/.test(normalized) || /\bguard/.test(normalized) || /\bdej[ao]/.test(normalized) || /\bincorpor/.test(normalized) || /\bquedate/.test(normalized)) {
      outputPreferences.addToWorkspace = true;
    }
    if (outputActions.includes('replace') || /reemplaz/.test(normalized) || /sustitu/.test(normalized) || /sobrescrib/.test(normalized)) {
      outputPreferences.replace = true;
    }
    if (actions.includes('zip') || /todo\s+junto/.test(normalized) || /todas\s+juntas/.test(normalized) || /todos\s+juntos/.test(normalized) || /en\s+un\s+zip/.test(normalized)) {
      outputPreferences.zip = true;
    }

    // If no output preferences specified, default to add-to-workspace
    if (!outputPreferences.download && !outputPreferences.addToWorkspace && !outputPreferences.replace && !outputPreferences.zip) {
      if (resultIntents.length > 0) {
        outputPreferences.addToWorkspace = true;
      }
    }

    // Detect quality ranges from implicit phrases
    if (/baja\s+un\s+poco\s+la\s+calidad|reduce\s+un\s+poco\s+la\s+calidad|calidad\s+media/i.test(normalized)) {
      outputPreferences._implicitQuality = 60;
    }
    if (/maxima\s+calidad|mejor\s+calidad|alta\s+calidad|maxima calidad/i.test(normalized)) {
      outputPreferences._implicitQuality = 95;
    }

    // Find unknown segments
    const normalizedWords = normalized.split(/\s+/).filter(w => w.length > 2);
    for (const word of normalizedWords) {
      let matched = false;
      for (const [, syns] of Object.entries(SYNONYMS)) {
        for (const syn of syns) {
          const synWords = syn.split(/\s+/);
          if (synWords.includes(word)) { matched = true; break; }
        }
        if (matched) break;
      }
      if (!matched && !KNOWN_SHORT_WORDS.includes(word)) {
        unknownSegments.push(word);
      }
    }

    return {
      originalText,
      correctedText: correctedText !== originalText ? correctedText : undefined,
      normalizedText: normalized,
      intents: resultIntents,
      outputActions,
      outputPreferences,
      ambiguities,
      warnings,
      corrections,
      unknownSegments: [...new Set(unknownSegments)],
    };
  }

  function guessTarget(action) {
    const imageOps = ['rotate', 'resize', 'convert', 'enhance', 'strip-metadata', 'compress', 'to-pdf'];
    const pdfOps = ['merge-pdf', 'pdf-to-images', 'extract-pages', 'rotate-pdf'];
    const textOps = ['ocr', 'to-table', 'to-document', 'report', 'chart', 'export-text'];
    if (imageOps.includes(action)) return 'image';
    if (pdfOps.includes(action)) return 'pdf';
    if (textOps.includes(action)) return 'text';
    return 'file';
  }

  return { parse, normalize, detectFormat, detectDimension, detectRotation, detectQuality, SYNONYMS, correctText, SPELLING_CORRECTIONS };
}
