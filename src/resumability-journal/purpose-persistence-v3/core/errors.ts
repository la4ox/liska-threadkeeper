export type PersistenceErrorCode =
  | 'corrupt-record'
  | 'record-too-large'
  | 'invalid-receipts'
  | 'read-failed'
  | 'revision-conflict'
  | 'transition-failed';

/** Fixed pure-contract codes; native/private exception text never crosses this boundary. */
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
