const DB_NAME = 'toolisto-workspace';
const DB_VERSION = 3;

function _openDB(dbName, dbVersion) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, dbVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll(page, storeName) {
  return page.evaluate(async ({ dbName, dbVersion, store }) => {
    try {
      const db = await new Promise((r, j) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onsuccess = () => r(req.result);
        req.onerror = () => j(req.error);
      });
      if (!db.objectStoreNames.contains(store)) { db.close(); return []; }
      const tx = db.transaction(store, 'readonly');
      const results = await new Promise((r) => {
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => r(req.result);
        req.onerror = () => r([]);
      });
      db.close();
      return results;
    } catch { return []; }
  }, { dbName: DB_NAME, dbVersion: DB_VERSION, store: storeName });
}

async function idbCount(page, storeName) {
  const all = await idbGetAll(page, storeName);
  return all.length;
}

async function idbGetById(page, storeName, id) {
  return page.evaluate(async ({ dbName, dbVersion, store, id }) => {
    try {
      const db = await new Promise((r, j) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onsuccess = () => r(req.result);
        req.onerror = () => j(req.error);
      });
      if (!db.objectStoreNames.contains(store)) { db.close(); return null; }
      const tx = db.transaction(store, 'readonly');
      const result = await new Promise((r) => {
        const req = tx.objectStore(store).get(id);
        req.onsuccess = () => r(req.result || null);
        req.onerror = () => r(null);
      });
      db.close();
      return result;
    } catch { return null; }
  }, { dbName: DB_NAME, dbVersion: DB_VERSION, store: storeName, id });
}

async function idbFindByType(page, storeName, type) {
  const all = await idbGetAll(page, storeName);
  return all.filter(item => item.type === type);
}

async function idbGetByIndex(page, storeName, indexName, value) {
  return page.evaluate(async ({ dbName, dbVersion, store, indexName, value }) => {
    try {
      const db = await new Promise((r, j) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onsuccess = () => r(req.result);
        req.onerror = () => j(req.error);
      });
      if (!db.objectStoreNames.contains(store)) { db.close(); return []; }
      const tx = db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(indexName);
      const results = await new Promise((r) => {
        const req = idx.getAll(value);
        req.onsuccess = () => r(req.result);
        req.onerror = () => r([]);
      });
      db.close();
      return results;
    } catch { return []; }
  }, { dbName: DB_NAME, dbVersion: DB_VERSION, store: storeName, indexName, value });
}

async function waitForCount(page, storeName, expected, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const count = await idbCount(page, storeName);
    if (count >= expected) return count;
    await page.waitForTimeout(intervalMs);
  }
  return -1;
}

async function waitForDocWithType(page, type, timeoutMs = 120000, intervalMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const store of ['documents', 'data', 'assets']) {
      const items = await idbFindByType(page, store, type);
      if (items.length > 0) return items[0];
    }
    await page.waitForTimeout(intervalMs);
  }
  return null;
}

async function idbGetAllStores(page) {
  return page.evaluate(async ({ dbName, dbVersion }) => {
    try {
      const db = await new Promise((r, j) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onsuccess = () => r(req.result);
        req.onerror = () => j(req.error);
      });
      const result = {};
      const storeNames = Array.from(db.objectStoreNames);
      for (const s of storeNames) {
        const tx = db.transaction(s, 'readonly');
        const count = await new Promise(r => {
          const req = tx.objectStore(s).count();
          req.onsuccess = () => r(req.result);
          req.onerror = () => r(0);
        });
        result[s] = count;
      }
      db.close();
      return result;
    } catch { return {}; }
  }, { dbName: DB_NAME, dbVersion: DB_VERSION });
}

async function idbGetExecutions(page) {
  return page.evaluate(async ({ dbName, dbVersion }) => {
    try {
      const db = await new Promise((r, j) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onsuccess = () => r(req.result);
        req.onerror = () => j(req.error);
      });
      if (!db.objectStoreNames.contains('executions')) { db.close(); return []; }
      const tx = db.transaction('executions', 'readonly');
      const results = await new Promise(r => {
        const req = tx.objectStore('executions').getAll();
        req.onsuccess = () => r(req.result);
        req.onerror = () => r([]);
      });
      db.close();
      return results.map(e => ({ id: e.id, toolId: e.toolId, status: e.status, toolName: e.toolName, resultType: e.resultType, resultAssetId: e.resultAssetId }));
    } catch { return []; }
  }, { dbName: DB_NAME, dbVersion: DB_VERSION });
}

export {
  DB_NAME, DB_VERSION,
  idbGetAll, idbCount, idbGetById, idbFindByType, idbGetByIndex,
  waitForCount, waitForDocWithType, idbGetAllStores, idbGetExecutions,
};
