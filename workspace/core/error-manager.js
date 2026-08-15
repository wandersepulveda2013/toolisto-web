const ERROR_CATEGORIES = {
  incompatibleFile: { message: 'El archivo no es compatible o tiene un formato que no podemos leer.', level: 'error' },
  corruptFile: { message: 'El archivo podria estar danado o incompleto.', level: 'error' },
  outOfMemory: { message: 'No hay suficiente memoria para completar esta operacion.', level: 'error' },
  readError: { message: 'No se pudo leer el archivo. Revisa los permisos e intenta de nuevo.', level: 'error' },
  ocrError: { message: 'El reconocimiento de texto no pudo completarse. La imagen podria ser muy pequena o estar borrosa.', level: 'error' },
  canvasError: { message: 'No se pudo procesar la imagen.', level: 'error' },
  saveError: { message: 'No se pudo guardar el trabajo. Revisa el espacio disponible.', level: 'error' },
  recoveryError: { message: 'No se pudo recuperar la sesion anterior. Se ha iniciado una sesion nueva.', level: 'warning' },
  canceled: { message: 'Operacion cancelada.', level: 'info' },
  notSupported: { message: 'Esta funcion no es compatible con tu navegador.', level: 'warning' },
  storageUnavailable: { message: 'El almacenamiento local no esta disponible. Los cambios no se guardaran automaticamente.', level: 'warning' },
  unexpected: { message: 'Ocurrio un error inesperado. El trabajo deberia estar seguro.', level: 'error' },
};

function _getCategoryInfo(category) {
  return ERROR_CATEGORIES[category] || ERROR_CATEGORIES.unexpected;
}

let _toastFn = null;

export function setToastHandler(fn) { _toastFn = fn; }

function _showToast(message, level, duration) {
  if (_toastFn) _toastFn(message, level, duration);
}

export function reportError(error, context) {
  const category = context?.category || 'unexpected';
  const info = _getCategoryInfo(category);
  console.error(`[${category}]`, context?.action || '', error?.message || String(error), error);
  _showToast(info.message, info.level, context?.duration || 5000);
  return info.message;
}

export function showUserError(options) {
  const message = options?.message || ERROR_CATEGORIES.unexpected.message;
  _showToast(message, 'error', options?.duration || 6000);
}

export function showWarning(options) {
  _showToast(options?.message || '', 'warning', options?.duration || 4000);
}

export function showSuccess(options) {
  _showToast(options?.message || '', 'success', options?.duration || 3000);
}

export function showInfo(options) {
  _showToast(options?.message || '', 'info', options?.duration || 3000);
}

export function classifyError(error) {
  if (!error) return 'unexpected';
  const msg = String(error.message || error).toLowerCase();
  if (msg.includes('quota') || msg.includes('quotaexceeded') || msg.includes('storage')) return 'outOfMemory';
  if (msg.includes('not found') || msg.includes('enoent')) return 'readError';
  if (msg.includes('corrupt') || msg.includes('invalid') || msg.includes('parse')) return 'corruptFile';
  if (msg.includes('ocr') || msg.includes('tesseract') || msg.includes('recognize')) return 'ocrError';
  if (msg.includes('canvas') || msg.includes('context') || msg.includes('pixel')) return 'canvasError';
  if (msg.includes('indexeddb') || msg.includes('save') || msg.includes('write')) return 'saveError';
  if (msg.includes('cancel') || msg.includes('abort')) return 'canceled';
  if (msg.includes('safari') || msg.includes('not supported') || msg.includes('not a function')) return 'notSupported';
  return 'unexpected';
}

export function withErrorHandling(task, options) {
  return async (...args) => {
    try {
      return await task(...args);
    } catch (error) {
      const category = options?.category || classifyError(error);
      reportError(error, { category, action: options?.action });
      if (options?.finally) options.finally(error);
      return null;
    }
  };
}

let _errorBoundaryActive = false;

export function setupGlobalErrorHandling() {
  if (_errorBoundaryActive) return;
  _errorBoundaryActive = true;
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      console.error('[global]', event.error?.message || event.message);
      if (!event.defaultPrevented) {
        const category = classifyError(event.error);
        const info = _getCategoryInfo(category);
        _showToast(info.message, info.level, 5000);
      }
    });
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[unhandled]', event.reason?.message || String(event.reason));
      const category = classifyError(event.reason);
      if (category !== 'canceled') {
        const info = _getCategoryInfo(category);
        _showToast(info.message, info.level, 5000);
      }
    });
  }
}
