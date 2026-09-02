import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; }
  console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ' [' + detail + ']' : ''}`);
}

function grabFn(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => new RegExp('^(?:export )?async function ' + name + '\\(').test(l) || new RegExp('^function ' + name + '\\(').test(l));
  if (i < 0) throw new Error('no se encontro ' + name);
  let d = 0;
  for (let j = i; j < lines.length; j++) {
    d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
    if (d === 0 && j > i) return lines.slice(i, j + 1).join('\n');
  }
  throw new Error('final no encontrado para ' + name);
}

// ---- extraemos las funciones REALES de workspace-storage.js ----
const wsSrc = readFileSync(new URL('../../workspace/core/workspace-storage.js', import.meta.url), 'utf8');
const loadSessionsSrc = grabFn(wsSrc, '_loadAllSessions');
const cleanupSrc = grabFn(wsSrc, 'cleanupSessionsForProject');

const SESSION_KEY_MATCH = wsSrc.match(/const SESSION_KEY\s*=\s*'([^']+)'/);
const SESSION_KEY = SESSION_KEY_MATCH ? SESSION_KEY_MATCH[1] : 'ws:session';

// dbGet/dbPut stub con un mapa en memoria que imita el envelope {key,value}
function buildApi(storeMap) {
  const dbGet = async (store, key) => {
    const k = key === 'settings' ? SESSION_KEY : key;
    return storeMap[k];
  };
  const dbPut = async (store, obj) => {
    const k = store === 'settings' ? obj.key : obj.key || obj.id;
    storeMap[k] = obj;
  };
  const js = [
    `const SESSION_KEY = ${JSON.stringify(SESSION_KEY)};`,
    loadSessionsSrc,
    cleanupSrc.replace(/^export async function /, 'async function '),
  ].join('\n');
  const fn = new Function('dbGet', 'dbPut', js + '\nreturn { loadSessions: _loadAllSessions, cleanup: cleanupSessionsForProject };');
  return fn(dbGet, dbPut);
}

function baseSession() {
  return {
    schemaVersion: 1,
    sessionId: 's1',
    workspace: {
      currentProjectId: 'p-del',
      documents: [
        { id: 'doc-keep', type: 'text', blocks: [{ id: 'b1' }] },
        { id: 'doc-del', type: 'table', blocks: [] },
      ],
      dataTables: [
        { id: 'tbl-keep', headers: ['a'], rows: [['1']] },
        { id: 'tbl-del', headers: ['b'], rows: [['2']] },
      ],
      captures: [
        { id: 'cap-keep', name: 'keep' },
        { id: 'cap-del', name: 'del' },
      ],
    },
  };
}

console.log('=== CE-096: cleanupSessionsForProject si elimina entidades borradas de ws:session ===');
console.log('(funciones REALES de workspace-storage.js; el bug: idSet.has(d) con d=objeto -> no-op silencioso)');

// 1. Reproduce el fallo real: entidades eliminadas deben salir de cada array
{
  const storeMap = {};
  storeMap[SESSION_KEY] = { key: SESSION_KEY, value: [baseSession()] };
  const api = buildApi(storeMap);
  await api.cleanup('p-del', ['doc-del', 'tbl-del', 'cap-del', 'p-del']);
  const persisted = storeMap[SESSION_KEY];
  const w = persisted.value[0].workspace;

  check('el doc eliminado se elimina de workspace.documents',
    !w.documents.some(d => d.id === 'doc-del'), 'docs=' + w.documents.map(d => d.id).join(','));
  check('el doc conservado permanece',
    w.documents.some(d => d.id === 'doc-keep'));
  check('la tabla eliminada se elimina de workspace.dataTables',
    !w.dataTables.some(t => t.id === 'tbl-del'), 'tables=' + w.dataTables.map(t => t.id).join(','));
  check('la tabla conservada permanece',
    w.dataTables.some(t => t.id === 'tbl-keep'));
  check('la captura eliminada se elimina de workspace.captures',
    !w.captures.some(c => c.id === 'cap-del'), 'caps=' + w.captures.map(c => c.id).join(','));
  check('la captura conservada permanece',
    w.captures.some(c => c.id === 'cap-keep'));
}

// 2. El barrido de entidades es global (una entidad borrada no debe quedar
//    referenciada en NINGUNA sesion persistida); el proyecto actual se limpia
//    solo para el proyecto borrado.
{
  const storeMap = {};
  const sessionOther = baseSession();
  sessionOther.workspace.currentProjectId = 'p-other';
  const sessionOther2 = baseSession();
  sessionOther2.workspace.currentProjectId = 'p-other';
  sessionOther2.workspace.documents = [{ id: 'doc-other-keep', type: 'text', blocks: [] }];
  storeMap[SESSION_KEY] = { key: SESSION_KEY, value: [sessionOther, sessionOther2] };
  const api = buildApi(storeMap);
  await api.cleanup('p-del', ['doc-del', 'tbl-del', 'cap-del', 'p-del']);
  const sessions = storeMap[SESSION_KEY].value;
  check('entidad borrada se limpia tambien en sesiones de otros proyectos',
    !sessions.some(s => s.workspace.documents.some(d => d.id === 'doc-del')));
  check('entidad de otro proyecto no borrada permanece en su sesion',
    sessions.some(s => s.workspace.documents.some(d => d.id === 'doc-other-keep')));
  check('el proyecto borrado nullifica su currentProjectId',
    sessions.filter(s => s.workspace.currentProjectId === 'p-other').length === 2);
  check('un proyecto no borrado conserva su currentProjectId',
    sessions.some(s => s.workspace.currentProjectId === 'p-other'));
}

// 3. El campo projectsession se limpia incluso si no hay IDs a borrar (solo objects)
{
  const storeMap = {};
  storeMap[SESSION_KEY] = { key: SESSION_KEY, value: [baseSession()] };
  const api = buildApi(storeMap);
  await api.cleanup('p-del', []);
  const w = storeMap[SESSION_KEY].value[0].workspace;
  check('currentProjectId se pone a null para el proyecto borrado',
    w.currentProjectId === null);
}

// 4. Sin sesiones: no lanza y no escribe
{
  const storeMap = {};
  const api = buildApi(storeMap);
  await api.cleanup('p-del', ['doc-del']);
  check('sin sesiones: no lanza y no escribe',
    storeMap[SESSION_KEY] === undefined);
}

console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);