/** Native storage-only acceptance. Identities, bytes, hashes and errors never enter the receipt. */
import { encodeSnapshotCatalog } from '../../../src/archive/catalog/encode';
import { conversationKeyInput } from '../../../src/archive/catalog/conversation-key';
import type { SnapshotCatalog, SnapshotCatalogEntry } from '../../../src/archive/catalog/contracts';
import {
  createProviderBaselineOwner,
  type ProviderBaselineOwner,
  type ProviderOwnerTimers,
  type ProviderReservation,
} from '../../../src/resumability-journal/provider-baseline-owner';
import { encodeRecord } from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import {
  FILE_ASSURANCE,
  STRICT_COMPLETENESS,
} from '../../../src/resumability-journal/purpose/contracts';

export const ROW_IDS = [
  'guarded-database',
  'provider-catalog',
  'paused-create',
  'two-handle-cas',
  'exact-inspection',
  'reopen-inspection-only',
  'paused-recovery',
  'pending-block',
  'stale-session',
  'claude-reservation',
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
  readonly schema: 'liska-provider-owner-native-receipt/1';
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
const fact = (value: unknown): void => {
  if (!value) throw new Error('acceptance-failed');
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

export async function runProviderBaselineOwnerScenario(env: ScenarioEnvironment): Promise<Receipt> {
  const rows = new Map<RowId, Row>();
  let current: RowId = 'guarded-database';
  let uncertain = false,
    failed = false,
    deadline = false,
    stopped = false;
  let last = env.monotonicNow(),
    maxGap = 0;
  const started = last;
  const owners = new Set<ProviderBaselineOwner>();
  const nativeHandles = new Set<IDBDatabase>();
  const pending = new Set<Promise<unknown>>();
  const gates: { release: () => void }[] = [];
  const expired = deferred();
  let databaseName = '',
    opens = 0,
    deletes = 0,
    denied = 0,
    deleted = 0;
  const check = () => {
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
      throw new Unproven();
    }
    last = now;
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
    close();
  }, 15000);
  let heartbeat: unknown;
  const pulse = () => {
    if (stopped) return;
    try {
      check();
    } catch {
      release();
      close();
    }
    heartbeat = env.timers.setTimeout(pulse, 25);
  };
  heartbeat = env.timers.setTimeout(pulse, 25);
  const pass = (id: RowId, metrics: number[]) => {
    check();
    rows.set(id, { id, status: 'PASS', metrics: metrics.map(cap) });
  };
  const hash = async (bytes: Uint8Array) => {
    check();
    const digest = await Promise.race([
      env.crypto.subtle.digest('SHA-256', bytes.slice().buffer),
      expired.promise.then(() => {
        throw new Unproven();
      }),
    ]);
    check();
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
          check();
        }
        return digest;
      },
    };
    gates.push(result);
    return result;
  };
  const guarded = {
    open(name: string, version?: number) {
      if (!databaseName || name !== databaseName || version !== 1) {
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
      const timer = env.timers.setTimeout(() => reject(new Error('cleanup-failed')), 1500);
      const finish = (ok: boolean) => {
        env.timers.clearTimeout(timer);
        if (ok) {
          deleted++;
          resolve();
        } else reject(new Error('cleanup-failed'));
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
        const values: [string, string, number[]][] = [];
        try {
          fact(
            database.version === 1 &&
              canonical([...database.objectStoreNames]) === canonical(['operations', 'owner'])
          );
          const transaction = database.transaction(['operations', 'owner'], 'readonly');
          for (const name of ['operations', 'owner']) {
            const store = transaction.objectStore(name);
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
  const validReservation = async (
    reservation: ProviderReservation,
    provider: string,
    now: number
  ) => {
    noAuthority(reservation);
    const { record, item, snapshot: value } = reservation;
    const operation = record.operation,
      cp = value.checkpoint;
    const bytes = encodeRecord(record);
    fact(new TextDecoder().decode(bytes) === canonical(record));
    fact(
      record.schema === 'liska-resumability-journal/3' &&
        record.revision === 0 &&
        record.phase === 'reserved' &&
        record.control === 'active' &&
        record.disposition === 'open'
    );
    fact(
      item.provider === provider &&
        operation.admission.provider === provider &&
        operation.admission.conversationId === item.conversationId &&
        operation.admission.conversationKey === item.conversationKey
    );
    fact(
      item.conversationKey ===
        'liska-conversation-key/1:' +
          (await hash(conversationKeyInput(item.provider, item.conversationId)))
    );
    fact(value.operations.length === 1 && canonical(value.operations[0]) === canonical(record));
    fact(cp.links.length === 1 && cp.charges.length === 1 && cp.observations.length === 1);
    fact(
      canonical(cp.links[0]) ===
        canonical({
          itemOrdinal: item.ordinal,
          ...operationIds(operation),
          operationSha256: await hash(new TextEncoder().encode(canonical(operation))),
          linkedAt: now,
          windowId: cp.budget.windowId,
        })
    );
    fact(
      canonical(cp.charges[0]) ===
        canonical({
          windowId: cp.budget.windowId,
          itemOrdinal: item.ordinal,
          operationId: operation.operationId,
          chargedAt: now,
        })
    );
    fact(
      canonical(cp.observations[0]) ===
        canonical({
          operationId: operation.operationId,
          recordRevision: 0,
          recordSha256: await hash(bytes),
          observedAt: now,
        })
    );
    const native = JSON.parse(await inventory()) as [string, string, number[]][];
    fact(
      native.length === 2 &&
        native.some(
          ([store, key, raw]) =>
            store === 'operations' &&
            key === operation.operationId &&
            canonical(raw) === canonical([...bytes])
        ) &&
        native.some(
          ([store, key, raw]) =>
            store === 'owner' &&
            key === 'baseline' &&
            canonical(raw) === canonical([...value.ownerBytes])
        )
    );
  };
  const create = async (
    owner: ProviderBaselineOwner,
    data: Awaited<ReturnType<typeof catalog>>
  ) => {
    const value = await owner.create(
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
    noAuthority(value);
    fact(
      value.checkpoint.control === 'paused' &&
        value.checkpoint.revision === 0 &&
        value.operations.length === 0 &&
        value.checkpoint.links.length === 0 &&
        value.checkpoint.charges.length === 0 &&
        value.checkpoint.observations.length === 0
    );
    return value;
  };
  try {
    const random = env.crypto.getRandomValues(new Uint8Array(12));
    databaseName =
      'liska-baseline-owner-v2-native-acceptance-' +
      Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
    fact(/^liska-baseline-owner-v2-native-acceptance-[a-f0-9]{24}$/.test(databaseName));
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
    current = 'provider-catalog';
    const mixed = await catalog(hash, ['claude', 'chatgpt']);
    fact(
      mixed.selection[0].conversationId === mixed.selection[1].conversationId &&
        mixed.selection[0].conversationKey !== mixed.selection[1].conversationKey
    );
    fact(
      canonical([...mixed.bytes]) ===
        canonical([...(await catalog(hash, ['claude', 'chatgpt'])).bytes])
    );
    pass(current, [2, 2, 1]);
    current = 'paused-create';
    const race = gate(),
      a = await fresh(race.hash);
    const paused = await create(a, mixed);
    fact(
      canonical(paused.plan.plan.items.map(item => item.provider)) ===
        canonical(['chatgpt', 'claude'])
    );
    const b = await fresh();
    const bPaused = await b.recoverAfterRestart(0, 100, signal());
    noAuthority(bPaused);
    fact(canonical(bPaused) === canonical(paused));
    const active = await a.applyControl(0, { kind: 'activate', now: 101 });
    noAuthority(active);
    pass(current, [0, 0, 1]);
    current = 'two-handle-cas';
    race.arm();
    const losing = a.reserveNext(1, mixed.bytes, ids('loser'), 102, signal());
    const drained = losing.then(
      () => 'unexpected-success',
      error => (error as { code?: string }).code
    );
    pending.add(drained);
    await Promise.race([
      race.entered,
      drained.then(() => {
        throw new Error('gate-not-entered');
      }),
    ]);
    const winner = await b.reserveNext(1, mixed.bytes, ids('winner'), 102, signal());
    race.release();
    fact((await drained) === 'revision-conflict');
    pending.delete(drained);
    await validReservation(winner, 'chatgpt', 102);
    pass(current, [1, winner.snapshot.checkpoint.revision, 1, 1, 1]);
    current = 'exact-inspection';
    const identity = {
      ...ids('winner'),
      planSha256: winner.snapshot.plan.planSha256,
      item: winner.item,
    };
    const beforeInspect = await inventory();
    const committed = await a.inspectReservation(identity),
      absent = await a.inspectReservation({ ...identity, ...ids('loser') });
    noAuthority(committed);
    noAuthority(absent);
    fact(
      committed.kind === 'committed' &&
        canonical(committed.record) === canonical(winner.record) &&
        absent.kind === 'not-observed'
    );
    await rejectedCode(
      () => a.inspectReservation({ ...identity, attemptId: 'mismatch' }),
      'corrupt-owner'
    );
    fact((await inventory()) === beforeInspect);
    pass(current, [1, 1, 1, 0]);
    a.close();
    b.close();
    current = 'reopen-inspection-only';
    const disposable = await fresh();
    fact(canonical(await snapshot(disposable)) === canonical(winner.snapshot));
    const reopened = await disposable.inspectReservation(identity);
    noAuthority(reopened);
    fact(reopened.kind === 'committed');
    await rejectedCode(
      () => disposable.applyControl(2, { kind: 'pause', now: 103 }),
      'recovery-required'
    );
    fact((await inventory()) === beforeInspect);
    disposable.close();
    pass(current, [1, 1, 0]);
    current = 'paused-recovery';
    const recoveredOwner = await fresh();
    const recovered = await recoveredOwner.recoverAfterRestart(2, 103, signal());
    noAuthority(recovered);
    fact(
      canonical(recovered.checkpoint) ===
        canonical({
          ...winner.snapshot.checkpoint,
          control: 'paused',
          revision: 3,
          observedAt: 103,
        }) && canonical(recovered.operations) === canonical(winner.snapshot.operations)
    );
    const pausedRaw = await inventory();
    const operationBytes = (raw: string) =>
      canonical((JSON.parse(raw) as unknown[][]).filter(entry => entry[0] === 'operations'));
    fact(operationBytes(pausedRaw) === operationBytes(beforeInspect));
    const repeated = await recoveredOwner.recoverAfterRestart(3, 104, signal());
    noAuthority(repeated);
    fact(canonical(repeated) === canonical(recovered) && (await inventory()) === pausedRaw);
    pass(current, [3, 1, 1, 0]);
    current = 'pending-block';
    const reactivated = await recoveredOwner.applyControl(3, { kind: 'activate', now: 105 });
    noAuthority(reactivated);
    const beforeBlocked = await inventory();
    await rejectedCode(
      () => recoveredOwner.reserveNext(4, mixed.bytes, ids('blocked'), 106, signal()),
      'candidate-unavailable'
    );
    fact((await inventory()) === beforeBlocked);
    recoveredOwner.close();
    pass(current, [4, 1, 0]);
    close();
    await remove();
    current = 'stale-session';
    const claude = await catalog(hash, ['claude']);
    const staleGate = gate(),
      stale = await fresh(staleGate.hash);
    await create(stale, claude);
    noAuthority(await stale.applyControl(0, { kind: 'activate', now: 101 }));
    staleGate.arm();
    const old = stale.reserveNext(1, claude.bytes, ids('stale'), 102, signal());
    const staleDrained = old.then(
      () => 'unexpected-success',
      error => (error as { code?: string }).code
    );
    pending.add(staleDrained);
    await Promise.race([
      staleGate.entered,
      staleDrained.then(() => {
        throw new Error('gate-not-entered');
      }),
    ]);
    const sameHandlePaused = await stale.applyControl(1, { kind: 'pause', now: 103 });
    noAuthority(sameHandlePaused);
    fact(
      sameHandlePaused.checkpoint.control === 'paused' &&
        sameHandlePaused.checkpoint.revision === 2 &&
        sameHandlePaused.operations.length === 0
    );
    const beforeStale = await inventory();
    staleGate.release();
    fact((await staleDrained) === 'invalid-input');
    pending.delete(staleDrained);
    fact((await inventory()) === beforeStale);
    stale.close();
    pass(current, [2, 0, 1, 0]);
    current = 'claude-reservation';
    const finalOwner = await fresh();
    fact(canonical(await snapshot(finalOwner)) === canonical(sameHandlePaused));
    const samePaused = await finalOwner.recoverAfterRestart(2, 104, signal());
    noAuthority(samePaused);
    fact(
      canonical(samePaused) === canonical(sameHandlePaused) && (await inventory()) === beforeStale
    );
    noAuthority(await finalOwner.applyControl(2, { kind: 'activate', now: 105 }));
    const claudeReservation = await finalOwner.reserveNext(
      3,
      claude.bytes,
      ids('claude'),
      106,
      signal()
    );
    await validReservation(claudeReservation, 'claude', 106);
    pass(current, [4, 0, 1, 1, 1]);
  } catch (error) {
    if (error instanceof Unproven || uncertain || deadline) uncertain = true;
    else failed = true;
    rows.set(current, { id: current, status: uncertain ? 'INCONCLUSIVE' : 'FAIL', metrics: [] });
  } finally {
    release();
    close();
    try {
      await Promise.allSettled([...pending]);
      if (databaseName) await remove();
      fact(databaseName && deleted === deletes && deleted >= 1);
      rows.set('cleanup', {
        id: 'cleanup',
        status: 'PASS',
        metrics: [cap(opens), cap(deletes), cap(deleted), cap(denied)],
      });
    } catch {
      failed = true;
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
    schema: 'liska-provider-owner-native-receipt/1',
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
