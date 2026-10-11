import { OperationError, errorRecord } from './errors.mjs';
import { canonicalPayload, cloneJSON, validateRequestId } from './canonical.mjs';
import { transitionRecord, RECORD_SCHEMA_VERSION } from './machine.mjs';
import { MemoryStore } from './stores.mjs';
import { projectOperation } from './projection.mjs';

function validPrincipal(principal) {
  if (!principal || typeof principal.id !== 'string' || !principal.id || principal.id.length > 128) {
    throw new OperationError('rights', 'A trusted principal identity is required');
  }
  return principal;
}

function resultParts(value, requestId, at) {
  if (!value || typeof value !== 'object' || !value.receipt || typeof value.receipt !== 'object') {
    throw new OperationError('missing-data', 'Executor must return a verifiable operation receipt');
  }
  if (value.receipt.requestId && value.receipt.requestId !== requestId) {
    throw new OperationError('conflict', 'Receipt belongs to a different request');
  }
  return {
    result: { public: cloneJSON(value.public || {}), private: cloneJSON(value.private || {}) },
    receipt: cloneJSON({ ...value.receipt, requestId, at: value.receipt.at ?? at })
  };
}

export class OperationEngine {
  #descriptors = new Map();
  #inflight = new Map();
  #controllers = new Map();
  #lifecycleGeneration = 0;
  constructor({ store = new MemoryStore(), descriptors = [], executorId = null, clock = () => Date.now(), leaseMs = 30000 } = {}) {
    if (!store || !['get', 'create', 'compareAndSwap'].every(key => typeof store[key] === 'function')) {
      throw new OperationError('invalid-input', 'Store must implement get/create/compareAndSwap');
    }
    if (!Number.isFinite(leaseMs) || leaseMs < 1000 || leaseMs > 300000) {
      throw new OperationError('invalid-input', 'Lease must be between 1000 and 300000 ms');
    }
    this.store = store;
    if (executorId !== null) validateRequestId(executorId);
    this.executorId = executorId;
    this.clock = clock;
    this.leaseMs = leaseMs;
    for (const descriptor of descriptors) this.register(descriptor);
  }
  register(descriptor) {
    if (!descriptor || typeof descriptor.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(descriptor.id)) {
      throw new OperationError('invalid-input', 'Descriptor needs a bounded operation ID');
    }
    if (this.#descriptors.has(descriptor.id)) throw new OperationError('conflict', 'Operation is already registered');
    if (descriptor.decision) {
      const options = descriptor.decision.options;
      if (!Array.isArray(options) || !options.length || options.length > 16 || options.some(value => typeof value !== 'string' || !value || value.length > 64)) {
        throw new OperationError('invalid-input', 'Decision must define 1–16 bounded string options');
      }
      if (!Number.isFinite(descriptor.decision.timeoutMs) || descriptor.decision.timeoutMs <= 0 || descriptor.decision.timeoutMs > 86400000) {
        throw new OperationError('invalid-input', 'Decision needs a finite positive deadline up to 24 hours');
      }
    }
    this.#descriptors.set(descriptor.id, Object.freeze({ ...descriptor,
      decision: descriptor.decision ? Object.freeze({ ...descriptor.decision, options: Object.freeze([...descriptor.decision.options]) }) : null
    }));
    return this;
  }
  catalog() {
    return [...this.#descriptors.values()].map(descriptor => ({
      id: descriptor.id,
      version: descriptor.version ?? 1,
      description: descriptor.description ?? null,
      mutates: descriptor.mutates ? cloneJSON(descriptor.mutates) : null,
      permissionDescription: descriptor.permissionDescription ?? null,
      argsSchema: descriptor.argsSchema ? cloneJSON(descriptor.argsSchema) : null,
      resultSchema: descriptor.resultSchema ? cloneJSON(descriptor.resultSchema) : null,
      supports: Object.fromEntries(['validate', 'permission', 'preview', 'execute', 'reconcile', 'compensate'].map(name => [name, typeof descriptor[name] === 'function'])),
      idempotentExecution: descriptor.idempotent === true,
      cancellation: 'before-execution; during-execution-is-uncertain',
      cleanup: 'AbortSignal supplied to executor; adapter owns resource disposal',
      decision: descriptor.decision ? cloneJSON(descriptor.decision) : null
    }));
  }
  #now() {
    const time = this.clock();
    if (!Number.isFinite(time)) throw new OperationError('invalid-input', 'Clock must return finite milliseconds');
    return time;
  }
  #descriptor(id) {
    const descriptor = this.#descriptors.get(id);
    if (!descriptor) throw new OperationError('unsupported', 'Operation is not registered');
    return descriptor;
  }
  async #record(id) {
    validateRequestId(id);
    const record = await this.store.get(id);
    if (!record) throw new OperationError('missing-data', 'Operation record does not exist');
    if (record.schemaVersion !== RECORD_SCHEMA_VERSION) throw new OperationError('unsupported', 'Record schema requires a migration');
    return record;
  }
  async #permit(descriptor, args, principal, stage, record = null) {
    validPrincipal(principal);
    if (typeof descriptor.permission !== 'function' || await descriptor.permission(cloneJSON(args), { principal, stage, record: record ? cloneJSON(record) : null }) !== true) {
      throw new OperationError('rights', 'Operation permission was denied');
    }
  }
  #view(record, principal, audience = 'participant') {
    return projectOperation(record, { principalId: principal?.id ?? null, audience });
  }
  async #change(record, state, patch = {}) {
    const next = transitionRecord(record, state, patch, this.#now());
    const result = await this.store.compareAndSwap(record.id, record.version, next);
    if (!result.updated) throw new OperationError('conflict', 'Record changed in another client');
    return result.record;
  }
  #assertOwned(record, state, fence) {
    if (record.state !== state || record.fence !== fence || record.lease?.owner !== this.executorId || record.lease.expiresAt <= this.#now()) {
      throw new OperationError('conflict', 'Executor lease or fencing token is stale');
    }
  }
  #assertLifecycle(generation, provenNoMutation = false) {
    if (generation !== this.#lifecycleGeneration) {
      throw new OperationError('cancelled', 'Local execution lifecycle was disposed', { provenNoMutation });
    }
  }
  #expired(record) {
    const time = this.#now();
    return record.deadlineAt != null && time >= record.deadlineAt || record.state === 'waiting' && record.decision?.deadlineAt != null && time >= record.decision.deadlineAt;
  }
  async #expire(record) {
    if (['prepared', 'waiting', 'ready'].includes(record.state) && this.#expired(record)) {
      return this.#change(record, 'expired', { error: { code: 'expired', message: 'Persistent deadline elapsed', provenNoMutation: true } });
    }
    return record;
  }
  async prepare({ operation, args, requestId, principal }) {
    validateRequestId(requestId);
    const descriptor = this.#descriptor(operation);
    const canonicalArgs = canonicalPayload(args);
    const safeArgs = JSON.parse(canonicalArgs);
    await this.#permit(descriptor, safeArgs, principal, 'prepare');
    const existing = await this.store.get(requestId);
    if (existing) {
      if (existing.operation !== operation || existing.canonicalArgs !== canonicalArgs || existing.requesterId !== principal.id) {
        throw new OperationError('conflict', 'Request ID was already used with another payload, operation, or principal');
      }
      return this.#view(await this.#expire(existing), principal);
    }
    if (typeof descriptor.validate !== 'function') throw new OperationError('unsupported', 'Operation has no validator');
    if (await descriptor.validate(cloneJSON(safeArgs), { principal, stage: 'prepare' }) !== true) {
      throw new OperationError('invalid-input', 'Operation validation failed');
    }
    await this.#permit(descriptor, safeArgs, principal, 'preview');
    const preview = typeof descriptor.preview === 'function' ? await descriptor.preview(cloneJSON(safeArgs), { principal, stage: 'preview' }) : {};
    const at = this.#now();
    const decision = descriptor.decision ? {
      required: true, options: [...descriptor.decision.options], choice: null,
      by: null, at: null, deadlineAt: at + descriptor.decision.timeoutMs
    } : null;
    let deadlineAt = null;
    if (descriptor.expiresInMs != null) {
      if (!Number.isFinite(descriptor.expiresInMs) || descriptor.expiresInMs <= 0) throw new OperationError('invalid-input', 'Invalid operation deadline');
      deadlineAt = at + descriptor.expiresInMs;
    }
    const record = {
      id: requestId, operation, schemaVersion: RECORD_SCHEMA_VERSION, version: 0,
      requesterId: principal.id, createdAt: at, updatedAt: at, deadlineAt,
      canonicalArgs, args: safeArgs, state: decision ? 'waiting' : 'ready',
      preview: { public: cloneJSON(preview?.public || {}), private: cloneJSON(preview?.private || {}) },
      decision, result: null, receipt: null, error: null, lease: null,
      fence: 0, executionStartedAt: null, completedAt: null, uncertaintyPhase: null
    };
    const inserted = await this.store.create(record);
    if (!inserted.created && (inserted.record.operation !== operation || inserted.record.canonicalArgs !== canonicalArgs || inserted.record.requesterId !== principal.id)) {
      throw new OperationError('conflict', 'Concurrent request ID payload collision');
    }
    return this.#view(inserted.record, principal);
  }
  async publicView(id, { principal, audience = 'participant' } = {}) {
    const record = await this.#record(id);
    await this.#permit(this.#descriptor(record.operation), record.args, principal, 'inspect', record);
    return this.#view(record, principal, audience);
  }
  async get(id, options) { return this.publicView(id, options); }
  async getAuthorityRecord(id, { principal } = {}) {
    if (!['authority', 'gm'].includes(principal?.role)) throw new OperationError('rights', 'Authority role is required for the private record');
    const record = await this.#record(id);
    await this.#permit(this.#descriptor(record.operation), record.args, principal, 'inspect-private', record);
    return cloneJSON(record);
  }
  async decide(id, { choice, principal } = {}) {
    let record = await this.#record(id);
    const descriptor = this.#descriptor(record.operation);
    await this.#permit(descriptor, record.args, principal, 'decide', record);
    record = await this.#expire(record);
    if (record.state === 'expired') throw new OperationError('expired', 'Decision deadline elapsed');
    if (!record.decision || !record.decision.options.includes(choice)) throw new OperationError('invalid-input', 'Decision is not an allowed option');
    if (record.decision.choice !== null) {
      if (record.decision.choice === choice) return this.#view(record, principal);
      throw new OperationError('conflict', 'Decision was already made');
    }
    if (record.state !== 'waiting') throw new OperationError('conflict', 'Operation is not waiting for a decision');
    record = await this.#change(record, 'ready', { decision: { ...record.decision, choice, by: principal.id, at: this.#now() } });
    return this.#view(record, principal);
  }
  execute(id, { principal } = {}) {
    validateRequestId(id);
    if (this.#inflight.has(id)) return this.#joinExecution(id, principal, this.#inflight.get(id));
    const pending = this.#execute(id, principal).finally(() => {
      this.#inflight.delete(id);
      this.#controllers.delete(id);
    });
    this.#inflight.set(id, pending);
    return pending;
  }
  async #joinExecution(id, principal, pending) {
    const record = await this.#record(id);
    await this.#permit(this.#descriptor(record.operation), record.args, principal, 'execute', record);
    await pending;
    return this.publicView(id, { principal });
  }
  async #execute(id, principal) {
    const lifecycle = this.#lifecycleGeneration;
    let record = await this.#record(id);
    this.#assertLifecycle(lifecycle, true);
    const descriptor = this.#descriptor(record.operation);
    await this.#permit(descriptor, record.args, principal, 'execute', record);
    // dispose may occur while permission awaits, before an AbortController exists.
    this.#assertLifecycle(lifecycle, true);
    if (record.state === 'resolved') return this.#view(record, principal);
    if (!this.executorId || typeof descriptor.execute !== 'function') throw new OperationError('no-executor', 'No responsible executor is configured');
    record = await this.#expire(record);
    this.#assertLifecycle(lifecycle, true);
    if (record.state === 'expired') throw new OperationError('expired', 'Operation deadline elapsed');
    if (record.state === 'waiting' || record.state === 'executing') throw new OperationError('waiting', 'Operation is waiting for a decision or an active executor');
    if (record.state === 'uncertain') throw new OperationError('uncertain', 'Execution outcome requires reconciliation');
    if (record.state === 'cancelled') throw new OperationError('cancelled', 'Operation was cancelled');
    if (record.state !== 'ready') throw new OperationError('conflict', 'Operation is not ready to execute');
    const at = this.#now();
    const fence = record.fence + 1;
    record = await this.#change(record, 'executing', {
      lease: { owner: this.executorId, fence, expiresAt: at + this.leaseMs },
      fence, executionStartedAt: at, error: null
    });
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    let executionInvoked = false;
    const assertFence = async () => {
      this.#assertLifecycle(lifecycle, !executionInvoked);
      const current = await this.#record(id);
      this.#assertLifecycle(lifecycle, !executionInvoked);
      this.#assertOwned(current, 'executing', fence);
      await this.#permit(descriptor, current.args, principal, 'commit', current);
      this.#assertLifecycle(lifecycle, !executionInvoked);
      this.#assertOwned(await this.#record(id), 'executing', fence);
      this.#assertLifecycle(lifecycle, !executionInvoked);
      if (controller.signal.aborted) throw new OperationError('cancelled', 'Execution was cancelled');
      return true;
    };
    const renewLease = async () => {
      await assertFence();
      const current = await this.#record(id);
      this.#assertOwned(current, 'executing', fence);
      const next = { ...current, version: current.version + 1, updatedAt: this.#now(), lease: { ...current.lease, expiresAt: this.#now() + this.leaseMs } };
      const renewed = await this.store.compareAndSwap(id, current.version, next);
      if (!renewed.updated) throw new OperationError('conflict', 'Lease renewal conflicted');
      return renewed.record.lease.expiresAt;
    };
    try {
      // Marker is already durable. Any process death from here onward is conservatively uncertain.
      await assertFence();
      this.#assertLifecycle(lifecycle, true);
      executionInvoked = true;
      const value = await descriptor.execute(cloneJSON(record.args), {
        principal, requestId: id, fence, executorId: this.executorId, decision: record.decision ? cloneJSON(record.decision) : null,
        preview: cloneJSON(record.preview), signal: controller.signal, assertFence, renewLease
      });
      const parts = resultParts(value, id, this.#now());
      await assertFence();
      const current = await this.#record(id);
      this.#assertOwned(current, 'executing', fence);
      record = await this.#change(current, 'resolved', { ...parts, lease: null, completedAt: this.#now(), error: null });
      return this.#view(record, principal);
    } catch (error) {
      const current = await this.#record(id);
      if (current.state === 'executing' && current.fence === fence && current.lease?.owner === this.executorId) {
        const failure = errorRecord(error);
        const state = failure.provenNoMutation ? 'failed' : 'uncertain';
        try {
          record = await this.#change(current, state, { error: failure, lease: null, fence: current.fence + 1, uncertaintyPhase: state === 'uncertain' ? 'execute' : null });
          return this.#view(record, principal);
        } catch (conflict) {
          if (conflict?.code !== 'conflict') throw conflict;
        }
      }
      return this.#view(await this.#record(id), principal);
    }
  }
  async recover(id, { principal } = {}) {
    let record = await this.#record(id);
    const descriptor = this.#descriptor(record.operation);
    await this.#permit(descriptor, record.args, principal, 'recover', record);
    record = await this.#expire(record);
    if (['executing', 'compensating'].includes(record.state) && record.lease?.expiresAt <= this.#now()) {
      record = await this.#change(record, 'uncertain', {
        lease: null, fence: record.fence + 1, uncertaintyPhase: record.state === 'compensating' ? 'compensate' : 'execute',
        error: { code: 'uncertain', message: 'Executor disappeared after the durable execution marker', provenNoMutation: false }
      });
    }
    if (record.state === 'uncertain' && record.uncertaintyPhase !== 'compensate' && typeof descriptor.reconcile === 'function') {
      await this.#permit(descriptor, record.args, principal, 'reconcile', record);
      const proof = await descriptor.reconcile(cloneJSON(record.args), { requestId: id, principal, record: cloneJSON(record) });
      if (proof) record = await this.#change(record, 'resolved', { ...resultParts(proof, id, this.#now()), completedAt: this.#now(), error: null, uncertaintyPhase: null });
    }
    return this.#view(record, principal);
  }
  async retry(id, { principal } = {}) {
    let record = await this.#record(id);
    const descriptor = this.#descriptor(record.operation);
    await this.#permit(descriptor, record.args, principal, 'retry', record);
    if (record.state !== 'uncertain') throw new OperationError('conflict', 'Only uncertain execution can be considered for retry');
    if (record.uncertaintyPhase === 'compensate') throw new OperationError('uncertain', 'Interrupted compensation requires adapter-specific manual reconciliation');
    if (descriptor.idempotent !== true) throw new OperationError('uncertain', 'Blind retry is forbidden without an adapter idempotency guarantee');
    record = await this.#change(record, 'ready', { error: null, lease: null });
    return this.execute(id, { principal });
  }
  async cancel(id, { principal } = {}) {
    let record = await this.#record(id);
    await this.#permit(this.#descriptor(record.operation), record.args, principal, 'cancel', record);
    if (record.state === 'cancelled') return this.#view(record, principal);
    if (['prepared', 'waiting', 'ready'].includes(record.state)) record = await this.#change(record, 'cancelled', { error: { code: 'cancelled', message: 'Cancelled before execution', provenNoMutation: true } });
    else if (record.state === 'executing') {
      record = await this.#change(record, 'uncertain', {
        lease: null, fence: record.fence + 1, uncertaintyPhase: 'execute',
        error: { code: 'uncertain', message: 'Cancellation occurred during execution; mutation outcome requires reconciliation', provenNoMutation: false }
      });
      this.#controllers.get(id)?.abort();
    } else throw new OperationError('conflict', 'Completed or uncertain operation cannot be cancelled as if unapplied');
    return this.#view(record, principal);
  }
  async compensate(id, { principal } = {}) {
    const lifecycle = this.#lifecycleGeneration;
    let record = await this.#record(id);
    this.#assertLifecycle(lifecycle, true);
    const descriptor = this.#descriptor(record.operation);
    await this.#permit(descriptor, record.args, principal, 'compensate', record);
    this.#assertLifecycle(lifecycle, true);
    if (typeof descriptor.compensate !== 'function') throw new OperationError('unsupported', 'This adapter does not support compensation');
    if (!this.executorId) throw new OperationError('no-executor', 'No compensation executor is configured');
    if (record.state !== 'resolved') throw new OperationError('conflict', 'Only resolved operations support their declared compensation');
    const fence = record.fence + 1;
    record = await this.#change(record, 'compensating', { fence, lease: { owner: this.executorId, fence, expiresAt: this.#now() + this.leaseMs } });
    let compensationInvoked = false;
    const assertFence = async () => {
      this.#assertLifecycle(lifecycle, !compensationInvoked);
      const current = await this.#record(id);
      this.#assertLifecycle(lifecycle, !compensationInvoked);
      this.#assertOwned(current, 'compensating', fence);
      await this.#permit(descriptor, current.args, principal, 'compensate-commit', current);
      this.#assertLifecycle(lifecycle, !compensationInvoked);
      this.#assertOwned(await this.#record(id), 'compensating', fence);
      this.#assertLifecycle(lifecycle, !compensationInvoked);
    };
    try {
      await assertFence();
      this.#assertLifecycle(lifecycle, true);
      compensationInvoked = true;
      const compensation = await descriptor.compensate(cloneJSON(record.args), { principal, requestId: id, fence, assertFence, receipt: cloneJSON(record.receipt) });
      if (!compensation?.receipt) throw new OperationError('uncertain', 'Compensation did not return a receipt');
      await assertFence();
      const current = await this.#record(id);
      this.#assertOwned(current, 'compensating', fence);
      record = await this.#change(current, 'compensated', { compensation: cloneJSON(compensation), lease: null });
    } catch (error) {
      const current = await this.#record(id);
      if (current.state === 'compensating' && current.fence === fence) record = await this.#change(current, 'uncertain', { lease: null, fence: fence + 1, error: errorRecord(error), uncertaintyPhase: 'compensate' });
      else record = current;
    }
    return this.#view(record, principal);
  }
  /** Stops local waits; it does not manufacture a successful result or rollback. */
  dispose() {
    // Invalidate work still awaiting permission/store reads before controller registration.
    // A new call may use this engine again; old calls retain their stale generation.
    this.#lifecycleGeneration++;
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
  }
}
