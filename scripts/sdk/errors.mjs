export const ERROR_CODES = Object.freeze([
  'invalid-input', 'missing-data', 'rights', 'waiting', 'conflict', 'uncertain',
  'cancelled', 'expired', 'no-executor', 'unsupported'
]);

export class OperationError extends Error {
  constructor(code, message, details = {}) {
    if (!ERROR_CODES.includes(code)) throw new TypeError(`Unknown operation error code: ${code}`);
    super(message);
    this.name = 'OperationError';
    this.code = code;
    this.details = details;
  }
}

export function errorRecord(error) {
  return {
    code: ERROR_CODES.includes(error?.code) ? error.code : 'uncertain',
    message: String(error?.message || 'Execution failed'),
    // Stack traces and arbitrary adapter error objects may contain secrets.
    provenNoMutation: error?.details?.provenNoMutation === true
  };
}
