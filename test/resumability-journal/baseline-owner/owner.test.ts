// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import {
  createBaselineOwner,
  OWNER_DATABASE_NAME,
  type OwnerControl,
} from '../../../src/resumability-journal/baseline-owner';
import { active, setup, signal, ids, fixture, requirements, sha256, deferred } from './fixtures';
import { catalogBytes, identity } from '../baseline-plan/fixtures';
afterEach(() => vi.restoreAllMocks());
describe('durable offline baseline owner', () => {
  it('runs the unique-name fake IndexedDB smoke through reserve, reopen and paused recovery', async () => {
    const { owner, data, settings } = await active({
      databaseName: OWNER_DATABASE_NAME + '-offline-smoke',
    });
    const committed = await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    owner.close();
    const reopened = createBaselineOwner(settings);
    await reopened.open();
    expect((await reopened.readSnapshot())?.ownerBytes).toEqual(committed.snapshot.ownerBytes);
    const recovered = await reopened.recoverAfterRestart(2, 103, signal());
    expect(recovered.checkpoint.control).toBe('paused');
    expect(recovered.operations).toEqual([committed.record]);
    reopened.close();
  });
  it('creates canonical bytes, refuses replacement, reopens fenced and recovers paused with exact histories', async () => {
    const { owner, data, settings } = await active();
    const result = await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    expect(result.executionAuthorized).toBe(false);
    expect(Object.keys(result).sort()).toEqual([
      'executionAuthorized',
      'item',
      'prepared',
      'record',
      'snapshot',
    ]);
    expect(result.record).toMatchObject({
      revision: 0,
      phase: 'reserved',
      control: 'active',
      disposition: 'open',
    });
    const before = await owner.readSnapshot();
    expect(before?.checkpoint.links).toHaveLength(1);
    expect(before?.checkpoint.charges).toHaveLength(1);
    expect(before?.checkpoint.observations).toHaveLength(1);
    await expect(
      owner.create(
        data.bytes,
        { ...requirements, selection: data.selection },
        { now: 100, windowId: 'b', maxReservationSlots: 16 },
        signal()
      )
    ).rejects.toMatchObject({ code: 'owner-exists' });
    owner.close();
    const reopened = createBaselineOwner(settings);
    await reopened.open();
    expect(await reopened.readSnapshot()).toEqual(before);
    await expect(reopened.applyControl(2, { kind: 'activate', now: 103 })).rejects.toMatchObject({
      code: 'recovery-required',
    });
    const recovered = await reopened.recoverAfterRestart(2, 103, signal());
    expect(recovered.checkpoint).toEqual({
      ...before!.checkpoint,
      control: 'paused',
      revision: 3,
      observedAt: 103,
    });
    expect(recovered.operations).toEqual(before!.operations);
    await expect(
      reopened.reserveNextChatGpt(3, data.bytes, ids('2'), 104, signal())
    ).rejects.toMatchObject({ code: 'candidate-unavailable' });
    reopened.close();
  });
  it('serializes creation on the one fixed owner key', async () => {
    const factory = new IDBFactory();
    const a = createBaselineOwner({ indexedDB: factory, sha256 }),
      b = createBaselineOwner({ indexedDB: factory, sha256 });
    await Promise.all([a.open(), b.open()]);
    const data = await fixture();
    const create = (owner: typeof a) =>
      owner.create(
        data.bytes,
        { ...requirements, selection: data.selection },
        { now: 100, windowId: 'a', maxReservationSlots: 16 },
        signal()
      );
    const results = await Promise.allSettled([create(a), create(b)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await a.readSnapshot())?.operations).toEqual([]);
    a.close();
    b.close();
  });
  it('two recovered handles racing reserve exactly one complete pair', async () => {
    const { owner: a, data, settings } = await active();
    const b = createBaselineOwner(settings);
    await b.open();
    await b.recoverAfterRestart(1, 102, signal());
    await a.applyControl(2, { kind: 'activate', now: 103 });
    const results = await Promise.allSettled([
      a.reserveNextChatGpt(3, data.bytes, ids('a'), 104, signal()),
      b.reserveNextChatGpt(3, data.bytes, ids('b'), 104, signal()),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const snapshot = await a.readSnapshot();
    expect(snapshot?.operations).toHaveLength(1);
    expect(snapshot?.checkpoint.links[0].operationId).toBe(
      snapshot?.operations[0].operation.operationId
    );
    expect(snapshot?.checkpoint.revision).toBe(4);
    a.close();
    b.close();
  });
  it.each(['revision', 'catalog', 'time', 'id', 'cancelled'] as const)(
    'rejects changed %s without mutation',
    async kind => {
      const { owner, data } = await active();
      const before = await owner.readSnapshot();
      const aborted = new AbortController();
      aborted.abort();
      await expect(
        owner.reserveNextChatGpt(
          kind === 'revision' ? 0 : 1,
          kind === 'catalog' ? await catalogBytes([identity(9)]) : data.bytes,
          kind === 'id' ? { ...ids(), captureId: 'invalid' } : ids(),
          kind === 'time' ? 99 : 102,
          kind === 'cancelled' ? aborted.signal : signal()
        )
      ).rejects.toBeDefined();
      expect(await owner.readSnapshot()).toEqual(before);
      owner.close();
    }
  );
  it.each(['operationId', 'attemptId', 'captureId'] as const)(
    'retains global %s uniqueness',
    async field => {
      const { owner, data } = await active();
      await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
      await expect(
        owner.reserveNextChatGpt(
          2,
          data.bytes,
          { ...ids('2'), [field]: ids()[field] },
          103,
          signal()
        )
      ).rejects.toMatchObject({ code: 'identity-exists' });
      expect((await owner.readSnapshot())?.operations).toHaveLength(1);
      owner.close();
    }
  );
  it('requires the current candidate to be ChatGPT, not a caller-chosen later item', async () => {
    const factory = new IDBFactory(),
      owner = createBaselineOwner({ indexedDB: factory, sha256 });
    await owner.open();
    const selection = [identity(1, 'aaa'), identity(2)];
    const bytes = await catalogBytes(selection);
    await owner.create(
      bytes,
      { ...requirements, selection },
      { now: 100, windowId: 'a', maxReservationSlots: 16 },
      signal()
    );
    await owner.applyControl(0, { kind: 'activate', now: 101 });
    await expect(owner.reserveNextChatGpt(1, bytes, ids(), 102, signal())).rejects.toMatchObject({
      code: 'unsupported-provider',
    });
    owner.close();
  });
  it('allows only exact control commands and preserves cooldown/windows through recovery', async () => {
    const { owner, settings } = await setup();
    await expect(
      owner.applyControl(0, { kind: 'observe-operation', now: 101 } as unknown as OwnerControl)
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await owner.applyControl(0, { kind: 'set-cooldown', now: 101, until: 200 });
    await owner.applyControl(1, { kind: 'roll-budget-window', now: 102, windowId: 'b' });
    const before = await owner.readSnapshot();
    owner.close();
    const next = createBaselineOwner(settings);
    await next.open();
    const after = await next.recoverAfterRestart(2, 103, signal());
    expect(after.checkpoint.cooldown).toEqual(before!.checkpoint.cooldown);
    expect(after.checkpoint.windows).toEqual(before!.checkpoint.windows);
    await next.applyControl(3, { kind: 'clear-cooldown', now: 104 });
    expect((await next.readSnapshot())?.checkpoint.cooldown).toBeUndefined();
    next.close();
  });
  it('snapshots caller bytes, IDs and hash capability before awaits', async () => {
    const gate = deferred<void>();
    let hold = false;
    const options = {
      sha256: async (bytes: Uint8Array) => {
        if (hold) await gate.promise;
        return sha256(bytes);
      },
    };
    const { owner, data } = await active(options);
    hold = true;
    const bytes = data.bytes.slice(),
      request = ids();
    const pending = owner.reserveNextChatGpt(1, bytes, request, 102, signal());
    bytes.fill(0);
    request.operationId = 'mutated';
    options.sha256 = async () => {
      throw new Error('replaced');
    };
    gate.resolve();
    expect((await pending).record.operation.operationId).toBe('operation-1');
    owner.close();
  });
  it('reconciles exact item/IDs read-only; absent is not retry permission', async () => {
    const { owner, data, snapshot } = await active();
    const exact = {
      ...ids(),
      planSha256: snapshot.plan.planSha256,
      item: snapshot.plan.plan.items[0],
    };
    expect(await owner.inspectReservation(exact)).toEqual({
      executionAuthorized: false,
      kind: 'not-observed',
    });
    await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    expect(await owner.inspectReservation(exact)).toMatchObject({
      executionAuthorized: false,
      kind: 'committed',
    });
    await expect(owner.inspectReservation({ ...exact, attemptId: 'other' })).rejects.toMatchObject({
      code: 'corrupt-owner',
    });
    owner.close();
  });
  it('never opens a legacy namespace or accepts arbitrary names', async () => {
    const factory = new IDBFactory(),
      spy = vi.spyOn(factory, 'open');
    const owner = createBaselineOwner({
      indexedDB: factory,
      sha256,
      databaseName: OWNER_DATABASE_NAME + '-smoke',
    });
    await owner.open();
    owner.close();
    expect(spy).toHaveBeenCalledExactlyOnceWith(OWNER_DATABASE_NAME + '-smoke', 1);
    for (const databaseName of [
      'liska-resumability-journal-v2',
      'liska-resumability-journal-v1',
      'other',
    ])
      expect(() => createBaselineOwner({ indexedDB: factory, sha256, databaseName })).toThrow(
        'invalid-schema'
      );
  });
  it('does not release the pair on request success, only transaction complete', async () => {
    const { owner, data } = await active();
    let complete = false,
      success = false;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = put.call(this, value, key);
      request.addEventListener('success', () => {
        success = true;
        expect(complete).toBe(false);
      });
      this.transaction.addEventListener('complete', () => {
        complete = true;
      });
      return request;
    });
    await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    expect(success && complete).toBe(true);
    owner.close();
  });
});
