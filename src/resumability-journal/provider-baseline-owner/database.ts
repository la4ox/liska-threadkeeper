import {
  ProviderOwnerStorageError,
  nativeErrorCode,
  type ProviderOwnerStorageErrorCode,
} from './errors';

export const PROVIDER_OWNER_DATABASE_NAME = 'liska-baseline-owner-v2';
export const PROVIDER_OWNER_STORE_NAME = 'owner';
export const PROVIDER_OPERATIONS_STORE_NAME = 'operations';
export const PROVIDER_OWNER_KEY = 'baseline';
export const PROVIDER_OWNER_DATABASE_VERSION = 1;

export interface ProviderOwnerTimers {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ProviderOwnerStoreOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  openTimeoutMs?: number;
  transactionTimeoutMs?: number;
  timers?: ProviderOwnerTimers;
}

export interface DatabaseDependencies {
  indexedDB: IDBFactory | undefined;
  databaseName: string;
  openTimeoutMs: number;
  transactionTimeoutMs: number;
  timers: ProviderOwnerTimers;
}

export interface ProviderOwnerConnection {
  database: IDBDatabase;
  invalidate?: () => void;
  failure?: ProviderOwnerStorageError;
  mutationUnknown?: boolean;
  transactions: Map<IDBTransaction, (error: ProviderOwnerStorageError) => void>;
}

const defaultTimers: ProviderOwnerTimers = {
  setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 5000;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 30000)
    throw new ProviderOwnerStorageError('open-failed');
  return value;
}

export function databaseDependencies(options: ProviderOwnerStoreOptions): DatabaseDependencies {
  if (
    options.databaseName !== undefined &&
    options.databaseName !== PROVIDER_OWNER_DATABASE_NAME &&
    !options.databaseName.startsWith(PROVIDER_OWNER_DATABASE_NAME + '-')
  )
    throw new ProviderOwnerStorageError('invalid-schema');
  return {
    indexedDB: options.indexedDB ?? globalThis.indexedDB,
    databaseName: options.databaseName ?? PROVIDER_OWNER_DATABASE_NAME,
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

export function closeConnection(
  connection: ProviderOwnerConnection,
  code: ProviderOwnerStorageErrorCode
): void {
  connection.invalidate?.();
  connection.failure ??= new ProviderOwnerStorageError(code);
  for (const fail of connection.transactions.values()) fail(connection.failure);
  connection.database.close();
}

function hasExactSchema(database: IDBDatabase): boolean {
  if (database.version !== PROVIDER_OWNER_DATABASE_VERSION) return false;
  if (
    database.objectStoreNames.length !== 2 ||
    !database.objectStoreNames.contains(PROVIDER_OWNER_STORE_NAME) ||
    !database.objectStoreNames.contains(PROVIDER_OPERATIONS_STORE_NAME)
  )
    return false;
  const transaction = database.transaction(
    [PROVIDER_OWNER_STORE_NAME, PROVIDER_OPERATIONS_STORE_NAME],
    'readonly'
  );
  return [PROVIDER_OWNER_STORE_NAME, PROVIDER_OPERATIONS_STORE_NAME].every(name => {
    const store = transaction.objectStore(name);
    return store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0;
  });
}

function upgradeSchema(
  request: IDBOpenDBRequest,
  oldVersion: number
): ProviderOwnerStorageErrorCode | undefined {
  if (oldVersion !== 0 || request.result.objectStoreNames.length !== 0) return 'invalid-schema';
  try {
    request.result.createObjectStore(PROVIDER_OWNER_STORE_NAME);
    request.result.createObjectStore(PROVIDER_OPERATIONS_STORE_NAME);
  } catch (error) {
    return nativeErrorCode(error, 'open-failed');
  }
}

function abortUpgrade(transaction: IDBTransaction | null | undefined): boolean {
  if (!transaction) return false;
  try {
    transaction.abort();
    return true;
  } catch {
    return false;
  }
}

function connectDatabase(database: IDBDatabase): ProviderOwnerConnection {
  try {
    if (!hasExactSchema(database)) throw new ProviderOwnerStorageError('invalid-schema');
  } catch {
    database.close();
    throw new ProviderOwnerStorageError('invalid-schema');
  }
  const connection: ProviderOwnerConnection = { database, transactions: new Map() };
  database.onversionchange = () => closeConnection(connection, 'version-changed');
  database.onclose = () => closeConnection(connection, 'closed');
  return connection;
}

// The retained upgrade transaction is the only reliable cancellation boundary before success.
// eslint-disable-next-line max-lines-per-function
export function openDatabase(
  dependencies: DatabaseDependencies,
  registerCancel: (cancel: () => void) => void
): Promise<ProviderOwnerConnection> {
  // eslint-disable-next-line max-lines-per-function -- One closure retains the live request and upgrade transaction through every terminal outcome.
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest | undefined;
    let upgradeStarted = false;
    let upgradeTransaction: IDBTransaction | null = null;
    const finishError = (code: ProviderOwnerStorageErrorCode) => {
      if (settled) return;
      settled = true;
      const outcome =
        !upgradeStarted || abortUpgrade(upgradeTransaction) ? code : 'open-outcome-unknown';
      dependencies.timers.clearTimeout(timer);
      reject(new ProviderOwnerStorageError(outcome));
    };
    const timer = dependencies.timers.setTimeout(
      () => finishError('open-timeout'),
      dependencies.openTimeoutMs
    );
    registerCancel(() => finishError('closed'));
    try {
      if (!dependencies.indexedDB) return finishError('unavailable');
      request = dependencies.indexedDB.open(
        dependencies.databaseName,
        PROVIDER_OWNER_DATABASE_VERSION
      );
    } catch (error) {
      return finishError(nativeErrorCode(error, 'open-failed'));
    }
    request.onblocked = () => finishError('open-blocked');
    request.onerror = () => finishError(nativeErrorCode(request?.error, 'open-failed'));
    request.onupgradeneeded = event => {
      upgradeStarted = true;
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
