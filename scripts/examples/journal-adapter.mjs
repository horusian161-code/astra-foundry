import {OperationEngine, MemoryStore, OperationError} from '../sdk/index.mjs';
import {MemoryDomainRepository, hasEditorAccess, requireIdentifier, requireRecord, requireObjectKeys, domainReceipt} from './memory-domain-repository.mjs';

export const JOURNAL_DEMO_STATE = Object.freeze({
  dossier: {
    title: 'Досье: потерянный сигнал', editorIds: ['player-1'],
    stages: {
      arrival: {title: 'Входящий сигнал', text: 'Две проверки: связь или архив.', open: true,
        choices: [{id: 'radio', label: 'Проверить связь', opens: 'radio'}, {id: 'archive', label: 'Открыть архив', opens: 'archive'}]},
      radio: {title: 'Ответ оператора', text: 'Канал восстановлен. Оператор передаёт координаты.', open: false, choices: []},
      archive: {title: 'Архивное дело', text: 'Архивная запись связывает сигнал с исчезнувшей экспедицией.', open: false, choices: []}
    }, choices: {}
  }
});

function branch(state, args) {
  const stage = state.stages?.[args.stageId];
  if (!stage?.open) throw new OperationError('rights', 'The requested journal stage is not disclosed.', {provenNoMutation: true});
  const choice = stage.choices?.find(entry => entry.id === args.choiceId);
  if (!choice || !state.stages?.[choice.opens]) {
    throw new OperationError('missing-data', 'The journal choice or destination is missing.', {provenNoMutation: true});
  }
  const chosen = state.choices?.[args.stageId];
  if (chosen && chosen !== args.choiceId) {
    throw new OperationError('conflict', 'Another branch is already selected.', {provenNoMutation: true});
  }
  return {stage, choice, alreadyOpen: Boolean(chosen && state.stages[choice.opens].open)};
}

const signature = args => JSON.stringify(['journal.choose', args.journalId, args.stageId, args.choiceId]);

/** Project before serializing: unopened contents never enter a participant response. */
export function journalView(repository, journalId, principal) {
  const {state, version} = requireRecord(repository, journalId);
  if (!hasEditorAccess(state, principal)) return {journalId, title: state.title, accessible: false};
  const stages = Object.entries(state.stages).filter(([, stage]) => stage.open).map(([id, stage]) => ({
    id, title: stage.title, text: stage.text,
    choices: (stage.choices ?? []).map(choice => ({id: choice.id, label: choice.label})),
    chosen: state.choices?.[id] ?? null
  }));
  return {journalId, title: state.title, accessible: true, revision: version, stages};
}

export function createJournalDescriptors(repository) {
  return [{
    id: 'journal.choose', version: 1, idempotent: true,
    argsSchema: {type: 'object', required: ['journalId', 'stageId', 'choiceId'], additionalProperties: false,
      properties: {journalId: {type: 'string'}, stageId: {type: 'string'}, choiceId: {type: 'string'}}},
    resultSchema: {type: 'object', required: ['journalId', 'choiceId', 'openedStageId', 'alreadyOpen'],
      properties: {journalId: {type: 'string'}, choiceId: {type: 'string'}, openedStageId: {type: 'string'}, alreadyOpen: {type: 'boolean'}}},
    permissionDescription: 'Editor of this isolated journal, GM, or demo authority.',
    mutates: ['isolated-memory journal stages', 'domain receipt ledger'],
    compensation: null,
    reconcile(args, {requestId}) { return domainReceipt(repository, args.journalId, requestId, signature(args)); },
    validate(args) {
      requireObjectKeys(args, ['journalId', 'stageId', 'choiceId']);
      requireIdentifier(args?.journalId, 'journalId'); requireIdentifier(args?.stageId, 'stageId'); requireIdentifier(args?.choiceId, 'choiceId');
      return true;
    },
    permission(args, {principal}) { return hasEditorAccess(requireRecord(repository, args.journalId).state, principal); },
    preview(args) {
      const {state} = requireRecord(repository, args.journalId);
      const selected = branch(state, args);
      return {public: {journalId: args.journalId, stageId: args.stageId, choiceId: args.choiceId,
        choiceLabel: selected.choice.label, alreadyOpen: selected.alreadyOpen}, private: {}};
    },
    async execute(args, {requestId, principal, assertFence}) {
      return repository.commit(args.journalId, {
        requestId, signature: signature(args), assertFence,
        mutate(state) {
          if (!hasEditorAccess(state, principal)) throw new OperationError('rights', 'Journal editing access was removed.', {provenNoMutation: true});
          const selected = branch(state, args);
          state.choices ??= {};
          state.choices[args.stageId] = args.choiceId;
          state.stages[selected.choice.opens].open = true;
          return {public: {journalId: args.journalId, choiceId: args.choiceId, openedStageId: selected.choice.opens,
            alreadyOpen: selected.alreadyOpen}, changes: selected.alreadyOpen ? [] : [{type: 'stage-open', stageId: selected.choice.opens}]};
        }
      });
    }
  }];
}

export function createJournalDemo({repository = new MemoryDomainRepository(JOURNAL_DEMO_STATE), store = new MemoryStore(), executorId = 'journal-demo-authority'} = {}) {
  const descriptors = createJournalDescriptors(repository);
  return {repository, descriptors, engine: new OperationEngine({store, descriptors, executorId})};
}
