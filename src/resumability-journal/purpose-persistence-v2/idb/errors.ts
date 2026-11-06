import { PurposePersistenceError, type PersistenceErrorCode } from '../core/errors';
export { PurposePersistenceError as JournalStorageError } from '../core/errors';
export type JournalStorageErrorCode = PersistenceErrorCode;

export function nativeErrorCode(
  error: unknown,
  fallback: PersistenceErrorCode
): PersistenceErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'quota-exceeded';
    if (error.name === 'VersionError') return 'unsupported-version';
    if (error.name === 'AbortError') return 'transaction-aborted';
  }
  return fallback;
}
export function transactionError(error: unknown, mode: IDBTransactionMode): Error {
  if (error instanceof PurposePersistenceError) return error;
  return new PurposePersistenceError(
    nativeErrorCode(error, mode === 'readonly' ? 'read-failed' : 'write-failed')
  );
}
