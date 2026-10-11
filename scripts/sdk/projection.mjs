import { cloneJSON } from './canonical.mjs';

const SECRET_KEYS = new Set(['attacktotal', 'attackroll', 'rawroll', 'secretdv', 'targetdv', 'hiddenresult']);
function safePublic(value, revealed) {
  if (Array.isArray(value)) return value.map(item => safePublic(item, revealed));
  if (!value || typeof value !== 'object') return value;
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (key === 'private' || key === 'args' || key === 'canonicalArgs' || key === 'executorId' || key === 'lease') continue;
    if (!revealed && SECRET_KEYS.has(key.replace(/[_-]/g, '').toLowerCase())) continue;
    result[key] = safePublic(item, revealed);
  }
  return result;
}

/** Pure participant projection. Never contains arguments, private payloads, or execution lease. */
export function projectOperation(record, { audience = 'participant', principalId = null } = {}) {
  if (!record) return null;
  const decided = record.decision?.choice != null;
  const revealed = decided || !record.decision?.required;
  const projection = {
    id: record.id, operation: record.operation, schemaVersion: record.schemaVersion,
    version: record.version, state: record.state, createdAt: record.createdAt, updatedAt: record.updatedAt,
    deadlineAt: record.deadlineAt,
    preview: safePublic(record.preview?.public || {}, revealed),
    decision: record.decision ? {
      required: record.decision.required, options: record.decision.options,
      choice: record.decision.choice, deadlineAt: record.decision.deadlineAt
    } : null,
    result: record.result ? safePublic(record.result.public || {}, revealed) : null,
    // Adapter receipts can contain privileged document IDs or resource values. Public receipt is an allowlist.
    receipt: record.receipt ? { requestId: record.id, applied: true, at: record.receipt.at ?? record.updatedAt } : null,
    error: record.error ? { code: record.error.code } : null,
    audience, isRequester: principalId === record.requesterId
  };
  return cloneJSON(projection);
}
