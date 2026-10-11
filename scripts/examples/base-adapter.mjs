import {OperationEngine, MemoryStore, OperationError} from '../sdk/index.mjs';
import {MemoryDomainRepository, hasEditorAccess, requireIdentifier, requirePositiveInteger, requireRecord, knownNonnegative, requireObjectKeys, domainReceipt} from './memory-domain-repository.mjs';

export const BASE_DEMO_STATE = Object.freeze({
  workshop: {title: 'База «Маяк»', editorIds: ['player-1'], resources: {parts: {label: 'Запчасти', quantity: 5}},
    projects: {antenna: {label: 'Восстановить антенну', progress: 0, segments: 4}}, reservations: {}}
});

const noChangeError = (code, message) => new OperationError(code, message, {provenNoMutation: true});
const reserveSignature = args => JSON.stringify(['base.reserve', args.baseId, args.reservationId, args.resourceId, args.quantity, args.projectId, args.steps]);
const commitSignature = args => JSON.stringify(['base.commit', args.baseId, args.reservationId]);
const releaseSignature = args => JSON.stringify(['base.release', args.baseId, args.reservationId]);

function assertAvailable(state, args) {
  const resource = state.resources?.[args.resourceId];
  const project = state.projects?.[args.projectId];
  const quantity = knownNonnegative(resource?.quantity, 'Resource quantity');
  const progress = knownNonnegative(project?.progress, 'Project progress');
  const segments = knownNonnegative(project?.segments, 'Project size');
  const held = Object.values(state.reservations ?? {}).filter(reservation => reservation.status === 'held');
  const reserved = held.filter(reservation => reservation.resourceId === args.resourceId).reduce((sum, reservation) => sum + reservation.quantity, 0);
  const reservedSteps = held.filter(reservation => reservation.projectId === args.projectId).reduce((sum, reservation) => sum + reservation.steps, 0);
  if (quantity - reserved < args.quantity) throw noChangeError('conflict', 'Insufficient unreserved resources.');
  if (progress + reservedSteps + args.steps > segments) throw noChangeError('conflict', 'The reserved work exceeds the remaining project.');
  return {resource, project, quantity, progress, segments, reserved, reservedSteps};
}

function heldReservation(state, args, principal) {
  const reservation = state.reservations?.[args.reservationId];
  if (!reservation) throw noChangeError('missing-data', 'Reservation is missing.');
  if (reservation.ownerId !== principal.id && !['gm', 'authority'].includes(principal.role)) {
    throw noChangeError('rights', 'Only the reservation owner or GM can resolve it.');
  }
  return reservation;
}

function validateBase(args) { requireIdentifier(args?.baseId, 'baseId'); requireIdentifier(args?.reservationId, 'reservationId'); return true; }
function permission(repository, args, {principal}) { return hasEditorAccess(requireRecord(repository, args.baseId).state, principal); }

export function baseView(repository, baseId, principal) {
  const {state, version} = requireRecord(repository, baseId);
  if (!hasEditorAccess(state, principal)) return {baseId, title: state.title, accessible: false};
  return {baseId, title: state.title, accessible: true, revision: version,
    resources: structuredClone(state.resources), projects: structuredClone(state.projects),
    reservations: Object.entries(state.reservations).map(([id, reservation]) => ({id, ...structuredClone(reservation)}))};
}

export function createBaseDescriptors(repository) {
  const common = {
    version: 1, idempotent: true, permissionDescription: 'Editor of this isolated base, GM, or demo authority; reservation resolves by its owner.',
    mutates: ['isolated-memory resource/project state', 'domain receipt ledger'], compensation: null,
    permission: (args, context) => permission(repository, args, context)
  };
  const reserve = {
    ...common, id: 'base.reserve',
    resultSchema: {type: 'object', required: ['reservationId', 'status', 'spendsNow'], properties: {reservationId: {type: 'string'}, status: {const: 'held'}, spendsNow: {const: 0}}},
    reconcile(args, {requestId}) { return domainReceipt(repository, args.baseId, requestId, reserveSignature(args)); },
    argsSchema: {type: 'object', required: ['baseId', 'reservationId', 'resourceId', 'quantity', 'projectId', 'steps'], additionalProperties: false,
      properties: {baseId: {type: 'string'}, reservationId: {type: 'string'}, resourceId: {type: 'string'}, quantity: {type: 'integer', minimum: 1}, projectId: {type: 'string'}, steps: {type: 'integer', minimum: 1}}},
    validate(args) { requireObjectKeys(args, ['baseId', 'reservationId', 'resourceId', 'quantity', 'projectId', 'steps']); validateBase(args); requireIdentifier(args.resourceId, 'resourceId'); requireIdentifier(args.projectId, 'projectId'); requirePositiveInteger(args.quantity, 'quantity'); requirePositiveInteger(args.steps, 'steps'); return true; },
    preview(args) {
      const {state} = requireRecord(repository, args.baseId);
      if (state.reservations?.[args.reservationId]) throw noChangeError('conflict', 'Reservation ID is already in use.');
      const available = assertAvailable(state, args);
      return {public: {baseId: args.baseId, reservationId: args.reservationId, resourceId: args.resourceId,
        available: available.quantity - available.reserved, reservedQuantity: args.quantity, steps: args.steps,
        spendsNow: 0}, private: {}};
    },
    execute(args, {requestId, principal, assertFence}) {
      return repository.commit(args.baseId, {requestId,
        signature: reserveSignature(args), assertFence,
        mutate(state) {
          if (!hasEditorAccess(state, principal)) throw noChangeError('rights', 'Base editing access was removed.');
          if (state.reservations?.[args.reservationId]) throw noChangeError('conflict', 'Reservation ID is already in use.');
          assertAvailable(state, args);
          state.reservations ??= {};
          state.reservations[args.reservationId] = {status: 'held', ownerId: principal.id,
            resourceId: args.resourceId, quantity: args.quantity, projectId: args.projectId, steps: args.steps};
          return {public: {reservationId: args.reservationId, status: 'held', spendsNow: 0}, changes: [{type: 'resource-reservation', reservationId: args.reservationId, quantity: args.quantity}]};
        }});
    }
  };
  const commit = {
    ...common, id: 'base.commit',
    resultSchema: {type: 'object', required: ['reservationId', 'status', 'alreadyCommitted', 'spent'], properties: {reservationId: {type: 'string'}, status: {const: 'committed'}, alreadyCommitted: {type: 'boolean'}, spent: {type: 'integer', minimum: 0}}},
    reconcile(args, {requestId}) { return domainReceipt(repository, args.baseId, requestId, commitSignature(args)); },
    argsSchema: {type: 'object', required: ['baseId', 'reservationId'], additionalProperties: false,
      properties: {baseId: {type: 'string'}, reservationId: {type: 'string'}}},
    validate(args) { requireObjectKeys(args, ['baseId', 'reservationId']); return validateBase(args); },
    preview(args, {principal}) {
      const {state} = requireRecord(repository, args.baseId);
      const reservation = heldReservation(state, args, principal);
      if (reservation.status === 'released') throw noChangeError('conflict', 'Released resources cannot be committed.');
      let expectedRemaining = null;
      let expectedProgress = null;
      if (reservation.status === 'held') {
        const quantity = knownNonnegative(state.resources?.[reservation.resourceId]?.quantity, 'Resource quantity');
        const progress = knownNonnegative(state.projects?.[reservation.projectId]?.progress, 'Project progress');
        const segments = knownNonnegative(state.projects?.[reservation.projectId]?.segments, 'Project size');
        if (quantity < reservation.quantity || progress + reservation.steps > segments) {
          throw noChangeError('conflict', 'The reserved resources or project changed; manual review is required.');
        }
        expectedRemaining = quantity - reservation.quantity;
        expectedProgress = progress + reservation.steps;
      }
      return {public: {reservationId: args.reservationId, status: reservation.status,
        resourceId: reservation.resourceId, expectedSpend: reservation.status === 'committed' ? 0 : reservation.quantity,
        expectedRemaining, expectedProgress, steps: reservation.steps}, private: {}};
    },
    execute(args, {requestId, principal, assertFence}) {
      return repository.commit(args.baseId, {requestId, signature: commitSignature(args), assertFence,
        mutate(state) {
          if (!hasEditorAccess(state, principal)) throw noChangeError('rights', 'Base editing access was removed.');
          const reservation = heldReservation(state, args, principal);
          if (reservation.status === 'released') throw noChangeError('conflict', 'Released resources cannot be committed.');
          if (reservation.status === 'committed') return {public: {reservationId: args.reservationId, status: 'committed', alreadyCommitted: true, spent: 0, originalSpent: reservation.quantity}, changes: []};
          const resource = state.resources?.[reservation.resourceId];
          const project = state.projects?.[reservation.projectId];
          const quantity = knownNonnegative(resource?.quantity, 'Resource quantity');
          const progress = knownNonnegative(project?.progress, 'Project progress');
          const segments = knownNonnegative(project?.segments, 'Project size');
          if (quantity < reservation.quantity || progress + reservation.steps > segments) {
            throw noChangeError('conflict', 'The reserved resources or project changed; manual review is required.');
          }
          resource.quantity = quantity - reservation.quantity;
          project.progress = progress + reservation.steps;
          reservation.status = 'committed';
          return {public: {reservationId: args.reservationId, status: 'committed', alreadyCommitted: false,
            spent: reservation.quantity, remaining: resource.quantity, progress: project.progress, segments},
          changes: [{type: 'resource-spend', resourceId: reservation.resourceId, from: quantity, to: resource.quantity},
            {type: 'clock-advance', projectId: reservation.projectId, from: progress, to: project.progress}]};
        }});
    }
  };
  const release = {
    ...common, id: 'base.release', argsSchema: commit.argsSchema, validate: commit.validate,
    resultSchema: {type: 'object', required: ['reservationId', 'status', 'alreadyReleased', 'spent'], properties: {reservationId: {type: 'string'}, status: {const: 'released'}, alreadyReleased: {type: 'boolean'}, spent: {const: 0}}},
    reconcile(args, {requestId}) { return domainReceipt(repository, args.baseId, requestId, releaseSignature(args)); },
    preview(args, {principal}) {
      const reservation = heldReservation(requireRecord(repository, args.baseId).state, args, principal);
      if (reservation.status === 'committed') throw noChangeError('conflict', 'Committed work has no generic undo.');
      return {public: {reservationId: args.reservationId, status: reservation.status, releases: reservation.quantity}, private: {}};
    },
    execute(args, {requestId, principal, assertFence}) {
      return repository.commit(args.baseId, {requestId, signature: releaseSignature(args), assertFence,
        mutate(state) {
          if (!hasEditorAccess(state, principal)) throw noChangeError('rights', 'Base editing access was removed.');
          const reservation = heldReservation(state, args, principal);
          if (reservation.status === 'committed') throw noChangeError('conflict', 'Committed work has no generic undo.');
          const alreadyReleased = reservation.status === 'released';
          reservation.status = 'released';
          return {public: {reservationId: args.reservationId, status: 'released', alreadyReleased, spent: 0},
            changes: alreadyReleased ? [] : [{type: 'resource-release', reservationId: args.reservationId, quantity: reservation.quantity}]};
        }});
    }
  };
  return [reserve, commit, release];
}

export function createBaseDemo({repository = new MemoryDomainRepository(BASE_DEMO_STATE), store = new MemoryStore(), executorId = 'base-demo-authority'} = {}) {
  const descriptors = createBaseDescriptors(repository);
  return {repository, descriptors, engine: new OperationEngine({store, descriptors, executorId})};
}
