import { ResumabilityJournalError } from '../core';

export const JOURNAL_STORAGE_ERROR_CODES = [
  'unavailable',
  'not-open',
  'closed',
  'version-changed',
  'unsupported-version',
  'invalid-schema',
  'open-blocked',
  'open-failed',
  'open-timeout',
  'transaction-aborted',
  'transaction-timeout',
  'transaction-outcome-unknown',
  'read-failed',
  'write-failed',
  'quota-exceeded',
  'corrupt-record',
  'record-too-large',
  'run-exists',
  'run-limit',
  'run-not-found',
  'revision-conflict',
  'transition-failed',
] as const;

export type JournalStorageErrorCode = (typeof JOURNAL_STORAGE_ERROR_CODES)[number];

/** Native exception messages can contain private data and never cross this boundary. */
export class JournalStorageError extends Error {
  constructor(readonly code: JournalStorageErrorCode) {
    super(code);
    this.name = 'JournalStorageError';
  }
}

export function nativeErrorCode(
  error: unknown,
  fallback: JournalStorageErrorCode
): JournalStorageErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'quota-exceeded';
    if (error.name === 'VersionError') return 'unsupported-version';
    if (error.name === 'AbortError') return 'transaction-aborted';
  }
  return fallback;
}
export function transitionError(error: unknown): Error {
  if (error instanceof JournalStorageError || error instanceof ResumabilityJournalError)
    return error;
  return new JournalStorageError('transition-failed');
}

export function transactionError(error: unknown, mode: IDBTransactionMode): Error {
  if (error instanceof DOMException) {
    return new JournalStorageError(
      nativeErrorCode(error, mode === 'readonly' ? 'read-failed' : 'write-failed')
    );
  }
  return transitionError(error);
}
