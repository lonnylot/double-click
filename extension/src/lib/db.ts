export interface StoredMessage {
  role: string;
  content: string;
  createdAt?: number;
}

export interface StoredError {
  message: string;
  hint: string;
  code: string;
}

export interface Conversation {
  id: string;
  url: string;
  title: string;
  selection: string;
  provider: string;
  providerSessionId: string | null;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
  lastError: StoredError | null;
}

const DB_NAME = 'double-click';
const STORE = 'conversations';
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

function openDb(): Promise<IDBDatabase> {
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
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function get(id: string): Promise<Conversation | undefined> {
  const db = await openDb();
  try {
    return await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(id) as IDBRequest<Conversation | undefined>);
  } finally {
    db.close();
  }
}

export async function put(record: Conversation): Promise<Conversation> {
  const db = await openDb();
  try {
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record));
    return record;
  } finally {
    db.close();
  }
}

export async function list(): Promise<Conversation[]> {
  const db = await openDb();
  try {
    const rows = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<Conversation[] | undefined>);
    return (rows || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } finally {
    db.close();
  }
}

export async function remove(id: string): Promise<void> {
  const db = await openDb();
  try {
    await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

export function update(
  id: string,
  updater: (current: Conversation | null) => Conversation | null | Promise<Conversation | null>,
): Promise<Conversation | null> {
  return enqueue(async () => {
    const current = await get(id);
    const next = await updater(current || null);
    if (!next) return null;
    next.id = id;
    await put(next);
    return next;
  });
}

export async function removeMany(ids: readonly string[]): Promise<void> {
  return enqueue(async () => {
    for (const id of ids) await remove(id);
  });
}
