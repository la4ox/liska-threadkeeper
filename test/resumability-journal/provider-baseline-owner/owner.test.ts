// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  createProviderBaselineOwner,
  PROVIDER_OWNER_DATABASE_NAME,
  type ProviderOwnerControl,
  type ProviderReservationIds,
} from '../../../src/resumability-journal/provider-baseline-owner';
import { active, deferred, identity, ids, setup, sha256, signal } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('reservation-only provider baseline owner', () => {
  it.each(['chatgpt', 'claude'] as const)(
    'creates and reserves one exact %s journal/3 record without an execution capability',
    async provider => {
      const { owner, bytes } = await active({}, [identity(0, provider)]);
      const result = await owner.reserveNext(1, bytes, ids(provider), 102, signal());
      expect(Object.keys(result).sort()).toEqual([
        'executionAuthorized',
        'item',
        'record',
        'snapshot',
      ]);
      expect(result).toMatchObject({
        executionAuthorized: false,
        item: { provider },
        record: {
          schema: 'liska-resumability-journal/3',
          revision: 0,
          phase: 'reserved',
          control: 'active',
          disposition: 'open',
        },
      });
      expect(result.record.operation).toEqual({
        schema: 'liska-new-capture-operation/1',
        purpose: 'new-capture',
        ...ids(provider),
        admission: {
          provider,
          conversationId: result.item.conversationId,
          conversationKey: result.item.conversationKey,
        },
        sourceSelection: { catalogSha256: result.snapshot.plan.plan.catalogSha256 },
        destinations: result.snapshot.plan.plan.destinations,
        completenessPolicy: result.snapshot.plan.plan.completenessPolicy,
      });
      expect(result.snapshot.checkpoint.links).toHaveLength(1);
      expect(result.snapshot.checkpoint.charges).toHaveLength(1);
      expect(result.snapshot.checkpoint.observations).toHaveLength(1);
      for (const value of [
        result,
        result.item,
        result.record,
        result.record.operation,
        result.snapshot,
        result.snapshot.plan,
        result.snapshot.checkpoint,
        result.snapshot.operations,
      ])
        expect(Object.isFrozen(value)).toBe(true);
      result.snapshot.ownerBytes.fill(0);
      expect((await owner.readSnapshot())?.ownerBytes).not.toEqual(result.snapshot.ownerBytes);
      owner.close();
    }
  );

  it('opens existing state inspection-only, then recovers by pausing without changing reservations', async () => {
    const { owner, bytes, settings } = await active();
    const reserved = await owner.reserveNext(1, bytes, ids(), 102, signal());
    owner.close();
    const reopened = createProviderBaselineOwner(settings);
    await reopened.open();
    expect(await reopened.readSnapshot()).toEqual(reserved.snapshot);
    await expect(reopened.applyControl(2, { kind: 'activate', now: 103 })).rejects.toMatchObject({
      code: 'recovery-required',
    });
    reopened.close();

    const recoveredOwner = createProviderBaselineOwner(settings);
    await recoveredOwner.open();
    const recovered = await recoveredOwner.recoverAfterRestart(2, 103, signal());
    expect(recovered.checkpoint).toEqual({
      ...reserved.snapshot.checkpoint,
      control: 'paused',
      revision: 3,
      observedAt: 103,
    });
    expect(recovered.operations).toEqual([reserved.record]);
    recoveredOwner.close();
  });

  it('preserves already-paused owner bytes and terminal facts through repeated recovery', async () => {
    const { owner, snapshot } = await setup();
    const before = await owner.readSnapshot();
    const recovered = await owner.recoverAfterRestart(0, 200, signal());
    expect(recovered).toEqual(before);
    expect(recovered.ownerBytes).toEqual(snapshot.ownerBytes);
    const again = await owner.recoverAfterRestart(0, 300, signal());
    expect(again.ownerBytes).toEqual(snapshot.ownerBytes);
    owner.close();
  });

  it('serializes create and reserve races under complete-inventory CAS', async () => {
    const factory = new IDBFactory();
    const first = createProviderBaselineOwner({ indexedDB: factory, sha256 });
    const second = createProviderBaselineOwner({ indexedDB: factory, sha256 });
    await Promise.all([first.open(), second.open()]);
    const selection = [identity(0, 'chatgpt')];
    const { catalogBytes, requirements } = await import('./fixtures');
    const bytes = await catalogBytes(selection);
    const create = (owner: typeof first) =>
      owner.create(
        bytes,
        { ...requirements, selection },
        { now: 100, windowId: 'a', maxReservationSlots: 16 },
        signal()
      );
    const creates = await Promise.allSettled([create(first), create(second)]);
    expect(creates.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    first.close();
    second.close();

    const a = createProviderBaselineOwner({ indexedDB: factory, sha256 });
    const b = createProviderBaselineOwner({ indexedDB: factory, sha256 });
    await Promise.all([a.open(), b.open()]);
    await Promise.all([
      a.recoverAfterRestart(0, 101, signal()),
      b.recoverAfterRestart(0, 101, signal()),
    ]);
    await a.applyControl(0, { kind: 'activate', now: 102 });
    await b.recoverAfterRestart(1, 102, signal());
    await b.applyControl(2, { kind: 'activate', now: 103 });
    await a.recoverAfterRestart(3, 103, signal());
    await a.applyControl(4, { kind: 'activate', now: 104 });
    const reserves = await Promise.allSettled([
      a.reserveNext(5, bytes, ids('a'), 105, signal()),
      b.reserveNext(5, bytes, ids('b'), 105, signal()),
    ]);
    expect(reserves.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await a.readSnapshot())?.operations).toHaveLength(1);
    a.close();
    b.close();
  });

  it('uses provider-aware conversation keys for equal conversation IDs', async () => {
    const chatgpt = identity(0, 'chatgpt');
    const claude = identity(0, 'claude');
    expect(chatgpt.conversationId).toBe(claude.conversationId);
    expect(chatgpt.conversationKey).not.toBe(claude.conversationKey);
    const { owner, bytes, snapshot } = await active({}, [claude, chatgpt]);
    expect(snapshot.plan.plan.items.map(item => item.provider)).toEqual(['chatgpt', 'claude']);
    expect((await owner.reserveNext(1, bytes, ids(), 102, signal())).item).toMatchObject(chatgpt);
    owner.close();
  });

  it.each(['revision', 'catalog', 'time', 'ids', 'cancelled'] as const)(
    'rejects changed %s, preserves bytes and permanently fences mutation on that handle',
    async kind => {
      const { owner, bytes } = await active();
      const before = await owner.readSnapshot();
      const aborted = new AbortController();
      aborted.abort();
      const changed = bytes.slice();
      changed[changed.length - 1] ^= 1;
      await expect(
        owner.reserveNext(
          kind === 'revision' ? 0 : 1,
          kind === 'catalog' ? changed : bytes,
          kind === 'ids' ? { operationId: 'same', attemptId: 'same', captureId: 'same' } : ids(),
          kind === 'time' ? 99 : 102,
          kind === 'cancelled' ? aborted.signal : signal()
        )
      ).rejects.toBeDefined();
      expect(await owner.readSnapshot()).toEqual(before);
      await expect(owner.applyControl(1, { kind: 'pause', now: 103 })).rejects.toMatchObject({
        code: 'recovery-required',
      });
      owner.close();
    }
  );

  it('accepts only the closed control set and never observe-operation', async () => {
    const { owner } = await setup();
    await expect(
      owner.applyControl(0, {
        kind: 'observe-operation',
        now: 101,
      } as unknown as ProviderOwnerControl)
    ).rejects.toMatchObject({ code: 'invalid-input' });
    owner.close();
  });

  it('snapshots caller bytes, IDs and the injected hash before yielding', async () => {
    const gate = deferred<void>();
    let hold = false;
    const options = {
      sha256: async (bytes: Uint8Array) => {
        if (hold) await gate.promise;
        return sha256(bytes);
      },
    };
    const { owner, bytes } = await active(options, [identity(0, 'claude')]);
    hold = true;
    const supplied = bytes.slice();
    const suppliedIds = ids();
    const pending = owner.reserveNext(1, supplied, suppliedIds, 102, signal());
    supplied.fill(0);
    suppliedIds.operationId = 'mutated';
    options.sha256 = async () => {
      throw new Error('replaced');
    };
    gate.resolve();
    expect((await pending).record.operation.operationId).toBe('operation-1');
    owner.close();
  });

  it.each(['pause', 'recover'] as const)(
    'fences an in-flight reservation after same-handle %s and prevents stale writes',
    async mode => {
      const gate = deferred<void>();
      const entered = deferred<void>();
      let delayNextHash = false;
      const { owner, bytes, settings } = await active({
        sha256: async input => {
          if (delayNextHash) {
            delayNextHash = false;
            entered.resolve();
            await gate.promise;
          }
          return sha256(input);
        },
      });
      const add = vi.spyOn(IDBObjectStore.prototype, 'add');
      const put = vi.spyOn(IDBObjectStore.prototype, 'put');
      delayNextHash = true;
      const pending = owner.reserveNext(1, bytes, ids(), 102, signal());
      await entered.promise;
      const paused =
        mode === 'pause'
          ? await owner.applyControl(1, { kind: 'pause', now: 103 })
          : await owner.recoverAfterRestart(1, 103, signal());

      expect(paused.checkpoint).toMatchObject({ control: 'paused', revision: 2 });
      expect(paused.operations).toHaveLength(0);
      expect(add).not.toHaveBeenCalled();
      expect(put).toHaveBeenCalledTimes(1);
      gate.resolve();
      await expect(pending).rejects.toMatchObject({ code: 'invalid-input' });
      expect(add).not.toHaveBeenCalled();
      expect(put).toHaveBeenCalledTimes(1);
      add.mockRestore();
      put.mockRestore();

      const fresh = createProviderBaselineOwner(settings);
      await fresh.open();
      expect(await fresh.readSnapshot()).toEqual(paused);
      owner.close();
      fresh.close();
    }
  );

  it.each(['getter', 'proxy'] as const)(
    'rejects hostile %s ID containers before mutation and preserves the owner bytes',
    async kind => {
      const { owner, bytes } = await active();
      const before = await owner.readSnapshot();
      const hostile =
        kind === 'getter'
          ? Object.defineProperty(
              { attemptId: 'attempt-hostile', captureId: 'capture-hostile' },
              'operationId',
              { enumerable: true, get: () => 'operation-hostile' }
            )
          : new Proxy(ids('hostile'), {
              ownKeys() {
                throw new Error('proxy-trap');
              },
            });
      await expect(
        owner.reserveNext(1, bytes, hostile as ProviderReservationIds, 102, signal())
      ).rejects.toBeDefined();
      expect(await owner.readSnapshot()).toEqual(before);
      owner.close();
    }
  );

  it('inspects exact committed identity read-only and never returns retry authority', async () => {
    const { owner, bytes, snapshot } = await active();
    const input = {
      ...ids(),
      planSha256: snapshot.plan.planSha256,
      item: snapshot.plan.plan.items[0],
    };
    expect(await owner.inspectReservation(input)).toEqual({
      executionAuthorized: false,
      kind: 'not-observed',
    });
    await owner.reserveNext(1, bytes, ids(), 102, signal());
    expect(await owner.inspectReservation(input)).toMatchObject({
      executionAuthorized: false,
      kind: 'committed',
    });
    await expect(
      owner.inspectReservation({ ...input, attemptId: 'foreign' })
    ).rejects.toMatchObject({
      code: 'corrupt-owner',
    });
    owner.close();
  });

  it('opens only the fixed namespace or an exact test suffix', async () => {
    const factory = new IDBFactory();
    const spy = vi.spyOn(factory, 'open');
    const owner = createProviderBaselineOwner({
      indexedDB: factory,
      sha256,
      databaseName: PROVIDER_OWNER_DATABASE_NAME + '-smoke',
    });
    await owner.open();
    owner.close();
    expect(spy).toHaveBeenCalledExactlyOnceWith(PROVIDER_OWNER_DATABASE_NAME + '-smoke', 1);
    for (const databaseName of [
      'liska-baseline-owner-v1',
      'liska-resumability-journal-v3',
      'liska-resumability-journal-v2',
      'other',
    ])
      expect(() =>
        createProviderBaselineOwner({ indexedDB: factory, sha256, databaseName })
      ).toThrow('invalid-schema');
  });
});
