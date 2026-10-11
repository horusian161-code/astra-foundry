import {OperationError} from '../sdk/index.mjs';

const copy = value => structuredClone(value);

/** Isolated, single-process example state. This is NOT a Foundry document store. */
export class MemoryDomainRepository {
  #records = new Map();

  constructor(initial = {}) {
    for (const [id, state] of Object.entries(initial)) {
      this.#records.set(id, {version: 0, state: copy(state), ledger: {}});
    }
  }

  read(id) {
    const record = this.#records.get(id);
    return record ? copy(record) : null;
  }

  compareAndSwap(id, expectedVersion, nextRecord) {
    const current = this.#records.get(id);
    if (!current || current.version !== expectedVersion) return false;
    if (nextRecord.version !== expectedVersion + 1) {
      throw new OperationError('invalid-input', 'Domain revision must advance by one.', {provenNoMutation: true});
    }
    this.#records.set(id, copy(nextRecord));
    return true;
  }

  /** Commit state and its receipt together in one synchronous local CAS. */
  async commit(id, {requestId, signature, assertFence, mutate}) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = this.read(id);
      if (!current) throw new OperationError('missing-data', 'Example document is absent.', {provenNoMutation: true});
      const previous = Object.hasOwn(current.ledger, requestId) ? current.ledger[requestId] : null;
      if (previous) {
        if (previous.signature !== signature) {
          throw new OperationError('conflict', 'A domain receipt already uses this request ID.', {provenNoMutation: true});
        }
        return copy(previous.result);
      }
      const state = copy(current.state);
      const change = mutate(state);
      const result = {
        public: copy(change.public),
        private: {},
        receipt: {domainId: id, revision: current.version + 1, changes: copy(change.changes ?? [])}
      };
      const next = {
        version: current.version + 1,
        state,
        ledger: {...current.ledger, [requestId]: {signature, result}}
      };
      // A fence check is necessary but is not a cross-store atomic transaction.
      await assertFence();
      if (this.compareAndSwap(id, current.version, next)) return copy(result);
    }
    throw new OperationError('conflict', 'Example state changed too often; prepare a fresh request.', {provenNoMutation: true});
  }
}

export function requireRecord(repository, id) {
  const record = repository.read(id);
  if (!record) throw new OperationError('missing-data', 'Example document is absent.', {provenNoMutation: true});
  return record;
}

export function domainReceipt(repository, id, requestId, signature) {
  const {ledger} = requireRecord(repository, id);
  if (!Object.hasOwn(ledger, requestId)) return null;
  const entry = ledger[requestId];
  if (entry.signature !== signature) {
    throw new OperationError('conflict', 'The domain receipt belongs to another payload.', {provenNoMutation: true});
  }
  return copy(entry.result);
}

export function hasEditorAccess(state, principal) {
  return Boolean(principal && (
    principal.role === 'gm' || principal.role === 'authority' || state.editorIds?.includes(principal.id)
  ));
}

export function knownNonnegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new OperationError('missing-data', `${label} is unknown or invalid.`, {provenNoMutation: true});
  }
  return value;
}

export function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(value)) {
    throw new OperationError('invalid-input', `${label} must be a short identifier.`, {provenNoMutation: true});
  }
}

export function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new OperationError('invalid-input', `${label} must be an integer from 1 to 1000.`, {provenNoMutation: true});
  }
}

export function requireObjectKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new OperationError('invalid-input', 'Arguments must match the operation schema.', {provenNoMutation: true});
  }
}
