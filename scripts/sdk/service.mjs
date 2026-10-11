import { OperationEngine } from './engine.mjs';
import { OperationError, ERROR_CODES } from './errors.mjs';
import { canonicalPayload, cloneJSON, validateRequestId } from './canonical.mjs';

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  'invalid-input': 'The operation request is invalid',
  'missing-data': 'Required operation data is unavailable',
  rights: 'The current principal is not permitted to perform this operation',
  waiting: 'The operation is waiting for a decision or an active executor',
  conflict: 'The operation request conflicts with an existing record',
  uncertain: 'The operation outcome requires reconciliation',
  cancelled: 'The operation service or request was cancelled',
  expired: 'The operation deadline has elapsed',
  'no-executor': 'No responsible executor is configured',
  unsupported: 'The requested operation is not supported'
});

function publicError(error) {
  let code = 'uncertain';
  try {
    // Error objects are untrusted adapter output. Do not execute code accessors,
    // and contain even a failing Proxy reflection trap.
    const field = error && (typeof error === 'object' || typeof error === 'function') ? Object.getOwnPropertyDescriptor(error, 'code') : null;
    if (field && 'value' in field && ERROR_CODES.includes(field.value)) code = field.value;
  } catch { /* Preserve the generic public error; never propagate sanitizer failures. */ }
  // Arbitrary adapter error messages, stacks and details can contain private state.
  return new OperationError(code, PUBLIC_ERROR_MESSAGES[code]);
}

function requestEnvelope(input, allowed, required) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    throw new OperationError('invalid-input', PUBLIC_ERROR_MESSAGES['invalid-input']);
  }
  const keys = Reflect.ownKeys(input);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new OperationError('invalid-input', PUBLIC_ERROR_MESSAGES['invalid-input']);
  }
  const values = Object.create(null);
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key);
    if (!property || !('value' in property)) throw new OperationError('invalid-input', PUBLIC_ERROR_MESSAGES['invalid-input']);
    values[key] = property.value;
  }
  if (required.some(key => !Object.hasOwn(values, key))) throw new OperationError('invalid-input', PUBLIC_ERROR_MESSAGES['invalid-input']);
  if (Object.hasOwn(values, 'requestId')) validateRequestId(values.requestId);
  if (Object.hasOwn(values, 'operation')) validateRequestId(values.operation);
  if (Object.hasOwn(values, 'choice') && (typeof values.choice !== 'string' || !values.choice || values.choice.length > 64 || /[\u0000-\u001f\u007f]/.test(values.choice))) {
    throw new OperationError('invalid-input', PUBLIC_ERROR_MESSAGES['invalid-input']);
  }
  if (Object.hasOwn(values, 'args')) values.args = JSON.parse(canonicalPayload(values.args));
  return values;
}

/**
 * Public operation boundary. Caller data never supplies identity, role or executor.
 * This is a binding to a trusted identity resolver, not authentication or a transport.
 */
export class OperationService {
  #engine;
  #resolvePrincipal;
  #disposed = false;

  constructor({ engine, resolvePrincipal } = {}) {
    if (!(engine instanceof OperationEngine) || typeof resolvePrincipal !== 'function') {
      throw new OperationError('invalid-input', 'OperationService requires an engine and a trusted principal resolver');
    }
    this.#engine = engine;
    this.#resolvePrincipal = resolvePrincipal;
  }

  #assertActive() {
    if (this.#disposed) throw new OperationError('cancelled', PUBLIC_ERROR_MESSAGES.cancelled);
  }

  async #principal() {
    this.#assertActive();
    let principal;
    try {
      const resolvePrincipal = this.#resolvePrincipal;
      // No request payload or caller-supplied context is passed to this callback.
      principal = await resolvePrincipal();
      if (!principal || typeof principal.id !== 'string' || !principal.id || principal.id.length > 128) {
        throw new Error('Missing principal');
      }
      principal = cloneJSON(principal);
    } catch {
      throw new OperationError('rights', PUBLIC_ERROR_MESSAGES.rights);
    }
    this.#assertActive();
    return principal;
  }

  async #call(input, allowed, required, action) {
    try {
      this.#assertActive();
      const request = requestEnvelope(input, allowed, required);
      const principal = await this.#principal();
      const value = await action(request, principal);
      this.#assertActive();
      // Engine operation methods return participant projection; full records are
      // reachable only through the raw trusted engine, which this boundary never exposes.
      return cloneJSON(value);
    } catch (error) {
      throw publicError(error);
    }
  }

  async catalog(input = {}) {
    return this.#call(input, [], [], () => this.#engine.catalog());
  }

  async prepare(input) {
    return this.#call(input, ['requestId', 'operation', 'args'], ['requestId', 'operation', 'args'],
      (request, principal) => this.#engine.prepare({ ...request, principal }));
  }

  async decide(input) {
    return this.#call(input, ['requestId', 'choice'], ['requestId', 'choice'],
      ({ requestId, choice }, principal) => this.#engine.decide(requestId, { choice, principal }));
  }

  async execute(input) {
    return this.#call(input, ['requestId'], ['requestId'],
      ({ requestId }, principal) => this.#engine.execute(requestId, { principal }));
  }

  async get(input) {
    return this.#call(input, ['requestId'], ['requestId'],
      ({ requestId }, principal) => this.#engine.publicView(requestId, { principal }));
  }

  async recover(input) {
    return this.#call(input, ['requestId'], ['requestId'],
      ({ requestId }, principal) => this.#engine.recover(requestId, { principal }));
  }

  async cancel(input) {
    return this.#call(input, ['requestId'], ['requestId'],
      ({ requestId }, principal) => this.#engine.cancel(requestId, { principal }));
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#engine.dispose();
  }
}
