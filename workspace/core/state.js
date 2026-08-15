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

const appStore = createStore({
  currentView: 'projects',
  currentProject: null,
  currentDoc: null,
  currentModule: null,
  projects: [],
  documents: [],
  captures: [],
  dataTables: [],
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
  recentTools: JSON.parse(localStorage.getItem('toolisto-recent-tools') || '[]'),
  favoriteTools: JSON.parse(localStorage.getItem('toolisto-favorite-tools') || '[]'),
  undoStack: [],
  redoStack: [],
  isDirty: false,
  lastSaved: null,
});

export { appStore, createStore };
