import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationEngine, MemoryStore} from '../scripts/sdk/index.mjs';
import {MemoryDemoLedger} from '../scripts/demo/ledger.mjs';
import {createDemoAttackDescriptor} from '../scripts/demo/attack-operation.mjs';
import {renderWorkflowPanel, workflowPhaseForOperation} from '../scripts/ui/workflow-render.mjs';

const principal = {id: 'demo-user', role: 'player'};
const initialArgs = () => ({
  namespace: 'review-encounter', attackerId: 'proxy', attackerName: 'Прокси',
  targetId: 'guard', targetName: 'Исходная охрана', weaponId: 'rifle',
  weaponName: 'Исходная винтовка', rangeDV: 17, dvSource: 'review-range'
});
const engineFor = ledger => new OperationEngine({
  store: new MemoryStore(), executorId: 'review-authority',
  descriptors: [createDemoAttackDescriptor({ledger})]
});
async function ready(engine, args, requestId, choice = 'accept') {
  await engine.prepare({operation: 'demo.redline.attack', args, requestId, principal});
  return engine.decide(requestId, {choice, principal});
}

test('independent R1: empty domain outcome stays uncertain and cannot render a miss or applied receipt', async () => {
  const ledger = new MemoryDemoLedger();
  await ledger.load('review-encounter', {ammo: 0, targetHP: 40, targetSP: 11});
  const engine = engineFor(ledger);
  await ready(engine, initialArgs(), 'review-empty-outcome');
  const operation = await engine.execute('review-empty-outcome', {principal});
  assert.equal(operation.state, 'uncertain');
  assert.equal(operation.receipt, null);
  assert.equal(operation.result, null);
  assert.equal(workflowPhaseForOperation(operation), 'recovery');
  const html = renderWorkflowPanel({phase: 'result', operation, isGM: false});
  assert.doesNotMatch(html, /ПРОМАХ|ПОПАДАНИЕ|Применено один раз/);
  assert.match(html, /Сверка и восстановление/);
  assert.equal(await ledger.receipt('review-empty-outcome'), null);
});

test('independent R1: completed label without receipt cannot manufacture an applied UI result', () => {
  const operation = {id: 'review-false-completion', state: 'resolved',
    result: {hit: false, attackTotal: 17, dv: 17}, receipt: null};
  assert.equal(workflowPhaseForOperation(operation), 'recovery');
  assert.doesNotMatch(renderWorkflowPanel({phase: 'result', operation}), /ПРОМАХ|Применено один раз/);
});

test('independent R2: a different defense with identical numerical result cannot adopt an old receipt', async () => {
  const ledger = new MemoryDemoLedger();
  const first = engineFor(ledger), args = initialArgs();
  await ready(first, args, 'review-choice-collision', 'accept');
  const original = await first.execute('review-choice-collision', {principal});
  assert.equal(original.result.dv, 17);
  const resourcesBefore = await ledger.load(args.namespace);

  // Same request and range DV; both branches produce DV 17. Matching numbers
  // therefore cannot prove that a different recorded decision was executed.
  const restoredStore = engineFor(ledger);
  await ready(restoredStore, args, 'review-choice-collision', 'evade');
  assert.equal((await restoredStore.execute('review-choice-collision', {principal})).state, 'uncertain');
  assert.equal((await restoredStore.recover('review-choice-collision', {principal})).state, 'uncertain');
  assert.deepEqual(await ledger.load(args.namespace), resourcesBefore);
});

test('independent R3: saved participant snapshots survive caller mutation and a new selected character', async () => {
  const ledger = new MemoryDemoLedger(), engine = engineFor(ledger), args = initialArgs();
  const operation = await engine.prepare({operation: 'demo.redline.attack', args,
    requestId: 'review-participant-snapshot', principal});
  args.attackerName = 'Новое имя вызывающей формы';
  args.targetName = 'Подставленная цель';
  args.weaponName = 'Подставленное оружие';
  const html = renderWorkflowPanel({phase: 'defense', operation, selected: {name: 'Нана'},
    target: {name: 'Другая выбранная цель'}, weapon: {name: 'Другой выбранный пистолет'}});
  for (const expected of ['Прокси', 'Исходная охрана', 'Исходная винтовка']) assert.ok(html.includes(expected));
  assert.doesNotMatch(html, /Новое имя вызывающей формы|Подставленная цель|Подставленное оружие|Другая выбранная цель|Другой выбранный пистолет|Нана/);
  const persisted = await engine.publicView('review-participant-snapshot', {principal});
  assert.equal(persisted.preview.attackerName, 'Прокси');
  assert.equal(persisted.preview.targetName, 'Исходная охрана');
  assert.equal(persisted.state, 'waiting');
  assert.equal(persisted.result, null);
});
