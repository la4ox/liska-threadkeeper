// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProviderBaselineOwner,
  PROVIDER_OWNER_DATABASE_NAME,
  PROVIDER_OWNER_KEY,
  type ProviderBaselineOwner,
} from '../../../src/resumability-journal/provider-baseline-owner';
import {
  assertProviderExecutionHeadroom,
  encodeProviderOwner,
  type ValidatedProviderOwner,
} from '../../../src/resumability-journal/provider-baseline-owner/envelope';
import { encodeProviderBaselineCheckpoint } from '../../../src/resumability-journal/provider-baseline';
import {
  controlRecord,
  encodeWithControlHeadroom,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/control';
import {
  encodeRecord,
  snapshotRecord,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import { active, identity, ids, sha256, signal } from './fixtures';

const owners: ProviderBaselineOwner[] = [];
afterEach(() => owners.splice(0).forEach(owner => owner.close()));

async function fixture(count: number) {
  const context = await active({}, [identity(0, 'chatgpt')]);
  owners.push(context.owner);
  const reservation = await context.owner.reserveNext(1, context.bytes, ids(), 102, signal());
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
  const state: ValidatedProviderOwner = {
    plan: reservation.snapshot.plan,
    catalogBytes: context.bytes,
    checkpoint,
    operations: [record],
  };
  const bound = {
    ...ids(),
    item: reservation.item,
    planSha256: reservation.snapshot.plan.planSha256,
  };
  return { ...context, reservation, record, state, identity: bound };
}

async function install(context: { factory: IDBFactory; state: ValidatedProviderOwner }) {
  const database = await new Promise<IDBDatabase>(resolve => {
    const request = context.factory.open(PROVIDER_OWNER_DATABASE_NAME, 1);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['owner', 'operations'], 'readwrite');
    transaction.objectStore('owner').put(encodeProviderOwner(context.state), PROVIDER_OWNER_KEY);
    for (const record of context.state.operations)
      transaction
        .objectStore('operations')
        .put(encodeWithControlHeadroom(record), record.operation.operationId);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

async function rejectsAdmission(context: Awaited<ReturnType<typeof fixture>>) {
  await expect(context.owner.readSnapshot()).rejects.toMatchObject({
    code: 'headroom-exhausted',
  });
  await expect(
    context.owner.createExecutionPort(context.identity, { now: () => 103 })
  ).rejects.toMatchObject({ code: 'headroom-exhausted' });
  context.owner.close();
  const reopened = createProviderBaselineOwner(context.settings);
  owners.push(reopened);
  await reopened.open();
  await expect(reopened.readSnapshot()).rejects.toMatchObject({ code: 'headroom-exhausted' });
}

describe('provider execution exact retained headroom', () => {
  it.each(['pause', 'restart', 'interruption'] as const)(
    '125 observations retain claim -> %s -> late evidence exactly through 128',
    async route => {
      const context = await fixture(125);
      assertProviderExecutionHeadroom(context.state);
      await install(context);
      const port = await context.owner.createExecutionPort(context.identity, { now: () => 103 });
      await port.claimDispatch(124);
      expect((await context.owner.readSnapshot())?.checkpoint.observations).toHaveLength(126);
      if (route === 'pause')
        await context.owner.applyControl(context.state.checkpoint.revision + 1, {
          kind: 'pause',
          now: 103,
        });
      else if (route === 'restart')
        await context.owner.recoverAfterRestart(
          context.state.checkpoint.revision + 1,
          103,
          signal()
        );
      else await port.markExecutionUnknown(125, 'capture-failed');
      await port.recordProducerReceipts(126, []);
      const final = (await context.owner.readSnapshot())!;
      expect(final.checkpoint.observations).toHaveLength(128);
      expect(final.operations[0]).toMatchObject({
        revision: 127,
        phase: 'awaiting-resolution',
      });
      expect(encodeProviderBaselineCheckpoint(final.checkpoint).byteLength).toBeLessThanOrEqual(
        64 * 1024
      );
      context.owner.close();
      const reopened = createProviderBaselineOwner(context.settings);
      owners.push(reopened);
      await reopened.open();
      expect(await reopened.readSnapshot()).toEqual(final);
    }
  );

  it('rejects reservation-only state with 126 observations non-destructively', async () => {
    const context = await fixture(126);
    await install(context);
    await rejectsAdmission(context);
  });

  it('rejects paused unknown M-2 on admission, read, port creation and reopen', async () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const context = await fixture(3);
    const record = snapshotRecord({
      ...context.record,
      revision: maximum - 2,
      phase: 'unknown',
      interruptionReason: 'capture-failed',
    });
    const observations = [...context.state.checkpoint.observations];
    observations[2] = {
      ...observations[2],
      recordRevision: record.revision,
      recordSha256: await sha256(encodeRecord(record)),
    };
    context.state = {
      ...context.state,
      operations: [record],
      checkpoint: { ...context.state.checkpoint, control: 'paused', observations },
    };
    await install(context);
    await rejectsAdmission(context);
  });

  it('admits paused unknown M-3, records evidence at awaiting M-2 and reopens it', async () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const context = await fixture(3);
    const record = snapshotRecord({
      ...context.record,
      revision: maximum - 3,
      phase: 'unknown',
      interruptionReason: 'capture-failed',
    });
    const observations = [...context.state.checkpoint.observations];
    observations[2] = {
      ...observations[2],
      recordRevision: record.revision,
      recordSha256: await sha256(encodeRecord(record)),
    };
    context.state = {
      ...context.state,
      operations: [record],
      checkpoint: { ...context.state.checkpoint, control: 'paused', observations },
    };
    await install(context);
    const port = await context.owner.createExecutionPort(context.identity, { now: () => 103 });
    const evidence = await port.recordProducerReceipts(maximum - 3, []);
    expect(evidence).toMatchObject({
      revision: maximum - 2,
      phase: 'awaiting-resolution',
    });
    context.owner.close();
    const reopened = createProviderBaselineOwner(context.settings);
    owners.push(reopened);
    await reopened.open();
    expect((await reopened.readSnapshot())?.operations).toEqual([evidence]);
  });

  it.each(['pause', 'restart', 'interruption'] as const)(
    'retains reserved M-5 -> in-flight M-4 -> %s unknown M-3 -> awaiting M-2',
    async route => {
      const maximum = Number.MAX_SAFE_INTEGER;
      const context = await fixture(1);
      const reserved = snapshotRecord({ ...context.record, revision: maximum - 5 });
      context.state = {
        ...context.state,
        operations: [reserved],
        checkpoint: {
          ...context.state.checkpoint,
          observations: [
            {
              ...context.state.checkpoint.observations[0],
              recordRevision: reserved.revision,
              recordSha256: await sha256(encodeRecord(reserved)),
            },
          ],
        },
      };
      await install(context);
      const port = await context.owner.createExecutionPort(context.identity, { now: () => 103 });
      await port.claimDispatch(maximum - 5);
      expect((await context.owner.readSnapshot())?.operations[0].revision).toBe(maximum - 4);
      if (route === 'pause')
        await context.owner.applyControl(context.state.checkpoint.revision + 1, {
          kind: 'pause',
          now: 103,
        });
      else if (route === 'restart')
        await context.owner.recoverAfterRestart(
          context.state.checkpoint.revision + 1,
          103,
          signal()
        );
      else await port.markExecutionUnknown(maximum - 4, 'capture-failed');
      expect((await context.owner.readSnapshot())?.operations[0]).toMatchObject({
        revision: maximum - 3,
        phase: 'unknown',
      });
      const evidence = await port.recordProducerReceipts(maximum - 3, []);
      expect(evidence).toMatchObject({
        revision: maximum - 2,
        phase: 'awaiting-resolution',
      });
      context.owner.close();
      const reopened = createProviderBaselineOwner(context.settings);
      owners.push(reopened);
      await reopened.open();
      expect((await reopened.readSnapshot())?.operations).toEqual([evidence]);
    }
  );

  it.each(['reserved', 'in-flight'] as const)(
    'rejects %s with one fewer retained record revision than its exact lifecycle boundary',
    async phase => {
      const maximum = Number.MAX_SAFE_INTEGER;
      const context = await fixture(1);
      const record = snapshotRecord({
        ...context.record,
        revision: maximum - (phase === 'reserved' ? 4 : 3),
        phase,
      });
      context.state = {
        ...context.state,
        operations: [record],
        checkpoint: {
          ...context.state.checkpoint,
          observations: [
            {
              ...context.state.checkpoint.observations[0],
              recordRevision: record.revision,
              recordSha256: await sha256(encodeRecord(record)),
            },
          ],
        },
      };
      await install(context);
      await rejectsAdmission(context);
    }
  );

  it('keeps paused reserved M-4 readable but rejects activation without five active slots', async () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const context = await fixture(1);
    const record = snapshotRecord({ ...context.record, revision: maximum - 4 });
    context.state = {
      ...context.state,
      operations: [record],
      checkpoint: {
        ...context.state.checkpoint,
        control: 'paused',
        observations: [
          {
            ...context.state.checkpoint.observations[0],
            recordRevision: record.revision,
            recordSha256: await sha256(encodeRecord(record)),
          },
        ],
      },
    };
    await install(context);
    const before = await context.owner.readSnapshot();
    expect(before?.operations).toEqual([record]);
    await expect(
      context.owner.applyControl(context.state.checkpoint.revision, {
        kind: 'activate',
        now: 103,
      })
    ).rejects.toMatchObject({ code: 'headroom-exhausted' });
    expect(await context.owner.readSnapshot()).toEqual(before);
  });

  it.each(['pause', 'restart', 'interruption'] as const)(
    'proves reserved M-4 -> claim M-3 -> %s M-1 -> evidence M',
    async route => {
      const maximum = Number.MAX_SAFE_INTEGER;
      const context = await fixture(1);
      context.state = {
        ...context.state,
        checkpoint: { ...context.state.checkpoint, revision: maximum - 4 },
      };
      await install(context);
      const port = await context.owner.createExecutionPort(context.identity, { now: () => 103 });
      await port.claimDispatch(0);
      expect((await context.owner.readSnapshot())?.checkpoint.revision).toBe(maximum - 3);
      if (route === 'pause')
        await context.owner.applyControl(maximum - 3, { kind: 'pause', now: 103 });
      else if (route === 'restart')
        await context.owner.recoverAfterRestart(maximum - 3, 103, signal());
      else await port.markExecutionUnknown(1, 'capture-failed');
      const uncertain = (await context.owner.readSnapshot())!;
      expect(uncertain.checkpoint).toMatchObject({
        revision: maximum - 1,
        control: 'paused',
      });
      await port.recordProducerReceipts(2, []);
      const final = (await context.owner.readSnapshot())!;
      expect(final.checkpoint.revision).toBe(maximum);
      expect(final.operations[0].phase).toBe('awaiting-resolution');
      expect(await context.owner.recoverAfterRestart(maximum, 104, signal())).toEqual(final);
    }
  );

  it('rejects canonical active reserved M-3 on read, port creation and reopen', async () => {
    const context = await fixture(1);
    context.state = {
      ...context.state,
      checkpoint: {
        ...context.state.checkpoint,
        revision: Number.MAX_SAFE_INTEGER - 3,
      },
    };
    await install(context);
    await rejectsAdmission(context);
  });

  it('paused unknown M-1 reopens byte-identically and late evidence reaches M', async () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const context = await fixture(1);
    context.state = {
      ...context.state,
      checkpoint: { ...context.state.checkpoint, revision: maximum - 4 },
    };
    await install(context);
    const port = await context.owner.createExecutionPort(context.identity, { now: () => 103 });
    const claim = await port.claimDispatch(0);
    await port.markExecutionUnknown(1, 'capture-failed');
    const paused = (await context.owner.readSnapshot())!;
    expect(paused.checkpoint.revision).toBe(maximum - 1);
    context.owner.close();
    const reopened = createProviderBaselineOwner(context.settings);
    owners.push(reopened);
    await reopened.open();
    const recovered = await reopened.recoverAfterRestart(maximum - 1, 104, signal());
    expect(recovered.ownerBytes).toEqual(paused.ownerBytes);
    const fresh = await reopened.createExecutionPort(context.identity, { now: () => 105 });
    if (claim.dispatch !== 'available') throw new Error('unreachable');
    await expect(
      fresh.consumeDispatch(claim.token, context.record.operation, () => undefined)
    ).rejects.toBeDefined();
    await fresh.recordProducerReceipts(2, []);
    expect((await reopened.readSnapshot())?.checkpoint.revision).toBe(maximum);
  });

  it.each([4, 5])(
    'reservation pays its own revision before four lifecycle steps (remaining=%s)',
    async remaining => {
      const context = await active({}, [identity(0, 'chatgpt')]);
      owners.push(context.owner);
      const current = (await context.owner.readSnapshot())!;
      const revision = Number.MAX_SAFE_INTEGER - remaining;
      const state: ValidatedProviderOwner = {
        plan: current.plan,
        catalogBytes: context.bytes,
        operations: [],
        checkpoint: { ...current.checkpoint, revision },
      };
      await install({ factory: context.factory as IDBFactory, state });
      const pending = context.owner.reserveNext(revision, context.bytes, ids(), 103, signal());
      if (remaining === 5)
        expect((await pending).snapshot.checkpoint.revision).toBe(Number.MAX_SAFE_INTEGER - 4);
      else {
        await expect(pending).rejects.toMatchObject({ code: 'headroom-exhausted' });
        expect((await context.owner.readSnapshot())?.operations).toHaveLength(0);
      }
    }
  );

  it.each([0, 4, 5])(
    'paused reservation remains readable while activation pays its own step (remaining=%s)',
    async remaining => {
      const context = await fixture(1);
      const revision = Number.MAX_SAFE_INTEGER - remaining;
      context.state = {
        ...context.state,
        checkpoint: { ...context.state.checkpoint, control: 'paused', revision },
      };
      await install(context);
      const before = (await context.owner.readSnapshot())!;
      const activation = context.owner.applyControl(revision, { kind: 'activate', now: 103 });
      if (remaining === 5)
        expect((await activation).checkpoint.revision).toBe(Number.MAX_SAFE_INTEGER - 4);
      else {
        await expect(activation).rejects.toBeDefined();
        expect(await context.owner.readSnapshot()).toEqual(before);
      }
    }
  );

  it('checks the real 64KiB final checkpoint projection, not only counters', async () => {
    const context = await fixture(125);
    let accepted: ValidatedProviderOwner | undefined;
    let rejected: ValidatedProviderOwner | undefined;
    for (let width = 1; width <= 256; width++) {
      const windows = [
        { windowId: 'window-a', openedAt: 100 },
        ...Array.from({ length: 63 }, (_, index) => ({
          windowId: `window-${index}-` + '界'.repeat(width),
          openedAt: 102,
        })),
      ];
      if (windows.at(-1)!.windowId.length > 256) break;
      const candidate: ValidatedProviderOwner = {
        ...context.state,
        checkpoint: {
          ...context.state.checkpoint,
          windows,
          budget: { ...context.state.checkpoint.budget, windowId: windows.at(-1)!.windowId },
        },
      };
      try {
        encodeProviderBaselineCheckpoint(candidate.checkpoint);
      } catch {
        break;
      }
      try {
        assertProviderExecutionHeadroom(candidate);
        accepted = candidate;
      } catch {
        rejected = candidate;
        break;
      }
    }
    expect(accepted).toBeDefined();
    expect(rejected).toBeDefined();
    expect(encodeProviderBaselineCheckpoint(rejected!.checkpoint).byteLength).toBeLessThanOrEqual(
      64 * 1024
    );
    expect(() => assertProviderExecutionHeadroom(rejected!)).toThrow('headroom-exhausted');
  });

  it('active unknown retains evidence plus mandatory pause; paused unknown needs only evidence', async () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const context = await fixture(3);
    const record = snapshotRecord({
      ...context.record,
      revision: 2,
      phase: 'unknown',
      interruptionReason: 'capture-failed',
    });
    const observations = [...context.state.checkpoint.observations];
    observations[2] = { ...observations[2], recordSha256: await sha256(encodeRecord(record)) };
    context.state = {
      ...context.state,
      operations: [record],
      checkpoint: {
        ...context.state.checkpoint,
        observations,
        revision: maximum - 2,
      },
    };
    await install(context);
    const port = await context.owner.createExecutionPort(context.identity, { now: () => 103 });
    await port.recordProducerReceipts(2, []);
    expect((await context.owner.readSnapshot())?.checkpoint.revision).toBe(maximum - 1);
    const paused = await context.owner.applyControl(maximum - 1, { kind: 'pause', now: 103 });
    expect(paused.checkpoint.revision).toBe(maximum);

    const pausedRecord = controlRecord(record, 'pause');
    expect(pausedRecord.phase).toBe('unknown');
  });
});
