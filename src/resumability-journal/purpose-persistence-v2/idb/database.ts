import { JournalStorageError, nativeErrorCode, type JournalStorageErrorCode } from './errors';

export const JOURNAL_DATABASE_NAME = 'liska-resumability-journal-v2';
export const JOURNAL_STORE_NAME = 'operations';
export const JOURNAL_DATABASE_VERSION = 1;

export interface JournalTimers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface JournalStoreOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  openTimeoutMs?: number;
  transactionTimeoutMs?: number;
  timers?: JournalTimers;
}

export interface DatabaseDependencies {
  indexedDB: IDBFactory | undefined;
  databaseName: string;
  openTimeoutMs: number;
  transactionTimeoutMs: number;
  timers: JournalTimers;
}

export interface JournalConnection {
  database: IDBDatabase;
  failure?: JournalStorageError;
  transactions: Map<IDBTransaction, (error: JournalStorageError) => void>;
}

const defaultTimers: JournalTimers = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 5000;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 30000) {
    throw new JournalStorageError('open-failed');
  }
  return value;
}

export function databaseDependencies(options: JournalStoreOptions): DatabaseDependencies {
  if (
    options.databaseName !== undefined &&
    options.databaseName !== JOURNAL_DATABASE_NAME &&
    !options.databaseName.startsWith(JOURNAL_DATABASE_NAME + '-')
  ) {
    throw new JournalStorageError('invalid-schema');
  }
  return {
    indexedDB: options.indexedDB ?? globalThis.indexedDB,
    databaseName: options.databaseName ?? JOURNAL_DATABASE_NAME,
    openTimeoutMs: boundedTimeout(options.openTimeoutMs),
    transactionTimeoutMs: boundedTimeout(options.transactionTimeoutMs),
    timers: options.timers ?? defaultTimers,
  };
}

export function closeConnection(
  connection: JournalConnection,
  code: JournalStorageErrorCode
): void {
  connection.failure ??= new JournalStorageError(code);
  for (const fail of connection.transactions.values()) fail(connection.failure);
  connection.database.close();
}

function hasExactSchema(database: IDBDatabase): boolean {
  if (database.version !== JOURNAL_DATABASE_VERSION) return false;
  if (
    database.objectStoreNames.length !== 1 ||
    !database.objectStoreNames.contains(JOURNAL_STORE_NAME)
  ) {
    return false;
  }
  const transaction = database.transaction(JOURNAL_STORE_NAME, 'readonly');
  const store = transaction.objectStore(JOURNAL_STORE_NAME);
  return store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0;
}

function upgradeSchema(
  request: IDBOpenDBRequest,
  oldVersion: number,
  alreadyFailed: boolean
): JournalStorageErrorCode | undefined {
  if (alreadyFailed || oldVersion !== 0 || request.result.objectStoreNames.length !== 0) {
    request.transaction?.abort();
    return 'invalid-schema';
  }
  try {
    request.result.createObjectStore(JOURNAL_STORE_NAME);
  } catch (error) {
    request.transaction?.abort();
    return nativeErrorCode(error, 'open-failed');
  }
}

function connectDatabase(database: IDBDatabase): JournalConnection {
  try {
    if (!hasExactSchema(database)) throw new JournalStorageError('invalid-schema');
  } catch {
    database.close();
    throw new JournalStorageError('invalid-schema');
  }
  const connection: JournalConnection = { database, transactions: new Map() };
  database.onversionchange = () => closeConnection(connection, 'version-changed');
  database.onclose = () => closeConnection(connection, 'closed');
  return connection;
}

/** An unsuccessful open is never followed by a late, silent schema creation. */
export function openDatabase(
  dependencies: DatabaseDependencies,
  registerCancel: (cancel: () => void) => void
): Promise<JournalConnection> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest | undefined;
    const finishError = (code: JournalStorageErrorCode) => {
      if (settled) return;
      settled = true;
      dependencies.timers.clearTimeout(timer);
      reject(new JournalStorageError(code));
    };
    const timer = dependencies.timers.setTimeout(
      () => finishError('open-timeout'),
      dependencies.openTimeoutMs
    );
    registerCancel(() => finishError('closed'));
    try {
      if (!dependencies.indexedDB) return finishError('unavailable');
      request = dependencies.indexedDB.open(dependencies.databaseName, JOURNAL_DATABASE_VERSION);
    } catch (error) {
      return finishError(nativeErrorCode(error, 'open-failed'));
    }
    request.onblocked = () => finishError('open-blocked');
    request.onerror = () => finishError(nativeErrorCode(request?.error, 'open-failed'));
    request.onupgradeneeded = event => {
      const failure = upgradeSchema(request!, event.oldVersion, settled);
      if (failure) finishError(failure);
    };
    request.onsuccess = () => {
      const database = request!.result;
      if (settled) return database.close();
      try {
        const connection = connectDatabase(database);
        settled = true;
        dependencies.timers.clearTimeout(timer);
        resolve(connection);
      } catch {
        finishError('invalid-schema');
      }
    };
  });
}
