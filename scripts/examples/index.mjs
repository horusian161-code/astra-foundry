import {OperationEngine, MemoryStore} from '../sdk/index.mjs';
import {MemoryDomainRepository} from './memory-domain-repository.mjs';
import {JOURNAL_DEMO_STATE, createJournalDescriptors, journalView} from './journal-adapter.mjs';
import {BASE_DEMO_STATE, createBaseDescriptors, baseView} from './base-adapter.mjs';

export {MemoryDomainRepository, createJournalDescriptors, createBaseDescriptors, journalView, baseView};

/** One operation engine and one local domain store, used by two unrelated modules. */
export function createReusableDemo({repository = new MemoryDomainRepository({...JOURNAL_DEMO_STATE, ...BASE_DEMO_STATE}), store = new MemoryStore(), executorId = 'reuse-demo-authority'} = {}) {
  const descriptors = [...createJournalDescriptors(repository), ...createBaseDescriptors(repository)];
  return {repository, descriptors, engine: new OperationEngine({store, descriptors, executorId})};
}
