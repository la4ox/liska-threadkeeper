// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createProviderBaselineOwner,
  PROVIDER_OWNER_DATABASE_NAME,
} from '../../../src/resumability-journal/provider-baseline-owner';
import { encodeProviderOwner } from '../../../src/resumability-journal/provider-baseline-owner/envelope';
import {
  reduceProviderBaselineCheckpoint,
  snapshotProviderBaselineCheckpoint,
  type ProviderBaselineCheckpoint,
} from '../../../src/resumability-journal/provider-baseline';
import {
  controlRecord,
  encodeWithControlHeadroom,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/control';
import type { OperationRecord } from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import { reserved } from '../provider-baseline/fixtures';
import { catalogBytes, identity, requirements, setup, sha256, signal } from './fixtures';

async function rewrite(
  factory: IDBFactory,
  ownerBytes: Uint8Array,
  operations: readonly OperationRecord[],
  extra?: { readonly key: string; readonly bytes: Uint8Array }
) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(PROVIDER_OWNER_DATABASE_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['owner', 'operations'], 'readwrite');
    const owner = transaction.objectStore('owner');
    const records = transaction.objectStore('operations');
    owner.clear();
    records.clear();
    owner.add(ownerBytes, 'baseline');
    for (const record of operations)
      records.add(encodeWithControlHeadroom(record), record.operation.operationId);
    if (extra) records.add(extra.bytes, extra.key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
}

async function linkedCheckpoint(
  snapshot: Awaited<ReturnType<typeof setup>>['snapshot'],
  count: number
) {
  let checkpoint = snapshot.checkpoint;
  const records: OperationRecord[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const record = reserved(snapshot.plan, ordinal, String(ordinal));
    records.push(record);
    checkpoint = await reduceProviderBaselineCheckpoint(
      snapshot.plan,
      checkpoint,
      {
        kind: 'observe-operation',
        expectedRevision: checkpoint.revision,
        now: 101 + ordinal,
        itemOrdinal: ordinal,
        record,
      },
      { sha256, signal: signal() }
    );
  }
  return { checkpoint, records };
}

describe('provider owner complete-inventory admission and bounds', () => {
  it('admits exactly 16 bound reservations and rejects a seventeenth physical record', async () => {
    const selection = Array.from({ length: 17 }, (_, index) =>
      identity(index, index % 2 ? 'claude' : 'chatgpt')
    );
    const { owner, bytes, snapshot, factory, settings } = await setup({}, selection);
    owner.close();
    const { checkpoint, records } = await linkedCheckpoint(snapshot, 16);
    const ownerBytes = encodeProviderOwner({
      plan: snapshot.plan,
      checkpoint,
      catalogBytes: bytes,
    });
    await rewrite(factory, ownerBytes, records);
    const exact = createProviderBaselineOwner(settings);
    await exact.open();
    expect((await exact.readSnapshot())?.operations).toHaveLength(16);
    exact.close();

    const seventeenth = reserved(snapshot.plan, 16, '16');
    await rewrite(factory, ownerBytes, records, {
      key: seventeenth.operation.operationId,
      bytes: encodeWithControlHeadroom(seventeenth),
    });
    const overflow = createProviderBaselineOwner(settings);
    await overflow.open();
    await expect(overflow.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
    overflow.close();
  });

  it.each(['orphan', 'paused', 'trailing-record', 'trailing-owner'] as const)(
    'rejects %s bytes as corrupt rather than adopting or repairing them',
    async kind => {
      const { owner, bytes, snapshot, factory, settings } = await setup();
      owner.close();
      const record = reserved(snapshot.plan, 0, 'corrupt');
      const checkpoint =
        kind === 'orphan' || kind === 'trailing-record'
          ? snapshot.checkpoint
          : (await linkedCheckpoint(snapshot, 1)).checkpoint;
      const stored = kind === 'paused' ? controlRecord(record, 'pause') : record;
      let ownerBytes = encodeProviderOwner({
        plan: snapshot.plan,
        checkpoint,
        catalogBytes: bytes,
      });
      if (kind === 'trailing-owner') ownerBytes = new Uint8Array([...ownerBytes, 0]);
      const recordBytes = encodeWithControlHeadroom(stored);
      await rewrite(
        factory,
        ownerBytes,
        kind === 'orphan' || kind === 'paused' ? [stored] : [],
        kind === 'trailing-record'
          ? { key: record.operation.operationId, bytes: new Uint8Array([...recordBytes, 0]) }
          : undefined
      );
      const reader = createProviderBaselineOwner(settings);
      await reader.open();
      await expect(reader.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
      reader.close();
    }
  );

  it('rejects valid canonical owner bytes whose stored operation does not match the linked IDs', async () => {
    const { owner, bytes, snapshot, factory, settings } = await setup();
    owner.close();
    const { checkpoint } = await linkedCheckpoint(snapshot, 1);
    const foreign = reserved(snapshot.plan, 0, 'foreign');
    await rewrite(
      factory,
      encodeProviderOwner({ plan: snapshot.plan, checkpoint, catalogBytes: bytes }),
      [foreign]
    );
    const reader = createProviderBaselineOwner(settings);
    await reader.open();
    await expect(reader.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
    reader.close();
  });

  it('admits 64 budget windows and fences the 65th without changing stored bytes', async () => {
    const { owner } = await setup();
    for (let index = 1; index < 64; index++)
      await owner.applyControl(index - 1, {
        kind: 'roll-budget-window',
        now: 100 + index,
        windowId: 'window-' + index,
      });
    const before = await owner.readSnapshot();
    expect(before?.checkpoint.windows).toHaveLength(64);
    await expect(
      owner.applyControl(63, {
        kind: 'roll-budget-window',
        now: 200,
        windowId: 'window-64',
      })
    ).rejects.toBeDefined();
    expect(await owner.readSnapshot()).toEqual(before);
    owner.close();
  });

  it('preserves a paused terminal MAX revision/time byte-for-byte but rejects active MAX', async () => {
    const { owner, bytes, snapshot, factory, settings } = await setup();
    owner.close();
    const terminal = snapshotProviderBaselineCheckpoint({
      ...snapshot.checkpoint,
      revision: Number.MAX_SAFE_INTEGER,
      observedAt: Number.MAX_SAFE_INTEGER,
    });
    const terminalBytes = encodeProviderOwner({
      plan: snapshot.plan,
      checkpoint: terminal,
      catalogBytes: bytes,
    });
    await rewrite(factory, terminalBytes, []);
    const paused = createProviderBaselineOwner(settings);
    await paused.open();
    expect((await paused.readSnapshot())?.ownerBytes).toEqual(terminalBytes);
    expect(
      (await paused.recoverAfterRestart(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, signal()))
        .ownerBytes
    ).toEqual(terminalBytes);
    paused.close();

    const active = snapshotProviderBaselineCheckpoint({
      ...terminal,
      control: 'active',
    }) as ProviderBaselineCheckpoint;
    await rewrite(
      factory,
      encodeProviderOwner({ plan: snapshot.plan, checkpoint: active, catalogBytes: bytes }),
      []
    );
    const rejected = createProviderBaselineOwner(settings);
    await rejected.open();
    await expect(rejected.readSnapshot()).rejects.toMatchObject({ code: 'headroom-exhausted' });
    rejected.close();
  });

  it('refuses replacement without mutating the accepted owner', async () => {
    const { owner, bytes, selection } = await setup();
    const before = await owner.readSnapshot();
    await expect(
      owner.create(
        bytes,
        {
          purpose: 'new-capture',
          destinations: before!.plan.plan.destinations,
          completenessPolicy: before!.plan.plan.completenessPolicy,
          selection,
        },
        { now: 100, windowId: 'replacement', maxReservationSlots: 16 },
        signal()
      )
    ).rejects.toMatchObject({ code: 'owner-exists' });
    expect(await owner.readSnapshot()).toEqual(before);
    owner.close();
  });

  it.each(['unsupported-provider', 'mismatched-key'] as const)(
    'rejects %s during create and leaves the fresh inventory empty',
    async kind => {
      const factory = new IDBFactory();
      const owner = createProviderBaselineOwner({ indexedDB: factory, sha256 });
      await owner.open();
      const catalogSelection = [
        identity(0, kind === 'unsupported-provider' ? 'gemini' : 'chatgpt'),
      ];
      const requestSelection =
        kind === 'mismatched-key'
          ? [{ ...catalogSelection[0], conversationKey: identity(0, 'claude').conversationKey }]
          : catalogSelection;
      const bytes = await catalogBytes(catalogSelection);
      await expect(
        owner.create(
          bytes,
          { ...requirements, selection: requestSelection },
          { now: 100, windowId: 'window-a', maxReservationSlots: 16 },
          signal()
        )
      ).rejects.toBeDefined();
      expect(await owner.readSnapshot()).toBeUndefined();
      owner.close();
    }
  );
});
