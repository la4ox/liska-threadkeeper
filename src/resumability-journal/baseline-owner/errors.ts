export type OwnerStorageErrorCode =
  | 'invalid-schema'
  | 'unsupported-version'
  | 'unavailable'
  | 'open-failed'
  | 'open-timeout'
  | 'open-outcome-unknown'
  | 'open-blocked'
  | 'closed'
  | 'not-open'
  | 'version-changed'
  | 'transaction-aborted'
  | 'transaction-timeout'
  | 'transaction-outcome-unknown'
  | 'read-failed'
  | 'write-failed'
  | 'quota-exceeded'
  | 'corrupt-owner'
  | 'owner-exists'
  | 'owner-not-found'
  | 'revision-conflict'
  | 'recovery-required'
  | 'invalid-input'
  | 'catalog-mismatch'
  | 'candidate-unavailable'
  | 'unsupported-provider'
  | 'identity-exists'
  | 'headroom-exhausted';

export class OwnerStorageError extends Error {
  constructor(readonly code: OwnerStorageErrorCode) {
    super(code);
    this.name = 'OwnerStorageError';
  }
}
export function requireOwner(value: unknown, code: OwnerStorageErrorCode): asserts value {
  if (!value) throw new OwnerStorageError(code);
}
export function nativeErrorCode(
  error: unknown,
  fallback: OwnerStorageErrorCode
): OwnerStorageErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'quota-exceeded';
    if (error.name === 'VersionError') return 'unsupported-version';
    if (error.name === 'AbortError') return 'transaction-aborted';
  }
  return fallback;
}
export function transactionError(error: unknown, mode: IDBTransactionMode): Error {
  if (error instanceof OwnerStorageError) return error;
  return new OwnerStorageError(
    nativeErrorCode(error, mode === 'readonly' ? 'read-failed' : 'write-failed')
  );
}
