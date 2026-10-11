import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationEngine, MemoryStore, OperationError} from '../scripts/sdk/index.mjs';
import {MemoryDomainRepository} from '../scripts/examples/memory-domain-repository.mjs';
import {createJournalDemo, JOURNAL_DEMO_STATE, journalView} from '../scripts/examples/journal-adapter.mjs';
import {createBaseDemo, BASE_DEMO_STATE, baseView} from '../scripts/examples/base-adapter.mjs';
import {createReusableDemo} from '../scripts/examples/index.mjs';

const owner = {id: 'player-1', role: 'player'};
const stranger = {id: 'outsider', role: 'player'};
const second = {id: 'player-2', role: 'player'};
const choose = {journalId: 'dossier', stageId: 'arrival', choiceId: 'radio'};
const reserve = {baseId: 'workshop', reservationId: 'repair-1', resourceId: 'parts', quantity: 2, projectId: 'antenna', steps: 2};
const finish = {baseId: 'workshop', reservationId: 'repair-1'};
const prepare = (engine, operation, args, requestId, principal = owner) => engine.prepare({operation, args, requestId, principal});
const run = async (engine, operation, args, requestId, principal = owner) => {
  await prepare(engine, operation, args, requestId, principal);
  return engine.execute(requestId, {principal});
};

test('journal and base register typed operations in the SAME generic engine/catalog', () => {
  const journal = createJournalDemo(); const base = createBaseDemo();
  assert.ok(journal.engine instanceof OperationEngine);
  assert.ok(base.engine instanceof OperationEngine);
  assert.deepEqual(journal.engine.catalog().map(entry => entry.id), ['journal.choose']);
  assert.deepEqual(base.engine.catalog().map(entry => entry.id), ['base.reserve', 'base.commit', 'base.release']);
  for (const entry of [...journal.engine.catalog(), ...base.engine.catalog()]) {
    assert.equal(entry.idempotentExecution, true);
    assert.equal(entry.argsSchema.additionalProperties, false);
    assert.equal(entry.supports.permission, true);
    assert.equal(entry.supports.execute, true);
    assert.equal(entry.supports.compensate, false);
  }
});

test('one shared engine executes unrelated journal and base actions without a combat dependency', async () => {
  const {engine, repository} = createReusableDemo();
  assert.equal(engine.catalog().length, 4);
  await run(engine, 'journal.choose', choose, 'shared-journal');
  await run(engine, 'base.reserve', reserve, 'shared-base-reserve');
  await run(engine, 'base.commit', finish, 'shared-base-commit');
  assert.equal(journalView(repository, 'dossier', owner).stages.length, 2);
  assert.equal(baseView(repository, 'workshop', owner).resources.parts.quantity, 3);
});

test('journal preview is pure and does not serialize undisclosed destination text', async () => {
  const {engine, repository} = createJournalDemo();
  const before = repository.read('dossier');
  const prepared = await prepare(engine, 'journal.choose', choose, 'journal-preview');
  assert.equal(prepared.state, 'ready');
  assert.deepEqual(repository.read('dossier'), before);
  const response = JSON.stringify({prepared, view: journalView(repository, 'dossier', owner)});
  assert.equal(response.includes(JOURNAL_DEMO_STATE.dossier.stages.radio.text), false);
  assert.equal(response.includes(JOURNAL_DEMO_STATE.dossier.stages.archive.text), false);
  assert.equal(response.includes('canonicalArgs'), false);
});

test('journal retries reuse request records and never reopen a stage twice', async () => {
  const store = new MemoryStore();
  const demo = createJournalDemo({store});
  const first = await run(demo.engine, 'journal.choose', choose, 'journal-once');
  assert.equal(first.state, 'resolved');
  assert.equal(first.result.openedStageId, 'radio');
  const revision = demo.repository.read('dossier').version;
  const rebuilt = createJournalDemo({repository: demo.repository, store}).engine;
  const retry = await rebuilt.execute('journal-once', {principal: owner});
  assert.deepEqual(retry.receipt, first.receipt);
  assert.equal(demo.repository.read('dossier').version, revision);
  const fresh = await run(rebuilt, 'journal.choose', choose, 'journal-same-choice');
  assert.equal(fresh.result.alreadyOpen, true);
  assert.deepEqual(demo.repository.read('dossier').ledger['journal-same-choice'].result.receipt.changes, []);
});

test('journal request ID collision and incompatible branch preserve chosen state', async () => {
  const {engine, repository} = createJournalDemo();
  await run(engine, 'journal.choose', choose, 'journal-branch');
  await assert.rejects(prepare(engine, 'journal.choose', {...choose, choiceId: 'archive'}, 'journal-branch'), {code: 'conflict'});
  await assert.rejects(prepare(engine, 'journal.choose', {...choose, choiceId: 'archive'}, 'journal-other'), {code: 'conflict'});
  assert.equal(repository.read('dossier').state.stages.archive.open, false);
  assert.equal(repository.read('dossier').state.choices.arrival, 'radio');
});

test('journal denies noneditor mutation and projects no stage contents to them', async () => {
  const {engine, repository} = createJournalDemo();
  await assert.rejects(prepare(engine, 'journal.choose', choose, 'journal-rights', stranger), {code: 'rights'});
  assert.deepEqual(journalView(repository, 'dossier', stranger), {journalId: 'dossier', title: JOURNAL_DEMO_STATE.dossier.title, accessible: false});
  assert.equal(repository.read('dossier').version, 0);
});

test('example argument validators reject unknown fields and invalid quantity', async () => {
  const journal = createJournalDemo(); const base = createBaseDemo();
  await assert.rejects(prepare(journal.engine, 'journal.choose', {...choose, rawSecret: 42}, 'journal-invalid'), {code: 'invalid-input'});
  await assert.rejects(prepare(base.engine, 'base.reserve', {...reserve, quantity: 1.5}, 'base-invalid'), {code: 'invalid-input'});
  assert.equal(base.repository.read('workshop').version, 0);
});

test('base preparation and reservation do not spend; commit records one spend and clock delta', async () => {
  const {engine, repository} = createBaseDemo();
  const prepared = await prepare(engine, 'base.reserve', reserve, 'base-hold');
  assert.equal(prepared.preview.spendsNow, 0);
  assert.equal(repository.read('workshop').version, 0);
  const held = await engine.execute('base-hold', {principal: owner});
  assert.equal(held.result.status, 'held');
  assert.equal(repository.read('workshop').state.resources.parts.quantity, 5);
  const result = await run(engine, 'base.commit', finish, 'base-commit');
  assert.equal(result.state, 'resolved');
  assert.equal(result.result.spent, 2);
  assert.equal(result.result.remaining, 3);
  assert.equal(result.result.progress, 2);
  assert.equal(result.result.segments, 4);
  assert.equal(repository.read('workshop').ledger['base-commit'].result.receipt.changes.length, 2);
  assert.equal(baseView(repository, 'workshop', owner).resources.parts.quantity, 3);
});

test('same request retry and NEW request for an already committed reservation cannot spend twice', async () => {
  const {engine, repository} = createBaseDemo();
  await run(engine, 'base.reserve', reserve, 'base-reserve-once');
  const first = await run(engine, 'base.commit', finish, 'base-commit-once');
  const revision = repository.read('workshop').version;
  const retry = await engine.execute('base-commit-once', {principal: owner});
  assert.deepEqual(retry.result, first.result);
  assert.equal(repository.read('workshop').version, revision);
  const again = await run(engine, 'base.commit', finish, 'base-new-commit');
  assert.equal(again.result.alreadyCommitted, true);
  assert.equal(again.result.spent, 0);
  assert.equal(again.result.originalSpent, 2);
  assert.equal(repository.read('workshop').state.resources.parts.quantity, 3);
  assert.equal(repository.read('workshop').state.projects.antenna.progress, 2);
});

test('base collision keeps the original reservation arguments', async () => {
  const {engine, repository} = createBaseDemo();
  await run(engine, 'base.reserve', reserve, 'base-request-collision');
  await assert.rejects(prepare(engine, 'base.reserve', {...reserve, quantity: 4}, 'base-request-collision'), {code: 'conflict'});
  assert.equal(repository.read('workshop').state.reservations['repair-1'].quantity, 2);
});

test('concurrent local reservations cannot overbook the shared stock or progress clock', async () => {
  const {engine, repository} = createBaseDemo();
  const first = {...reserve, reservationId: 'a', quantity: 4, steps: 3};
  const other = {...reserve, reservationId: 'b', quantity: 4, steps: 3};
  await prepare(engine, 'base.reserve', first, 'base-concurrent-a');
  await prepare(engine, 'base.reserve', other, 'base-concurrent-b');
  const results = await Promise.all([
    engine.execute('base-concurrent-a', {principal: owner}), engine.execute('base-concurrent-b', {principal: owner})
  ]);
  assert.deepEqual(results.map(value => value.state).sort(), ['failed', 'resolved']);
  assert.equal(results.find(value => value.state === 'failed').error.code, 'conflict');
  const state = repository.read('workshop').state;
  assert.equal(Object.keys(state.reservations).length, 1);
  assert.equal(state.resources.parts.quantity, 5);
  assert.equal(state.projects.antenna.progress, 0);
});

test('unknown resource or clock value fails with missing-data instead of assuming zero', async () => {
  for (const unknown of ['resource', 'clock']) {
    const state = structuredClone(BASE_DEMO_STATE);
    if (unknown === 'resource') state.workshop.resources.parts.quantity = null;
    else state.workshop.projects.antenna.progress = null;
    const repository = new MemoryDomainRepository(state);
    const {engine} = createBaseDemo({repository});
    await assert.rejects(prepare(engine, 'base.reserve', reserve, `base-unknown-${unknown}`), {code: 'missing-data'});
    assert.equal(repository.read('workshop').version, 0);
    assert.equal(Object.keys(repository.read('workshop').ledger).length, 0);
  }
});

test('base noneditor and another editor cannot resolve a private reservation', async () => {
  const state = structuredClone(BASE_DEMO_STATE); state.workshop.editorIds.push(second.id);
  const repository = new MemoryDomainRepository(state);
  const {engine} = createBaseDemo({repository});
  await assert.rejects(prepare(engine, 'base.reserve', reserve, 'base-outsider', stranger), {code: 'rights'});
  await run(engine, 'base.reserve', reserve, 'base-owner-hold');
  await assert.rejects(prepare(engine, 'base.commit', finish, 'base-other-editor', second), {code: 'rights'});
  await assert.rejects(prepare(engine, 'base.release', finish, 'base-other-release', second), {code: 'rights'});
  assert.equal(repository.read('workshop').state.resources.parts.quantity, 5);
  assert.equal(baseView(repository, 'workshop', stranger).accessible, false);
});

test('commit revalidates changed stock and does not invent a negative balance', async () => {
  const {engine, repository} = createBaseDemo();
  await run(engine, 'base.reserve', reserve, 'base-held-before-change');
  await prepare(engine, 'base.commit', finish, 'base-stale-commit');
  const changed = repository.read('workshop');
  changed.state.resources.parts.quantity = 1;
  assert.equal(repository.compareAndSwap('workshop', changed.version, {...changed, version: changed.version + 1}), true);
  const result = await engine.execute('base-stale-commit', {principal: owner});
  assert.equal(result.state, 'failed');
  assert.equal(result.error.code, 'conflict');
  assert.equal(repository.read('workshop').state.resources.parts.quantity, 1);
  assert.equal(repository.read('workshop').state.projects.antenna.progress, 0);
  assert.equal(repository.read('workshop').state.reservations['repair-1'].status, 'held');
});

test('release frees an uncommitted reservation without changing stock and cannot undo spent work', async () => {
  const {engine, repository} = createBaseDemo();
  await run(engine, 'base.reserve', reserve, 'base-to-release');
  await run(engine, 'base.release', finish, 'base-release');
  const revision = repository.read('workshop').version;
  await engine.execute('base-release', {principal: owner});
  assert.equal(repository.read('workshop').version, revision);
  assert.equal(repository.read('workshop').state.resources.parts.quantity, 5);
  await assert.rejects(prepare(engine, 'base.commit', finish, 'base-after-release'), {code: 'conflict'});
  const next = {...reserve, reservationId: 'repair-2', quantity: 5, steps: 4};
  await run(engine, 'base.reserve', next, 'base-new-hold');
  await run(engine, 'base.commit', {baseId: 'workshop', reservationId: 'repair-2'}, 'base-spent');
  await assert.rejects(prepare(engine, 'base.release', {baseId: 'workshop', reservationId: 'repair-2'}, 'base-no-undo'), {code: 'conflict'});
});

test('domain fence failure cannot create a resource delta or a receipt', async () => {
  const repository = new MemoryDomainRepository(BASE_DEMO_STATE);
  await assert.rejects(repository.commit('workshop', {
    requestId: 'domain-stale-fence', signature: 'test',
    assertFence() { throw new OperationError('conflict', 'Stale executor'); },
    mutate(state) { state.resources.parts.quantity = 0; return {public: {}, changes: []}; }
  }), {code: 'conflict'});
  assert.equal(repository.read('workshop').version, 0);
  assert.equal(repository.read('workshop').state.resources.parts.quantity, 5);
  assert.deepEqual(repository.read('workshop').ledger, {});
});

test('an unauthorized concurrent caller cannot join the authorized in-flight result', async () => {
  const demo = createJournalDemo();
  let allowCommit;
  const pause = new Promise(resolve => { allowCommit = resolve; });
  let signalExecution;
  const executing = new Promise(resolve => { signalExecution = resolve; });
  const descriptors = demo.descriptors.map(descriptor => ({...descriptor,
    async execute(args, context) { signalExecution(); await pause; return descriptor.execute(args, context); }
  }));
  const engine = new OperationEngine({store: new MemoryStore(), descriptors, executorId: 'reuse-security-test'});
  await prepare(engine, 'journal.choose', choose, 'journal-shared-inflight');
  const ownerResult = engine.execute('journal-shared-inflight', {principal: owner});
  await executing;
  await assert.rejects(engine.execute('journal-shared-inflight', {principal: stranger}), {code: 'rights'});
  allowCommit();
  assert.equal((await ownerResult).state, 'resolved');
});

test('a receipt survives the commit-to-workflow gap and reconciles without another spend', async () => {
  const demo = createBaseDemo();
  const descriptors = demo.descriptors.map(descriptor => descriptor.id !== 'base.commit' ? descriptor : ({
    ...descriptor,
    async execute(args, context) {
      await descriptor.execute(args, context);
      throw new Error('Simulated process loss after local domain commit, before workflow receipt');
    }
  }));
  const engine = new OperationEngine({store: new MemoryStore(), descriptors, executorId: 'reuse-gap-test'});
  await run(engine, 'base.reserve', reserve, 'base-gap-hold');
  const uncertain = await run(engine, 'base.commit', finish, 'base-gap-commit');
  assert.equal(uncertain.state, 'uncertain');
  assert.equal(demo.repository.read('workshop').state.resources.parts.quantity, 3);
  const revision = demo.repository.read('workshop').version;
  const recovered = await engine.recover('base-gap-commit', {principal: owner});
  assert.equal(recovered.state, 'resolved');
  assert.equal(recovered.result.spent, 2);
  assert.equal(demo.repository.read('workshop').state.resources.parts.quantity, 3);
  assert.equal(demo.repository.read('workshop').version, revision);
});
