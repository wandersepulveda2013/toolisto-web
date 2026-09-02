function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Map();
  return {
    get(key) { return key ? state[key] : state; },
    set(updates) {
      const prev = { ...state };
      if (typeof updates === 'function') { state = { ...state, ...updates(state) }; }
      else { state = { ...state, ...updates }; }
      for (const [k, v] of Object.entries(state)) {
        if (prev[k] !== v && listeners.has(k)) {
          for (const fn of listeners.get(k)) fn(v, prev[k], state);
        }
      }
      if (listeners.has('*')) {
        for (const fn of listeners.get('*')) fn(state, prev);
      }
    },
    subscribe(key, fn) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
      return () => {
        const subscribers = listeners.get(key);
        if (!subscribers) return;
        subscribers.delete(fn);
        if (subscribers.size === 0) listeners.delete(key);
      };
    },
    reset() { this.set({ ...initialState }); }
  };
}

// CE-092 (boot recovery): una clave de preferencia corrupta en localStorage (JSON
// invalido, escritura parcial, otro tab) no debe romper el arranque del Workspace.
// Antes esto hacia un `JSON.parse(localStorage.getItem(...))` a nivel de import del
// modulo appStore, SIN try/catch: una sola clave corrupta lanzaba al instanciar
// appStore (ANTES de initApp) y dejaba pantalla en blanco sin ruta de recuperacion.
// Ahora un helper lee de forma segura, devuelve [] ante JSON invalido y elimina la
// clave corrupta para que la app se auto-recupere.
function readJsonList(key) {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    try { localStorage.removeItem(key); } catch {}
    return [];
  }
}

const appStore = createStore({
  currentView: 'projects',
  currentProject: null,
  currentDoc: null,
  currentModule: null,
  projects: [],
  documents: [],
  captures: [],
  dataTables: [],
  workflows: [],
  currentWorkflowId: null,
  dataModel: null,
  querySheets: [],
  activeQuerySheetId: null,
  queryModel: null,
  queryToolsOpen: false,
  querySourceOpen: true,
  queryStepsOpen: true,
  querySheetbarOpen: true,
  querySteps: [],
  dashboards: [],
  dashboardConfig: null,
  flowNodes: [],
  flowEdges: [],
  paletteOpen: false,
  sidebarCollapsed: false,
  sidebarWidth: 260,
  theme: 'light',
  density: 'equilibrada',
  modalStack: [],
  toasts: [],
  toolHistory: [],
  captureMode: 'camera',
  docView: 'fluid',
  dataSelection: null,
  queryResult: null,
  dragState: null,
  searchQuery: '',
  recentTools: readJsonList('toolisto-recent-tools'),
  favoriteTools: readJsonList('toolisto-favorite-tools'),
  undoStack: [],
  redoStack: [],
  isDirty: false,
  lastSaved: null,
});

export { appStore, createStore, readJsonList };
