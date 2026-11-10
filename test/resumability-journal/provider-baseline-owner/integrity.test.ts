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
import {
  encodeRecord,
  snapshotRecord,
  type OperationRecord,
} from '../../../src/resumability-journal/purpose-persistence-v3/core/record';
import { observed, reserved } from '../provider-baseline/fixtures';
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
  count: number,
  awaiting = false
) {
  let checkpoint = snapshot.checkpoint;
  const records: OperationRecord[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const record = reserved(snapshot.plan, ordinal, String(ordinal));
    checkpoint = await reduceProviderBaselineCheckpoint(
      snapshot.plan,
      checkpoint,
      {
        kind: 'observe-operation',
        expectedRevision: checkpoint.revision,
        now: 101 + ordinal * (awaiting ? 2 : 1),
        itemOrdinal: ordinal,
        record,
      },
      { sha256, signal: signal() }
    );
    const current = awaiting ? await observed(record, 'insufficient') : record;
    if (awaiting)
      checkpoint = await reduceProviderBaselineCheckpoint(
        snapshot.plan,
        checkpoint,
        {
          kind: 'observe-operation',
          expectedRevision: checkpoint.revision,
          now: 102 + ordinal * 2,
          itemOrdinal: ordinal,
          record: current,
        },
        { sha256, signal: signal() }
      );
    records.push(current);
  }
  return { checkpoint, records };
}

describe('provider owner complete-inventory admission and bounds', () => {
  it('admits exactly 16 bound awaiting-resolution records and rejects a seventeenth physical record', async () => {
    const selection = Array.from({ length: 17 }, (_, index) =>
      identity(index, index % 2 ? 'claude' : 'chatgpt')
    );
    const { owner, bytes, snapshot, factory, settings } = await setup({}, selection);
    owner.close();
    const { checkpoint, records } = await linkedCheckpoint(snapshot, 16, true);
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

  it('rejects more than one reserved, in-flight or unknown pending record', async () => {
    const selection = [identity(0, 'chatgpt'), identity(1, 'claude')];
    const { owner, bytes, snapshot, factory, settings } = await setup({}, selection);
    owner.close();
    const { checkpoint, records } = await linkedCheckpoint(snapshot, 2);
    await rewrite(
      factory,
      encodeProviderOwner({ plan: snapshot.plan, checkpoint, catalogBytes: bytes }),
      records
    );
    const reader = createProviderBaselineOwner(settings);
    await reader.open();
    await expect(reader.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
    reader.close();
  });

  it('rejects canonical reserved/paused state with a valid appended latest digest on read and reopen', async () => {
    const { owner, bytes, snapshot, factory, settings } = await setup();
    owner.close();
    const linked = await linkedCheckpoint(snapshot, 1);
    const paused = controlRecord(linked.records[0], 'pause');
    const checkpoint = await reduceProviderBaselineCheckpoint(
      snapshot.plan,
      linked.checkpoint,
      {
        kind: 'observe-operation',
        expectedRevision: linked.checkpoint.revision,
        now: linked.checkpoint.observedAt + 1,
        itemOrdinal: 0,
        record: paused,
      },
      { sha256, signal: signal() }
    );
    expect(checkpoint.observations.at(-1)).toMatchObject({
      recordRevision: paused.revision,
      recordSha256: await sha256(encodeRecord(paused)),
    });
    await rewrite(
      factory,
      encodeProviderOwner({ plan: snapshot.plan, checkpoint, catalogBytes: bytes }),
      [paused]
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const reader = createProviderBaselineOwner(settings);
      await reader.open();
      await expect(reader.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
      reader.close();
    }
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

  it.each(['immutable-operation', 'latest-record-digest'] as const)(
    'rejects %s corruption without rewriting either store',
    async kind => {
      const { owner, bytes, snapshot, factory, settings } = await setup();
      owner.close();
      const { checkpoint, records } = await linkedCheckpoint(snapshot, 1);
      const stored =
        kind === 'immutable-operation'
          ? [
              snapshotRecord({
                ...records[0],
                operation: {
                  ...records[0].operation,
                  sourceSelection: { catalogSha256: 'f'.repeat(64) },
                },
              }),
            ]
          : records;
      const observations = [...checkpoint.observations];
      if (kind === 'latest-record-digest')
        observations[observations.length - 1] = {
          ...observations.at(-1)!,
          recordSha256: 'e'.repeat(64),
        };
      const corrupted = { ...checkpoint, observations };
      await rewrite(
        factory,
        encodeProviderOwner({ plan: snapshot.plan, checkpoint: corrupted, catalogBytes: bytes }),
        stored
      );
      const reader = createProviderBaselineOwner(settings);
      await reader.open();
      await expect(reader.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
      reader.close();
    }
  );

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
