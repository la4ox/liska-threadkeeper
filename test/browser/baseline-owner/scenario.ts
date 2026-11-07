/** Browser-safe bounded acceptance scenario. Never returns identities, bytes or errors. */
import { encodeSnapshotCatalog } from '../../../src/archive/catalog/encode';
import { conversationKeyInput } from '../../../src/archive/catalog/conversation-key';
import type { SnapshotCatalog, SnapshotCatalogEntry } from '../../../src/archive/catalog/contracts';
import {
  createBaselineOwner,
  type BaselineOwner,
  type OwnerSnapshot,
  type OwnerTimers,
} from '../../../src/resumability-journal/baseline-owner';
import { createChatGptExecution } from '../../../src/resumability-journal/execution-coordinator';
import { encodeRecord } from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import {
  FILE_ASSURANCE,
  OBSIDIAN_ASSURANCE,
  STRICT_COMPLETENESS,
} from '../../../src/resumability-journal/purpose/contracts';
import { effectCounts, syntheticStagedCapabilities } from './capabilities';

export const ROW_IDS = [
  'catalog',
  'guarded-database',
  'paused-plan',
  'atomic-reservation',
  'staged-execution',
  'latest-observation',
  'explicit-second-reservation',
  'reopen-recovery',
  'inflight-close',
  'inflight-recovery',
  'cleanup',
  'visibility-deadline',
  'network-denial',
  'denied-ambient-effects',
] as const;
export type RowId = (typeof ROW_IDS)[number];
export type Status = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export interface Row {
  readonly id: RowId;
  readonly status: Status;
  readonly metrics: readonly number[];
}
export interface Receipt {
  readonly status: Status;
  readonly code: 'none' | 'acceptance-failed' | 'native-scheduling-unproven';
  readonly rows: readonly Row[];
  readonly elapsedMs: number;
  readonly maxGapMs: number;
}
export interface ScenarioEnvironment {
  readonly indexedDB: IDBFactory;
  readonly crypto: Pick<Crypto, 'getRandomValues' | 'subtle'>;
  readonly timers: OwnerTimers;
  readonly monotonicNow: () => number;
  /** Must latch any hidden state for the entire run, not just sample current visibility. */
  readonly remainedVisible: () => boolean;
  readonly networkCalls: () => number;
  readonly ambientCalls: () => number;
}
const cap = (value: number) => Math.min(1_000_000, Math.max(0, Math.round(value) || 0));
const signal = () => new AbortController().signal;
const requireFact = (value: unknown) => {
  if (!value) throw new Error('acceptance-failed');
};
class Unproven extends Error {}
const ids = (suffix: string) => ({
  operationId: 'operation-' + suffix,
  attemptId: 'attempt-' + suffix,
  captureId: 'capture-chatgpt-' + suffix,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
async function rejected(effect: () => Promise<unknown>) {
  try {
    await effect();
    return false;
  } catch {
    return true;
  }
}
async function catalog(sha256: (bytes: Uint8Array) => Promise<string>) {
  const selection = await Promise.all(
    [1, 2].map(async index => {
      const conversationId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      return {
        provider: 'chatgpt',
        conversationId,
        conversationKey:
          `liska-conversation-key/1:${await sha256(conversationKeyInput('chatgpt', conversationId))}` as const,
      };
    })
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
      manifestSha256: await sha256(new TextEncoder().encode('{}')),
      manifestByteLength: 2,
      captureId: 'previous-' + index,
      capturedAt: '2026-11-07T00:00:00.000Z',
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
    selectedFileCount: 2,
    selectedManifestCount: 2,
    unassociatedFileCount: 0,
    entries,
  };
  const bytes = encodeSnapshotCatalog(value);
  const again = encodeSnapshotCatalog(value);
  requireFact(
    bytes.length < 8192 &&
      bytes.length === again.length &&
      bytes.every((byte, index) => byte === again[index])
  );
  return { bytes, selection };
}

export async function runBaselineOwnerScenario(env: ScenarioEnvironment): Promise<Receipt> {
  const rows = new Map<RowId, Row>();
  let current: RowId = 'catalog';
  let uncertain = false,
    failed = false;
  const owners = new Set<BaselineOwner>();
  const counts = effectCounts();
  let opens = 0,
    deletes = 0,
    denied = 0;
  let databaseName = '';
  let deadline = false,
    last = env.monotonicNow(),
    maxGap = 0;
  const started = last;
  const gate = deferred();
  const expired = deferred();
  let pending: Promise<unknown> | undefined;
  let heartbeat: unknown;
  let stopHeartbeat = false;
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
  const pulse = () => {
    if (stopHeartbeat) return;
    try {
      check();
    } catch {
      owners.forEach(owner => owner.close());
      gate.resolve();
      expired.resolve();
    }
    heartbeat = env.timers.setTimeout(pulse, 25);
  };
  const pass = (id: RowId, metrics: number[]) => {
    check();
    rows.set(id, { id, status: 'PASS', metrics: metrics.map(cap) });
  };
  const sha256 = async (bytes: Uint8Array) => {
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
  const guarded = {
    open(name: string, version?: number) {
      if (name !== databaseName || version !== 1 || !databaseName) {
        denied++;
        throw new Error('guard-denied');
      }
      opens++;
      return env.indexedDB.open(name, version);
    },
    deleteDatabase(name: string) {
      if (name !== databaseName || !databaseName) {
        denied++;
        throw new Error('guard-denied');
      }
      deletes++;
      return env.indexedDB.deleteDatabase(name);
    },
  } as IDBFactory;
  const remove = () =>
    new Promise<void>((resolve, reject) => {
      const timer = env.timers.setTimeout(() => {
        uncertain = true;
        reject(new Unproven());
      }, 1500);
      try {
        const request = guarded.deleteDatabase(databaseName);
        request.onsuccess = () => {
          env.timers.clearTimeout(timer);
          resolve();
        };
        request.onerror = request.onblocked = () => {
          env.timers.clearTimeout(timer);
          reject(new Error('cleanup-failed'));
        };
      } catch (error) {
        env.timers.clearTimeout(timer);
        reject(error);
      }
    });
  const settings = () => ({
    indexedDB: guarded,
    databaseName,
    sha256,
    timers: env.timers,
    openTimeoutMs: 1500,
    transactionTimeoutMs: 1500,
  });
  const fresh = async () => {
    check();
    const owner = createBaselineOwner(settings());
    owners.add(owner);
    await owner.open();
    return owner;
  };
  const snapshot = async (owner: BaselineOwner) => {
    const value = await owner.readSnapshot();
    requireFact(value);
    return value!;
  };
  const latest = async (value: OwnerSnapshot, operationIndex: number) => {
    const record = value.operations[operationIndex];
    const observation = [...value.checkpoint.observations]
      .reverse()
      .find(item => item.operationId === record.operation.operationId);
    return (
      observation?.recordRevision === record.revision &&
      observation.recordSha256 === (await sha256(encodeRecord(record)))
    );
  };
  const timeout = env.timers.setTimeout(() => {
    deadline = true;
    uncertain = true;
    owners.forEach(owner => owner.close());
    gate.resolve();
    expired.resolve();
  }, 15000);
  heartbeat = env.timers.setTimeout(pulse, 25);
  try {
    check();
    requireFact(env.networkCalls() === 0 && env.ambientCalls() === 0);
    const data = await catalog(sha256);
    pass('catalog', [2, 1]);
    current = 'guarded-database';
    const random = env.crypto.getRandomValues(new Uint8Array(12));
    databaseName =
      'liska-baseline-owner-v1-native-acceptance-' +
      Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
    requireFact(/^liska-baseline-owner-v1-native-acceptance-[a-f0-9]{24}$/.test(databaseName));
    for (const effect of [
      () => guarded.open('liska-baseline-owner-v1', 1),
      () => guarded.open(databaseName, 2),
      () => guarded.deleteDatabase('liska-baseline-owner-v1'),
    ]) {
      let refused = false;
      try {
        effect();
      } catch {
        refused = true;
      }
      requireFact(refused);
    }
    requireFact(denied === 3 && opens === 0 && deletes === 0);
    pass('guarded-database', [denied, opens, deletes]);
    const requirements = {
      purpose: 'new-capture' as const,
      destinations: [
        { destination: 'file' as const, assurance: FILE_ASSURANCE },
        { destination: 'obsidian' as const, assurance: OBSIDIAN_ASSURANCE },
      ],
      completenessPolicy: STRICT_COMPLETENESS,
    };
    const initialize = async () => {
      const owner = await fresh();
      const paused = await owner.create(
        data.bytes,
        { ...requirements, selection: data.selection },
        { now: 100, windowId: 'synthetic', maxReservationSlots: 4 },
        signal()
      );
      requireFact(
        paused.checkpoint.control === 'paused' &&
          paused.checkpoint.revision === 0 &&
          paused.operations.length === 0
      );
      await owner.applyControl(0, { kind: 'activate', now: 101 });
      const reserved = await owner.reserveNextChatGpt(1, data.bytes, ids('1'), 102, signal());
      return { owner, paused, reserved };
    };
    current = 'paused-plan';
    const first = await initialize();
    pass('paused-plan', [first.paused.checkpoint.revision, first.paused.operations.length]);
    current = 'atomic-reservation';
    const { reserved, owner } = first;
    requireFact(
      reserved.record.phase === 'reserved' &&
        reserved.snapshot.checkpoint.links.length === 1 &&
        reserved.snapshot.checkpoint.charges.length === 1 &&
        (await latest(reserved.snapshot, 0))
    );
    pass('atomic-reservation', [
      reserved.snapshot.checkpoint.revision,
      reserved.record.revision,
      1,
      1,
    ]);
    const identity = {
      ...ids('1'),
      planSha256: reserved.snapshot.plan.planSha256,
      item: reserved.item,
    };
    const port = await owner.createExecutionPort(identity, { now: () => 103 });
    current = 'staged-execution';
    const handle = createChatGptExecution(
      {
        store: port,
        prepared: reserved.prepared,
        expectedReservedRevision: 0,
        noteFileName: 'synthetic.md',
        signal: signal(),
      },
      syntheticStagedCapabilities(sha256, counts, check)
    );
    const running = handle.run();
    const cached = handle.run() === running;
    pending = running;
    const result = await running;
    pending = undefined;
    rows.set('staged-execution', {
      id: 'staged-execution',
      status: 'FAIL',
      metrics: [
        Number(cached),
        counts.request,
        counts.sink,
        counts.stageIssue,
        counts.stageCreate,
        counts.stageRead,
        counts.stageRelease,
        counts.stageTransfer,
        counts.verifiedArtifacts,
        Number(result.code === 'evidence-recorded'),
        Number(result.evidence.state === 'committed'),
        Number(result.evidence.record?.phase === 'awaiting-resolution'),
      ],
    });
    requireFact(
      cached &&
        result.code === 'evidence-recorded' &&
        result.evidence.state === 'committed' &&
        result.evidence.record?.phase === 'awaiting-resolution' &&
        counts.request === 1 &&
        counts.sink === 3 &&
        counts.stageIssue === 1 &&
        counts.stageCreate === 0 &&
        counts.stageRead === 34 &&
        counts.stageRelease === 0 &&
        counts.stageTransfer === 1 &&
        counts.verifiedArtifacts === 5
    );
    requireFact(
      result.stageOwnership?.filter(item => item.event === 'transferred').length === 1 &&
        result.archiveWrites?.every(item => item.state === 'returned')
    );
    pass('staged-execution', [
      Number(cached),
      counts.request,
      counts.sink,
      counts.stageIssue,
      counts.stageCreate,
      counts.stageRead,
      counts.stageRelease,
      counts.stageTransfer,
      counts.verifiedArtifacts,
    ]);
    current = 'latest-observation';
    const completed = await snapshot(owner);
    requireFact(
      completed.operations.length === 1 &&
        completed.operations[0].disposition === 'open' &&
        completed.operations[0].revision === 2 &&
        completed.checkpoint.observations.length === 3 &&
        completed.checkpoint.links.length === 1 &&
        completed.checkpoint.charges.length === 1 &&
        (await latest(completed, 0))
    );
    pass('latest-observation', [completed.checkpoint.revision, 2, 3, 1, 1, 1]);
    current = 'explicit-second-reservation';
    const second = await owner.reserveNextChatGpt(
      completed.checkpoint.revision,
      data.bytes,
      ids('2'),
      104,
      signal()
    );
    requireFact(
      second.item.ordinal !== reserved.item.ordinal &&
        second.record.phase === 'reserved' &&
        counts.request === 1 &&
        counts.sink === 3 &&
        second.snapshot.checkpoint.links.length === 2 &&
        second.snapshot.checkpoint.charges.length === 2
    );
    pass('explicit-second-reservation', [
      second.snapshot.checkpoint.revision,
      2,
      2,
      counts.request,
      counts.sink,
    ]);
    current = 'reopen-recovery';
    owner.close();
    const reopened = await fresh();
    const beforeRecoveryEffects = { ...counts };
    const before = await snapshot(reopened);
    requireFact(JSON.stringify(before) === JSON.stringify(second.snapshot));
    const recovered = await reopened.recoverAfterRestart(before.checkpoint.revision, 105, signal());
    const recoveredPort = await reopened.createExecutionPort(identity, { now: () => 106 });
    let growth = 0;
    const effect = async () => {
      growth++;
    };
    const noToken = await rejected(() =>
      recoveredPort.consumeDispatch(Object.freeze({}), reserved.prepared.operation, effect)
    );
    const oldDenied = await rejected(() => port.claimDispatch(ids('1').operationId, 0));
    requireFact(
      recovered.checkpoint.control === 'paused' &&
        noToken &&
        oldDenied &&
        growth === 0 &&
        JSON.stringify(recovered.operations) === JSON.stringify(before.operations) &&
        JSON.stringify(recovered.checkpoint.links) === JSON.stringify(before.checkpoint.links) &&
        JSON.stringify(recovered.checkpoint.charges) ===
          JSON.stringify(before.checkpoint.charges) &&
        JSON.stringify(recovered.checkpoint.observations) ===
          JSON.stringify(before.checkpoint.observations) &&
        counts.request === 1 &&
        counts.sink === 3
    );
    const effectsUnchanged = Object.keys(counts).every(
      key =>
        counts[key as keyof typeof counts] === beforeRecoveryEffects[key as keyof typeof counts]
    );
    requireFact(effectsUnchanged);
    pass('reopen-recovery', [
      recovered.checkpoint.revision,
      recovered.checkpoint.observations.length,
      recovered.checkpoint.links.length,
      recovered.checkpoint.charges.length,
      Number(noToken),
      Number(oldDenied),
      growth,
      counts.request - beforeRecoveryEffects.request,
      counts.sink - beforeRecoveryEffects.sink,
      Number(effectsUnchanged),
    ]);
    reopened.close();
    await remove(); // Independent second case: no retained plan or operations from the completed case.
    current = 'inflight-close';
    const independent = await initialize();
    const independentIdentity = {
      ...ids('1'),
      planSha256: independent.reserved.snapshot.plan.planSha256,
      item: independent.reserved.item,
    };
    const oldPort = await independent.owner.createExecutionPort(independentIdentity, {
      now: () => 103,
    });
    const claim = await oldPort.claimDispatch(ids('1').operationId, 0);
    const entered = deferred();
    pending = oldPort.consumeDispatch(
      claim.token,
      independent.reserved.prepared.operation,
      async () => {
        check();
        counts.request++;
        entered.resolve();
        await gate.promise;
        return 1;
      }
    );
    // Attach rejection handling before closing any authority, then drain the started effect.
    const drained = pending.then(
      () => 1,
      () => 0
    );
    await Promise.race([
      entered.promise,
      drained.then(() => {
        throw new Error('request-not-started');
      }),
    ]);
    independent.owner.close();
    gate.resolve();
    requireFact((await drained) === 1);
    pending = undefined;
    pass('inflight-close', [counts.request, counts.sink, claim.record.revision]);
    current = 'inflight-recovery';
    const restarted = await fresh();
    const beforeRestartEffects = { ...counts };
    const retained = await snapshot(restarted);
    requireFact(
      retained.operations[0].phase === 'in-flight' &&
        retained.operations[0].revision === 1 &&
        (await latest(retained, 0))
    );
    const resumed = await restarted.recoverAfterRestart(
      retained.checkpoint.revision,
      104,
      signal()
    );
    const newPort = await restarted.createExecutionPort(independentIdentity, { now: () => 105 });
    const oldToken = await rejected(() =>
      oldPort.consumeDispatch(claim.token, independent.reserved.prepared.operation, effect)
    );
    const foreignToken = await rejected(() =>
      newPort.consumeDispatch(claim.token, independent.reserved.prepared.operation, effect)
    );
    const cannotClaim = await rejected(() => newPort.claimDispatch(ids('1').operationId, 2));
    requireFact(
      resumed.checkpoint.control === 'paused' &&
        resumed.operations[0].phase === 'unknown' &&
        resumed.operations[0].interruptionReason === 'restart' &&
        resumed.operations[0].revision === 2 &&
        resumed.operations[0].disposition === 'open' &&
        (await latest(resumed, 0)) &&
        resumed.checkpoint.links.length === 1 &&
        resumed.checkpoint.charges.length === 1 &&
        oldToken &&
        foreignToken &&
        cannotClaim &&
        growth === 0 &&
        counts.request === 2 &&
        counts.sink === 3
    );
    const restartEffectsUnchanged = Object.keys(counts).every(
      key => counts[key as keyof typeof counts] === beforeRestartEffects[key as keyof typeof counts]
    );
    requireFact(restartEffectsUnchanged);
    pass('inflight-recovery', [
      resumed.checkpoint.revision,
      2,
      resumed.checkpoint.observations.length,
      1,
      1,
      Number(oldToken),
      Number(foreignToken),
      Number(cannotClaim),
      growth,
      counts.request - beforeRestartEffects.request,
      counts.sink - beforeRestartEffects.sink,
      Number(restartEffectsUnchanged),
    ]);
  } catch (error) {
    if (error instanceof Unproven || uncertain || deadline) uncertain = true;
    else failed = true;
    rows.set(current, {
      id: current,
      status: uncertain ? 'INCONCLUSIVE' : 'FAIL',
      metrics: rows.get(current)?.metrics ?? [],
    });
  } finally {
    owners.forEach(owner => owner.close());
    gate.resolve();
    try {
      if (pending) await pending.catch(() => undefined);
      if (databaseName) await remove();
      requireFact(databaseName && opens === 4 && deletes === 2 && denied === 3);
      rows.set('cleanup', { id: 'cleanup', status: 'PASS', metrics: [opens, deletes, denied] });
    } catch {
      if (!uncertain) failed = true;
      rows.set('cleanup', {
        id: 'cleanup',
        status: uncertain ? 'INCONCLUSIVE' : 'FAIL',
        metrics: [cap(opens), cap(deletes), cap(denied)],
      });
    }
    // A real native scheduling probe is mandatory even if the scenario finished within one pulse.
    const probeStart = env.monotonicNow();
    await new Promise<void>(resolve => env.timers.setTimeout(resolve, 10));
    const probeMs = env.monotonicNow() - probeStart;
    if (probeMs < 5 || probeMs > 1000) uncertain = true;
    try {
      check();
    } catch {
      uncertain = true;
    }
    stopHeartbeat = true;
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
    const ambient = env.ambientCalls();
    if (ambient !== 0) failed = true;
    rows.set('denied-ambient-effects', {
      id: 'denied-ambient-effects',
      status: ambient === 0 ? 'PASS' : 'FAIL',
      metrics: [cap(ambient)],
    });
  }
  if (!failed && !uncertain && ROW_IDS.some(id => rows.get(id)?.status !== 'PASS')) failed = true;
  const status: Status = failed ? 'FAIL' : uncertain ? 'INCONCLUSIVE' : 'PASS';
  return Object.freeze({
    status,
    code: failed ? 'acceptance-failed' : uncertain ? 'native-scheduling-unproven' : 'none',
    rows: Object.freeze(
      ROW_IDS.map<Row>(
        id =>
          rows.get(id) ?? {
            id,
            status: status === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'FAIL',
            metrics: [],
          }
      )
    ),
    elapsedMs: cap(env.monotonicNow() - started),
    maxGapMs: cap(maxGap),
  });
}
