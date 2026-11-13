'use strict';

(function (root) {
  const DB_NAME = 'double-click';
  const STORE = 'conversations';
  let chain = Promise.resolve();

  function enqueue(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('url', 'url');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function get(id) {
    const db = await openDb();
    try {
      return await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
    } finally {
      db.close();
    }
  }

  async function put(record) {
    const db = await openDb();
    try {
      await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
      return record;
    } finally {
      db.close();
    }
  }

  async function list() {
    const db = await openDb();
    try {
      const rows = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
      return (rows || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } finally {
      db.close();
    }
  }

  async function remove(id) {
    const db = await openDb();
    try {
      await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
    } finally {
      db.close();
    }
  }

  function update(id, updater) {
    return enqueue(async () => {
      const current = await get(id);
      const next = await updater(current || null);
      if (!next) return null;
      next.id = id;
      await put(next);
      return next;
    });
  }

  async function removeMany(ids) {
    return enqueue(async () => {
      for (const id of ids) await remove(id);
    });
  }

  root.DoubleClickDB = {
    get,
    put,
    list,
    remove,
    update,
    removeMany,
  };
})(globalThis);
