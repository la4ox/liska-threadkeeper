// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createBaselineOwner,
  OWNER_DATABASE_NAME,
  OWNER_KEY,
} from '../../../src/resumability-journal/baseline-owner';
import { encodeOwner } from '../../../src/resumability-journal/baseline-owner/envelope';
import { encodeRecord } from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { encodeBaselineCheckpoint } from '../../../src/resumability-journal/baseline-plan';
import { active, setup, ids, signal, sha256 } from './fixtures';
import { fixture, linked, reserved, observed, dependencies } from '../baseline-plan/fixtures';
import { reduceBaselineCheckpoint } from '../../../src/resumability-journal/baseline-plan';
import { MAX_OWNER_BYTES } from '../../../src/resumability-journal/baseline-owner/envelope';

async function connection(factory: IDBFactory, version = 1, upgrade?: (db: IDBDatabase) => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(OWNER_DATABASE_NAME, version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function mutate(factory: IDBFactory, action: (tx: IDBTransaction) => void) {
  const db = await connection(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['owner', 'operations'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      action(tx);
    });
  } finally {
    db.close();
  }
}
describe('exact durable inventory and bounded accepted state', () => {
  it('rejects two exact pending reservations even with complete canonical links and observations', async () => {
    const factory = new IDBFactory(),
      owner = createBaselineOwner({ indexedDB: factory, sha256 });
    await owner.open();
    const data = await fixture(2),
      records = [reserved(data.plan, 0), reserved(data.plan, 1)];
    let checkpoint = data.checkpoint;
    for (let index = 0; index < records.length; index++)
      checkpoint = await linked(data.plan, checkpoint, records[index], index);
    await mutate(factory, tx => {
      tx.objectStore('owner').add(
        encodeOwner({ plan: data.plan, checkpoint, catalogBytes: data.bytes }),
        OWNER_KEY
      );
      records.forEach(record =>
        tx.objectStore('operations').add(encodeRecord(record), record.operation.operationId)
      );
    });
    await expect(owner.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
    owner.close();
  });
  it('accepts exactly 16 linked lifetime records, rejects the seventeenth and never refunds reservations', async () => {
    const factory = new IDBFactory();
    const owner = createBaselineOwner({ indexedDB: factory, sha256 });
    await owner.open();
    const data = await fixture(17);
    let checkpoint = data.checkpoint;
    const records = [];
    for (let index = 0; index < 16; index++) {
      const record = await observed(reserved(data.plan, index));
      records.push(record);
      checkpoint = await linked(data.plan, checkpoint, record, index);
    }
    checkpoint = await reduceBaselineCheckpoint(
      data.plan,
      checkpoint,
      { kind: 'activate', expectedRevision: checkpoint.revision, now: 200 },
      dependencies()
    );
    await mutate(factory, tx => {
      tx.objectStore('owner').add(
        encodeOwner({ plan: data.plan, checkpoint, catalogBytes: data.bytes }),
        OWNER_KEY
      );
      records.forEach(record =>
        tx.objectStore('operations').add(encodeRecord(record), record.operation.operationId)
      );
    });
    expect((await owner.readSnapshot())?.operations).toHaveLength(16);
    const recovered = await owner.recoverAfterRestart(checkpoint.revision, 201, signal());
    expect(recovered.checkpoint.charges).toHaveLength(16);
    await owner.applyControl(recovered.checkpoint.revision, { kind: 'activate', now: 202 });
    await expect(
      owner.reserveNextChatGpt(
        recovered.checkpoint.revision + 1,
        data.bytes,
        ids('17'),
        203,
        signal()
      )
    ).rejects.toMatchObject({ code: 'candidate-unavailable' });
    await mutate(factory, tx => {
      const extra = reserved(data.plan, 16);
      tx.objectStore('operations').add(encodeRecord(extra), extra.operation.operationId);
    });
    await expect(owner.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
    owner.close();
  });
  it.each(['owner', 'operations'] as const)(
    'bounds %s raw byte allocations before parsing',
    async store => {
      const { owner, factory } = await setup();
      await mutate(factory as IDBFactory, tx =>
        tx
          .objectStore(store)
          .put(
            new Uint8Array((store === 'owner' ? MAX_OWNER_BYTES : 8 * 1024 * 1024) + 1),
            store === 'owner' ? OWNER_KEY : 'oversized'
          )
      );
      await expect(owner.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
      owner.close();
    }
  );
  it.each([
    'owner-extra',
    'owner-missing',
    'record-missing',
    'record-orphan',
    'record-foreign',
    'record-key',
    'record-phase',
    'record-revision',
    'checkpoint-digest',
    'plan-digest',
    'trailing-byte',
  ] as const)('fails closed on %s without repair or adoption', async kind => {
    const { owner, data, factory, settings } = await active();
    const result = await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    const snapshot = result.snapshot;
    await mutate(factory as IDBFactory, tx => {
      const owners = tx.objectStore('owner'),
        operations = tx.objectStore('operations');
      if (kind === 'owner-extra') owners.add(snapshot.ownerBytes, 'other');
      if (kind === 'owner-missing') owners.delete(OWNER_KEY);
      if (kind === 'record-missing') operations.delete(ids().operationId);
      if (kind === 'record-orphan')
        operations.add(
          encodeRecord({
            ...result.record,
            operation: { ...result.record.operation, ...ids('extra') },
          }),
          ids('extra').operationId
        );
      if (kind === 'record-key') {
        operations.delete(ids().operationId);
        operations.add(encodeRecord(result.record), 'other');
      }
      if (kind === 'record-foreign')
        operations.put(
          encodeRecord({
            ...result.record,
            operation: {
              ...result.record.operation,
              sourceSelection: { catalogSha256: 'a'.repeat(64) },
            },
          }),
          ids().operationId
        );
      if (kind === 'record-phase')
        operations.put(encodeRecord({ ...result.record, phase: 'in-flight' }), ids().operationId);
      if (kind === 'record-revision')
        operations.put(encodeRecord({ ...result.record, revision: 1 }), ids().operationId);
      if (kind === 'checkpoint-digest')
        owners.put(
          encodeOwner({
            plan: snapshot.plan,
            checkpoint: { ...snapshot.checkpoint, planSha256: 'a'.repeat(64) },
            catalogBytes: data.bytes,
          }),
          OWNER_KEY
        );
      if (kind === 'plan-digest')
        owners.put(
          encodeOwner({
            plan: { ...snapshot.plan, planSha256: 'a'.repeat(64) },
            checkpoint: snapshot.checkpoint,
            catalogBytes: data.bytes,
          }),
          OWNER_KEY
        );
      if (kind === 'trailing-byte')
        owners.put(new Uint8Array([...snapshot.ownerBytes, 0]), OWNER_KEY);
    });
    const fresh = createBaselineOwner(settings);
    await fresh.open();
    await expect(fresh.readSnapshot()).rejects.toBeDefined();
    await expect(
      fresh.inspectReservation({
        ...ids(),
        planSha256: snapshot.plan.planSha256,
        item: result.item,
      })
    ).rejects.toBeDefined();
    await expect(fresh.recoverAfterRestart(2, 103, signal())).rejects.toBeDefined();
    owner.close();
    fresh.close();
  });
  it.each([
    'owner-index',
    'operation-index',
    'key-path',
    'auto-increment',
    'extra-store',
    'missing-store',
    'version',
  ] as const)('rejects %s schema in place', async kind => {
    const factory = new IDBFactory();
    const db = await connection(factory, kind === 'version' ? 2 : 1, db => {
      const owners = db.createObjectStore(
        'owner',
        kind === 'key-path'
          ? { keyPath: 'id' }
          : kind === 'auto-increment'
            ? { autoIncrement: true }
            : {}
      );
      if (kind === 'owner-index') owners.createIndex('extra', 'id');
      if (kind !== 'missing-store') {
        const operations = db.createObjectStore('operations');
        if (kind === 'operation-index') operations.createIndex('extra', 'id');
      }
      if (kind === 'extra-store') db.createObjectStore('extra');
    });
    db.close();
    const owner = createBaselineOwner({ indexedDB: factory, sha256 });
    await expect(owner.open()).rejects.toMatchObject({
      code: kind === 'version' ? 'unsupported-version' : 'invalid-schema',
    });
    owner.close();
  });
  it('stops at exactly 64 retained windows without pruning', async () => {
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
      owner.applyControl(63, { kind: 'roll-budget-window', now: 164, windowId: 'overflow' })
    ).rejects.toMatchObject({ code: 'history-exhausted' });
    expect(await owner.readSnapshot()).toEqual(before);
    await owner.recoverAfterRestart(63, 165, signal());
    expect((await owner.readSnapshot())?.checkpoint.windows).toEqual(before?.checkpoint.windows);
    owner.close();
  });
  it.each(['pause', 'restart'] as const)(
    'allows one final active increment, then %s consumes the last revision safely',
    async route => {
      const { owner, data, factory, settings, snapshot } = await setup();
      const checkpoint = {
        ...snapshot.checkpoint,
        revision: Number.MAX_SAFE_INTEGER - 2,
        control: 'active' as const,
      };
      await mutate(factory as IDBFactory, tx =>
        tx
          .objectStore('owner')
          .put(
            encodeOwner({ plan: snapshot.plan, checkpoint, catalogBytes: data.bytes }),
            OWNER_KEY
          )
      );
      const active = await owner.applyControl(checkpoint.revision, { kind: 'activate', now: 101 });
      expect(active.checkpoint.revision).toBe(Number.MAX_SAFE_INTEGER - 1);
      await expect(
        owner.applyControl(active.checkpoint.revision, {
          kind: 'set-cooldown',
          now: 102,
          until: 200,
        })
      ).rejects.toMatchObject({ code: 'headroom-exhausted' });
      expect(await owner.readSnapshot()).toEqual(active);
      const paused =
        route === 'pause'
          ? await owner.applyControl(active.checkpoint.revision, {
              kind: 'pause',
              now: Number.MAX_SAFE_INTEGER,
            })
          : undefined;
      owner.close();
      const fresh = createBaselineOwner(settings);
      await fresh.open();
      const recovered = await fresh.recoverAfterRestart(
        paused?.checkpoint.revision ?? active.checkpoint.revision,
        Number.MAX_SAFE_INTEGER,
        signal()
      );
      expect(recovered.checkpoint).toMatchObject({
        control: 'paused',
        revision: Number.MAX_SAFE_INTEGER,
        observedAt: Number.MAX_SAFE_INTEGER,
      });
      expect(encodeBaselineCheckpoint(recovered.checkpoint).length).toBeLessThanOrEqual(64 * 1024);
      if (paused) expect(recovered.ownerBytes).toEqual(paused.ownerBytes);
      expect(await fresh.readSnapshot()).toEqual(recovered);
      const again = await fresh.recoverAfterRestart(
        recovered.checkpoint.revision,
        Number.MAX_SAFE_INTEGER,
        signal()
      );
      expect(again.ownerBytes).toEqual(recovered.ownerBytes);
      await expect(
        fresh.applyControl(recovered.checkpoint.revision, {
          kind: 'activate',
          now: Number.MAX_SAFE_INTEGER,
        })
      ).rejects.toBeDefined();
      await expect(
        fresh.applyControl(recovered.checkpoint.revision, {
          kind: 'pause',
          now: Number.MAX_SAFE_INTEGER,
        })
      ).rejects.toMatchObject({ code: 'revision-conflict' });
      expect((await fresh.readSnapshot())?.ownerBytes).toEqual(recovered.ownerBytes);
      fresh.close();
    }
  );
  it('rejects an active terminal checkpoint on read rather than accepting a state that cannot pause', async () => {
    const { owner, data, factory, snapshot } = await setup();
    await mutate(factory as IDBFactory, tx =>
      tx.objectStore('owner').put(
        encodeOwner({
          plan: snapshot.plan,
          catalogBytes: data.bytes,
          checkpoint: {
            ...snapshot.checkpoint,
            control: 'active',
            revision: Number.MAX_SAFE_INTEGER,
          },
        }),
        OWNER_KEY
      )
    );
    await expect(owner.readSnapshot()).rejects.toMatchObject({ code: 'headroom-exhausted' });
    owner.close();
  });
  it('rejects beyond-safe times and own-data accessors before hashing', async () => {
    const { owner, data } = await active();
    await expect(
      owner.reserveNextChatGpt(1, data.bytes, ids(), Number.MAX_SAFE_INTEGER + 1, signal())
    ).rejects.toBeDefined();
    let reads = 0;
    const request = {
      ...ids(),
      get operationId() {
        reads++;
        return 'bad';
      },
    };
    await expect(
      owner.reserveNextChatGpt(1, data.bytes, request, 102, signal())
    ).rejects.toBeDefined();
    expect(reads).toBe(0);
    owner.close();
  });
});
