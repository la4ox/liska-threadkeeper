// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  createBaselineOwner,
  OWNER_DATABASE_NAME,
  OWNER_KEY,
  type BaselineOwner,
} from '../../../src/resumability-journal/baseline-owner';
import {
  assertExecutionHeadroom,
  encodeOwner,
  type ValidatedOwner,
} from '../../../src/resumability-journal/baseline-owner/envelope';
import { encodeBaselineCheckpoint } from '../../../src/resumability-journal/baseline-plan';
import {
  encodeRecord,
  snapshotRecord,
} from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { active, ids, signal, sha256 } from './fixtures';
const owners: BaselineOwner[] = [];
afterEach(() => {
  owners.splice(0).forEach(owner => owner.close());
  vi.restoreAllMocks();
});
async function fixture(count: number) {
  const ctx = await active();
  owners.push(ctx.owner);
  const reservation = await ctx.owner.reserveNextChatGpt(1, ctx.data.bytes, ids(), 102, signal());
  const record = snapshotRecord({ ...reservation.record, revision: count - 1 });
  const checkpoint = {
    ...reservation.snapshot.checkpoint,
    revision: count + 1,
    observations: Array.from({ length: count }, (_, index) => ({
      operationId: ids().operationId,
      recordRevision: index,
      recordSha256: index === count - 1 ? '' : 'f'.repeat(64),
      observedAt: 102,
    })),
  };
  checkpoint.observations[count - 1].recordSha256 = await sha256(encodeRecord(record));
  const owner: ValidatedOwner = {
    plan: reservation.snapshot.plan,
    catalogBytes: ctx.data.bytes,
    checkpoint,
    operations: [record],
  };
  return { ...ctx, reservation, record, state: owner };
}
async function install(ctx: { factory: IDBFactory; state: ValidatedOwner }) {
  const db = await new Promise<IDBDatabase>(resolve => {
    const request = ctx.factory.open(OWNER_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['owner', 'operations'], 'readwrite');
    tx.objectStore('owner').put(encodeOwner(ctx.state), OWNER_KEY);
    ctx.state.operations.forEach(record =>
      tx.objectStore('operations').put(encodeRecord(record), record.operation.operationId)
    );
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
async function rejectsAdmission(ctx: Awaited<ReturnType<typeof fixture>>) {
  await expect(ctx.owner.readSnapshot()).rejects.toBeDefined();
  await expect(
    ctx.owner.createExecutionPort(
      { ...ids(), item: ctx.reservation.item, planSha256: ctx.state.plan.planSha256 },
      { now: () => 103 }
    )
  ).rejects.toBeDefined();
  ctx.owner.close();
  const reopened = createBaselineOwner(ctx.settings);
  owners.push(reopened);
  await reopened.open();
  await expect(reopened.readSnapshot()).rejects.toBeDefined();
  await expect(
    reopened.recoverAfterRestart(ctx.state.checkpoint.revision, 103, signal())
  ).rejects.toBeDefined();
}
it.each(['pause', 'restart', 'interruption'] as const)(
  '125 observations retain exact room for claim -> %s -> late evidence at 128',
  async route => {
    const ctx = await fixture(125);
    assertExecutionHeadroom(ctx.state);
    await install(ctx);
    const port = await ctx.owner.createExecutionPort(
      { ...ids(), item: ctx.reservation.item, planSha256: ctx.state.plan.planSha256 },
      { now: () => 103 }
    );
    await port.claimDispatch(ids().operationId, 124);
    const claimed = (await ctx.owner.readSnapshot())!;
    expect(claimed.checkpoint.observations).toHaveLength(126);
    if (route === 'pause')
      await ctx.owner.applyControl(claimed.checkpoint.revision, { kind: 'pause', now: 103 });
    else if (route === 'restart')
      await ctx.owner.recoverAfterRestart(claimed.checkpoint.revision, 103, signal());
    else await port.markExecutionUnknown(ids().operationId, 125, 'capture-failed');
    await port.recordProducerReceipts(ids().operationId, 126, []);
    const final = (await ctx.owner.readSnapshot())!;
    expect(final.checkpoint.observations).toHaveLength(128);
    expect(final.operations[0].phase).toBe('awaiting-resolution');
    expect(final.checkpoint.charges).toHaveLength(1);
    expect(final.checkpoint.links).toHaveLength(1);
    expect(encodeBaselineCheckpoint(final.checkpoint).byteLength).toBeLessThanOrEqual(64 * 1024);
    ctx.owner.close();
    const reader = createBaselineOwner(ctx.settings);
    owners.push(reader);
    await reader.open();
    expect(await reader.readSnapshot()).toEqual(final);
  }
);
it('rejects read/port/reopen admission when 126 observations cannot retain execution headroom', async () => {
  const ctx = await fixture(126);
  await install(ctx);
  await rejectsAdmission(ctx);
});
it('checks the actual 64KiB projected envelope, including worst-width clock/revision observations', async () => {
  const ctx = await fixture(125);
  let nearest: ValidatedOwner | undefined, rejected: ValidatedOwner | undefined;
  for (let width = 1; width <= 256; width++) {
    const windows = [
      { windowId: 'a', openedAt: 100 },
      ...Array.from({ length: 63 }, (_, index) => ({
        windowId: `w${index}-` + '界'.repeat(width),
        openedAt: 102,
      })),
    ];
    if (windows.at(-1)!.windowId.length > 256) break;
    const candidate = {
      ...ctx.state,
      checkpoint: {
        ...ctx.state.checkpoint,
        windows,
        budget: { ...ctx.state.checkpoint.budget, windowId: windows.at(-1)!.windowId },
      },
    };
    try {
      encodeBaselineCheckpoint(candidate.checkpoint);
    } catch {
      break;
    }
    try {
      assertExecutionHeadroom(candidate);
      nearest = candidate;
    } catch {
      rejected = candidate;
      break;
    }
  }
  expect(nearest).toBeDefined();
  expect(rejected).toBeDefined();
  expect(encodeBaselineCheckpoint(rejected!.checkpoint).byteLength).toBeLessThanOrEqual(64 * 1024);
  expect(() => assertExecutionHeadroom(rejected!)).toThrow();
  expect(encodeBaselineCheckpoint(nearest!.checkpoint).byteLength).toBeGreaterThan(62 * 1024);
  ctx.state = rejected!;
  await install(ctx);
  await rejectsAdmission(ctx);
});
it.each(['pause', 'restart', 'interruption'] as const)(
  'exact MAX checkpoint budget preserves reserved M-4 -> claim M-3 -> %s M-1 -> evidence M',
  async route => {
    const maximum = Number.MAX_SAFE_INTEGER,
      ctx = await fixture(1);
    ctx.state = { ...ctx.state, checkpoint: { ...ctx.state.checkpoint, revision: maximum - 4 } };
    await install(ctx);
    const port = await ctx.owner.createExecutionPort(
      { ...ids(), item: ctx.reservation.item, planSha256: ctx.state.plan.planSha256 },
      { now: () => 103 }
    );
    await port.claimDispatch(ids().operationId, 0);
    expect((await ctx.owner.readSnapshot())?.checkpoint.revision).toBe(maximum - 3);
    if (route === 'pause') await ctx.owner.applyControl(maximum - 3, { kind: 'pause', now: 103 });
    else if (route === 'restart') await ctx.owner.recoverAfterRestart(maximum - 3, 103, signal());
    else await port.markExecutionUnknown(ids().operationId, 1, 'capture-failed');
    const unknown = (await ctx.owner.readSnapshot())!;
    expect(unknown.checkpoint).toMatchObject({ revision: maximum - 1, control: 'paused' });
    expect(unknown.operations[0].phase).toBe('unknown');
    await port.recordProducerReceipts(ids().operationId, 2, []);
    const final = (await ctx.owner.readSnapshot())!;
    expect(final.checkpoint).toMatchObject({ revision: maximum, control: 'paused' });
    expect(final.operations[0].phase).toBe('awaiting-resolution');
    ctx.owner.close();
    const reopened = createBaselineOwner(ctx.settings);
    owners.push(reopened);
    await reopened.open();
    expect(await reopened.readSnapshot()).toEqual(final);
    expect(await reopened.recoverAfterRestart(maximum, 103, signal())).toEqual(final);
  }
);
it('rejects canonical reserved M-3 on read, port creation and reopen', async () => {
  const ctx = await fixture(1);
  ctx.state = {
    ...ctx.state,
    checkpoint: { ...ctx.state.checkpoint, revision: Number.MAX_SAFE_INTEGER - 3 },
  };
  await install(ctx);
  await rejectsAdmission(ctx);
});
it('paused unknown M-1 survives explicit reopened recovery byte-identically and late evidence reaches M', async () => {
  const maximum = Number.MAX_SAFE_INTEGER,
    ctx = await fixture(1);
  ctx.state = { ...ctx.state, checkpoint: { ...ctx.state.checkpoint, revision: maximum - 4 } };
  await install(ctx);
  const identity = { ...ids(), item: ctx.reservation.item, planSha256: ctx.state.plan.planSha256 };
  const originalPort = await ctx.owner.createExecutionPort(identity, { now: () => 103 });
  const { token } = await originalPort.claimDispatch(ids().operationId, 0);
  await originalPort.markExecutionUnknown(ids().operationId, 1, 'capture-failed');
  const paused = (await ctx.owner.readSnapshot())!;
  expect(paused.checkpoint).toMatchObject({ control: 'paused', revision: maximum - 1 });
  ctx.owner.close();
  const reopened = createBaselineOwner(ctx.settings);
  owners.push(reopened);
  await reopened.open();
  expect(await reopened.recoverAfterRestart(maximum - 1, 104, signal())).toEqual(paused);
  expect((await reopened.readSnapshot())?.ownerBytes).toEqual(paused.ownerBytes);
  const port = await reopened.createExecutionPort(identity, { now: () => 105 });
  const effect = vi.fn();
  await expect(
    port.consumeDispatch(token, ctx.reservation.prepared.operation, effect)
  ).rejects.toBeDefined();
  expect(effect).not.toHaveBeenCalled();
  await port.recordProducerReceipts(ids().operationId, 2, []);
  const final = (await reopened.readSnapshot())!;
  expect(final.checkpoint).toMatchObject({ revision: maximum, control: 'paused' });
  expect(final.operations[0].phase).toBe('awaiting-resolution');
});
it.each(['in-flight', 'unknown'] as const)(
  'rejects canonical %s with one fewer mandatory checkpoint step on admission',
  async phase => {
    const ctx = await fixture(phase === 'in-flight' ? 2 : 3);
    const record = snapshotRecord({
      ...ctx.record,
      phase,
      ...(phase === 'unknown' && { control: 'paused', interruptionReason: 'pause' }),
    });
    const observations = [...ctx.state.checkpoint.observations];
    observations[observations.length - 1] = {
      ...observations.at(-1)!,
      recordSha256: await sha256(encodeRecord(record)),
    };
    ctx.state = {
      ...ctx.state,
      operations: [record],
      checkpoint: {
        ...ctx.state.checkpoint,
        observations,
        control: phase === 'unknown' ? 'paused' : 'active',
        revision: Number.MAX_SAFE_INTEGER - (phase === 'in-flight' ? 2 : 0),
      },
    };
    await install(ctx);
    await expect(ctx.owner.readSnapshot()).rejects.toMatchObject({ code: 'headroom-exhausted' });
    await rejectsAdmission(ctx);
  }
);
it('active unknown retains a separate post-evidence pause while paused unknown needs only evidence', async () => {
  const ctx = await fixture(3),
    maximum = Number.MAX_SAFE_INTEGER;
  const record = snapshotRecord({
    ...ctx.record,
    phase: 'unknown',
    interruptionReason: 'capture-failed',
  });
  const observations = [...ctx.state.checkpoint.observations];
  observations[2] = { ...observations[2], recordSha256: await sha256(encodeRecord(record)) };
  ctx.state = {
    ...ctx.state,
    operations: [record],
    checkpoint: { ...ctx.state.checkpoint, observations, revision: maximum - 2 },
  };
  await install(ctx);
  const port = await ctx.owner.createExecutionPort(
    { ...ids(), item: ctx.reservation.item, planSha256: ctx.state.plan.planSha256 },
    { now: () => 103 }
  );
  await port.recordProducerReceipts(ids().operationId, 2, []);
  expect((await ctx.owner.readSnapshot())?.checkpoint).toMatchObject({
    control: 'active',
    revision: maximum - 1,
  });
  const paused = await ctx.owner.applyControl(maximum - 1, { kind: 'pause', now: 103 });
  expect(paused.checkpoint).toMatchObject({ control: 'paused', revision: maximum });
});
it.each([4, 5])(
  'reservation pays its own checkpoint revision before retaining four execution steps (remaining=%s)',
  async remaining => {
    const ctx = await active();
    owners.push(ctx.owner);
    const snapshot = (await ctx.owner.readSnapshot())!;
    const revision = Number.MAX_SAFE_INTEGER - remaining;
    const state = {
      plan: snapshot.plan,
      catalogBytes: ctx.data.bytes,
      operations: snapshot.operations,
      checkpoint: { ...snapshot.checkpoint, revision },
    };
    await install({ factory: ctx.factory as IDBFactory, state });
    const pending = ctx.owner.reserveNextChatGpt(revision, ctx.data.bytes, ids(), 103, signal());
    if (remaining === 5)
      expect((await pending).snapshot.checkpoint.revision).toBe(Number.MAX_SAFE_INTEGER - 4);
    else {
      await expect(pending).rejects.toMatchObject({ code: 'headroom-exhausted' });
      const after = (await ctx.owner.readSnapshot())!;
      expect(after.operations).toHaveLength(0);
      expect(after.checkpoint.revision).toBe(revision);
    }
  }
);
it.each([0, 4, 5])(
  'paused reserved admission is safe, while activation pays its separate step (remaining=%s)',
  async remaining => {
    const ctx = await fixture(1),
      revision = Number.MAX_SAFE_INTEGER - remaining;
    ctx.state = {
      ...ctx.state,
      checkpoint: { ...ctx.state.checkpoint, control: 'paused', revision },
    };
    await install(ctx);
    const before = (await ctx.owner.readSnapshot())!;
    const pending = ctx.owner.applyControl(revision, { kind: 'activate', now: 103 });
    if (remaining === 5)
      expect((await pending).checkpoint.revision).toBe(Number.MAX_SAFE_INTEGER - 4);
    else {
      await expect(pending).rejects.toBeDefined();
      expect(await ctx.owner.readSnapshot()).toEqual(before);
    }
  }
);
it('rejects a digest-mismatched latest observation', async () => {
  const ctx = await fixture(3);
  const observations = [...ctx.state.checkpoint.observations];
  observations[2] = { ...observations[2], recordSha256: 'e'.repeat(64) };
  ctx.state = { ...ctx.state, checkpoint: { ...ctx.state.checkpoint, observations } };
  await install(ctx);
  await expect(ctx.owner.readSnapshot()).rejects.toBeDefined();
});
