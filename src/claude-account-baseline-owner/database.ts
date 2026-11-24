import { ClaudeAccountBaselineOwnerError } from './errors';

export const CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE = 'liska-claude-account-baseline-owner-v1';
export const CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE_VERSION = 1;
export const CLAUDE_ACCOUNT_BASELINE_OWNER_STORE = 'owner';
export const CLAUDE_ACCOUNT_BASELINE_OWNER_KEY = 'baseline';
const defaultTimeoutMs = 5000;

export interface ClaudeAccountBaselineOwnerOptions {
  readonly indexedDB?: IDBFactory;
  readonly timeoutMs?: number;
}

function supportedSchema(database: IDBDatabase): boolean {
  if (
    database.version !== CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE_VERSION ||
    database.objectStoreNames.length !== 1 ||
    !database.objectStoreNames.contains(CLAUDE_ACCOUNT_BASELINE_OWNER_STORE)
  )
    return false;
  const store = database
    .transaction(CLAUDE_ACCOUNT_BASELINE_OWNER_STORE, 'readonly')
    .objectStore(CLAUDE_ACCOUNT_BASELINE_OWNER_STORE);
  return store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0;
}

function initialize(request: IDBOpenDBRequest, oldVersion: number, open: boolean): void {
  try {
    if (!open || oldVersion !== 0 || request.result.objectStoreNames.length !== 0) {
      request.transaction?.abort();
      return;
    }
    request.result.createObjectStore(CLAUDE_ACCOUNT_BASELINE_OWNER_STORE);
  } catch {
    request.transaction?.abort();
  }
}

export async function openClaudeAccountOwnerDatabase(options: ClaudeAccountBaselineOwnerOptions) {
  const { indexedDB = globalThis.indexedDB, timeoutMs = defaultTimeoutMs } = options;
  if (!indexedDB) throw new ClaudeAccountBaselineOwnerError('unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > defaultTimeoutMs)
    throw new ClaudeAccountBaselineOwnerError('invalid-limits');
  const database = await requestDatabase(indexedDB, timeoutMs);
  return { database, timeoutMs };
}

function requestDatabase(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(
        CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE,
        CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE_VERSION
      );
    } catch {
      return reject(new ClaudeAccountBaselineOwnerError('open-failed'));
    }
    let pending = true;
    const fail = (error: ClaudeAccountBaselineOwnerError) => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new ClaudeAccountBaselineOwnerError('open-timeout')),
      timeoutMs
    );
    request.onblocked = () => fail(new ClaudeAccountBaselineOwnerError('open-blocked'));
    request.onerror = () =>
      fail(
        new ClaudeAccountBaselineOwnerError(
          request.error?.name === 'VersionError' ? 'unsupported' : 'open-failed'
        )
      );
    request.onupgradeneeded = event => initialize(request, event.oldVersion, pending);
    request.onsuccess = () => {
      const database = request.result;
      if (!pending) return database.close();
      try {
        if (supportedSchema(database)) {
          pending = false;
          clearTimeout(timer);
          resolve(database);
          return;
        }
      } catch {
        // An unreadable schema is not a candidate for adoption or repair.
      }
      database.close();
      fail(new ClaudeAccountBaselineOwnerError('unsupported'));
    };
  });
}
