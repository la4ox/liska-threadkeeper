export type ProviderOwnerStorageErrorCode =
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

export class ProviderOwnerStorageError extends Error {
  constructor(readonly code: ProviderOwnerStorageErrorCode) {
    super(code);
    this.name = 'ProviderOwnerStorageError';
  }
}

export function requireOwner(value: unknown, code: ProviderOwnerStorageErrorCode): asserts value {
  if (!value) throw new ProviderOwnerStorageError(code);
}

export function nativeErrorCode(
  error: unknown,
  fallback: ProviderOwnerStorageErrorCode
): ProviderOwnerStorageErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'quota-exceeded';
    if (error.name === 'VersionError') return 'unsupported-version';
    if (error.name === 'AbortError') return 'transaction-aborted';
  }
  return fallback;
}

export function transactionError(error: unknown, mode: IDBTransactionMode): Error {
  if (error instanceof ProviderOwnerStorageError) return error;
  return new ProviderOwnerStorageError(
    nativeErrorCode(error, mode === 'readonly' ? 'read-failed' : 'write-failed')
  );
}
