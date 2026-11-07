// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { IDBObjectStore, IDBVersionChangeEvent } from 'fake-indexeddb';
import {
  createBaselineOwner,
  type BaselineOwner,
} from '../../../src/resumability-journal/baseline-owner';
import { createChatGptExecution } from '../../../src/resumability-journal/execution-coordinator';
import { active, ids, signal, ManualTimers, deferred } from './fixtures';
import { sink } from '../execution-coordinator/fixtures';
import { response } from '../purpose-persistence-v2/fixtures';
const owners: BaselineOwner[] = [];
afterEach(() => {
  owners.splice(0).forEach(owner => owner.close());
  vi.restoreAllMocks();
});
async function fixture(timers?: ManualTimers) {
  const ctx = await active(timers ? { timers } : {});
  owners.push(ctx.owner);
  const reserved = await ctx.owner.reserveNextChatGpt(1, ctx.data.bytes, ids(), 102, signal());
  const identity = { ...ids(), item: reserved.item, planSha256: reserved.snapshot.plan.planSha256 };
  const port = await ctx.owner.createExecutionPort(identity, { now: () => 104 });
  return { ...ctx, ...reserved, identity, port };
}
it.each(['claim', 'evidence', 'interruption', 'pause', 'restart'] as const)(
  'rolls back both stores on each operation/owner write failure during %s',
  async action => {
    for (const target of ['owner', 'operations']) {
      const ctx = await fixture();
      if (action !== 'claim') await ctx.port.claimDispatch(ids().operationId, 0);
      const before = await ctx.owner.readSnapshot();
      const original = IDBObjectStore.prototype.put;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          if (this.name === target) throw new DOMException('PRIVATE', 'QuotaExceededError');
          return original.call(this, value, key);
        });
      const pending =
        action === 'claim'
          ? ctx.port.claimDispatch(ids().operationId, 0)
          : action === 'evidence'
            ? ctx.port.recordProducerReceipts(ids().operationId, 1, [])
            : action === 'interruption'
              ? ctx.port.markExecutionUnknown(ids().operationId, 1, 'capture-failed')
              : action === 'pause'
                ? ctx.owner.applyControl(3, { kind: 'pause', now: 104 })
                : ctx.owner.recoverAfterRestart(3, 104, signal());
      await expect(pending).rejects.toMatchObject({ code: 'quota-exceeded' });
      spy.mockRestore();
      expect(await ctx.owner.readSnapshot()).toEqual(before);
      ctx.owner.close();
    }
  }
);
it.each(['claim', 'evidence', 'interruption'] as const)(
  'missing committed %s terminal reports unknown and forbids any retry or compensation',
  async action => {
    const timers = new ManualTimers(),
      ctx = await fixture(timers);
    if (action !== 'claim') await ctx.port.claimDispatch(ids().operationId, 0);
    const terminal = deferred<void>();
    const original = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = original.call(this, value, key);
      if (this.name === 'owner') {
        this.transaction.oncomplete = null;
        this.transaction.onabort = null;
        this.transaction.addEventListener('complete', () => terminal.resolve());
        this.transaction.commit();
        timers.fire();
      }
      return request;
    });
    const pending =
      action === 'claim'
        ? ctx.port.claimDispatch(ids().operationId, 0)
        : action === 'evidence'
          ? ctx.port.recordProducerReceipts(ids().operationId, 1, [])
          : ctx.port.markExecutionUnknown(ids().operationId, 1, 'capture-failed');
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'transaction-outcome-unknown',
    });
    await terminal.promise;
    timers.fire();
    await assertion;
    spy.mockRestore();
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put');
    await expect(ctx.port.claimDispatch(ids().operationId, 0)).rejects.toMatchObject({
      code: 'transaction-outcome-unknown',
    });
    await expect(ctx.port.recordProducerReceipts(ids().operationId, 1, [])).rejects.toMatchObject({
      code: 'transaction-outcome-unknown',
    });
    expect(writes).not.toHaveBeenCalled();
    const peer = createBaselineOwner(ctx.settings);
    owners.push(peer);
    await peer.open();
    const snapshot = (await peer.readSnapshot())!;
    expect(snapshot.checkpoint.charges).toHaveLength(1);
    expect(snapshot.checkpoint.links).toHaveLength(1);
    expect(snapshot.operations[0].phase).toBe(
      action === 'claim' ? 'in-flight' : action === 'evidence' ? 'awaiting-resolution' : 'unknown'
    );
    expect(snapshot.checkpoint.observations.at(-1)?.recordRevision).toBe(
      snapshot.operations[0].revision
    );
  }
);
it.each(['close', 'pause', 'restart', 'versionchange'] as const)(
  'the final consume fence prevents effect when %s happens at transaction completion',
  async action => {
    const ctx = await fixture();
    const { token } = await ctx.port.claimDispatch(ids().operationId, 0);
    const original = IDBObjectStore.prototype.openCursor;
    let acted = false,
      control: Promise<unknown> | undefined;
    vi.spyOn(IDBObjectStore.prototype, 'openCursor').mockImplementation(function (...args) {
      if (!acted && this.transaction.mode === 'readwrite') {
        acted = true;
        const db = this.transaction.db;
        this.transaction.addEventListener('complete', () => {
          if (action === 'close') ctx.owner.close();
          else if (action === 'versionchange')
            db.dispatchEvent(
              new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
            );
          else if (action === 'pause')
            control = ctx.owner.applyControl(3, { kind: 'pause', now: 104 });
          else control = ctx.owner.recoverAfterRestart(3, 104, signal());
        });
      }
      return original.apply(this, args);
    });
    const effect = vi.fn();
    await expect(
      ctx.port.consumeDispatch(token, ctx.prepared.operation, effect)
    ).rejects.toBeDefined();
    await control;
    expect(acted).toBe(true);
    expect(effect).not.toHaveBeenCalled();
  }
);
it('failed pause burns authority before persistence and never restores it', async () => {
  const ctx = await fixture();
  const { token } = await ctx.port.claimDispatch(ids().operationId, 0);
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('private', 'QuotaExceededError');
  });
  await expect(ctx.owner.applyControl(3, { kind: 'pause', now: 104 })).rejects.toBeDefined();
  put.mockRestore();
  await expect(
    ctx.port.consumeDispatch(token, ctx.prepared.operation, vi.fn())
  ).rejects.toBeDefined();
  expect((await ctx.owner.readSnapshot())?.operations[0].phase).toBe('in-flight');
});
it('failed reserved pause requires explicit activation before any fresh claim', async () => {
  const ctx = await fixture();
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('private', 'QuotaExceededError');
  });
  await expect(ctx.owner.applyControl(2, { kind: 'pause', now: 104 })).rejects.toBeDefined();
  put.mockRestore();
  await expect(ctx.port.claimDispatch(ids().operationId, 0)).rejects.toBeDefined();
  expect((await ctx.owner.readSnapshot())?.operations[0].phase).toBe('reserved');
  await ctx.owner.applyControl(2, { kind: 'activate', now: 104 });
  expect((await ctx.port.claimDispatch(ids().operationId, 0)).record.phase).toBe('in-flight');
});
it.each(['close', 'pause', 'restart', 'versionchange'] as const)(
  'never mints a token when %s happens at claim commit completion',
  async action => {
    const ctx = await fixture();
    const original = IDBObjectStore.prototype.put;
    let control: Promise<unknown> | undefined,
      acted = false;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = original.call(this, value, key);
      if (this.name === 'owner' && !acted) {
        acted = true;
        const db = this.transaction.db;
        this.transaction.addEventListener('complete', () => {
          if (action === 'close') ctx.owner.close();
          else if (action === 'versionchange')
            db.dispatchEvent(
              new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
            );
          else if (action === 'pause')
            control = ctx.owner.applyControl(3, { kind: 'pause', now: 104 });
          else control = ctx.owner.recoverAfterRestart(3, 104, signal());
        });
      }
      return request;
    });
    await expect(ctx.port.claimDispatch(ids().operationId, 0)).rejects.toBeDefined();
    await control;
    spy.mockRestore();
    const reader = createBaselineOwner(ctx.settings);
    owners.push(reader);
    await reader.open();
    const snapshot = (await reader.readSnapshot())!;
    expect(snapshot.operations[0].phase).toBe(
      action === 'close' || action === 'versionchange' ? 'in-flight' : 'unknown'
    );
    expect(snapshot.checkpoint.charges).toHaveLength(1);
  }
);
it('started inline capture drains through pause and records late evidence without reactivating', async () => {
  const ctx = await fixture(),
    entered = deferred<void>(),
    release = deferred<void>();
  const requestCapture = vi.fn(async () => {
    entered.resolve();
    await release.promise;
    return response(
      JSON.stringify({
        conversation_id: ctx.item.conversationId,
        title: 'Synthetic',
        current_node: 'a',
        mapping: {
          a: {
            id: 'a',
            parent: null,
            children: [],
            message: {
              id: 'a',
              author: { role: 'assistant' },
              content: { content_type: 'text', parts: ['Synthetic'] },
            },
          },
        },
      })
    );
  });
  const handle = createChatGptExecution(
    {
      store: ctx.port,
      prepared: ctx.prepared,
      expectedReservedRevision: 0,
      noteFileName: 'test.md',
      signal: signal(),
    },
    { requestCapture, persistArtifacts: sink }
  );
  const pending = handle.run();
  await entered.promise;
  await ctx.owner.applyControl(3, { kind: 'pause', now: 104 });
  release.resolve();
  const result = await pending;
  expect(result.evidence).toMatchObject({
    state: 'committed',
    record: { phase: 'awaiting-resolution', control: 'paused' },
  });
  expect(requestCapture).toHaveBeenCalledOnce();
  expect((await ctx.owner.readSnapshot())?.checkpoint.control).toBe('paused');
});
it('failed durable evidence retains producer facts and atomically records uncertainty', async () => {
  const ctx = await fixture();
  const original = IDBObjectStore.prototype.put;
  let failed = false;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
    if (
      this.name === 'operations' &&
      !failed &&
      new TextDecoder().decode(value).includes('awaiting-resolution')
    ) {
      failed = true;
      throw new DOMException('private', 'QuotaExceededError');
    }
    return original.call(this, value, key);
  });
  const result = await createChatGptExecution(
    {
      store: ctx.port,
      prepared: ctx.prepared,
      expectedReservedRevision: 0,
      noteFileName: 'test.md',
      signal: signal(),
    },
    {
      requestCapture: async () =>
        response(
          JSON.stringify({
            conversation_id: ctx.item.conversationId,
            title: 'Synthetic',
            current_node: 'a',
            mapping: {
              a: {
                id: 'a',
                parent: null,
                children: [],
                message: {
                  id: 'a',
                  author: { role: 'assistant' },
                  content: { content_type: 'text', parts: ['Synthetic'] },
                },
              },
            },
          })
        ),
      persistArtifacts: sink,
    }
  ).run();
  expect(result).toMatchObject({
    code: 'evidence-persistence-failed',
    evidence: { state: 'failed' },
    uncertainty: { state: 'committed', record: { phase: 'unknown' } },
  });
  expect(result.producer?.producerReceipts).toHaveLength(1);
  expect(
    (await ctx.owner.readSnapshot())?.checkpoint.observations.map(item => item.recordRevision)
  ).toEqual([0, 1, 2]);
});
