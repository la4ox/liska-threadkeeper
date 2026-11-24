import {
  ClaudeAccountBaselineOwnerError,
  openClaudeAccountBaselineOwner,
  type ClaudeAccountBaseline,
  type ClaudeAccountBaselineOwner,
} from '../../../src/claude-account-baseline-owner';
import {
  CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE as databaseName,
  CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE_VERSION as databaseVersion,
  CLAUDE_ACCOUNT_BASELINE_OWNER_KEY as recordKey,
  CLAUDE_ACCOUNT_BASELINE_OWNER_STORE as storeName,
} from '../../../src/claude-account-baseline-owner/database';
import { admitted, collectionA, collectionB } from './fixture';

export const steps = Object.freeze(['cancel', 'close', 'race', 'reopen', 'cleanup'] as const);
type Step = (typeof steps)[number];
type Report = {
  ok: boolean;
  passed: readonly Step[];
  failed?: Step | 'preflight';
};

function waitBounded<Value>(result: Promise<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('harness-timeout')), 2500);
    void result.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        reject(new Error('harness-operation-failed'));
      }
    );
  });
}

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('harness-check-failed');
}

function terminalEvent(transaction: IDBTransaction): Promise<'abort' | 'complete'> {
  return new Promise(resolve => {
    transaction.addEventListener('abort', () => resolve('abort'), { once: true });
    transaction.addEventListener('complete', () => resolve('complete'), { once: true });
  });
}

async function abortAfterAdd(
  owner: ClaudeAccountBaselineOwner,
  prototype: IDBObjectStore,
  mode: 'cancel' | 'close'
): Promise<void> {
  const controller = new AbortController();
  const original = prototype.add;
  let requests = 0;
  let ended: Promise<'abort' | 'complete'> | undefined;
  let closing: Promise<void> | undefined;
  prototype.add = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    const request = original.call(this, value, key);
    const transaction = this.transaction;
    ended = terminalEvent(transaction);
    request.addEventListener('success', () => {
      requests += 1;
      if (mode === 'cancel') controller.abort();
      else closing = owner.close();
    });
    return request;
  };
  try {
    const result = await owner.createPaused(collectionA, admitted(), controller.signal).then(
      () => 'unexpected-success',
      (error: unknown) => error instanceof ClaudeAccountBaselineOwnerError && error.code
    );
    check(result === 'transaction-aborted' && requests === 1 && ended);
    check((await waitBounded(ended)) === 'abort');
    await closing;
    if (mode === 'close') {
      const closed = await owner.read().then(
        () => false,
        (error: unknown) =>
          error instanceof ClaudeAccountBaselineOwnerError && error.code === 'closed'
      );
      check(closed);
    }
  } finally {
    prototype.add = original;
  }
}

async function race(
  left: ClaudeAccountBaselineOwner,
  right: ClaudeAccountBaselineOwner
): Promise<ClaudeAccountBaseline> {
  const outcomes = await Promise.allSettled([
    left.createPaused(collectionA, admitted()),
    right.createPaused(collectionB, admitted(0)),
  ]);
  const [winner] = outcomes.filter(outcome => outcome.status === 'fulfilled');
  const [loser] = outcomes.filter(outcome => outcome.status === 'rejected');
  check(winner?.value.kind === 'created');
  check(
    loser?.reason instanceof ClaudeAccountBaselineOwnerError && loser.reason.code === 'conflict'
  );
  return winner.value.baseline;
}

function openForIndependentInspection(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => reject(new Error('harness-inspection-failed'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function inspectExactInventory(factory: IDBFactory): Promise<void> {
  const database = await openForIndependentInspection(factory);
  try {
    check(database.objectStoreNames.length === 1 && database.objectStoreNames.contains(storeName));
    const transaction = database.transaction(storeName);
    const objectStore = transaction.objectStore(storeName);
    check(
      objectStore.keyPath === null &&
        !objectStore.autoIncrement &&
        objectStore.indexNames.length === 0
    );
    const keys = objectStore.getAllKeys();
    check((await waitBounded(terminalEvent(transaction))) === 'complete');
    check(keys.result.length === 1 && keys.result[0] === recordKey);
  } finally {
    database.close();
  }
}

async function exists(factory: IDBFactory): Promise<boolean> {
  return (await waitBounded(factory.databases())).some(database => database.name === databaseName);
}

async function cleanup(factory: IDBFactory): Promise<void> {
  await waitBounded(
    new Promise<void>((resolve, reject) => {
      const request = factory.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('harness-cleanup-failed'));
    })
  );
  check(!(await exists(factory)));
}

export async function runClaudeAccountOwnerScenario(
  factory: IDBFactory,
  objectStorePrototype: IDBObjectStore
): Promise<Report> {
  const passed: Step[] = [];
  let failed: Report['failed'] = 'preflight';
  try {
    // Never adopt or clear a pre-existing database, even in the isolated test origin.
    check(!(await exists(factory)));
  } catch {
    return { ok: false, passed, failed };
  }
  const handles: ClaudeAccountBaselineOwner[] = [];
  const open = async () => {
    const owner = await openClaudeAccountBaselineOwner({ indexedDB: factory });
    handles.push(owner);
    return owner;
  };
  try {
    failed = 'cancel';
    const left = await open();
    await abortAfterAdd(left, objectStorePrototype, 'cancel');
    check((await left.read()) === null);
    passed.push(failed);

    failed = 'close';
    await abortAfterAdd(await open(), objectStorePrototype, 'close');
    check((await left.read()) === null);
    passed.push(failed);

    failed = 'race';
    const right = await open();
    const baseline = await race(left, right);
    await Promise.all([left.close(), right.close()]);
    passed.push(failed);

    failed = 'reopen';
    const fresh = await open();
    const stored = await fresh.read();
    check(stored?.phase === 'paused' && stored.revision === 0 && !stored.executionAuthorized);
    check(JSON.stringify(stored) === JSON.stringify(baseline));
    const result = await fresh.createPaused(baseline.collectionId, baseline.admission);
    check(result.kind === 'already-created');
    await inspectExactInventory(factory);
    passed.push(failed);
    failed = undefined;
  } catch {
    // Report only the fixed step, never an exception, stored bytes, or identifiers.
  } finally {
    try {
      await Promise.all(handles.map(owner => owner.close()));
      await cleanup(factory);
      passed.push('cleanup');
    } catch {
      failed ??= 'cleanup';
    }
  }
  return failed === undefined ? { ok: true, passed } : { ok: false, passed, failed };
}
