import {
  decodeClaudeAccountBaseline,
  type ClaudeAccountBaseline,
} from '../claude-account-baseline-owner/codec';
import {
  CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE as NAME,
  CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE_VERSION as VERSION,
  CLAUDE_ACCOUNT_BASELINE_OWNER_KEY as KEY,
  CLAUDE_ACCOUNT_BASELINE_OWNER_STORE as STORE,
} from '../claude-account-baseline-owner/database';
import { ClaudeAccountBaselineOwnerError } from '../claude-account-baseline-owner/errors';

interface SourceOptions {
  readonly factory: IDBFactory;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export type LegacySourceErrorCode =
  | 'unsupported'
  | 'corrupt'
  | 'limit-exceeded'
  | 'cancelled'
  | 'discovery-failed'
  | 'discovery-timeout'
  | 'open-failed'
  | 'open-blocked'
  | 'open-timeout'
  | 'legacy-changed'
  | 'read-failed'
  | 'transaction-aborted'
  | 'transaction-outcome-unknown'
  | 'close-failed';

export class LegacySourceError extends Error {
  constructor(readonly code: LegacySourceErrorCode) {
    super(code);
  }
}

export function isAborted(signal: AbortSignal | undefined): boolean {
  // Check the platform brand and do not evaluate own overrides.
  return (
    signal !== undefined &&
    Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(signal)
  );
}

function observeAbort(signal: AbortSignal | undefined, abort: () => void): () => void {
  if (signal) EventTarget.prototype.addEventListener.call(signal, 'abort', abort, { once: true });
  return () => {
    if (signal) EventTarget.prototype.removeEventListener.call(signal, 'abort', abort);
  };
}

function bounded<Value>(
  { signal, timeoutMs }: SourceOptions,
  timeout: LegacySourceErrorCode,
  syncFailure: LegacySourceErrorCode,
  start: (accept: (value: Value) => boolean, fail: (code: LegacySourceErrorCode) => void) => void
): Promise<Value> {
  return new Promise((resolve, reject) => {
    let pending = true;
    const finish = () => {
      if (!pending) return false;
      pending = false;
      clearTimeout(timer);
      unobserve();
      return true;
    };
    const fail = (code: LegacySourceErrorCode) => {
      if (finish()) reject(new LegacySourceError(code));
    };
    const accept = (value: Value) => {
      if (!finish()) return false;
      resolve(value);
      return true;
    };
    const timer = setTimeout(() => fail(timeout), timeoutMs);
    const unobserve = observeAbort(signal, () => fail('cancelled'));
    if (isAborted(signal)) return fail('cancelled');
    try {
      start(accept, fail);
    } catch {
      fail(syncFailure);
    }
  });
}

function discover(options: SourceOptions): Promise<boolean> {
  return bounded(options, 'discovery-timeout', 'discovery-failed', (accept, fail) => {
    const { factory } = options;
    if (typeof factory.databases !== 'function') return fail('unsupported');
    void factory
      .databases()
      .then(databases => {
        const matching = databases.filter(info => info.name === NAME);
        if (matching.length === 0) accept(false);
        else if (matching.length === 1 && matching[0].version === VERSION) accept(true);
        else fail('unsupported');
      })
      .catch(() => fail('discovery-failed'));
  });
}

function closeDatabase(database: IDBDatabase): boolean {
  try {
    database.close();
    return true;
  } catch {
    return false;
  }
}

function openExisting(options: SourceOptions): Promise<IDBDatabase> {
  return bounded(options, 'open-timeout', 'open-failed', (accept, fail) => {
    const request = options.factory.open(NAME, VERSION);
    let upgrading = false;
    request.onblocked = () => fail('open-blocked');
    request.onerror = () =>
      fail(
        upgrading
          ? 'legacy-changed'
          : request.error?.name === 'VersionError'
            ? 'unsupported'
            : 'open-failed'
      );
    // A request may still run after timeout, cancellation or blocking. Never
    // allow its upgrade to commit, and always close even a late handle.
    request.onupgradeneeded = () => {
      upgrading = true;
      const database = request.result;
      try {
        request.transaction!.abort();
      } finally {
        closeDatabase(database);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (upgrading) {
        closeDatabase(database);
        fail('legacy-changed');
      } else if (!accept(database)) closeDatabase(database);
    };
  });
}

type Stored =
  | { readonly kind: 'legacy-empty' }
  | { readonly kind: 'stored'; readonly bytes: unknown };
type Legacy =
  | { readonly kind: 'legacy-absent' | 'legacy-empty' }
  | { readonly kind: 'found'; readonly baseline: ClaudeAccountBaseline };

function inspectStore(
  tx: IDBTransaction,
  receive: (output: Stored | LegacySourceError) => void
): void {
  const store = tx.objectStore(STORE);
  if (store.keyPath !== null || store.autoIncrement || store.indexNames.length !== 0) {
    receive(new LegacySourceError('unsupported'));
    return;
  }
  // No unbounded enumeration, and never read the values of foreign rows.
  const inventory = store.getAllKeys(undefined, 2);
  inventory.onsuccess = () => {
    const keys = inventory.result;
    if (keys.length === 0) receive({ kind: 'legacy-empty' });
    else if (keys.length !== 1 || keys[0] !== KEY) receive(new LegacySourceError('corrupt'));
    else {
      const row = store.get(KEY);
      row.onsuccess = () => receive({ kind: 'stored', bytes: row.result });
    }
  };
}

function observeRead(tx: IDBTransaction, { signal, timeoutMs }: SourceOptions): Promise<Stored> {
  return new Promise((resolve, reject) => {
    let pending = true;
    let cancelled = false;
    let output: Stored | LegacySourceError | undefined;
    const finish = (result: Stored | LegacySourceError) => {
      if (!pending) return;
      pending = false;
      clearTimeout(timer);
      unobserve();
      if (result instanceof LegacySourceError) reject(result);
      else resolve(result);
    };
    const abort = () => {
      try {
        tx.abort();
      } catch {
        // Completion may win. Only an observed terminal event gives a result.
      }
    };
    const cancel = () => {
      cancelled = true;
      abort();
    };
    const timer = setTimeout(() => {
      abort();
      finish(new LegacySourceError('transaction-outcome-unknown'));
    }, timeoutMs);
    const unobserve = observeAbort(signal, cancel);
    tx.onabort = () =>
      finish(new LegacySourceError(cancelled ? 'cancelled' : 'transaction-aborted'));
    tx.oncomplete = () => finish(output ?? new LegacySourceError('transaction-outcome-unknown'));
    if (isAborted(signal)) return cancel();
    try {
      inspectStore(tx, value => {
        output = value;
      });
    } catch {
      abort();
    }
  });
}

function readStored(database: IDBDatabase, options: SourceOptions): Promise<Stored> {
  if (isAborted(options.signal)) throw new LegacySourceError('cancelled');
  if (
    database.name !== NAME ||
    database.version !== VERSION ||
    database.objectStoreNames.length !== 1 ||
    !database.objectStoreNames.contains(STORE)
  )
    throw new LegacySourceError('unsupported');
  let tx: IDBTransaction;
  try {
    tx = database.transaction(STORE, 'readonly');
  } catch {
    throw new LegacySourceError('read-failed');
  }
  return observeRead(tx, options);
}

export async function readLegacyCatalog(options: SourceOptions): Promise<Legacy> {
  if (!(await discover(options))) return { kind: 'legacy-absent' };
  const database = await openExisting(options);
  let stored: Stored;
  let closed: boolean;
  try {
    stored = await readStored(database, options);
  } finally {
    closed = closeDatabase(database);
  }
  if (!closed) throw new LegacySourceError('close-failed');
  if (stored.kind === 'legacy-empty') return stored;
  try {
    return { kind: 'found', baseline: decodeClaudeAccountBaseline(stored.bytes) };
  } catch (error) {
    throw new LegacySourceError(
      error instanceof ClaudeAccountBaselineOwnerError &&
        (error.code === 'unsupported' || error.code === 'limit-exceeded')
        ? error.code
        : 'corrupt'
    );
  }
}
