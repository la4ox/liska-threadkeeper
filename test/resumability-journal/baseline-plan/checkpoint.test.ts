// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  BASELINE_LIMITS,
  createBaselineCheckpoint,
  reduceBaselineCheckpoint,
  encodeBaselineCheckpoint,
  decodeBaselineCheckpoint,
  nextBaselineDecision,
} from '../../../src/resumability-journal/baseline-plan';
import { snapshotRecord } from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import {
  bothDestinations,
  clone,
  command,
  dependencies,
  fixture,
  identity,
  linked,
  observed,
  reserved,
} from './fixtures';

describe('bounded data-only baseline checkpoint reducer', () => {
  it('creates paused and roundtrips exact detached checkpoint bytes', async () => {
    const { plan, checkpoint } = await fixture();
    expect(checkpoint.control).toBe('paused');
    expect(checkpoint.revision).toBe(0);
    expect(checkpoint.planSha256).toBe(plan.planSha256);
    const record = await observed(reserved(plan));
    const attached = await linked(plan, checkpoint, record);
    const bytes = encodeBaselineCheckpoint(attached);
    const restored = decodeBaselineCheckpoint(bytes);
    expect(restored).toEqual(attached);
    expect(restored).not.toBe(attached);
    expect(encodeBaselineCheckpoint(restored)).toEqual(bytes);
    expect(Object.isFrozen(restored.links[0])).toBe(true);
    const text = new TextDecoder().decode(bytes);
    for (const field of ['phase', 'assessment', 'disposition', 'receipts'])
      expect(text).not.toContain('"' + field + '"');
  });
  it('requires explicit activation, pauses explicitly, and restart reattachment always returns paused', async () => {
    const { plan, checkpoint } = await fixture();
    const active = await command(plan, checkpoint, { kind: 'activate' });
    expect(active.control).toBe('active');
    const paused = await command(plan, active, { kind: 'pause' });
    expect(paused.control).toBe('paused');
    const recovered = await command(plan, active, { kind: 'recover-after-restart' });
    expect(recovered.control).toBe('paused');
    expect(recovered.revision).toBe(active.revision + 1);
    const activeAgain = await command(plan, recovered, { kind: 'activate' });
    expect(activeAgain.control).toBe('active');
    expect(checkpoint.control).toBe('paused');
  });
  it('fences exact revisions, safe counters and backwards monotonic time', async () => {
    const { plan, checkpoint } = await fixture();
    for (const expectedRevision of [-1, 1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(
        reduceBaselineCheckpoint(
          plan,
          checkpoint,
          { kind: 'activate', expectedRevision, now: 101 },
          dependencies()
        )
      ).rejects.toThrow();
    await expect(
      reduceBaselineCheckpoint(
        plan,
        checkpoint,
        { kind: 'activate', expectedRevision: 0, now: 99 },
        dependencies()
      )
    ).rejects.toThrow('clock-regressed');
    const sameTime = await command(plan, checkpoint, { kind: 'activate' }, 100);
    expect(sameTime.observedAt).toBe(100);
    const overflow = { ...checkpoint, revision: Number.MAX_SAFE_INTEGER };
    await expect(command(plan, overflow, { kind: 'activate' })).rejects.toThrow(
      'revision-conflict'
    );
    for (const now of [-0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(
        createBaselineCheckpoint(
          plan,
          { now, windowId: 'a', maxReservationSlots: 1 },
          dependencies()
        )
      ).rejects.toThrow();
  });
  it('sets and clears explicit cooldown observations with an exact boundary, no implicit clock', async () => {
    const { plan, checkpoint } = await fixture();
    const active = await command(plan, checkpoint, { kind: 'activate' });
    const cooled = await command(plan, active, { kind: 'set-cooldown', until: 200 });
    expect(cooled.cooldown).toEqual({ observedAt: 102, until: 200 });
    expect(await nextBaselineDecision(plan, cooled, [], 199, dependencies())).toMatchObject({
      reason: 'cooldown',
    });
    expect(await nextBaselineDecision(plan, cooled, [], 200, dependencies())).toMatchObject({
      kind: 'candidate',
    });
    const clear = await command(plan, cooled, { kind: 'clear-cooldown' });
    expect(clear).not.toHaveProperty('cooldown');
    expect(cooled).toHaveProperty('cooldown');
    await expect(command(plan, clear, { kind: 'set-cooldown', until: 100 })).rejects.toThrow(
      'invalid-command'
    );
  });
  it('charges one exact operation once, retains immutable links and accepts exact repeats without another observation', async () => {
    const { plan, checkpoint } = await fixture();
    const record = reserved(plan);
    const first = await linked(plan, checkpoint, record);
    const repeat = await linked(plan, first, clone(record));
    expect(repeat.charges).toEqual(first.charges);
    expect(repeat.links).toEqual(first.links);
    expect(repeat.observations).toEqual(first.observations);
    expect(repeat.revision).toBe(first.revision + 1);
    expect(first.charges).toEqual([
      {
        windowId: 'window-a',
        itemOrdinal: 0,
        operationId: record.operation.operationId,
        chargedAt: 101,
      },
    ]);
    const advanced = await linked(plan, repeat, await observed(record));
    expect(advanced.charges).toEqual(first.charges);
    expect(advanced.links).toEqual(first.links);
    expect(advanced.observations).toHaveLength(2);
    expect(first.observations).toHaveLength(1);
    await expect(linked(plan, advanced, record)).rejects.toThrow('operation-conflict');
  });
  it('enforces exact item, catalog, purpose, destinations and completeness bindings', async () => {
    const { plan, checkpoint } = await fixture();
    const record = reserved(plan);
    await expect(linked(plan, checkpoint, record, 1)).rejects.toThrow('operation-conflict');
    for (const operation of [
      {
        ...record.operation,
        admission: { ...record.operation.admission, conversationKey: identity(99).conversationKey },
      },
      { ...record.operation, sourceSelection: { catalogSha256: 'f'.repeat(64) } },
      { ...record.operation, destinations: bothDestinations },
      { ...record.operation, purpose: 'old-capture' },
      { ...record.operation, completenessPolicy: 'not-strict' },
      { ...record.operation, admission: { ...record.operation.admission, provider: 'claude' } },
    ])
      await expect(linked(plan, checkpoint, { ...record, operation } as never)).rejects.toThrow();
    const forged = { ...checkpoint, planSha256: 'f'.repeat(64) };
    await expect(command(plan, forged, { kind: 'activate' })).rejects.toThrow('digest-mismatch');
  });
  it.each(['operationId', 'attemptId', 'captureId'])(
    'rejects reused lifetime %s and a second attempt on an already touched item',
    async field => {
      const { plan, checkpoint } = await fixture();
      const first = reserved(plan, 0);
      const attached = await linked(plan, checkpoint, first);
      const second = reserved(plan, 1);
      const collision = snapshotRecord({
        ...second,
        operation: { ...second.operation, [field]: first.operation[field] },
      });
      await expect(linked(plan, attached, collision, 1)).rejects.toThrow('operation-conflict');
      await expect(linked(plan, attached, reserved(plan, 0, 'another'))).rejects.toThrow(
        'operation-conflict'
      );
    }
  );
  it('never refills or refunds on a forward jump, unknown result, pause, restart, or repeated link', async () => {
    const { plan, checkpoint } = await fixture(3, 1);
    const unknown = snapshotRecord({
      ...reserved(plan),
      phase: 'unknown',
      interruptionReason: 'restart',
    });
    let state = await linked(plan, checkpoint, unknown);
    state = await command(plan, state, { kind: 'pause' }, Number.MAX_SAFE_INTEGER - 3);
    state = await command(plan, state, { kind: 'recover-after-restart' });
    state = await command(plan, state, { kind: 'activate' });
    expect(state.charges).toHaveLength(1);
    expect(state.budget.windowId).toBe('window-a');
    expect(state.windows).toHaveLength(1);
    await expect(linked(plan, state, reserved(plan, 1), 1)).rejects.toThrow('budget-exhausted');
    expect(
      await nextBaselineDecision(plan, state, [unknown], state.observedAt, dependencies())
    ).toMatchObject({ reason: 'unresolved-effect' });
  });
  it('rolls only on an explicit new opaque window ID and never makes prior items retryable', async () => {
    const { plan, checkpoint } = await fixture(3, 1);
    const record = await observed(reserved(plan));
    let state = await linked(plan, await command(plan, checkpoint, { kind: 'activate' }), record);
    expect(await nextBaselineDecision(plan, state, [record], 1000, dependencies())).toMatchObject({
      reason: 'budget-exhausted',
    });
    state = await command(plan, state, { kind: 'roll-budget-window', windowId: 'window-b' }, 1000);
    expect(state.windows.map(window => window.windowId)).toEqual(['window-a', 'window-b']);
    expect(state.charges).toHaveLength(1);
    expect(state.links).toHaveLength(1);
    expect(await nextBaselineDecision(plan, state, [record], 1000, dependencies())).toMatchObject({
      kind: 'candidate',
      item: { ordinal: 1 },
    });
    state = await linked(plan, state, record);
    expect(state.charges).toHaveLength(1);
    await expect(linked(plan, state, reserved(plan, 0, 'retry'))).rejects.toThrow(
      'operation-conflict'
    );
    await expect(
      command(plan, state, { kind: 'roll-budget-window', windowId: 'window-a' })
    ).rejects.toThrow('invalid-command');
    const second = await linked(plan, state, await observed(reserved(plan, 1)), 1);
    expect(second.charges.map(charge => charge.windowId)).toEqual(['window-a', 'window-b']);
  });
  it('stops at bounded immutable histories instead of pruning, rotating or raising capacity', async () => {
    const { plan, checkpoint } = await fixture(17);
    let state = checkpoint;
    for (let index = 0; index < 16; index++)
      state = await linked(plan, state, reserved(plan, index), index);
    expect(state.links).toHaveLength(16);
    expect(state.charges).toHaveLength(16);
    state = await command(plan, state, { kind: 'roll-budget-window', windowId: 'window-b' });
    await expect(linked(plan, state, reserved(plan, 16), 16)).rejects.toThrow('history-exhausted');
    expect(state.links).toHaveLength(16);
    for (const maxReservationSlots of [0, 17, -1, 1.5, Infinity])
      await expect(
        createBaselineCheckpoint(
          plan,
          { now: 100, windowId: 'a', maxReservationSlots },
          dependencies()
        )
      ).rejects.toThrow();
    expect(BASELINE_LIMITS.maxReservationSlots).toBe(16);
  });
  it('retains bounded window and observation history with an explicit exhaustion stop', async () => {
    const { plan, checkpoint } = await fixture();
    let windows = checkpoint;
    for (let index = 1; index < BASELINE_LIMITS.maxWindows; index++)
      windows = await command(plan, windows, {
        kind: 'roll-budget-window',
        windowId: 'window-' + index,
      });
    await expect(
      command(plan, windows, { kind: 'roll-budget-window', windowId: 'overflow' })
    ).rejects.toThrow('history-exhausted');
    const record = reserved(plan);
    let history = checkpoint;
    for (let revision = 0; revision < BASELINE_LIMITS.maxObservations; revision++)
      history = await linked(plan, history, snapshotRecord({ ...record, revision }));
    expect(history.observations).toHaveLength(BASELINE_LIMITS.maxObservations);
    await expect(
      linked(
        plan,
        history,
        snapshotRecord({ ...record, revision: BASELINE_LIMITS.maxObservations })
      )
    ).rejects.toThrow('history-exhausted');
    const active = await command(plan, history, { kind: 'activate' });
    const resolution = snapshotRecord({
      ...(await observed(record)),
      revision: BASELINE_LIMITS.maxObservations,
    });
    expect(
      await nextBaselineDecision(plan, active, [resolution], active.observedAt, dependencies())
    ).toMatchObject({ executionAuthorized: false, reason: 'capacity-unavailable' });
  });
  it('rejects malformed commands and unsafe checkpoint data without executing caller accessors', async () => {
    const { plan, checkpoint } = await fixture();
    const getter = vi.fn();
    for (const input of [
      { ...checkpoint, extra: true },
      { ...checkpoint, control: 'automatic' },
      { ...checkpoint, phase: 'reserved' },
      { ...checkpoint, observedAt: -1 },
      { ...checkpoint, windows: [] },
      { ...checkpoint, budget: { windowId: 'missing', maxReservationSlots: 1 } },
      Object.defineProperty(clone(checkpoint), 'control', { get: getter, enumerable: true }),
      { ...checkpoint, toJSON: getter },
      { ...checkpoint, links: Array(1) },
    ])
      expect(() => encodeBaselineCheckpoint(input)).toThrow();
    for (const fields of [
      { kind: 'retry' },
      { kind: 'activate', extra: true },
      { kind: 'activate', until: 200 },
      { kind: 'roll-budget-window' },
      { kind: 'observe-operation', itemOrdinal: 0 },
      { kind: 'set-cooldown', until: -1 },
    ])
      await expect(command(plan, checkpoint, fields)).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    const bytes = encodeBaselineCheckpoint(checkpoint);
    const text = new TextDecoder().decode(bytes);
    for (const invalid of [
      text + '\n',
      '\ufeff' + text,
      text.replace('"revision":0', '"revision":0,"revision":0'),
    ])
      expect(() => decodeBaselineCheckpoint(new TextEncoder().encode(invalid))).toThrow();
    expect(() =>
      decodeBaselineCheckpoint(new Uint8Array(BASELINE_LIMITS.maxCheckpointBytes + 1))
    ).toThrow();
  });
  it('rejects broken charge, link, window and observation relationships rather than repairing them', async () => {
    const { plan, checkpoint } = await fixture();
    const attached = await linked(plan, checkpoint);
    const bad = [
      { ...attached, charges: [] },
      { ...attached, links: [...attached.links, attached.links[0]] },
      { ...attached, charges: [{ ...attached.charges[0], operationId: 'foreign' }] },
      { ...attached, charges: [{ ...attached.charges[0], windowId: 'missing' }] },
      { ...attached, observations: [] },
      { ...attached, observations: [...attached.observations, attached.observations[0]] },
      { ...attached, observations: [{ ...attached.observations[0], observedAt: 0 }] },
      { ...attached, observations: [{ ...attached.observations[0], operationId: 'foreign' }] },
      { ...attached, windows: [...attached.windows, attached.windows[0]] },
      { ...attached, observedAt: 99 },
      { ...attached, cooldown: { observedAt: 1000, until: 1001 } },
    ];
    for (const value of bad)
      expect(() => encodeBaselineCheckpoint(value)).toThrow('invalid-checkpoint');
  });
  it('detaches record and command data before awaiting and catches changed snapshots at the same revision', async () => {
    const { plan, checkpoint } = await fixture();
    const record = clone(reserved(plan));
    const fields = {
      kind: 'observe-operation' as const,
      itemOrdinal: 0,
      record,
      expectedRevision: 0,
      now: 101,
    };
    const state = await reduceBaselineCheckpoint(plan, checkpoint, fields, {
      ...dependencies(),
      sha256: async bytes => {
        (fields as { itemOrdinal: number }).itemOrdinal = 1;
        (record.operation as { operationId: string }).operationId = 'mutated';
        return dependencies().sha256(bytes);
      },
    });
    expect(state.links[0].operationId).toBe('operation-0');
    const changed = snapshotRecord({ ...reserved(plan), control: 'paused' });
    await expect(linked(plan, state, changed)).rejects.toThrow('operation-conflict');
    const forged = { ...state, links: [{ ...state.links[0], attemptId: 'other' }] };
    await expect(linked(plan, forged, reserved(plan))).rejects.toThrow('operation-conflict');
  });
});
