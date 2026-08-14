import { applyMigrations } from './migrations.js';

const DB_NAME = 'toolisto-workspace';
const DB_VERSION = 3;

const STORES = {
  projects: 'projects',
  documents: 'documents',
  data: 'data',
  captures: 'captures',
  settings: 'settings',
  assets: 'assets',
  executions: 'executions',
  workflows: 'workflows',
};

let _dbPromise = null;
let _db = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      applyMigrations(db, e.oldVersion);
    };
    req.onsuccess = (e) => {
      _db = e.target.result;
      _db.onversionchange = () => {
        _db.close();
        _db = null;
        _dbPromise = null;
      };
      resolve(_db);
    };
    req.onerror = (e) => { _dbPromise = null; reject(e.target.error); };
    req.onblocked = () => {
      _dbPromise = null;
      reject(new Error('La base de datos esta bloqueada por otra pestaña.'));
    };
  });
  return _dbPromise;
}

function _handleTxError(tx, reject) {
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
}

async function dbGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    _handleTxError(tx, reject);
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    _handleTxError(tx, reject);
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    _handleTxError(tx, reject);
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    _handleTxError(tx, reject);
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetByIndex(storeName, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    _handleTxError(tx, reject);
    const idx = tx.objectStore(storeName).index(indexName);
    const req = idx.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    _handleTxError(tx, reject);
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbBulkPut(storeName, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    _handleTxError(tx, reject);
    const store = tx.objectStore(storeName);
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
  });
}

async function dbBulkDelete(storeName, keys) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    _handleTxError(tx, reject);
    const store = tx.objectStore(storeName);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
  });
}

async function dbTransaction(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    _handleTxError(tx, reject);
    let transactionComplete = false;
    let callbackComplete = false;
    let result;
    const settle = () => {
      if (transactionComplete && callbackComplete) resolve(result);
    };
    const abortAndReject = error => {
      // Un error del callback debe revertir también las operaciones que ya se
      // hubieran encolado. Sin abort(), IndexedDB puede completar esos put().
      try { tx.abort(); } catch (_) { /* La transacción ya puede haber cerrado. */ }
      reject(error);
    };
    tx.oncomplete = () => {
      transactionComplete = true;
      settle();
    };
    const ctx = {};
    for (const s of (Array.isArray(stores) ? stores : [stores])) {
      ctx[s] = tx.objectStore(s);
    }
    try {
      const callbackResult = fn(ctx);
      if (callbackResult && typeof callbackResult.then === 'function') {
        callbackResult.then(value => {
          result = value;
          callbackComplete = true;
          settle();
        }).catch(abortAndReject);
      } else {
        result = callbackResult;
        callbackComplete = true;
        settle();
      }
    } catch (error) {
      abortAndReject(error);
    }
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function closeDB() {
  if (_db) _db.close();
  _db = null;
  _dbPromise = null;
}

export {
  openDB, closeDB,
  dbGet, dbPut, dbDelete, dbGetAll, dbGetByIndex, dbClear,
  dbBulkPut, dbBulkDelete, dbTransaction,
  generateId, STORES, DB_VERSION, DB_NAME,
};
