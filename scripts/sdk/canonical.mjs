import { OperationError } from './errors.mjs';

export function validateRequestId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) {
    throw new OperationError('invalid-input', 'Request ID must be 1–128 ASCII identifier characters');
  }
  return value;
}

// Exact canonical comparison, rather than a weak/non-cryptographic hash.
export function canonicalPayload(value, { maxLength = 65536, maxDepth = 32, maxNodes = 8192 } = {}) {
  const ancestors = new Set();
  let nodes = 0;
  function encode(item, depth) {
    if (++nodes > maxNodes) throw new OperationError('invalid-input', 'Payload has too many values');
    if (depth > maxDepth) throw new OperationError('invalid-input', 'Payload is too deeply nested');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object') throw new OperationError('invalid-input', 'Payload must contain only finite JSON values');
    if (ancestors.has(item)) throw new OperationError('invalid-input', 'Cyclic payload is unsupported');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      throw new OperationError('invalid-input', 'Payload must contain only plain objects and arrays');
    }
    if (Object.getOwnPropertySymbols(item).length) throw new OperationError('invalid-input', 'Symbol payload keys are unsupported');
    ancestors.add(item);
    let text;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new OperationError('invalid-input', 'Sparse or decorated arrays are unsupported');
      const values = [];
      for (let index = 0; index < item.length; index++) {
        const field = Object.getOwnPropertyDescriptor(item, String(index));
        if (!field || !('value' in field)) throw new OperationError('invalid-input', 'Payload accessors are unsupported');
        values.push(encode(field.value, depth + 1));
      }
      text = `[${values.join(',')}]`;
    } else {
      text = `{${Object.keys(item).sort().map(key => {
        const field = Object.getOwnPropertyDescriptor(item, key);
        if (!field || !('value' in field)) throw new OperationError('invalid-input', 'Payload accessors are unsupported');
        return `${JSON.stringify(key)}:${encode(field.value, depth + 1)}`;
      }).join(',')}}`;
    }
    ancestors.delete(item);
    if (text.length > maxLength) throw new OperationError('invalid-input', 'Payload is too large');
    return text;
  }
  const result = encode(value, 0);
  if (result.length > maxLength) throw new OperationError('invalid-input', 'Payload is too large');
  return result;
}

export function cloneJSON(value) {
  // Records contain arguments, their canonical copy, previews and receipts.
  return JSON.parse(canonicalPayload(value, { maxLength: 1048576, maxDepth: 64, maxNodes: 32768 }));
}
