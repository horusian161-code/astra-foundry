/** Neutral lifecycle boundary. It knows no Foundry documents or CPR rules. */
export class Scope {
  #cleanups = [];
  #disposed = false;
  track(cleanup) {
    if (typeof cleanup !== 'function') throw new TypeError('cleanup must be a function');
    if (this.#disposed) cleanup(); else this.#cleanups.push(cleanup);
    return cleanup;
  }
  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.track(() => target.removeEventListener(type, listener, options));
  }
  hook(hooks, name, listener) {
    const id = hooks.on(name, listener);
    this.track(() => hooks.off(name, id));
    return id;
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { console.warn('REDLINE cleanup failed', error); }
    }
  }
}
export class RefreshScheduler {
  #timer = null;
  #disposed = false;
  constructor(callback, delay = 60) { this.callback = callback; this.delay = delay; }
  request() {
    if (this.#disposed || this.#timer !== null) return;
    this.#timer = setTimeout(() => { this.#timer = null; if (!this.#disposed) this.callback(); }, this.delay);
  }
  dispose() { this.#disposed = true; clearTimeout(this.#timer); this.#timer = null; }
}
export const collectionValues = collection => {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === 'function') return Array.from(collection);
  return [];
};
export const scalarNumber = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
};
