import {
  closeConnection,
  databaseDependencies,
  openDatabase,
  type JournalConnection,
  type JournalStoreOptions,
} from './database';
import { JournalStorageError } from './errors';
import { journalOperations } from './operations';
import { journalTransaction, type JournalTransactionRunner } from './transaction';
import type { JournalStore } from './types';

export * from './errors';
export {
  JOURNAL_DATABASE_NAME,
  JOURNAL_DATABASE_VERSION,
  JOURNAL_STORE_NAME,
  JOURNAL_MAX_RUNS,
  JOURNAL_MAX_RECORD_BYTES,
  type JournalStoreOptions,
  type JournalTimers,
} from './database';
export type { JournalSummary } from './records';
export type { JournalStore, JournalReducer } from './types';

/** No database is opened and no recovery occurs until explicitly requested by the private page. */
export function createJournalStore(options: JournalStoreOptions = {}): JournalStore {
  const dependencies = databaseDependencies(options);
  let connection: JournalConnection | undefined;
  let opening: Promise<void> | undefined;
  let cancelOpen: (() => void) | undefined;
  const run: JournalTransactionRunner = (mode, action) => {
    try {
      if (!connection) throw new JournalStorageError('not-open');
      if (connection.failure) throw connection.failure;
      return journalTransaction(connection, dependencies, mode, action);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return {
    ...journalOperations(run),
    open() {
      if (opening) return opening;
      if (connection && !connection.failure) return Promise.resolve();
      opening = openDatabase(dependencies, cancel => {
        cancelOpen = cancel;
      })
        .then(value => {
          connection = value;
        })
        .finally(() => {
          opening = undefined;
          cancelOpen = undefined;
        });
      return opening;
    },
    close() {
      cancelOpen?.();
      if (connection) closeConnection(connection, 'closed');
    },
  };
}
