import { OperationError } from './errors.mjs';
import { cloneJSON } from './canonical.mjs';

export const RECORD_SCHEMA_VERSION = 1;
export const TRANSITIONS = Object.freeze({
  prepared: Object.freeze(['waiting', 'ready', 'cancelled', 'expired', 'failed']),
  waiting: Object.freeze(['ready', 'cancelled', 'expired', 'failed']),
  ready: Object.freeze(['executing', 'cancelled', 'expired', 'failed']),
  executing: Object.freeze(['resolved', 'failed', 'uncertain']),
  uncertain: Object.freeze(['resolved', 'ready']),
  resolved: Object.freeze(['compensating']),
  compensating: Object.freeze(['compensated', 'uncertain']),
  failed: Object.freeze([]), cancelled: Object.freeze([]), expired: Object.freeze([]),
  compensated: Object.freeze([])
});

export function transitionRecord(record, state, patch = {}, at = Date.now()) {
  if (record.schemaVersion !== RECORD_SCHEMA_VERSION) throw new OperationError('unsupported', 'Unsupported record schema');
  if (!TRANSITIONS[record.state]?.includes(state)) {
    throw new OperationError('conflict', `Invalid transition ${record.state} → ${state}`);
  }
  if (!Number.isFinite(at)) throw new OperationError('invalid-input', 'Transition time must be finite');
  const next = { ...cloneJSON(record), ...cloneJSON(patch), state, version: record.version + 1, updatedAt: at };
  // Identity and historical authority cannot be replaced by a transition patch.
  for (const key of ['id', 'operation', 'schemaVersion', 'createdAt', 'canonicalArgs', 'requesterId']) next[key] = record[key];
  return next;
}
