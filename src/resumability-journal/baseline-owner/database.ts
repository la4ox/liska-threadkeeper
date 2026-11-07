import { OwnerStorageError, nativeErrorCode, type OwnerStorageErrorCode } from './errors';

export const OWNER_DATABASE_NAME = 'liska-baseline-owner-v1';
export const OWNER_STORE_NAME = 'owner';
export const OPERATIONS_STORE_NAME = 'operations';
export const OWNER_KEY = 'baseline';
export const OWNER_DATABASE_VERSION = 1;

export interface OwnerTimers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OwnerStoreOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  openTimeoutMs?: number;
  transactionTimeoutMs?: number;
  timers?: OwnerTimers;
}

export interface DatabaseDependencies {
  indexedDB: IDBFactory | undefined;
  databaseName: string;
  openTimeoutMs: number;
  transactionTimeoutMs: number;
  timers: OwnerTimers;
}

export interface OwnerConnection {
  database: IDBDatabase;
  failure?: OwnerStorageError;
  mutationUnknown?: boolean;
  transactions: Map<IDBTransaction, (error: OwnerStorageError) => void>;
}

const defaultTimers: OwnerTimers = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 5000;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 30000) {
    throw new OwnerStorageError('open-failed');
  }
  return value;
}

export function databaseDependencies(options: OwnerStoreOptions): DatabaseDependencies {
  if (
    options.databaseName !== undefined &&
    options.databaseName !== OWNER_DATABASE_NAME &&
    !options.databaseName.startsWith(OWNER_DATABASE_NAME + '-')
  ) {
    throw new OwnerStorageError('invalid-schema');
  }
  return {
    indexedDB: options.indexedDB ?? globalThis.indexedDB,
    databaseName: options.databaseName ?? OWNER_DATABASE_NAME,
    openTimeoutMs: boundedTimeout(options.openTimeoutMs),
    transactionTimeoutMs: boundedTimeout(options.transactionTimeoutMs),
    timers: options.timers
      ? {
          setTimeout: options.timers.setTimeout.bind(options.timers),
          clearTimeout: options.timers.clearTimeout.bind(options.timers),
        }
      : defaultTimers,
  };
}

export function closeConnection(connection: OwnerConnection, code: OwnerStorageErrorCode): void {
  connection.failure ??= new OwnerStorageError(code);
  for (const fail of connection.transactions.values()) fail(connection.failure);
  connection.database.close();
}

function hasExactSchema(database: IDBDatabase): boolean {
  if (database.version !== OWNER_DATABASE_VERSION) return false;
  if (
    database.objectStoreNames.length !== 2 ||
    !database.objectStoreNames.contains(OWNER_STORE_NAME) ||
    !database.objectStoreNames.contains(OPERATIONS_STORE_NAME)
  ) {
    return false;
  }
  const transaction = database.transaction([OWNER_STORE_NAME, OPERATIONS_STORE_NAME], 'readonly');
  return [OWNER_STORE_NAME, OPERATIONS_STORE_NAME].every(name => {
    const store = transaction.objectStore(name);
    return store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0;
  });
}

function upgradeSchema(
  request: IDBOpenDBRequest,
  oldVersion: number
): OwnerStorageErrorCode | undefined {
  if (oldVersion !== 0 || request.result.objectStoreNames.length !== 0) {
    return 'invalid-schema';
  }
  try {
    request.result.createObjectStore(OWNER_STORE_NAME);
    request.result.createObjectStore(OPERATIONS_STORE_NAME);
  } catch (error) {
    return nativeErrorCode(error, 'open-failed');
  }
}

/** An upgrade can already be committing when cancellation arrives; never claim rollback then. */
function abortUpgrade(transaction: IDBTransaction | null | undefined): boolean {
  if (!transaction) return false;
  try {
    transaction.abort();
    return true;
  } catch {
    return false;
  }
}

function connectDatabase(database: IDBDatabase): OwnerConnection {
  try {
    if (!hasExactSchema(database)) throw new OwnerStorageError('invalid-schema');
  } catch {
    database.close();
    throw new OwnerStorageError('invalid-schema');
  }
  const connection: OwnerConnection = { database, transactions: new Map() };
  database.onversionchange = () => closeConnection(connection, 'version-changed');
  database.onclose = () => closeConnection(connection, 'closed');
  return connection;
}

/** Cancel any started upgrade; a refused abort reports uncertainty and never exposes a connection. */
// eslint-disable-next-line max-lines-per-function -- Shared open/upgrade/cancel state retains the exact transaction through the commit-to-success interval.
export function openDatabase(
  dependencies: DatabaseDependencies,
  registerCancel: (cancel: () => void) => void
): Promise<OwnerConnection> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest | undefined;
    let upgradeStarted = false;
    let upgradeTransaction: IDBTransaction | null = null;
    const finishError = (code: OwnerStorageErrorCode) => {
      if (settled) return;
      settled = true;
      const outcome =
        !upgradeStarted || abortUpgrade(upgradeTransaction) ? code : 'open-outcome-unknown';
      dependencies.timers.clearTimeout(timer);
      reject(new OwnerStorageError(outcome));
    };
    const timer = dependencies.timers.setTimeout(
      () => finishError('open-timeout'),
      dependencies.openTimeoutMs
    );
    registerCancel(() => finishError('closed'));
    try {
      if (!dependencies.indexedDB) return finishError('unavailable');
      request = dependencies.indexedDB.open(dependencies.databaseName, OWNER_DATABASE_VERSION);
    } catch (error) {
      return finishError(nativeErrorCode(error, 'open-failed'));
    }
    request.onblocked = () => finishError('open-blocked');
    request.onerror = () => finishError(nativeErrorCode(request?.error, 'open-failed'));
    request.onupgradeneeded = event => {
      upgradeStarted = true;
      // The request clears this reference before open success; retain the original transaction.
      upgradeTransaction = request!.transaction;
      if (settled) {
        abortUpgrade(upgradeTransaction);
        return;
      }
      const failure = upgradeSchema(request!, event.oldVersion);
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
