import { CLAUDE_BASELINE_HARD_LIMITS } from '../claude-baseline/contracts';
import { fields } from '../claude-baseline/data';
import { AccountCatalogError } from './errors';

export const ACCOUNT_CATALOG_DATABASE = 'liska-account-catalog-owner-v1';
export const ACCOUNT_CATALOG_DATABASE_VERSION = 1;
export const SLOTS = 'slots';
export const OWNERS = 'owners';
export const STORES = [SLOTS, OWNERS] as const;
const DEFAULT_TIMEOUT_MS = 5000;

export interface AccountCatalogOptions {
  /** Trusted platform/test dependency, not catalog data. */
  readonly indexedDB?: IDBFactory;
  readonly timeoutMs?: number;
}

function optionsData(raw: unknown) {
  try {
    const data = fields(raw, [], ['timeoutMs', 'indexedDB'], CLAUDE_BASELINE_HARD_LIMITS);
    const timeoutMs = 'timeoutMs' in data ? data.timeoutMs : DEFAULT_TIMEOUT_MS;
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > DEFAULT_TIMEOUT_MS
    )
      throw new AccountCatalogError('invalid-options');
    return {
      factory: (data.indexedDB as IDBFactory | undefined) ?? globalThis.indexedDB,
      timeoutMs,
    };
  } catch {
    throw new AccountCatalogError('invalid-options');
  }
}

function supportedSchema(database: IDBDatabase): boolean {
  if (
    database.version !== ACCOUNT_CATALOG_DATABASE_VERSION ||
    database.objectStoreNames.length !== STORES.length ||
    !STORES.every(name => database.objectStoreNames.contains(name))
  )
    return false;
  const inspection = database.transaction([...STORES], 'readonly');
  return STORES.every(name => {
    const store = inspection.objectStore(name);
    return store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0;
  });
}

function initialize(request: IDBOpenDBRequest, oldVersion: number, pending: boolean): void {
  try {
    if (!pending || oldVersion !== 0 || request.result.objectStoreNames.length !== 0) {
      request.transaction?.abort();
      return;
    }
    for (const store of STORES) request.result.createObjectStore(store);
  } catch {
    request.transaction?.abort();
  }
}

export async function openCatalogDatabase(options: AccountCatalogOptions) {
  const { factory, timeoutMs } = optionsData(options);
  if (!factory) throw new AccountCatalogError('unavailable');
  return { database: await requestDatabase(factory, timeoutMs), timeoutMs };
}

function requestDatabase(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(ACCOUNT_CATALOG_DATABASE, ACCOUNT_CATALOG_DATABASE_VERSION);
    } catch {
      return reject(new AccountCatalogError('open-failed'));
    }
    let pending = true;
    const finish = () => {
      pending = false;
      clearTimeout(timer);
    };
    const fail = (error: AccountCatalogError) => {
      if (!pending) return;
      finish();
      reject(error);
    };
    const timer = setTimeout(() => fail(new AccountCatalogError('open-timeout')), timeoutMs);
    request.onblocked = () => fail(new AccountCatalogError('open-blocked'));
    request.onerror = () =>
      fail(
        new AccountCatalogError(
          request.error?.name === 'VersionError' ? 'unsupported' : 'open-failed'
        )
      );
    request.onupgradeneeded = event => initialize(request, event.oldVersion, pending);
    request.onsuccess = () => {
      const database = request.result;
      if (!pending) return database.close();
      try {
        if (supportedSchema(database)) {
          finish();
          resolve(database);
          return;
        }
      } catch {
        // Unreadable schema: no adoption or repair.
      }
      database.close();
      fail(new AccountCatalogError('unsupported'));
    };
  });
}
