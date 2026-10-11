import test from 'node:test';
import assert from 'node:assert/strict';
import { OperationService, OperationEngine, MemoryStore, OperationError } from '../scripts/sdk/index.mjs';

const owner = { id: 'owner-1', role: 'player' };
const stranger = { id: 'other-1', role: 'player' };
const authority = { id: 'gm-1', role: 'gm' };

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function fixture({ descriptor = {}, resolver, executorId = 'demo-authority' } = {}) {
  let principal = { ...owner };
  let resolveCalls = 0;
  let executions = 0;
  const seen = [];
  const engine = new OperationEngine({
    store: new MemoryStore(), executorId,
    descriptors: [{
      id: 'demo.change',
      argsSchema: { type: 'object', required: ['amount'] },
      validate: args => Object.keys(args).length === 1 && Number.isInteger(args.amount) && args.amount > 0,
      permission: (_args, { principal, stage }) => {
        seen.push({ stage, id: principal.id, role: principal.role });
        return principal.id === owner.id || principal.role === 'gm';
      },
      preview: args => ({ public: { amount: args.amount }, private: { attackTotal: 19, internalToken: 'server-secret' } }),
      execute: async (args, { requestId, assertFence }) => {
        await assertFence(); executions++;
        return { public: { amount: args.amount }, private: { token: 'server-secret' }, receipt: { requestId, privateDocumentId: 'secret-document' } };
      },
      ...descriptor
    }]
  });
  const service = new OperationService({ engine, resolvePrincipal: async () => {
    resolveCalls++;
    return resolver ? resolver() : principal;
  } });
  return {
    service, engine, seen,
    select: value => { principal = value; },
    resolveCalls: () => resolveCalls,
    executions: () => executions
  };
}
const request = { requestId: 'request-1', operation: 'demo.change', args: { amount: 2 } };

test('service constructor requires an engine and a trusted resolver', () => {
  assert.throws(() => new OperationService(), error => error.code === 'invalid-input');
  assert.throws(() => new OperationService({ engine: {}, resolvePrincipal: () => owner }), error => error.code === 'invalid-input');
  assert.throws(() => new OperationService({ engine: new OperationEngine() }), error => error.code === 'invalid-input');
});

test('all public methods reject caller identity, role, rights, executor and audience fields', async () => {
  const { service, resolveCalls } = fixture();
  const inputs = {
    catalog: {}, prepare: request,
    decide: { requestId: request.requestId, choice: 'accept' },
    execute: { requestId: request.requestId }, get: { requestId: request.requestId },
    recover: { requestId: request.requestId }, cancel: { requestId: request.requestId }
  };
  for (const [method, payload] of Object.entries(inputs)) {
    for (const [key, value] of Object.entries({ principal: authority, role: 'gm', userId: 'gm-1', rights: true, executor: 'gm-1', executorId: 'gm-1', audience: 'authority', trusted: true })) {
      await assert.rejects(service[method]({ ...payload, [key]: value }), error => error.code === 'invalid-input' && !Object.keys(error.details).length);
    }
  }
  assert.equal(resolveCalls(), 0);
});

test('intake validates missing, extra, oversized, accessor and non-JSON values without executing getters', async () => {
  const { service, resolveCalls } = fixture();
  const getter = { ...request };
  let read = false;
  Object.defineProperty(getter, 'role', { get() { read = true; return 'gm'; }, enumerable: true });
  await assert.rejects(service.prepare(getter), error => error.code === 'invalid-input');
  const requiredAccessor = { operation: 'demo.change', args: { amount: 2 } };
  Object.defineProperty(requiredAccessor, 'requestId', { get() { read = true; return 'request-1'; }, enumerable: true });
  await assert.rejects(service.prepare(requiredAccessor), error => error.code === 'invalid-input');
  assert.equal(read, false);
  for (const input of [null, [], request.requestId, Object.create({ role: 'gm' }), { ...request, requestId: 'x'.repeat(129) }, { ...request, operation: '../unsafe' }, { operation: 'demo.change', args: {} }, { ...request, args: { amount: NaN } }, { ...request, args: () => 1 }, { ...request, [Symbol('role')]: 'gm' }]) {
    await assert.rejects(service.prepare(input), error => error.code === 'invalid-input');
  }
  await assert.rejects(service.decide({ requestId: 'request-1', choice: 'x'.repeat(65) }), error => error.code === 'invalid-input');
  await assert.rejects(service.decide({ requestId: 'request-1', choice: 'accept\n' }), error => error.code === 'invalid-input');
  await assert.rejects(service.execute({ requestId: 'request-1', args: {} }), error => error.code === 'invalid-input');
  assert.equal(resolveCalls(), 0);
});

test('each valid public call resolves a new trusted principal without passing caller context', async () => {
  let calls = 0;
  const { service } = fixture({ resolver: (...args) => { assert.equal(args.length, 0); calls++; return owner; } });
  await service.catalog();
  await service.prepare(request);
  await service.get({ requestId: request.requestId });
  await service.recover({ requestId: request.requestId });
  await service.execute({ requestId: request.requestId });
  assert.equal(calls, 5);
});

test('a changed current principal is rechecked for get, execute, recover, cancel and decide', async () => {
  const setup = fixture({ descriptor: { decision: { options: ['accept', 'evade'], timeoutMs: 30000 } } });
  await setup.service.prepare(request);
  setup.select(stranger);
  for (const method of ['get', 'execute', 'recover', 'cancel']) {
    await assert.rejects(setup.service[method]({ requestId: request.requestId }), error => error.code === 'rights');
  }
  await assert.rejects(setup.service.decide({ requestId: request.requestId, choice: 'accept' }), error => error.code === 'rights');
  assert.equal(setup.executions(), 0);
  setup.select(owner);
  assert.equal((await setup.service.decide({ requestId: request.requestId, choice: 'accept' })).state, 'ready');
  assert.equal((await setup.service.execute({ requestId: request.requestId })).state, 'resolved');
  assert.ok(setup.seen.some(call => call.stage === 'commit' && call.id === owner.id));
});

test('caller args do not supply identity and remain subject to the operation validator', async () => {
  const { service, select, executions } = fixture();
  select(stranger);
  await assert.rejects(service.prepare({ ...request, args: { amount: 2, role: 'gm', userId: owner.id, rights: true } }), error => error.code === 'rights');
  select(owner);
  await assert.rejects(service.prepare({ ...request, args: { amount: 2, role: 'gm' } }), error => error.code === 'invalid-input');
  assert.equal(executions(), 0);
});

test('resolver identity is snapshotted and invalid or failing resolvers deny operation access', async () => {
  for (const value of [null, {}, { id: '' }, { id: 'x'.repeat(129) }, { id: 'a', role: () => 'gm' }]) {
    const { service } = fixture({ resolver: () => value });
    await assert.rejects(service.catalog(), error => error.code === 'rights');
  }
  const { service } = fixture({ resolver: () => { throw new Error('secret access token'); } });
  await assert.rejects(service.prepare(request), error => error.code === 'rights' && !error.message.includes('secret') && !Object.keys(error.details).length);
});

test('duplicate request returns cached result; changed args or principal cannot reuse it', async () => {
  const setup = fixture();
  const ready = await setup.service.prepare(request);
  assert.deepEqual(await setup.service.prepare(request), ready);
  await assert.rejects(setup.service.prepare({ ...request, args: { amount: 3 } }), error => error.code === 'conflict');
  const applied = await setup.service.execute({ requestId: request.requestId });
  assert.deepEqual(await setup.service.execute({ requestId: request.requestId }), applied);
  assert.equal(setup.executions(), 1);
  setup.select(authority);
  await assert.rejects(setup.service.prepare(request), error => error.code === 'conflict');
});

test('an unauthorized concurrent caller cannot join the owner execution through the service', async () => {
  const entered = deferred(), gate = deferred();
  const setup = fixture({ descriptor: { execute: async (_args, { requestId, assertFence }) => {
    entered.resolve(); await gate.promise; await assertFence(); return { public: { okay: true }, receipt: { requestId } };
  } } });
  await setup.service.prepare(request);
  const running = setup.service.execute({ requestId: request.requestId });
  await entered.promise;
  setup.select(stranger);
  await assert.rejects(setup.service.execute({ requestId: request.requestId }), error => error.code === 'rights');
  setup.select(owner); gate.resolve();
  assert.equal((await running).state, 'resolved');
});

test('unsupported operations and missing records return explicit errors', async () => {
  const { service } = fixture();
  await assert.rejects(service.prepare({ ...request, operation: 'unknown.operation' }), error => error.code === 'unsupported');
  await assert.rejects(service.get({ requestId: 'absent' }), error => error.code === 'missing-data');
});

test('no executor denies execution and preserves ready state', async () => {
  const { service, engine, executions } = fixture({ executorId: null });
  await service.prepare(request);
  await assert.rejects(service.execute({ requestId: request.requestId }), error => error.code === 'no-executor');
  assert.equal((await engine.store.get(request.requestId)).state, 'ready');
  assert.equal(executions(), 0);
});

test('service returns participant projections only and exposes no private authority method or raw engine', async () => {
  const { service, engine } = fixture({ descriptor: { decision: { options: ['accept'], timeoutMs: 30000 } } });
  const waiting = await service.prepare(request);
  const forbidden = ['args', 'canonicalArgs', 'private', 'lease', 'executorId', 'server-secret', 'attackTotal', 'secret-document'];
  for (const value of forbidden) assert.equal(JSON.stringify(waiting).includes(value), false);
  assert.equal(service.getAuthorityRecord, undefined);
  assert.equal(service.engine, undefined); assert.equal(service.store, undefined); assert.equal(service.resolvePrincipal, undefined);
  await service.decide({ requestId: request.requestId, choice: 'accept' });
  const resolved = await service.execute({ requestId: request.requestId });
  for (const value of forbidden) assert.equal(JSON.stringify(resolved).includes(value), false);
  assert.equal(resolved.receipt.requestId, request.requestId);
  resolved.result.amount = 999;
  assert.equal((await service.get({ requestId: request.requestId })).result.amount, 2);
  assert.equal((await engine.getAuthorityRecord(request.requestId, { principal: authority })).result.private.token, 'server-secret');
});

test('service does not expose arbitrary adapter error details or unknown error codes', async () => {
  for (const thrown of [new OperationError('missing-data', 'Private target HP 42', { private: 'secret' }), Object.assign(new Error('Secret socket payload'), { code: 'invented-error' })]) {
    const { service } = fixture({ descriptor: { validate: () => { throw thrown; } } });
    await assert.rejects(service.prepare(request), error =>
      error instanceof OperationError && ['missing-data', 'uncertain'].includes(error.code) && !/Private|Secret/.test(error.message) && !Object.keys(error.details).length);
  }
});

test('error sanitizer never invokes untrusted code accessors or propagates failing Proxy reflection', async () => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'code', { get() { getterCalls++; throw new Error('SECRET-42'); } });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('SECRET-PROXY'); } });
  for (const thrown of [accessor, proxy]) {
    const { service } = fixture({ descriptor: { validate: () => { throw thrown; } } });
    await assert.rejects(service.prepare(request), error => error instanceof OperationError && error.code === 'uncertain' && !error.message.includes('SECRET'));
  }
  assert.equal(getterCalls, 0);
});

test('cancel before executing preserves terminal state through the public boundary', async () => {
  const { service, executions } = fixture();
  await service.prepare(request);
  assert.equal((await service.cancel({ requestId: request.requestId })).state, 'cancelled');
  await assert.rejects(service.execute({ requestId: request.requestId }), error => error.code === 'cancelled');
  assert.equal(executions(), 0);
});

test('disposal is idempotent and no later public call resolves an identity or executes work', async () => {
  const { service, resolveCalls, executions } = fixture();
  await service.prepare(request);
  const before = resolveCalls();
  service.dispose(); service.dispose();
  const calls = {
    catalog: {}, prepare: request,
    get: { requestId: request.requestId }, recover: { requestId: request.requestId },
    execute: { requestId: request.requestId }, cancel: { requestId: request.requestId },
    decide: { requestId: request.requestId, choice: 'accept' }
  };
  for (const [method, input] of Object.entries(calls)) await assert.rejects(service[method](input), error => error.code === 'cancelled');
  assert.equal(resolveCalls(), before); assert.equal(executions(), 0);
});

test('disposal during identity resolution cannot start an operation after the await', async () => {
  const gate = deferred();
  const setup = fixture({ resolver: () => gate.promise });
  const preparing = setup.service.prepare(request);
  setup.service.dispose(); gate.resolve(owner);
  await assert.rejects(preparing, error => error.code === 'cancelled');
  assert.equal(await setup.engine.store.get(request.requestId), null);
});

test('dispose during execute permission cannot start a later domain mutation before a controller exists', async () => {
  const entered = deferred(), gate = deferred(); let writes = 0;
  const setup = fixture({ descriptor: {
    permission: async (_args, { stage }) => {
      if (stage === 'execute') { entered.resolve(); await gate.promise; }
      return true;
    },
    execute: async (_args, { requestId, assertFence }) => { await assertFence(); writes++; return { public: { writes }, receipt: { requestId } }; }
  } });
  await setup.service.prepare(request);
  const running = setup.service.execute({ requestId: request.requestId });
  await entered.promise; setup.service.dispose(); gate.resolve();
  await assert.rejects(running, error => error.code === 'cancelled');
  assert.equal(writes, 0);
  assert.equal((await setup.engine.store.get(request.requestId)).state, 'ready');
  // A new binding can reopen the engine; the earlier generation remains cancelled.
  const reopened = new OperationService({ engine: setup.engine, resolvePrincipal: () => owner });
  assert.equal((await reopened.execute({ requestId: request.requestId })).state, 'resolved');
  assert.equal(writes, 1);
});

test('dispose after executing marker but before adapter entry records proven no-mutation failure', async () => {
  const entered = deferred(), gate = deferred(); let writes = 0;
  const setup = fixture({ descriptor: {
    permission: async (_args, { stage }) => {
      if (stage === 'commit') { entered.resolve(); await gate.promise; }
      return true;
    },
    execute: async (_args, { requestId }) => { writes++; return { public: { writes }, receipt: { requestId } }; }
  } });
  await setup.service.prepare(request);
  const running = setup.service.execute({ requestId: request.requestId });
  await entered.promise;
  assert.equal((await setup.engine.store.get(request.requestId)).state, 'executing');
  setup.service.dispose(); gate.resolve();
  await assert.rejects(running, error => error.code === 'cancelled');
  assert.equal(writes, 0);
  const record = await setup.engine.store.get(request.requestId);
  assert.equal(record.state, 'failed'); assert.equal(record.error.provenNoMutation, true);
});

test('dispose during compensation permission cannot run a new compensation adapter', async () => {
  const entered = deferred(), gate = deferred(); let restores = 0;
  const setup = fixture({ descriptor: {
    permission: async (_args, { stage }) => {
      if (stage === 'compensate') { entered.resolve(); await gate.promise; }
      return true;
    },
    compensate: async (_args, { assertFence }) => { await assertFence(); restores++; return { receipt: { compensationId: 'restore-1' } }; }
  } });
  await setup.service.prepare(request); await setup.service.execute({ requestId: request.requestId });
  const running = setup.engine.compensate(request.requestId, { principal: owner });
  await entered.promise; setup.service.dispose(); gate.resolve();
  await assert.rejects(running, error => error.code === 'cancelled');
  assert.equal(restores, 0);
  assert.equal((await setup.engine.store.get(request.requestId)).state, 'resolved');
});

test('disposal aborts active adapter waits without manufacturing rollback or success', async () => {
  const entered = deferred(); let cleaned = false;
  const setup = fixture({ descriptor: { execute: async (_args, { signal }) => {
    entered.resolve();
    try { await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('local abort')), { once: true })); }
    finally { cleaned = true; }
  } } });
  await setup.service.prepare(request);
  const running = setup.service.execute({ requestId: request.requestId });
  await entered.promise; setup.service.dispose();
  await assert.rejects(running, error => error.code === 'cancelled');
  assert.equal(cleaned, true);
  assert.equal((await setup.engine.store.get(request.requestId)).state, 'uncertain');
});
