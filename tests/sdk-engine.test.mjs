import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationEngine, MemoryStore, OperationError, transitionRecord, canonicalPayload, projectOperation, validateRequestId } from '../scripts/sdk/index.mjs';

const owner = { id: 'player-1', role: 'player' };
const authority = { id: 'gm-1', role: 'gm' };
const stranger = { id: 'stranger', role: 'player' };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function makeDescriptor(extra = {}) {
  return {
    id: 'demo.change', validate: args => typeof args.amount === 'number' && args.amount > 0,
    permission: (_args, { principal }) => principal.id === owner.id || principal.role === 'gm',
    preview: args => ({ public: { amount: args.amount }, private: { secret: 42 } }),
    execute: async (args, { requestId, assertFence }) => {
      await assertFence();
      return { public: { changed: args.amount }, private: { internal: 'secret' }, receipt: { requestId, resourceVersion: 7 } };
    }, ...extra
  };
}
function makeEngine(extra = {}, options = {}) {
  return new OperationEngine({ store: new MemoryStore(), descriptors: [makeDescriptor(extra)], executorId: 'executor-1', ...options });
}
async function prepare(engine, requestId = 'request-1', principal = owner) {
  return engine.prepare({ operation: 'demo.change', args: { amount: 2 }, requestId, principal });
}

test('canonical request comparison is stable, bounded, exact, and rejects executable/non-JSON payloads', () => {
  assert.equal(canonicalPayload({ b: 2, a: [false, null, 1] }), canonicalPayload({ a: [false, null, 1], b: 2 }));
  assert.notEqual(canonicalPayload({ amount: 1 }), canonicalPayload({ amount: '1' }));
  for (const value of [undefined, NaN, Infinity, () => 1, new Date(), [1, , 3]]) assert.throws(() => canonicalPayload(value), error => error.code === 'invalid-input');
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => canonicalPayload(cycle), error => error.code === 'invalid-input');
  const getter = { get secret() { throw new Error('must not execute'); } };
  assert.throws(() => canonicalPayload(getter), error => error.code === 'invalid-input');
  const getterArray = [];
  Object.defineProperty(getterArray, '0', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => canonicalPayload(getterArray), error => error.code === 'invalid-input');
  assert.throws(() => canonicalPayload('x'.repeat(65537)), error => error.code === 'invalid-input');
  for (const id of ['', 'a'.repeat(129), '../escape', 'x\n']) assert.throws(() => validateRequestId(id));
});

test('same request and payload returns cached record; operation/payload/principal collisions are rejected', async () => {
  const engine = makeEngine();
  const first = await prepare(engine);
  assert.deepEqual(await prepare(engine), first);
  await assert.rejects(engine.prepare({ operation: 'demo.change', args: { amount: 3 }, requestId: 'request-1', principal: owner }), error => error.code === 'conflict');
  await assert.rejects(engine.prepare({ operation: 'demo.change', args: { amount: 2 }, requestId: 'request-1', principal: authority }), error => error.code === 'conflict');
  engine.register(makeDescriptor({ id: 'other.change' }));
  await assert.rejects(engine.prepare({ operation: 'other.change', args: { amount: 2 }, requestId: 'request-1', principal: owner }), error => error.code === 'conflict');
});

test('atomic create guards two simultaneous payloads with the same request ID', async () => {
  const engine = makeEngine();
  const result = await Promise.allSettled([1, 2].map(amount => engine.prepare({ operation: 'demo.change', args: { amount }, requestId: 'collision', principal: owner })));
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(result.find(item => item.status === 'rejected').reason.code, 'conflict');
});

test('repeated click joins a single execution and returns one receipt', async () => {
  let calls = 0;
  const gate = deferred();
  const entered = deferred();
  const engine = makeEngine({ execute: async (_args, { requestId, assertFence }) => {
    calls++; entered.resolve(); await gate.promise; await assertFence();
    return { public: { calls }, receipt: { requestId } };
  } });
  await prepare(engine);
  const first = engine.execute('request-1', { principal: owner });
  await entered.promise;
  const second = engine.execute('request-1', { principal: owner });
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1); assert.equal(a.state, 'resolved'); assert.deepEqual(a, b);
  assert.equal((await engine.execute('request-1', { principal: owner })).receipt.requestId, 'request-1');
  assert.equal(calls, 1);
});

test('inflight deduplication does not bypass a second principal permission check', async () => {
  const entered = deferred(), gate = deferred();
  const engine = makeEngine({ execute: async (_args, { requestId }) => { entered.resolve(); await gate.promise; return { public: { secretToOwner: 9 }, receipt: { requestId } }; } });
  await prepare(engine);
  const running = engine.execute('request-1', { principal: owner });
  await entered.promise;
  await assert.rejects(engine.execute('request-1', { principal: stranger }), error => error.code === 'rights');
  gate.resolve(); await running;
});

test('two engine clients sharing a store cannot concurrently invoke the executor', async () => {
  const store = new MemoryStore(), gate = deferred(), entered = deferred();
  let calls = 0;
  const descriptor = makeDescriptor({ execute: async (_args, { requestId, assertFence }) => { calls++; entered.resolve(); await gate.promise; await assertFence(); return { public: {}, receipt: { requestId } }; } });
  const first = new OperationEngine({ store, descriptors: [descriptor], executorId: 'first' });
  const second = new OperationEngine({ store, descriptors: [descriptor], executorId: 'second' });
  await prepare(first);
  const running = first.execute('request-1', { principal: owner });
  await entered.promise;
  await assert.rejects(second.execute('request-1', { principal: owner }), error => ['waiting', 'conflict'].includes(error.code));
  gate.resolve(); await running; assert.equal(calls, 1);
});

test('store CAS rejects stale versions and never mutates caller-owned snapshots', async () => {
  const engine = makeEngine(); await prepare(engine);
  const record = await engine.store.get('request-1');
  const next = transitionRecord(record, 'cancelled', {}, 3);
  assert.equal((await engine.store.compareAndSwap(record.id, record.version, next)).updated, true);
  assert.equal((await engine.store.compareAndSwap(record.id, record.version, next)).updated, false);
  next.args.amount = 999;
  assert.equal((await engine.store.get(record.id)).args.amount, 2);
  await assert.rejects(engine.store.compareAndSwap(record.id, 1, { ...next, version: 99 }), error => error.code === 'invalid-input');
});

test('reload before execution marker preserves ready state and executes normally', async () => {
  const store = new MemoryStore(); let calls = 0;
  const descriptor = makeDescriptor({ execute: async (_args, { requestId }) => { calls++; return { public: {}, receipt: { requestId } }; } });
  const initial = new OperationEngine({ store, descriptors: [descriptor], executorId: 'old' });
  await prepare(initial);
  const resumed = new OperationEngine({ store, descriptors: [descriptor], executorId: 'new' });
  assert.equal((await resumed.recover('request-1', { principal: owner })).state, 'ready');
  assert.equal((await resumed.execute('request-1', { principal: owner })).state, 'resolved');
  assert.equal(calls, 1);
});

test('reload after durable marker becomes uncertain and refuses blind retry', async () => {
  let now = 1000, calls = 0;
  const engine = makeEngine({ execute: async () => { calls++; } }, { clock: () => now });
  await prepare(engine);
  const ready = await engine.store.get('request-1');
  const interrupted = transitionRecord(ready, 'executing', { fence: 1, lease: { owner: 'dead-client', fence: 1, expiresAt: 2000 }, executionStartedAt: now }, now);
  await engine.store.compareAndSwap(ready.id, ready.version, interrupted);
  assert.equal((await engine.recover(ready.id, { principal: owner })).state, 'executing');
  now = 3000;
  assert.equal((await engine.recover(ready.id, { principal: owner })).state, 'uncertain');
  await assert.rejects(engine.execute(ready.id, { principal: owner }), error => error.code === 'uncertain');
  await assert.rejects(engine.retry(ready.id, { principal: owner }), error => error.code === 'uncertain');
  assert.equal(calls, 0);
});

test('receipt reconciliation recovers a committed result without re-executing the action', async () => {
  let calls = 0;
  const ledger = new Map();
  const engine = makeEngine({ execute: async (_args, { requestId }) => {
    calls++;
    ledger.set(requestId, { public: { appliedAmount: 2 }, receipt: { requestId, ledgerVersion: 1 } });
    throw new Error('client lost connection after domain commit');
  }, reconcile: async (_args, { requestId }) => ledger.get(requestId) || null });
  await prepare(engine);
  assert.equal((await engine.execute('request-1', { principal: owner })).state, 'uncertain');
  const recovered = await engine.recover('request-1', { principal: owner });
  assert.equal(recovered.state, 'resolved'); assert.equal(recovered.result.appliedAmount, 2); assert.equal(calls, 1);
});

test('explicit idempotent retry can use an atomic domain receipt ledger', async () => {
  let amount = 10, calls = 0, first = true;
  const receipts = new Map();
  const engine = makeEngine({ idempotent: true, execute: async (args, { requestId, assertFence }) => {
    calls++; await assertFence();
    if (!receipts.has(requestId)) { amount -= args.amount; receipts.set(requestId, { public: { amount }, receipt: { requestId } }); }
    if (first) { first = false; throw new Error('lost reply'); }
    return receipts.get(requestId);
  } });
  await prepare(engine);
  assert.equal((await engine.execute('request-1', { principal: owner })).state, 'uncertain');
  assert.equal((await engine.retry('request-1', { principal: owner })).state, 'resolved');
  assert.equal(calls, 2); assert.equal(amount, 8);
});

test('stale fencing token cannot commit after an expired lease is recovered', async () => {
  let now = 0, amount = 10;
  const entered = deferred(), gate = deferred();
  const store = new MemoryStore();
  const descriptor = makeDescriptor({ execute: async (args, { requestId, assertFence }) => {
    entered.resolve(); await gate.promise; await assertFence(); amount -= args.amount;
    return { public: { amount }, receipt: { requestId } };
  } });
  const first = new OperationEngine({ store, descriptors: [descriptor], executorId: 'old', clock: () => now, leaseMs: 1000 });
  const recovered = new OperationEngine({ store, descriptors: [descriptor], executorId: 'new', clock: () => now, leaseMs: 1000 });
  await prepare(first); const pending = first.execute('request-1', { principal: owner }); await entered.promise;
  now = 1001;
  assert.equal((await recovered.recover('request-1', { principal: owner })).state, 'uncertain');
  gate.resolve(); assert.equal((await pending).state, 'uncertain'); assert.equal(amount, 10);
});

test('long-running adapter can renew its own active lease without changing the fencing token', async () => {
  let now = 0;
  const engine = makeEngine({ execute: async (_args, { requestId, fence, renewLease, assertFence }) => {
    now = 800;
    assert.equal(await renewLease(), 1800);
    now = 1500;
    await assertFence();
    return { public: { fence }, receipt: { requestId } };
  } }, { clock: () => now, leaseMs: 1000 });
  await prepare(engine);
  const result = await engine.execute('request-1', { principal: owner });
  assert.equal(result.state, 'resolved'); assert.equal(result.result.fence, 1);
  assert.equal((await engine.store.get('request-1')).lease, null);
});

test('persistent decision deadline survives reload and expires without inventing a choice', async () => {
  let now = 50;
  const store = new MemoryStore(), descriptor = makeDescriptor({ decision: { options: ['evade', 'accept'], timeoutMs: 1000 } });
  const initial = new OperationEngine({ store, descriptors: [descriptor], executorId: 'old', clock: () => now });
  const first = await prepare(initial); assert.equal(first.decision.deadlineAt, 1050);
  now = 1050;
  const resumed = new OperationEngine({ store, descriptors: [descriptor], executorId: 'new', clock: () => now });
  const expired = await resumed.recover('request-1', { principal: owner });
  assert.equal(expired.state, 'expired'); assert.equal(expired.decision.choice, null);
  await assert.rejects(resumed.decide('request-1', { principal: owner, choice: 'accept' }), error => error.code === 'expired');
});

test('defense choice is validated, durable, and cannot be changed after acceptance', async () => {
  const engine = makeEngine({ decision: { options: ['evade', 'accept'], timeoutMs: 30000 } });
  assert.equal((await prepare(engine)).state, 'waiting');
  await assert.rejects(engine.execute('request-1', { principal: owner }), error => error.code === 'waiting');
  await assert.rejects(engine.decide('request-1', { principal: owner, choice: 'parry' }), error => error.code === 'invalid-input');
  assert.equal((await engine.decide('request-1', { principal: owner, choice: 'evade' })).state, 'ready');
  assert.equal((await engine.decide('request-1', { principal: owner, choice: 'evade' })).state, 'ready');
  await assert.rejects(engine.decide('request-1', { principal: owner, choice: 'accept' }), error => error.code === 'conflict');
});

test('public projections omit private records, args, leases, and pre-decision attack totals', async () => {
  const engine = makeEngine({
    decision: { options: ['evade', 'accept'], timeoutMs: 30000 },
    preview: () => ({ public: { weapon: 'pistol', attackTotal: 19, nested: { attack_roll: 17, private: { total: 9 } } }, private: { attackTotal: 19, dv: 15 } })
  });
  const waiting = await prepare(engine);
  const json = JSON.stringify(waiting);
  for (const secret of ['attackTotal', 'attack_roll', 'canonicalArgs', 'private', 'lease', 'executorId']) assert.equal(json.includes(secret), false);
  assert.equal(waiting.preview.weapon, 'pistol');
  await assert.rejects(engine.getAuthorityRecord('request-1', { principal: owner }), error => error.code === 'rights');
  assert.equal((await engine.getAuthorityRecord('request-1', { principal: authority })).preview.private.attackTotal, 19);
  const ready = await engine.decide('request-1', { principal: owner, choice: 'evade' });
  assert.equal(ready.preview.attackTotal, 19); assert.equal('private' in ready.preview.nested, false);
  assert.equal(JSON.stringify(projectOperation(await engine.store.get('request-1'), { audience: 'authority' })).includes('canonicalArgs'), false);
});

test('rights are reevaluated after preparation and immediately before a domain commit', async () => {
  let allowed = true, amount = 10;
  const entered = deferred(), gate = deferred();
  const engine = makeEngine({ permission: () => allowed, execute: async (args, { requestId, assertFence }) => {
    entered.resolve(); await gate.promise; await assertFence(); amount -= args.amount; return { public: { amount }, receipt: { requestId } };
  } });
  await prepare(engine); allowed = false;
  await assert.rejects(engine.execute('request-1', { principal: owner }), error => error.code === 'rights');
  allowed = true; const pending = engine.execute('request-1', { principal: owner }); await entered.promise;
  allowed = false; gate.resolve();
  assert.equal((await pending).state, 'uncertain'); assert.equal(amount, 10);
});

test('cancel before execution is terminal and leaves resources untouched', async () => {
  let calls = 0;
  const engine = makeEngine({ execute: async () => { calls++; } });
  await prepare(engine); assert.equal((await engine.cancel('request-1', { principal: owner })).state, 'cancelled');
  await assert.rejects(engine.execute('request-1', { principal: owner }), error => error.code === 'cancelled');
  assert.equal(calls, 0);
});

test('cancellation during execution aborts adapter cleanup and preserves uncertain outcome', async () => {
  const entered = deferred(); let cleanup = false;
  const engine = makeEngine({ execute: async (_args, { signal }) => {
    entered.resolve();
    try { await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new OperationError('cancelled', 'stop')), { once: true }); }); }
    finally { cleanup = true; }
  } });
  await prepare(engine); const pending = engine.execute('request-1', { principal: owner }); await entered.promise;
  assert.equal((await engine.cancel('request-1', { principal: owner })).state, 'uncertain');
  assert.equal((await pending).state, 'uncertain'); assert.equal(cleanup, true);
});

test('dispose aborts local adapter waits and does not claim rollback', async () => {
  const entered = deferred(); let cleanup = false;
  const engine = makeEngine({ execute: async (_args, { signal }) => {
    entered.resolve();
    try { await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('disposed')), { once: true })); }
    finally { cleanup = true; }
  } });
  await prepare(engine); const pending = engine.execute('request-1', { principal: owner }); await entered.promise;
  engine.dispose(); assert.equal((await pending).state, 'uncertain'); assert.equal(cleanup, true);
});

test('operation without a configured executor is denied without a marker or mutation', async () => {
  const engine = makeEngine({}, { executorId: null }); await prepare(engine);
  await assert.rejects(engine.execute('request-1', { principal: owner }), error => error.code === 'no-executor');
  assert.equal((await engine.store.get('request-1')).state, 'ready');
});

test('adapter-declared proven no-mutation failure is distinct from interrupted execution', async () => {
  const engine = makeEngine({ execute: async () => { throw new OperationError('missing-data', 'Empty magazine', { provenNoMutation: true }); } });
  await prepare(engine); const failed = await engine.execute('request-1', { principal: owner });
  assert.equal(failed.state, 'failed'); assert.equal(failed.error.code, 'missing-data');
});

test('receipt mismatch or missing receipt cannot manufacture a resolved result', async () => {
  for (const value of [{ public: { okay: true } }, { public: {}, receipt: { requestId: 'other' } }]) {
    const engine = makeEngine({ execute: async () => value }); await prepare(engine);
    assert.equal((await engine.execute('request-1', { principal: owner })).state, 'uncertain');
  }
});

test('unsupported universal compensation is denied; declared compensation has a separate state', async () => {
  const engine = makeEngine(); await prepare(engine); await engine.execute('request-1', { principal: owner });
  await assert.rejects(engine.compensate('request-1', { principal: owner }), error => error.code === 'unsupported');
  const reversible = makeEngine({ compensate: async (_args, { assertFence }) => { await assertFence(); return { public: { restored: true }, receipt: { compensationId: 'restore-1' } }; } });
  await prepare(reversible); await reversible.execute('request-1', { principal: owner });
  assert.equal((await reversible.compensate('request-1', { principal: owner })).state, 'compensated');
});

test('interrupted compensation cannot be mistaken for a retry of the original action', async () => {
  const engine = makeEngine({ idempotent: true, compensate: async () => { throw new Error('lost reply after compensation'); }, reconcile: async () => ({ public: {}, receipt: { requestId: 'request-1' } }) });
  await prepare(engine); await engine.execute('request-1', { principal: owner });
  assert.equal((await engine.compensate('request-1', { principal: owner })).state, 'uncertain');
  assert.equal((await engine.recover('request-1', { principal: owner })).state, 'uncertain');
  await assert.rejects(engine.retry('request-1', { principal: owner }), error => error.code === 'uncertain');
});

test('catalog declares actual supported operations and state machine rejects invented transitions', async () => {
  const engine = makeEngine();
  assert.deepEqual(engine.catalog()[0].supports, { validate: true, permission: true, preview: true, execute: true, reconcile: false, compensate: false });
  await prepare(engine); const record = await engine.store.get('request-1');
  assert.throws(() => transitionRecord(record, 'resolved'), error => error.code === 'conflict');
  assert.throws(() => transitionRecord({ ...record, schemaVersion: 999 }, 'executing'), error => error.code === 'unsupported');
});
