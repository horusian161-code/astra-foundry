import { cloneJSON, validateRequestId } from './canonical.mjs';
import { OperationError } from './errors.mjs';

function validateNext(id, expectedVersion, next) {
  validateRequestId(id);
  if (next.id !== id || next.version !== expectedVersion + 1) {
    throw new OperationError('invalid-input', 'CAS must preserve ID and increment the record version exactly once');
  }
}

export class MemoryStore {
  #records = new Map();
  async get(id) { validateRequestId(id); return this.#records.has(id) ? cloneJSON(this.#records.get(id)) : null; }
  async create(record) {
    validateRequestId(record.id);
    if (record.version !== 0) throw new OperationError('invalid-input', 'New record version must be zero');
    if (this.#records.has(record.id)) return { created: false, record: cloneJSON(this.#records.get(record.id)) };
    const safe = cloneJSON(record);
    this.#records.set(record.id, safe);
    return { created: true, record: cloneJSON(safe) };
  }
  async compareAndSwap(id, expectedVersion, next) {
    validateNext(id, expectedVersion, next);
    const current = this.#records.get(id);
    if (!current || current.version !== expectedVersion) return { updated: false, record: current ? cloneJSON(current) : null };
    const safe = cloneJSON(next);
    this.#records.set(id, safe);
    return { updated: true, record: cloneJSON(safe) };
  }
  async list() { return [...this.#records.values()].map(record => cloneJSON(record)); }
  async close() {}
}

/** Authority-local persistence. This database is not a secure channel or a server. */
export class IndexedDBStore {
  #database = null;
  constructor({ name = 'astra-operations', indexedDB = globalThis.indexedDB } = {}) {
    if (!indexedDB) throw new OperationError('unsupported', 'IndexedDB is unavailable');
    if (typeof name !== 'string' || !name || name.length > 128) throw new OperationError('invalid-input', 'Invalid database name');
    this.factory = indexedDB;
    this.name = name;
  }
  async open() {
    if (!this.#database) this.#database = new Promise((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new OperationError('conflict', 'Database upgrade is blocked by another client'));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.#database = null; };
        resolve(request.result);
      };
    });
    return this.#database;
  }
  async #transaction(mode, operation) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('records', mode);
      const objectStore = transaction.objectStore('records');
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Database transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted'));
      const guard = callback => event => {
        try { callback(event); }
        catch (error) { transaction.abort(); reject(error); }
      };
      try { operation(objectStore, value => { result = value; }, guard); }
      catch (error) { transaction.abort(); reject(error); }
    });
  }
  async get(id) {
    validateRequestId(id);
    return this.#transaction('readonly', (records, done, guard) => {
      const request = records.get(id);
      request.onsuccess = guard(() => done(request.result ? cloneJSON(request.result) : null));
    });
  }
  async create(record) {
    validateRequestId(record.id);
    if (record.version !== 0) throw new OperationError('invalid-input', 'New record version must be zero');
    const safe = cloneJSON(record);
    return this.#transaction('readwrite', (records, done, guard) => {
      const request = records.get(safe.id);
      request.onsuccess = guard(() => {
        if (request.result) done({ created: false, record: cloneJSON(request.result) });
        else {
          records.add(safe);
          done({ created: true, record: cloneJSON(safe) });
        }
      });
    });
  }
  async compareAndSwap(id, expectedVersion, next) {
    validateNext(id, expectedVersion, next);
    const safe = cloneJSON(next);
    return this.#transaction('readwrite', (records, done, guard) => {
      const request = records.get(id);
      request.onsuccess = guard(() => {
        const current = request.result;
        if (!current || current.version !== expectedVersion) done({ updated: false, record: current ? cloneJSON(current) : null });
        else {
          records.put(safe);
          done({ updated: true, record: cloneJSON(safe) });
        }
      });
    });
  }
  async list() {
    return this.#transaction('readonly', (records, done, guard) => {
      const request = records.getAll();
      request.onsuccess = guard(() => done(request.result.map(record => cloneJSON(record))));
    });
  }
  async close() {
    if (this.#database) (await this.#database).close();
    this.#database = null;
  }
}
