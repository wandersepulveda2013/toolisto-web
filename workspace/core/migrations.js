import { openDB, closeDB, DB_VERSION, DB_NAME } from './db.js';

const BACKUP_DB_NAME = 'toolisto-workspace-backup';

function createV1Stores(db) {
  const ps = db.createObjectStore('projects', { keyPath: 'id' });
  ps.createIndex('updatedAt', 'updatedAt');
  ps.createIndex('name', 'name');
  const ds = db.createObjectStore('documents', { keyPath: 'id' });
  ds.createIndex('projectId', 'projectId');
  const dt = db.createObjectStore('data', { keyPath: 'id' });
  dt.createIndex('projectId', 'projectId');
  const cs = db.createObjectStore('captures', { keyPath: 'id' });
  cs.createIndex('projectId', 'projectId');
  cs.createIndex('docId', 'docId');
  db.createObjectStore('settings', { keyPath: 'key' });
}

function createAssetsStore(db) {
  const as = db.createObjectStore('assets', { keyPath: 'id' });
  as.createIndex('projectId', 'projectId');
  as.createIndex('type', 'type');
  as.createIndex('sourceAssetId', 'sourceAssetId');
}

function createV3Stores(db) {
  const es = db.createObjectStore('executions', { keyPath: 'id' });
  es.createIndex('projectId', 'projectId');
  es.createIndex('toolId', 'toolId');
  es.createIndex('sourceAssetId', 'sourceAssetId');
  const ws = db.createObjectStore('workflows', { keyPath: 'id' });
  ws.createIndex('projectId', 'projectId');
}

const MIGRATION_PLAN = {
  1: { from: 0, to: 1, label: 'v1: proyectos, documentos, datos, capturas y ajustes', run: createV1Stores },
  2: { from: 1, to: 2, label: 'v2: activos', run: createAssetsStore },
  3: { from: 2, to: 3, label: 'v3: ejecuciones y flujos de trabajo', run: createV3Stores },
};

function applyPlan(db, oldVersion, plan) {
  const applied = [];
  for (let v = oldVersion + 1; v <= DB_VERSION; v++) {
    const migration = plan[v];
    if (migration && typeof migration.run === 'function') {
      migration.run(db);
      applied.push(v);
    }
  }
  return applied;
}

function applyMigrations(db, oldVersion) {
  return applyPlan(db, oldVersion, MIGRATION_PLAN);
}

function getMigrationPlan() {
  return Object.keys(MIGRATION_PLAN).sort((a, b) => Number(a) - Number(b)).map(v => ({
    version: Number(v),
    from: MIGRATION_PLAN[v].from,
    to: MIGRATION_PLAN[v].to,
    label: MIGRATION_PLAN[v].label,
  }));
}

function openRaw(dbName, version, onupgradeneeded) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = (e) => {
      try {
        onupgradeneeded(e.target.result, e.oldVersion, e.newVersion);
      } catch (error) {
        req.onsuccess = null;
        reject(error);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de datos bloqueada por otra pestaña durante la migración.'));
  });
}

function readAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function writeAll(db, storeName, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function deleteDatabase(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Borrado de base bloqueado por otra pestaña.'));
  });
}

async function getSchemaInfo() {
  const db = await openDB();
  return { name: db.name, version: db.version, stores: Array.from(db.objectStoreNames) };
}

async function backupDatabase(backupName = BACKUP_DB_NAME) {
  const db = await openDB();
  const stores = Array.from(db.objectStoreNames);
  const schema = {};
  for (const s of stores) {
    const source = db.transaction(s, 'readonly').objectStore(s);
    const indexes = [];
    for (const idxName of Array.from(source.indexNames)) {
      const idx = source.index(idxName);
      indexes.push({ name: idxName, keyPath: idx.keyPath, options: { unique: idx.unique, multiEntry: idx.multiEntry } });
    }
    schema[s] = { keyPath: source.keyPath, autoIncrement: source.autoIncrement, indexes };
  }
  try { await deleteDatabase(backupName); } catch (e) { /* ignore */ }
  const backup = await openRaw(backupName, db.version, (bdb) => {
    for (const s of stores) {
      const spec = schema[s];
      const os = bdb.createObjectStore(s, { keyPath: spec.keyPath || undefined, autoIncrement: !!spec.autoIncrement });
      for (const idx of spec.indexes) {
        os.createIndex(idx.name, idx.keyPath, idx.options);
      }
    }
  });
  for (const s of stores) {
    const data = await readAll(db, s);
    if (data.length) await writeAll(backup, s, data);
  }
  backup.close();
  return { backupName, version: db.version, stores };
}

async function restoreDatabase(backupName = BACKUP_DB_NAME, targetName = DB_NAME) {
  const backup = await new Promise((resolve, reject) => {
    const req = indexedDB.open(backupName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('No hay copia de seguridad disponible.'));
    req.onblocked = () => reject(new Error('Borrado de base bloqueado por otra pestaña.'));
  });
  const backupStores = Array.from(backup.objectStoreNames);
  const snapshot = {};
  for (const s of backupStores) snapshot[s] = await readAll(backup, s);
  backup.close();
  try { await deleteDatabase(targetName); } catch (e) { /* ignore */ }
  const main = await openRaw(targetName, DB_VERSION, (db, oldVersion) => {
    applyMigrations(db, oldVersion);
  });
  for (const s of backupStores) {
    if (main.objectStoreNames.contains(s) && snapshot[s].length) {
      await writeAll(main, s, snapshot[s]);
    }
  }
  main.close();
  return { restored: true, stores: backupStores };
}

async function migrateDatabase({ backup = true, backupName = BACKUP_DB_NAME } = {}) {
  const before = await getSchemaInfo();
  if (before.version >= DB_VERSION) {
    return { migrated: false, from: before.version, to: before.version, backup: null };
  }
  const backupMade = backup ? await backupDatabase(backupName) : null;
  closeDB();
  try {
    await openDB();
    const after = await getSchemaInfo();
    return { migrated: true, from: before.version, to: after.version, backup: backupMade };
  } catch (error) {
    if (backupMade) {
      try { await restoreDatabase(backupName); } catch (restoreError) { /* preserve original */ }
    }
    throw error;
  }
}

export {
  BACKUP_DB_NAME, MIGRATION_PLAN,
  applyMigrations, applyPlan, getMigrationPlan,
  getSchemaInfo, backupDatabase, restoreDatabase, migrateDatabase,
};
