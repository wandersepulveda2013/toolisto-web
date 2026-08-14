import { appStore } from './state.js';
import { generateId, dbPut, dbGet, dbDelete, dbGetAll, dbClear } from './db.js';

const SESSION_KEY = 'ws:session';
const SCHEMA_VERSION = 1;
const MAX_SESSIONS = 5;

function isStorageAvailable() {
  try {
    const req = indexedDB.open('toolisto-workspace-storage-test', 1);
    req.onerror = () => {};
    req.onsuccess = () => { const db = req.result; db.close(); indexedDB.deleteDatabase('toolisto-workspace-storage-test'); };
    return true;
  } catch (e) { return false; }
}

export async function saveWorkspaceSession(sessionData) {
  if (!isStorageAvailable()) return false;
  try {
    const sessionId = appStore.get('_sessionId') || generateId();
    const doc = appStore.get('currentDoc');
    const dataTable = appStore.get('currentDataTable');
    const session = {
      schemaVersion: SCHEMA_VERSION,
      sessionId,
      createdAt: appStore.get('_sessionCreatedAt') || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspace: {
        currentView: appStore.get('currentView'),
        currentProjectId: appStore.get('currentProject')?.id || null,
        currentDocId: doc?.id || null,
        currentDataTableId: dataTable?.id || null,
        designConfig: appStore.get('designConfig') || null,
        flowNodes: appStore.get('flowNodes') || [],
        flowEdges: appStore.get('flowEdges') || [],
        documents: (sessionData?.documents || []).filter(d => d),
        dataTables: (sessionData?.dataTables || []).filter(d => d),
        captures: (sessionData?.captures || []).filter(c => c),
        workflowDefinition: sessionData?.workflowDefinition || null,
        toasts: appStore.get('toasts') || [],
        theme: appStore.get('theme'),
        density: appStore.get('density'),
        sidebarCollapsed: appStore.get('sidebarCollapsed'),
      },
    };
    if (dataTable && !session.workspace.dataTables.find(t => t.id === dataTable.id)) {
      session.workspace.dataTables.push(dataTable);
    }
    if (doc && !session.workspace.documents.find(d => d.id === doc.id)) {
      session.workspace.documents.push(doc);
    }
    const sessions = await _loadAllSessions();
    const previousSessions = sessions.filter(item => item.sessionId !== sessionId);
    previousSessions.unshift(session);
    while (previousSessions.length > MAX_SESSIONS) previousSessions.pop();
    try { localStorage.setItem('toolisto-session-id', sessionId); } catch (e) {}
    appStore.set({ _sessionId: sessionId, _sessionCreatedAt: session.createdAt, lastSaved: Date.now() });
    await dbPut('settings', { key: SESSION_KEY, value: previousSessions });
    return true;
  } catch (e) { console.error('Save session error:', e); return false; }
}

export async function loadWorkspaceSession() {
  if (!isStorageAvailable()) return null;
  try {
    const sessions = await _loadAllSessions();
    if (sessions.length === 0) return null;
    const sessionId = _getSessionId();
    if (sessionId) {
      const match = sessions.find(s => s.sessionId === sessionId);
      if (match) return match;
    }
    return sessions[0];
  } catch (e) { console.error('Load session error:', e); return null; }
}

export async function hasRecoverableSession() {
  if (!isStorageAvailable()) return false;
  try {
    const sessions = await _loadAllSessions();
    return sessions.length > 0 && sessions[0].workspace?.currentProjectId != null;
  } catch (e) { return false; }
}

export async function deleteWorkspaceSession(sessionId) {
  if (!isStorageAvailable()) return;
  try {
    const sessions = await _loadAllSessions();
    const filtered = sessions.filter(s => s.sessionId !== sessionId);
    if (filtered.length === 0) await dbDelete('settings', SESSION_KEY);
    else await dbPut('settings', { key: SESSION_KEY, value: filtered });
    try { localStorage.removeItem('toolisto-session-id'); } catch (e) {}
  } catch (e) { console.error('Delete session error:', e); }
}

export async function getWorkspaceSessionInfo() {
  const session = await loadWorkspaceSession();
  if (!session) return null;
  const w = session.workspace || {};
  return {
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    schemaVersion: session.schemaVersion,
    docCount: (w.documents || []).length,
    tableCount: (w.dataTables || []).length,
    captureCount: (w.captures || []).length,
    currentView: w.currentView,
  };
}

export async function cleanupOldSessions() {
  if (!isStorageAvailable()) return;
  try {
    const sessions = await _loadAllSessions();
    if (sessions.length <= MAX_SESSIONS) return;
    sessions.splice(MAX_SESSIONS);
    await dbPut('settings', { key: SESSION_KEY, value: sessions });
  } catch (e) { console.error('Cleanup sessions error:', e); }
}

function _getSessionId() {
  try { return localStorage.getItem('toolisto-session-id'); } catch (e) { return null; }
}

async function _loadAllSessions() {
  try {
    const entry = await dbGet('settings', SESSION_KEY);
    if (!entry || !Array.isArray(entry.value)) return [];
    return entry.value.filter(s => s && typeof s === 'object' && s.schemaVersion != null);
  } catch (e) { return []; }
}
