/** Native storage-only acceptance. Identities, bytes, hashes and errors never enter the receipt. */
import { encodeSnapshotCatalog } from '../../../src/archive/catalog/encode';
import { conversationKeyInput } from '../../../src/archive/catalog/conversation-key';
import type { SnapshotCatalog, SnapshotCatalogEntry } from '../../../src/archive/catalog/contracts';
import {
  createProviderBaselineOwner,
  type ProviderBaselineOwner,
  type ProviderOwnerTimers,
  type ProviderOwnerSnapshot,
  type ProviderReservationIdentity,
  type ProviderExecutionPort,
  type ProviderDispatchToken,
} from '../../../src/resumability-journal/provider-baseline-owner';
import { isProviderExecutionPort } from '../../../src/resumability-journal/provider-baseline-owner/port';
import {
  encodeRecord,
  CHATGPT_ADAPTER_VERSION,
  CLAUDE_ADAPTER_VERSION,
  type OperationRecord,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import {
  FILE_ASSURANCE,
  STRICT_COMPLETENESS,
} from '../../../src/resumability-journal/purpose/contracts';

export const ROW_IDS = [
  'guarded-database',
  'claim-consume-once',
  'pause-late-evidence',
  'restart-late-evidence',
  'claim-committed-revoked',
  'consume-final-fence',
  'two-handle-claim-cas',
  'consume-inventory-fence',
  'interruption-observation',
  'evidence-atomic-abort',
  'cleanup',
  'visibility-deadline',
  'network-denial',
] as const;
export type RowId = (typeof ROW_IDS)[number];
export type Status = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export interface Row {
  readonly id: RowId;
  readonly status: Status;
  readonly metrics: readonly number[];
}
export interface Receipt {
  readonly schema: 'liska-provider-owner-lifecycle-native-receipt/1';
  readonly status: Status;
  readonly code: 'none' | 'acceptance-failed' | 'native-scheduling-unproven';
  readonly rows: readonly Row[];
  readonly elapsedMs: number;
  readonly maxGapMs: number;
}
export interface ScenarioEnvironment {
  readonly indexedDB: IDBFactory;
  readonly crypto: Pick<Crypto, 'getRandomValues' | 'subtle'>;
  readonly timers: ProviderOwnerTimers;
  readonly monotonicNow: () => number;
  /** Latches every hidden state throughout the run. */
  readonly remainedVisible: () => boolean;
  readonly networkCalls: () => number;
}
const cap = (value: number) =>
  Number.isFinite(value) ? Math.min(1_000_000, Math.max(0, Math.round(value))) : 0;
const signal = () => new AbortController().signal;
class AcceptanceFailure extends Error {}
const fact = (value: unknown): void => {
  if (!value) throw new AcceptanceFailure('acceptance-failed');
};
class Unproven extends Error {}
const ids = (suffix: string) => ({
  operationId: 'operation-' + suffix,
  attemptId: 'attempt-' + suffix,
  captureId: 'capture-' + suffix,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
};
function noAuthority(value: unknown): void {
  if (!value || typeof value !== 'object' || value instanceof Uint8Array) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'executionAuthorized') fact(item === false);
    noAuthority(item);
  }
}
async function rejectedCode(effect: () => Promise<unknown>, code: string) {
  try {
    await effect();
  } catch (error) {
    fact((error as { code?: unknown }).code === code);
    return;
  }
  fact(false);
}
async function catalog(
  hash: (bytes: Uint8Array) => Promise<string>,
  providers: readonly ('chatgpt' | 'claude')[]
) {
  const conversationId = '00000000-0000-4000-8000-000000000001';
  const selection = await Promise.all(
    providers.map(async provider => ({
      provider,
      conversationId,
      conversationKey:
        `liska-conversation-key/1:${await hash(conversationKeyInput(provider, conversationId))}` as const,
    }))
  );
  const empty = {
    count: 0,
    declaredBytes: 0,
    presentCount: 0,
    presentBytes: 0,
    sizeMatchCount: 0,
    missingCount: 0,
    sizeMismatchCount: 0,
  };
  const entries: SnapshotCatalogEntry[] = await Promise.all(
    selection.map(async (item, index) => ({
      ...item,
      manifestValidity: 'valid',
      manifestSha256: await hash(new TextEncoder().encode('{}')),
      manifestByteLength: 2,
      captureId: 'previous-' + index,
      capturedAt: '2026-11-08T00:00:00.000Z',
      method: 'same-origin-api',
      declaredCompleteness: {
        graph: 'complete',
        messages: 'complete',
        branches: 'complete',
        assets: 'complete',
      },
      artifacts: { ...empty },
      assets: { ...empty, recordCount: 0 },
      canonical: { presence: 'absent', byteLength: null, declaredFileRole: null },
      associatedFileCount: 1,
      extraFileCount: 0,
      extraFileBytes: 0,
      issueCodes: [],
      occurrenceCount: 1,
    }))
  );
  const value: SnapshotCatalog = {
    schema: 'liska-snapshot-catalog/1',
    algorithmVersion: 'manifest-metadata/1',
    conversationKeyVersion: 'liska-conversation-key/1',
    analysisOnly: true,
    mutationAuthorized: false,
    referenceCoverage: 'selected-inputs-only',
    fileEvidence: 'metadata-only-not-content-verified',
    accountBinding: 'not-recorded-in-liska-capture-1',
    selectedFileCount: entries.length,
    selectedManifestCount: entries.length,
    unassociatedFileCount: 0,
    entries,
  };
  const bytes = encodeSnapshotCatalog(value);
  fact(
    bytes.length < 8192 && canonical([...bytes]) === canonical([...encodeSnapshotCatalog(value)])
  );
  return { bytes, selection };
}

export async function runProviderBaselineOwnerLifecycleScenario(
  env: ScenarioEnvironment
): Promise<Receipt> {
  const rows = new Map<RowId, Row>();
  let current: RowId = 'guarded-database';
  let uncertain = false,
    failed = false,
    deadline = false,
    stopped = false;
  let interruptedHash = false;
  let last = env.monotonicNow(),
    maxGap = 0;
  const started = last;
  const owners = new Set<ProviderBaselineOwner>();
  const tokens = new Set<ProviderDispatchToken>();
  const restorers = new Set<() => void>();
  let storePrototype: IDBObjectStore | undefined;
  let databasePrototype: IDBDatabase | undefined;
  let cleanupFailed = false,
    deletionPending = false,
    finalCleanup = false;
  const nativeHandles = new Set<IDBDatabase>();
  const pending = new Set<Promise<unknown>>();
  const gates: { release: () => void }[] = [];
  const expired = deferred();
  let databaseName = '',
    opens = 0,
    deletes = 0,
    denied = 0,
    deleted = 0;
  const check = (sampleOnly = false) => {
    const now = env.monotonicNow();
    maxGap = Math.max(maxGap, now - last);
    if (
      !Number.isFinite(now) ||
      now < last ||
      now - started > 15000 ||
      maxGap > 1000 ||
      !env.remainedVisible() ||
      deadline
    ) {
      uncertain = true;
    }
    last = now;
    // Timing is orthogonal to correctness. Within owner hashing only latch it:
    // throwing here would be normalized into an apparent production hash failure.
    if (uncertain && !sampleOnly) throw new Unproven();
  };
  const release = () => {
    gates.forEach(gate => gate.release());
    expired.resolve();
  };
  const close = () => {
    owners.forEach(owner => owner.close());
    nativeHandles.forEach(database => database.close());
  };
  const timeout = env.timers.setTimeout(() => {
    deadline = true;
    uncertain = true;
    release();
  }, 15000);
  let heartbeat: unknown;
  const pulse = () => {
    if (stopped) return;
    check(true);
    heartbeat = env.timers.setTimeout(pulse, 25);
  };
  heartbeat = env.timers.setTimeout(pulse, 25);
  const pass = (id: RowId, metrics: number[]) => {
    check();
    rows.set(id, { id, status: 'PASS', metrics: metrics.map(cap) });
  };
  const hash = async (bytes: Uint8Array) => {
    check(true);
    let settled = false;
    const digest = await Promise.race([
      env.crypto.subtle.digest('SHA-256', bytes.slice().buffer),
      expired.promise.then(() => {
        if (!settled && deadline) interruptedHash = true;
        throw new Unproven();
      }),
    ]);
    settled = true;
    check(true);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const gate = () => {
    let armed = false;
    const entered = deferred(),
      released = deferred();
    const result = {
      arm: () => {
        fact(!armed);
        armed = true;
      },
      entered: entered.promise,
      release: released.resolve,
      hash: async (bytes: Uint8Array) => {
        const digest = await hash(bytes);
        if (armed) {
          armed = false;
          entered.resolve();
          await Promise.race([released.promise, expired.promise]);
          check(true);
        }
        return digest;
      },
    };
    gates.push(result);
    return result;
  };
  const guarded = {
    open(name: string, version?: number) {
      if (
        !databaseName ||
        name !== databaseName ||
        version !== 1 ||
        finalCleanup ||
        deletionPending
      ) {
        denied++;
        throw new Error('guard-denied');
      }
      opens++;
      return env.indexedDB.open(name, version);
    },
    deleteDatabase(name: string) {
      if (!databaseName || name !== databaseName) {
        denied++;
        throw new Error('guard-denied');
      }
      deletes++;
      return env.indexedDB.deleteDatabase(name);
    },
  } as IDBFactory;
  const remove = () =>
    new Promise<void>((resolve, reject) => {
      deletionPending = true;
      let settled = false;
      const timer = env.timers.setTimeout(() => finish(false), 1500);
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        env.timers.clearTimeout(timer);
        if (ok) {
          deleted++;
          deletionPending = false;
          resolve();
        } else {
          cleanupFailed = true;
          reject(new Error('cleanup-failed'));
        }
      };
      try {
        const request = guarded.deleteDatabase(databaseName);
        request.onsuccess = () => finish(true);
        request.onerror = request.onblocked = () => finish(false);
      } catch {
        finish(false);
      }
    });
  const fresh = async (sha256 = hash) => {
    check();
    const owner = createProviderBaselineOwner({
      indexedDB: guarded,
      databaseName,
      sha256,
      timers: env.timers,
      openTimeoutMs: 1500,
      transactionTimeoutMs: 1500,
    });
    owners.add(owner);
    await owner.open();
    check();
    return owner;
  };
  const snapshot = async (owner: ProviderBaselineOwner) => {
    const value = await owner.readSnapshot();
    fact(value);
    noAuthority(value);
    return value!;
  };
  // Independent native byte inventory, not a projection through the owner validator.
  const inventory = () =>
    new Promise<string>((resolve, reject) => {
      let settled = false;
      const timer = env.timers.setTimeout(() => {
        settled = true;
        reject(new Error('inventory-failed'));
      }, 1500);
      const finish = (value?: string) => {
        if (settled) return;
        settled = true;
        env.timers.clearTimeout(timer);
        if (value === undefined) reject(new Error('inventory-failed'));
        else resolve(value);
      };
      const request = guarded.open(databaseName, 1);
      request.onerror = request.onblocked = () => finish();
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        nativeHandles.add(database);
        databasePrototype = Object.getPrototypeOf(database) as IDBDatabase;
        const values: [string, string, number[]][] = [];
        try {
          fact(
            database.version === 1 &&
              canonical([...database.objectStoreNames]) === canonical(['operations', 'owner'])
          );
          const transaction = database.transaction(['operations', 'owner'], 'readonly');
          for (const name of ['operations', 'owner']) {
            const store = transaction.objectStore(name);
            if (name === 'operations')
              storePrototype = Object.getPrototypeOf(store) as IDBObjectStore;
            fact(store.keyPath === null && !store.autoIncrement && store.indexNames.length === 0);
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
              if (!cursor.result) return;
              fact(typeof cursor.result.key === 'string');
              values.push([
                name,
                cursor.result.key as string,
                [...(cursor.result.value as Uint8Array)],
              ]);
              cursor.result.continue();
            };
          }
          transaction.oncomplete = () => {
            database.close();
            nativeHandles.delete(database);
            values.sort(([leftStore, leftKey], [rightStore, rightKey]) => {
              if (leftStore !== rightStore) return leftStore < rightStore ? -1 : 1;
              if (leftKey === rightKey) return 0;
              return leftKey < rightKey ? -1 : 1;
            });
            finish(canonical(values));
          };
          transaction.onabort = transaction.onerror = () => {
            database.close();
            nativeHandles.delete(database);
            finish();
          };
        } catch {
          database.close();
          nativeHandles.delete(database);
          finish();
        }
      };
    });
  const bounded = <T>(work: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = env.timers.setTimeout(function boundedDeadline() {
        check(true);
        reject(uncertain ? new Unproven() : new AcceptanceFailure('acceptance-failed'));
      }, 1500);
      work.then(
        value => {
          env.timers.clearTimeout(timer);
          resolve(value);
        },
        error => {
          env.timers.clearTimeout(timer);
          reject(error);
        }
      );
    });
  const tracked = <T>(work: Promise<T>) => {
    pending.add(work);
    // Attach a rejection handler immediately, including for effects held across owner.close().
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work)
    );
    return work;
  };
  const settle = (work: Promise<unknown>) =>
    tracked(
      work.then(
        () => 'fulfilled',
        error => (error as { code?: unknown }).code
      )
    );
  const verify = async (owner: ProviderBaselineOwner, immutable?: string) => {
    const value = await snapshot(owner);
    const native = JSON.parse(await inventory()) as [string, string, number[]][];
    const cp = value.checkpoint;
    fact(native.length === value.operations.length + 1);
    fact(
      native.some(
        ([store, key, raw]) =>
          store === 'owner' &&
          key === 'baseline' &&
          canonical(raw) === canonical([...value.ownerBytes])
      )
    );
    fact(
      cp.links.length === value.operations.length && cp.charges.length === value.operations.length
    );
    if (immutable) fact(canonical([cp.links, cp.charges]) === immutable);
    for (const record of value.operations) {
      const bytes = encodeRecord(record);
      fact(new TextDecoder().decode(bytes) === canonical(record));
      fact(
        native.some(
          ([store, key, raw]) =>
            store === 'operations' &&
            key === record.operation.operationId &&
            canonical(raw) === canonical([...bytes])
        )
      );
      const observations = cp.observations.filter(
        item => item.operationId === record.operation.operationId
      );
      const latest = observations[observations.length - 1];
      fact(
        latest &&
          latest.recordRevision === record.revision &&
          latest.recordSha256 === (await hash(bytes))
      );
      fact(observations.length === record.revision + 1);
      const link = cp.links.find(item => item.operationId === record.operation.operationId);
      const charge = cp.charges.find(item => item.operationId === record.operation.operationId);
      fact(link && charge);
      fact(
        link!.operationSha256 ===
          (await hash(new TextEncoder().encode(canonical(record.operation))))
      );
      fact(
        link!.attemptId === record.operation.attemptId &&
          link!.captureId === record.operation.captureId
      );
      fact(
        charge!.itemOrdinal === link!.itemOrdinal &&
          charge!.windowId === link!.windowId &&
          charge!.chargedAt === link!.linkedAt
      );
    }
    return value;
  };
  const create = async (
    owner: ProviderBaselineOwner,
    data: Awaited<ReturnType<typeof catalog>>
  ) => {
    await owner.create(
      data.bytes,
      {
        selection: data.selection,
        purpose: 'new-capture',
        destinations: [{ destination: 'file', assurance: FILE_ASSURANCE }],
        completenessPolicy: STRICT_COMPLETENESS,
      },
      { now: 100, windowId: 'synthetic', maxReservationSlots: 4 },
      signal()
    );
    const value = await verify(owner);
    fact(
      value.checkpoint.control === 'paused' &&
        value.checkpoint.revision === 0 &&
        value.operations.length === 0 &&
        value.checkpoint.observations.length === 0
    );
    return value;
  };
  const bind = async (
    owner: ProviderBaselineOwner,
    identity: ProviderReservationIdentity,
    clock: { value: number }
  ) => {
    const port = await owner.createExecutionPort(identity, { now: () => clock.value });
    fact(
      Object.isFrozen(port) &&
        Object.getPrototypeOf(port) === Object.prototype &&
        isProviderExecutionPort(port) &&
        !isProviderExecutionPort({ ...port })
    );
    fact(
      canonical(Object.keys(port)) ===
        canonical([
          'read',
          'claimDispatch',
          'consumeDispatch',
          'markExecutionUnknown',
          'recordProducerReceipts',
        ])
    );
    return port;
  };
  const setup = async (provider: 'chatgpt' | 'claude' = 'chatgpt', sha256 = hash) => {
    const data = await catalog(hash, [provider]);
    const owner = await fresh(sha256);
    await create(owner, data);
    await owner.applyControl(0, { kind: 'activate', now: 101 });
    await verify(owner);
    const reservation = await owner.reserveNext(1, data.bytes, ids('synthetic'), 102, signal());
    const value = await verify(owner);
    fact(
      reservation.item.provider === provider &&
        reservation.record.revision === 0 &&
        reservation.record.phase === 'reserved' &&
        reservation.record.control === 'active' &&
        reservation.record.disposition === 'open' &&
        value.checkpoint.revision === 2
    );
    const identity = {
      ...ids('synthetic'),
      planSha256: value.plan.planSha256,
      item: reservation.item,
    };
    const clock = { value: 103 };
    const port = await bind(owner, identity, clock);
    fact(canonical(await port.read()) === canonical(reservation.record));
    return {
      owner,
      port,
      identity,
      clock,
      data,
      record: reservation.record,
      immutable: canonical([value.checkpoint.links, value.checkpoint.charges]),
    };
  };
  type Context = Awaited<ReturnType<typeof setup>>;
  const claim = async (context: Context) => {
    const result = await context.port.claimDispatch(0);
    fact(
      result.dispatch === 'available' &&
        result.record.revision === 1 &&
        result.record.phase === 'in-flight'
    );
    if (result.dispatch !== 'available') throw new Error('acceptance-failed');
    fact(Object.isFrozen(result.token) && Object.getPrototypeOf(result.token) === null);
    tokens.add(result.token);
    await verify(context.owner, context.immutable);
    return result;
  };
  // These are strict synthetic factual receipts. Only recordProducerReceipts consumes them;
  // neither the callback nor this harness calls an adapter or supplies an assessment.
  const strictReceipts = async (record: OperationRecord) => {
    const operation = record.operation,
      provider = operation.admission.provider;
    const commitment = async (relativePath: string) => ({
      relativePath,
      byteLength: 2,
      sha256: await hash(new TextEncoder().encode('{}')),
    });
    const raw = await commitment('raw.json'),
      manifest = await commitment('manifest.json'),
      normalized = await commitment('canonical.json');
    return [
      {
        schema:
          provider === 'chatgpt'
            ? 'liska-chatgpt-producer-evidence/1'
            : 'liska-claude-producer-evidence/1',
        provider,
        conversationId: operation.admission.conversationId,
        captureId: operation.captureId,
        legacyRoutingDigest: await hash(
          new TextEncoder().encode(operation.admission.conversationId)
        ),
        requestedDestinations: ['file'],
        destination: 'file',
        raw,
        manifest,
        canonical: normalized,
        intent: {
          ...operation.admission,
          ...operationIds(operation),
          catalogSha256: operation.sourceSelection.catalogSha256,
          requiredDestinations: ['file'],
        },
        completeness: {
          graph: 'complete',
          messages: 'complete',
          branches: 'complete',
          assets: 'complete',
        },
        assets: [],
        observations: [raw, manifest, normalized].map(commitment => ({
          destination: 'file',
          commitment,
          observation: {
            kind: 'browser-download-complete-path-confirmed',
            observedRelativePath: commitment.relativePath,
          },
        })),
      },
    ];
  };
  const evidence = async (context: Context, port: ProviderExecutionPort, revision: number) => {
    context.clock.value = 105;
    const previous = await port.read();
    const record = await port.recordProducerReceipts(
      revision,
      await strictReceipts(context.record)
    );
    const observation = record.observation;
    fact(
      record.phase === 'awaiting-resolution' &&
        record.disposition === 'open' &&
        record.control === previous.control &&
        record.revision === revision + 1 &&
        observation &&
        observation.receipts.length === 1 &&
        observation.provider === context.identity.item.provider &&
        observation.adapterVersion ===
          (observation.provider === 'chatgpt' ? CHATGPT_ADAPTER_VERSION : CLAUDE_ADAPTER_VERSION) &&
        observation.hashOutcome === 'available' &&
        observation.adaptation.assessment.kind === 'consistent'
    );
    const value = await verify(context.owner, context.immutable);
    fact(value.checkpoint.control === 'paused' && value.operations.length === 1);
    const before = await inventory();
    context.owner.close();
    const reopened = await fresh();
    const replay = await verify(reopened, context.immutable);
    fact(canonical(replay) === canonical(value) && (await inventory()) === before);
    // Read/replay is inspection only, never reactivation or next reservation.
    fact(replay.checkpoint.control === 'paused' && replay.checkpoint.charges.length === 1);
    return record;
  };
  const endLifecycle = async () => {
    gates.forEach(gate => gate.release());
    await bounded(Promise.allSettled([...pending]));
    restorers.forEach(restore => restore());
    close();
    owners.clear();
    nativeHandles.clear();
    tokens.clear();
    await remove();
    fact(deletes === deleted);
  };
  const replace = (object: object, key: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    fact(descriptor?.configurable && typeof descriptor.value === 'function');
    Object.defineProperty(object, key, { ...descriptor, value });
    const restore = () => {
      Object.defineProperty(object, key, descriptor!);
      restorers.delete(restore);
    };
    restorers.add(restore);
    return restore;
  };
  // Hooks always delegate the native method. Scope is exact DB, two stores, operation key,
  // mode, revision and one armed phase. No owner methods or terminal events are replaced.
  const putHook = (
    phase: 'in-flight' | 'awaiting-resolution',
    callback: (request: IDBRequest, transaction: IDBTransaction) => void
  ) => {
    fact(storePrototype);
    const prototype = storePrototype!,
      original = prototype.put;
    let hits = 0,
      completed = 0,
      aborted = 0;
    const terminal = deferred();
    const restore = replace(
      prototype,
      'put',
      function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        const request = original.call(this, value, key);
        const transaction = this.transaction;
        if (
          !hits &&
          transaction.db.name === databaseName &&
          transaction.mode === 'readwrite' &&
          canonical([...transaction.objectStoreNames]) === canonical(['operations', 'owner']) &&
          this.name === 'operations' &&
          key === 'operation-synthetic' &&
          value instanceof Uint8Array
        ) {
          const record = JSON.parse(new TextDecoder().decode(value)) as OperationRecord;
          if (record.phase !== phase || record.revision !== (phase === 'in-flight' ? 1 : 2))
            return request;
          hits++;
          transaction.addEventListener(
            'complete',
            () => {
              completed++;
              terminal.resolve();
            },
            { once: true }
          );
          transaction.addEventListener(
            'abort',
            () => {
              aborted++;
              terminal.resolve();
            },
            { once: true }
          );
          callback(request, transaction);
        }
        return request;
      }
    );
    return { restore, terminal: terminal.promise, counts: () => [hits, completed, aborted] };
  };
  const finalFence = (owner: ProviderBaselineOwner) => {
    fact(databasePrototype);
    const prototype = databasePrototype!,
      original = prototype.transaction;
    let hits = 0,
      completed = 0,
      keyHits = 0;
    const restore = replace(
      prototype,
      'transaction',
      function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        const transaction = original.apply(this, args);
        if (
          !hits &&
          this.name === databaseName &&
          args[1] === 'readwrite' &&
          canonical([...transaction.objectStoreNames]) === canonical(['operations', 'owner'])
        ) {
          hits++;
          // This observer is registered before TransactionSession installs oncomplete.
          // The native request verifies the exact bound key; the owner still performs its own scan.
          const request = transaction.objectStore('operations').get('operation-synthetic');
          request.addEventListener(
            'success',
            () => {
              const record = JSON.parse(
                new TextDecoder().decode(request.result as Uint8Array)
              ) as OperationRecord;
              if (record.phase === 'in-flight' && record.revision === 1) keyHits++;
            },
            { once: true }
          );
          transaction.addEventListener(
            'complete',
            () => {
              completed++;
              if (keyHits === 1) owner.close();
            },
            { once: true }
          );
        }
        return transaction;
      }
    );
    return { restore, counts: () => [hits, completed, keyHits] };
  };
  try {
    const random = env.crypto.getRandomValues(new Uint8Array(12));
    databaseName =
      'liska-baseline-owner-v2-lifecycle-acceptance-' +
      Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
    fact(/^liska-baseline-owner-v2-lifecycle-acceptance-[a-f0-9]{24}$/.test(databaseName));
    check();
    fact(env.networkCalls() === 0);
    for (const effect of [
      () => guarded.open('liska-baseline-owner-v2', 1),
      () => guarded.open('liska-baseline-owner-v1', 1),
      () => guarded.open('foreign', 1),
      () => guarded.open(databaseName, 2),
      () => guarded.open(databaseName),
      () => guarded.deleteDatabase('liska-baseline-owner-v2'),
      () => guarded.deleteDatabase('foreign'),
    ]) {
      let refused = false;
      try {
        effect();
      } catch {
        refused = true;
      }
      fact(refused);
    }
    fact(denied === 7 && opens === 0 && deletes === 0);
    pass(current, [denied, opens, deletes]);
    // Provider-separated exact catalog identities are setup facts, not another acceptance row.
    const mixed = await catalog(hash, ['chatgpt', 'claude']);
    fact(
      mixed.selection[0].conversationId === mixed.selection[1].conversationId &&
        mixed.selection[0].conversationKey !== mixed.selection[1].conversationKey
    );

    current = 'claim-consume-once';
    {
      const context = await setup(),
        available = await claim(context);
      let calls = 0;
      const first = settle(
        context.port.consumeDispatch(available.token, context.record.operation, () => {
          calls++;
          return 1;
        })
      );
      const second = settle(
        context.port.consumeDispatch(available.token, context.record.operation, () => {
          calls++;
          return 2;
        })
      );
      fact((await first) === 'fulfilled' && (await second) === 'transition-failed' && calls === 1);
      await rejectedCode(
        () =>
          context.port.consumeDispatch(available.token, context.record.operation, () => {
            calls++;
          }),
        'transition-failed'
      );
      await verify(context.owner, context.immutable);
      pass(current, [0, 1, calls, 1]);
      await endLifecycle();
    }
    current = 'pause-late-evidence';
    {
      const context = await setup(),
        available = await claim(context),
        held = deferred(),
        entered = deferred();
      gates.push({ release: held.resolve });
      let calls = 0;
      const work = tracked(
        context.port.consumeDispatch(available.token, context.record.operation, async () => {
          calls++;
          entered.resolve();
          await held.promise;
          return 1;
        })
      );
      await bounded(entered.promise);
      context.clock.value = 104;
      await context.owner.applyControl(3, { kind: 'pause', now: 104 });
      const value = await verify(context.owner, context.immutable);
      fact(
        value.checkpoint.control === 'paused' &&
          value.checkpoint.revision === 5 &&
          value.operations[0].phase === 'unknown' &&
          value.operations[0].interruptionReason === 'pause' &&
          value.operations[0].revision === 2
      );
      held.resolve();
      fact((await bounded(work)) === 1 && calls === 1);
      await evidence(context, context.port, 2);
      pass(current, [1, 2, 3, 1, 1]);
      await endLifecycle();
    }
    current = 'restart-late-evidence';
    {
      const context = await setup('claude'),
        available = await claim(context),
        held = deferred(),
        entered = deferred();
      gates.push({ release: held.resolve });
      let calls = 0;
      const work = tracked(
        context.port.consumeDispatch(available.token, context.record.operation, async () => {
          calls++;
          entered.resolve();
          await held.promise;
          return 1;
        })
      );
      await bounded(entered.promise);
      context.owner.close();
      const reopened = await fresh();
      await reopened.recoverAfterRestart(3, 104, signal());
      const value = await verify(reopened, context.immutable);
      fact(
        value.checkpoint.control === 'paused' &&
          value.checkpoint.revision === 5 &&
          value.operations[0].phase === 'unknown' &&
          value.operations[0].interruptionReason === 'restart'
      );
      await rejectedCode(
        () =>
          context.port.consumeDispatch(available.token, context.record.operation, () => {
            calls++;
          }),
        'closed'
      );
      const port = await bind(reopened, context.identity, (context.clock = { value: 105 }));
      held.resolve();
      fact((await bounded(work)) === 1 && calls === 1);
      await evidence({ ...context, owner: reopened }, port, 2);
      pass(current, [1, 2, 3, 1, 1]);
      await endLifecycle();
    }
    current = 'claim-committed-revoked';
    {
      const pauseGate = gate(),
        context = await setup('chatgpt', pauseGate.hash);
      let pause: Promise<ProviderOwnerSnapshot> | undefined;
      const hook = putHook('in-flight', () => {
        pauseGate.arm();
        pause = tracked(context.owner.applyControl(3, { kind: 'pause', now: 104 }));
      });
      try {
        const result = await context.port.claimDispatch(0);
        fact(
          result.dispatch === 'revoked' &&
            !('token' in result) &&
            result.record.phase === 'in-flight' &&
            result.record.revision === 1
        );
        fact(pause);
        await bounded(pauseGate.entered);
        const committed = await verify(context.owner, context.immutable);
        fact(
          committed.operations[0].phase === 'in-flight' &&
            committed.operations[0].revision === 1 &&
            committed.checkpoint.control === 'active' &&
            committed.checkpoint.revision === 3
        );
        pauseGate.release();
        await bounded(pause!);
        const value = await verify(context.owner, context.immutable);
        fact(
          value.operations[0].phase === 'unknown' &&
            value.operations[0].interruptionReason === 'pause' &&
            value.checkpoint.control === 'paused'
        );
        fact(canonical(hook.counts()) === canonical([1, 1, 0]));
        pass(current, [1, 1, 0, 2]);
      } finally {
        hook.restore();
      }
      await endLifecycle();
    }
    current = 'consume-final-fence';
    {
      const context = await setup(),
        available = await claim(context);
      const before = await inventory(),
        hook = finalFence(context.owner);
      let calls = 0;
      try {
        await rejectedCode(
          () =>
            context.port.consumeDispatch(available.token, context.record.operation, () => {
              calls++;
            }),
          'closed'
        );
        fact(calls === 0 && canonical(hook.counts()) === canonical([1, 1, 1]));
      } finally {
        hook.restore();
      }
      fact((await inventory()) === before);
      pass(current, [1, 1, 1, calls]);
      await endLifecycle();
    }
    current = 'two-handle-claim-cas';
    {
      const race = gate(),
        a = await setup('chatgpt', race.hash);
      // Both native connections are recovered while paused, then explicitly activated at current revisions.
      const paused = await a.owner.applyControl(2, { kind: 'pause', now: 103 });
      await verify(a.owner, a.immutable);
      const bOwner = await fresh();
      await a.owner.recoverAfterRestart(paused.checkpoint.revision, 104, signal());
      await verify(a.owner, a.immutable);
      await bOwner.recoverAfterRestart(paused.checkpoint.revision, 104, signal());
      await verify(bOwner, a.immutable);
      const aActive = await a.owner.applyControl(3, { kind: 'activate', now: 105 });
      await verify(a.owner, a.immutable);
      await bOwner.applyControl(aActive.checkpoint.revision, { kind: 'activate', now: 106 });
      await verify(bOwner, a.immutable);
      a.clock.value = 107;
      const aPort = await bind(a.owner, a.identity, a.clock);
      const bPort = await bind(bOwner, a.identity, { value: 107 });
      race.arm();
      const losing = settle(aPort.claimDispatch(0));
      await bounded(
        Promise.race([
          race.entered,
          losing.then(() => {
            throw new Error('acceptance-failed');
          }),
        ])
      );
      const winner = await bPort.claimDispatch(0);
      fact(winner.dispatch === 'available');
      if (winner.dispatch === 'available') tokens.add(winner.token);
      await verify(bOwner, a.immutable);
      race.release();
      fact((await bounded(losing)) === 'revision-conflict');
      const value = await verify(bOwner, a.immutable);
      fact(value.operations.length === 1 && value.operations[0].revision === 1);
      pass(current, [1, 1, 1, 1, 1]);
      await endLifecycle();
    }
    current = 'consume-inventory-fence';
    {
      const context = await setup(),
        available = await claim(context);
      await context.owner.applyControl(3, { kind: 'set-cooldown', now: 104, until: 110 });
      const value = await verify(context.owner, context.immutable),
        before = await inventory();
      fact(value.operations[0].revision === 1 && value.checkpoint.revision === 4);
      let calls = 0;
      await rejectedCode(
        () =>
          context.port.consumeDispatch(available.token, context.record.operation, () => {
            calls++;
          }),
        'revision-conflict'
      );
      await rejectedCode(
        () =>
          context.port.consumeDispatch(available.token, context.record.operation, () => {
            calls++;
          }),
        'transition-failed'
      );
      fact(calls === 0 && (await inventory()) === before);
      pass(current, [4, 1, 0, 1]);
      await endLifecycle();
    }
    current = 'interruption-observation';
    {
      const context = await setup();
      const available = await claim(context);
      context.clock.value = 104;
      const result = await context.port.markExecutionUnknown(1, 'capture-failed');
      const value = await verify(context.owner, context.immutable);
      fact(
        result.revision === 2 &&
          result.phase === 'unknown' &&
          result.interruptionReason === 'capture-failed' &&
          value.checkpoint.control === 'paused' &&
          value.checkpoint.revision === 5
      );
      const before = await inventory();
      let calls = 0;
      await rejectedCode(
        () =>
          context.port.consumeDispatch(available.token, context.record.operation, () => {
            calls++;
          }),
        'candidate-unavailable'
      );
      fact(calls === 0 && (await inventory()) === before);
      pass(current, [2, 5, 1, calls]);
      await endLifecycle();
    }
    current = 'evidence-atomic-abort';
    {
      const context = await setup();
      await claim(context);
      const receipts = await strictReceipts(context.record),
        before = await inventory();
      let success = 0;
      const hook = putHook('awaiting-resolution', (request, transaction) => {
        request.addEventListener(
          'success',
          () => {
            success++;
            transaction.abort();
          },
          { once: true }
        );
      });
      try {
        await rejectedCode(
          () => context.port.recordProducerReceipts(1, receipts),
          'transaction-aborted'
        );
        // Native owner onabort can release promise continuations before this later
        // observer runs. Await its real terminal observation before reading counters.
        await bounded(hook.terminal);
        fact(canonical(hook.counts()) === canonical([1, 0, 1]) && success === 1);
      } finally {
        hook.restore();
      }
      fact((await inventory()) === before);
      // This fenced lifecycle is never repaired/retried/reopened.
      pass(current, [1, 1, 1, 1]);
    }
  } catch (error) {
    // A scheduling failure cannot conceal an independently observed correctness failure.
    const timingOnly =
      error instanceof Unproven || (interruptedHash && !(error instanceof AcceptanceFailure));
    if (timingOnly) uncertain = true;
    else failed = true;
    rows.set(current, { id: current, status: timingOnly ? 'INCONCLUSIVE' : 'FAIL', metrics: [] });
  } finally {
    release();
    restorers.forEach(restore => restore());
    close();
    try {
      await bounded(Promise.allSettled([...pending]));
      if (databaseName) await remove();
      finalCleanup = true;
      fact(databaseName && !cleanupFailed && deleted === deletes && deleted >= 1);
      tokens.clear();
      rows.set('cleanup', {
        id: 'cleanup',
        status: 'PASS',
        metrics: [cap(opens), cap(deletes), cap(deleted), cap(denied)],
      });
    } catch {
      failed = true;
      finalCleanup = true;
      rows.set('cleanup', {
        id: 'cleanup',
        status: 'FAIL',
        metrics: [cap(opens), cap(deletes), cap(deleted), cap(denied)],
      });
    }
    const probeStart = env.monotonicNow();
    await new Promise<void>(resolve => env.timers.setTimeout(resolve, 10));
    const probeMs = env.monotonicNow() - probeStart;
    if (probeMs < 5 || probeMs > 1000 || !Number.isFinite(probeMs)) uncertain = true;
    try {
      check();
    } catch {
      uncertain = true;
    }
    stopped = true;
    env.timers.clearTimeout(heartbeat);
    env.timers.clearTimeout(timeout);
    rows.set('visibility-deadline', {
      id: 'visibility-deadline',
      status: uncertain ? 'INCONCLUSIVE' : 'PASS',
      metrics: [Number(env.remainedVisible()), cap(probeMs), cap(maxGap)],
    });
    const network = env.networkCalls();
    if (network !== 0) failed = true;
    rows.set('network-denial', {
      id: 'network-denial',
      status: network === 0 ? 'PASS' : 'FAIL',
      metrics: [cap(network)],
    });
  }
  if (!failed && !uncertain && ROW_IDS.some(id => rows.get(id)?.status !== 'PASS')) failed = true;
  const status: Status = failed ? 'FAIL' : uncertain ? 'INCONCLUSIVE' : 'PASS';
  return Object.freeze({
    schema: 'liska-provider-owner-lifecycle-native-receipt/1',
    status,
    code: failed ? 'acceptance-failed' : uncertain ? 'native-scheduling-unproven' : 'none',
    rows: Object.freeze(
      ROW_IDS.map<Row>(
        id => rows.get(id) ?? { id, status: uncertain ? 'INCONCLUSIVE' : 'FAIL', metrics: [] }
      )
    ),
    elapsedMs: cap(env.monotonicNow() - started),
    maxGapMs: cap(maxGap),
  });
}
function operationIds(operation: { operationId: string; attemptId: string; captureId: string }) {
  return {
    operationId: operation.operationId,
    attemptId: operation.attemptId,
    captureId: operation.captureId,
  };
}
