// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createProviderBaselineCheckpoint,
  assertProviderCheckpointPlan,
  assertProviderPlan,
  snapshotProviderBaselineCheckpoint,
  encodeProviderBaselineCheckpoint,
  decodeProviderBaselineCheckpoint,
  reduceProviderBaselineCheckpoint,
  projectProviderBaselineProgress,
  nextProviderBaselineDecision,
  snapshotProviderOperations,
  providerRecordDigest,
  providerOperationDigest,
  MAX_PROVIDER_OPERATIONS,
  PROVIDER_BASELINE_LIMITS,
  PROVIDER_CHECKPOINT_SCHEMA,
  type ProviderBaselineCheckpoint,
} from '../../../src/resumability-journal/provider-baseline';
import {
  createBaselinePlan,
  encodeBaselinePlan,
  snapshotAdmittedPlan,
} from '../../../src/resumability-journal/baseline-plan/plan';
import { detach } from '../../../src/resumability-journal/baseline-plan/data';
import { canonical as canonicalRecord } from '../../../src/resumability-journal/purpose-persistence-v3/core/data';
import {
  encodeRecord,
  snapshotRecord,
  type OperationRecord,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import {
  fixture,
  identity,
  catalogBytes,
  requirements,
  dependencies,
  sha256,
  hash,
  clone,
  command,
  linked,
  reserved,
  observed,
} from './fixtures';

describe('provider-aware checkpoint/2 integration and input fences', () => {
  it('reuses unchanged admitted plan bytes and distinguishes identical conversation IDs across both providers', async () => {
    const selection = [identity(7, 'claude'), identity(7, 'chatgpt'), identity(8, 'claude')];
    const { plan, checkpoint } = await fixture(3, 16, selection);
    const original = encodeBaselinePlan(plan.plan);
    expect(plan.plan.items[0].conversationId).toBe(plan.plan.items[1].conversationId);
    expect(plan.plan.items[0].conversationKey).not.toBe(plan.plan.items[1].conversationKey);
    const records = await Promise.all([0, 1].map(i => observed(reserved(plan, i), 'consistent')));
    let current = await command(plan, checkpoint, { kind: 'activate' });
    for (let i = 0; i < records.length; i++) current = await linked(plan, current, records[i], i);
    expect(current.links).toHaveLength(2);
    expect(current.charges).toHaveLength(2);
    const progress = await projectProviderBaselineProgress(
      plan,
      current,
      [...records].reverse(),
      current.observedAt,
      dependencies()
    );
    expect(progress.items.map(item => item.category)).toEqual([
      'awaiting-resolution',
      'awaiting-resolution',
      'untouched',
    ]);
    expect(progress.items.map(item => item.resolutionRequired)).toEqual([true, true, false]);
    expect(
      await nextProviderBaselineDecision(plan, current, records, current.observedAt, dependencies())
    ).toEqual({
      executionAuthorized: false,
      kind: 'candidate',
      item: plan.plan.items[2],
    });
    expect(encodeBaselinePlan(plan.plan)).toEqual(original);
    expect(hash(original)).toBe(plan.planSha256);
    const crossed = {
      ...records[0],
      operation: {
        ...records[0].operation,
        admission: { ...records[0].operation.admission, provider: 'claude' },
      },
    };
    expect(
      await nextProviderBaselineDecision(
        plan,
        current,
        [crossed, records[1]] as OperationRecord[],
        current.observedAt,
        dependencies()
      )
    ).toMatchObject({ reason: 'conflict' });
  });
  it.each(['gemini', 'chatgpt-extra', 'claude-extra', 'perplexity'])(
    'closes every public plan admission path to unsupported %s',
    async provider => {
      const selection = [identity(0, 'chatgpt'), identity(1, provider)];
      const bytes = await catalogBytes(selection);
      const plan = await createBaselinePlan(bytes, { ...requirements, selection }, dependencies());
      const { checkpoint } = await fixture();
      const bound = { ...checkpoint, planSha256: plan.planSha256 };
      expect(() => assertProviderPlan(plan)).toThrow('invalid-plan');
      expect(() => assertProviderCheckpointPlan(plan, bound)).toThrow('invalid-plan');
      await expect(
        createProviderBaselineCheckpoint(
          plan,
          { now: 100, windowId: 'a', maxReservationSlots: 1 },
          dependencies()
        )
      ).rejects.toThrow('invalid-plan');
      await expect(
        projectProviderBaselineProgress(plan, bound, [], 100, dependencies())
      ).rejects.toThrow('invalid-plan');
      await expect(command(plan, bound, { kind: 'activate' })).rejects.toThrow('invalid-plan');
      expect(await nextProviderBaselineDecision(plan, bound, [], 100, dependencies())).toEqual({
        executionAuthorized: false,
        kind: 'stop',
        reason: 'conflict',
      });
    }
  );
  it('rejects checkpoint/1 and all non-journal/3 records without upgrading or adopting them', async () => {
    const { plan, checkpoint } = await fixture();
    expect(PROVIDER_CHECKPOINT_SCHEMA).toBe('liska-explicit-baseline-checkpoint/2');
    expect(() =>
      snapshotProviderBaselineCheckpoint({
        ...checkpoint,
        schema: 'liska-explicit-baseline-checkpoint/1',
      })
    ).toThrow('invalid-checkpoint');
    for (const schema of [
      'liska-resumability-journal/1',
      'liska-resumability-journal/2',
      'liska-resumability-journal/4',
    ]) {
      const record = { ...reserved(plan), schema };
      expect(() => snapshotProviderOperations([record])).toThrow('corrupt-record');
      await expect(linked(plan, checkpoint, record as never)).rejects.toThrow('corrupt-record');
      expect(
        await nextProviderBaselineDecision(plan, checkpoint, [record] as never, 100, dependencies())
      ).toMatchObject({ reason: 'conflict' });
    }
  });
  it.each(['chatgpt', 'claude'] as const)(
    'hashes exact canonical %s operation and complete journal/3 record bytes, not cached adaptation',
    async provider => {
      const { plan, checkpoint } = await fixture(3, 16, undefined, provider);
      const record = await observed(reserved(plan), 'consistent');
      expect(await providerOperationDigest(record, sha256)).toBe(
        hash(new TextEncoder().encode(canonicalRecord(record.operation)))
      );
      expect(await providerRecordDigest(record, sha256)).toBe(hash(encodeRecord(record)));
      const state = await linked(plan, checkpoint, record);
      expect(state.links[0].operationSha256).toBe(await providerOperationDigest(record, sha256));
      expect(state.observations[0].recordSha256).toBe(hash(encodeRecord(record)));
      for (const changes of [
        { assessment: { kind: 'insufficient', codes: [] } },
        { evidence: { text: 'x'.repeat(2048) } },
      ]) {
        const malformed = snapshotRecord({
          ...record,
          observation: {
            ...record.observation,
            adaptation: { ...record.observation!.adaptation, ...changes },
          },
        });
        expect(snapshotProviderOperations([malformed])).toEqual([malformed]);
        await expect(providerRecordDigest(malformed, sha256)).rejects.toThrow('corrupt-record');
        await expect(linked(plan, checkpoint, malformed)).rejects.toThrow('corrupt-record');
      }
    }
  );
  it('snapshots bounded long/deep journal/3 data without passing whole records through old plan detach; replay still rejects invented evidence', async () => {
    const { plan } = await fixture();
    const record = await observed(reserved(plan));
    let deep: unknown = 'x'.repeat(2048);
    for (let i = 0; i < 17; i++) deep = { deep };
    const current = snapshotRecord({
      ...record,
      observation: {
        ...record.observation,
        adaptation: { ...record.observation!.adaptation, evidence: deep },
      },
    });
    expect(() => detach(current)).toThrow('limit-exceeded');
    expect(snapshotProviderOperations([current])).toEqual([current]);
    expect(encodeRecord(current).length).toBeLessThan(65536);
    await expect(providerRecordDigest(current, sha256)).rejects.toThrow('corrupt-record');
  });
  it('keeps exact full snapshots detached before hash awaits, including plan/checkpoint and direct digest helpers', async () => {
    const { plan, checkpoint } = await fixture();
    const record = clone(await observed(reserved(plan)));
    const expectedRecord = hash(encodeRecord(record));
    expect(
      await providerRecordDigest(record, async bytes => {
        Object.assign(record, { revision: 999 });
        Object.assign(record.operation, { operationId: 'changed' });
        return sha256(bytes);
      })
    ).toBe(expectedRecord);
    const mutablePlan = clone(plan),
      mutableCheckpoint = clone(checkpoint);
    const state = await reduceProviderBaselineCheckpoint(
      mutablePlan,
      mutableCheckpoint,
      { kind: 'activate', expectedRevision: 0, now: 101 },
      {
        ...dependencies(),
        sha256: async bytes => {
          Object.assign(mutablePlan.plan.items[0], { provider: 'gemini' });
          Object.assign(mutableCheckpoint.budget, { maxReservationSlots: 0 });
          return sha256(bytes);
        },
      }
    );
    expect(state.control).toBe('active');
    expect(state.budget.maxReservationSlots).toBe(16);
    expect(snapshotAdmittedPlan(plan)).toEqual(plan);
  });
  it('rejects getters, failing proxies, sparse record lists and forged cached observations with no caller callbacks', async () => {
    const { plan, checkpoint } = await fixture();
    const getter = vi.fn();
    const current = await observed(reserved(plan));
    const recordGetter = Object.defineProperty(clone(current), 'observation', {
      get: getter,
      enumerable: true,
    });
    const failing = new Proxy(current, {
      ownKeys: () => {
        throw new Error('private-proxy-detail');
      },
    });
    for (const input of [[recordGetter], [failing], Array(1)]) {
      expect(() => snapshotProviderOperations(input)).toThrow();
      expect(
        await nextProviderBaselineDecision(plan, checkpoint, input, 100, dependencies())
      ).toMatchObject({ reason: 'conflict' });
    }
    const planGetter = Object.defineProperty(clone(plan), 'plan', {
      get: getter,
      enumerable: true,
    });
    await expect(
      createProviderBaselineCheckpoint(
        planGetter,
        { now: 100, windowId: 'a', maxReservationSlots: 1 },
        dependencies()
      )
    ).rejects.toThrow();
    const commandGetter = Object.defineProperty(
      { kind: 'observe-operation', itemOrdinal: 0, expectedRevision: 0, now: 101 },
      'record',
      { get: getter, enumerable: true }
    );
    await expect(
      reduceProviderBaselineCheckpoint(plan, checkpoint, commandGetter as never, dependencies())
    ).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('exact lifetime ceilings and deterministic precedence', () => {
  it('admits exactly 4096 plan items and closes a 4097th item before checkpoint creation', async () => {
    const { plan } = await fixture();
    const items = Array.from({ length: 4096 }, (_, ordinal) => ({
      ordinal,
      ...identity(ordinal, ordinal % 2 ? 'claude' : 'chatgpt'),
    }))
      .sort(
        (a, b) =>
          a.provider.localeCompare(b.provider) || a.conversationId.localeCompare(b.conversationId)
      )
      .map((item, ordinal) => ({ ...item, ordinal }));
    const large = { ...plan.plan, items };
    const admitted = { plan: large, planSha256: hash(encodeBaselinePlan(large)) };
    expect(
      await createProviderBaselineCheckpoint(
        admitted,
        { now: 100, windowId: 'a', maxReservationSlots: 16 },
        dependencies()
      )
    ).toMatchObject({ revision: 0 });
    expect(() =>
      snapshotAdmittedPlan({
        ...admitted,
        plan: { ...large, items: [...items, { ordinal: 4096, ...identity(4096) }] },
      })
    ).toThrow();
    expect(PROVIDER_BASELINE_LIMITS.maxPlanItems).toBe(4096);
  });
  it('accepts an exact 64 KiB canonical checkpoint, then rejects one additional UTF8 byte without pruning', async () => {
    const { plan, checkpoint } = await fixture();
    const record = snapshotRecord({
      ...reserved(plan),
      operation: {
        ...reserved(plan).operation,
        operationId: 'o'.repeat(256),
        attemptId: 'a'.repeat(256),
        captureId: 'c'.repeat(256),
      },
    });
    const attached = await linked(plan, checkpoint, record);
    const windows = [
      attached.windows[0],
      ...Array.from({ length: 63 }, (_, i) => ({ windowId: 'w' + i, openedAt: 101 })),
    ];
    const candidate = {
      ...attached,
      windows,
      budget: { ...attached.budget, windowId: windows[63].windowId },
      observations: Array.from({ length: 128 }, (_, recordRevision) => ({
        ...attached.observations[0],
        recordRevision,
      })),
    };
    const size = () => new TextEncoder().encode(JSON.stringify(candidate)).length;
    let remaining = 65536 - size();
    expect(remaining).toBeGreaterThan(0);
    for (let i = 1; i < 63 && remaining; i++) {
      const added = Math.min(remaining, 255 - windows[i].windowId.length);
      windows[i].windowId += 'x'.repeat(added);
      remaining -= added;
    }
    expect(remaining).toBe(0);
    const exact = encodeProviderBaselineCheckpoint(candidate);
    expect(exact).toHaveLength(65536);
    expect(encodeProviderBaselineCheckpoint(decodeProviderBaselineCheckpoint(exact))).toEqual(
      exact
    );
    windows[62].windowId += 'x';
    expect(size()).toBe(65537);
    expect(() => encodeProviderBaselineCheckpoint(candidate)).toThrow('invalid-checkpoint');
  });
  it('uses complete 16/17-record snapshots and lifetime observations rather than window replacement for capacity', async () => {
    expect(MAX_PROVIDER_OPERATIONS).toBe(16);
    const { plan, checkpoint } = await fixture(17);
    const records = Array.from({ length: 17 }, (_, i) => reserved(plan, i));
    expect(snapshotProviderOperations(records.slice(0, 16))).toHaveLength(16);
    expect(() => snapshotProviderOperations(records)).toThrow('limit-exceeded');
    const active = await command(plan, checkpoint, { kind: 'activate' });
    expect(
      await nextProviderBaselineDecision(plan, active, records, active.observedAt, dependencies())
    ).toMatchObject({ reason: 'conflict' });
    const record = snapshotRecord({ ...records[0], control: 'paused' });
    let state = active;
    for (let revision = 0; revision < 128; revision++)
      state = await linked(plan, state, snapshotRecord({ ...record, revision }));
    const repeat = await linked(plan, state, snapshotRecord({ ...record, revision: 127 }));
    expect(repeat.observations).toEqual(state.observations);
    expect(repeat.revision).toBe(state.revision + 1);
    expect(repeat.observedAt).toBe(state.observedAt + 1);
    expect(
      await nextProviderBaselineDecision(
        plan,
        repeat,
        [snapshotRecord({ ...record, revision: 127 })],
        repeat.observedAt,
        dependencies()
      )
    ).toMatchObject({ reason: 'capacity-unavailable' });
  });
  it('pins all stop-priority pairs through cumulative fences, never dispatching a touched item', async () => {
    const { plan, checkpoint } = await fixture(3, 1);
    let state = await command(plan, checkpoint, { kind: 'activate' });
    const settledFact = await observed(reserved(plan), 'consistent');
    state = await linked(plan, state, settledFact);
    state = await command(plan, state, { kind: 'set-cooldown', until: 1000 });
    const decision = (
      cp: ProviderBaselineCheckpoint,
      records: readonly OperationRecord[],
      now = cp.observedAt
    ) => nextProviderBaselineDecision(plan, cp, records, now, dependencies());
    expect(await decision(state, [settledFact])).toMatchObject({ reason: 'cooldown' });
    expect(await decision(state, [settledFact], 1000)).toMatchObject({
      reason: 'budget-exhausted',
    });
    // Remove the optional observation instead of serializing undefined into journal data.
    const reservedData = clone(settledFact) as Record<string, unknown>;
    delete reservedData.observation;
    Object.assign(reservedData, { revision: 2, phase: 'reserved' });
    const pending = snapshotRecord(reservedData);
    expect(await decision(state, [pending])).toMatchObject({ reason: 'linked-operation-pending' });
    const unknown = snapshotRecord({
      ...pending,
      phase: 'unknown',
      interruptionReason: 'restart',
      control: 'paused',
    });
    expect(await decision(state, [unknown])).toMatchObject({ reason: 'unresolved-effect' });
    const paused = await command(plan, state, { kind: 'pause' });
    expect(await decision(paused, [unknown])).toMatchObject({ reason: 'paused' });
    expect(await decision(paused, [unknown], 100)).toMatchObject({ reason: 'clock-regressed' });
    expect(await decision(paused, [], 100)).toMatchObject({ reason: 'conflict' });
    const single = await fixture(1, 1);
    const last = await observed(reserved(single.plan), 'consistent');
    const allTouched = await linked(
      single.plan,
      await command(single.plan, single.checkpoint, { kind: 'activate' }),
      last
    );
    expect(
      await nextProviderBaselineDecision(
        single.plan,
        allTouched,
        [last],
        allTouched.observedAt,
        dependencies()
      )
    ).toMatchObject({ reason: 'no-unattempted-items' });
  });
});

describe('injected hash and cancellation failures', () => {
  it.each(['throw', 'malformed', 'mutate', 'abort'] as const)(
    'closes create/reduce/project/decision on %s without caller exception leakage',
    async failure => {
      const { plan, checkpoint } = await fixture();
      const failingDependencies = () => {
        const controller = new AbortController();
        return {
          signal: controller.signal,
          sha256: async (bytes: Uint8Array) => {
            if (failure === 'throw') throw new Error('private-hash-detail');
            if (failure === 'malformed') return 'wrong';
            if (failure === 'mutate') bytes[0] ^= 255;
            if (failure === 'abort') controller.abort();
            return hash(bytes);
          },
        };
      };
      await expect(
        createProviderBaselineCheckpoint(
          plan,
          { now: 100, windowId: 'a', maxReservationSlots: 1 },
          failingDependencies()
        )
      ).rejects.toThrow('hash-failed');
      await expect(
        reduceProviderBaselineCheckpoint(
          plan,
          checkpoint,
          { kind: 'activate', now: 101, expectedRevision: 0 },
          failingDependencies()
        )
      ).rejects.toThrow('hash-failed');
      await expect(
        projectProviderBaselineProgress(plan, checkpoint, [], 100, failingDependencies())
      ).rejects.toThrow('hash-failed');
      expect(
        await nextProviderBaselineDecision(plan, checkpoint, [], 100, failingDependencies())
      ).toEqual({ executionAuthorized: false, kind: 'stop', reason: 'conflict' });
    }
  );
  it('retains the captured AbortSignal even when caller dependencies are replaced between hash continuations', async () => {
    const { plan, checkpoint } = await fixture();
    const controller = new AbortController();
    const mutable = {
      signal: controller.signal,
      sha256: async (bytes: Uint8Array) => {
        queueMicrotask(() =>
          queueMicrotask(() => {
            mutable.signal = new AbortController().signal;
            controller.abort();
          })
        );
        return hash(bytes);
      },
    };
    await expect(
      createProviderBaselineCheckpoint(
        plan,
        { now: 100, windowId: 'a', maxReservationSlots: 1 },
        mutable
      )
    ).rejects.toThrow('hash-failed');
    expect(checkpoint.revision).toBe(0);
  });
});
