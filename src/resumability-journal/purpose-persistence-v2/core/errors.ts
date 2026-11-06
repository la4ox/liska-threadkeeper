export type PersistenceErrorCode =
  | 'unavailable'
  | 'not-open'
  | 'closed'
  | 'version-changed'
  | 'unsupported-version'
  | 'invalid-schema'
  | 'open-blocked'
  | 'open-failed'
  | 'open-timeout'
  | 'transaction-aborted'
  | 'transaction-timeout'
  | 'transaction-outcome-unknown'
  | 'read-failed'
  | 'write-failed'
  | 'quota-exceeded'
  | 'corrupt-record'
  | 'record-too-large'
  | 'identity-exists'
  | 'record-limit'
  | 'operation-not-found'
  | 'revision-conflict'
  | 'transition-failed'
  | 'invalid-receipts';

/** Fixed codes only; native/private exception text never crosses this boundary. */
export class PurposePersistenceError extends Error {
  constructor(readonly code: PersistenceErrorCode) {
    super(code);
    this.name = 'PurposePersistenceError';
  }
}

export function requireCondition(
  value: unknown,
  code: PersistenceErrorCode = 'corrupt-record'
): asserts value {
  if (!value) throw new PurposePersistenceError(code);
}
