// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore, IDBVersionChangeEvent } from 'fake-indexeddb';
import {
  createBaselineOwner,
  OWNER_DATABASE_NAME,
} from '../../../src/resumability-journal/baseline-owner';
import { encodeRecord } from '../../../src/resumability-journal/purpose-persistence-v2/core/record';
import { reserved } from '../baseline-plan/fixtures';
import { active, signal, ids, ManualTimers, deferred, sha256 } from './fixtures';
afterEach(() => vi.restoreAllMocks());
describe('two-store atomic commit and terminal outcomes', () => {
  it('CASes operation-only phantom insertion during async preparation, not only owner revision', async () => {
    const gate = deferred<void>(),
      entered = deferred<void>();
    let hold = false;
    const { owner, data, factory, settings } = await active({
      sha256: async bytes => {
        if (hold) {
          entered.resolve();
          await gate.promise;
        }
        return sha256(bytes);
      },
    });
    const before = await owner.readSnapshot();
    hold = true;
    const pending = owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    await entered.promise;
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = factory.open(OWNER_DATABASE_NAME, 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite');
      const phantom = reserved(before!.plan, 1, 'phantom');
      tx.objectStore('operations').add(encodeRecord(phantom), phantom.operation.operationId);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'revision-conflict' });
    const reader = createBaselineOwner({ ...settings, sha256 });
    await reader.open();
    await expect(reader.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
    owner.close();
    reader.close();
  });
  it.each(['close', 'cancel'] as const)(
    'does not commit after %s during hash continuation',
    async kind => {
      const gate = deferred<void>(),
        entered = deferred<void>();
      let hold = false;
      const { owner, data, settings } = await active({
        sha256: async bytes => {
          if (hold) {
            entered.resolve();
            await gate.promise;
          }
          return sha256(bytes);
        },
      });
      const before = await owner.readSnapshot(),
        controller = new AbortController();
      hold = true;
      const pending = owner.reserveNextChatGpt(1, data.bytes, ids(), 102, controller.signal);
      await entered.promise;
      if (kind === 'close') owner.close();
      else controller.abort();
      gate.resolve();
      await expect(pending).rejects.toBeDefined();
      const reader = createBaselineOwner({ ...settings, sha256 });
      await reader.open();
      expect(await reader.readSnapshot()).toEqual(before);
      owner.close();
      reader.close();
    }
  );
  it.each([
    'add-throw',
    'put-throw',
    'add-abort',
    'put-abort',
    'add-success-abort',
    'put-success-abort',
  ] as const)('rolls back both sides on %s', async fault => {
    const { owner, data, settings } = await active();
    const before = await owner.readSnapshot();
    const method = fault.startsWith('add') ? 'add' : 'put';
    const original = IDBObjectStore.prototype[method];
    const spy = vi
      .spyOn(IDBObjectStore.prototype, method)
      .mockImplementation(function (value, key) {
        if (fault.endsWith('throw')) throw new DOMException('private', 'QuotaExceededError');
        const request = original.call(this, value, key);
        if (fault.includes('success'))
          request.addEventListener('success', () => this.transaction.abort());
        else this.transaction.abort();
        return request;
      });
    await expect(
      owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal())
    ).rejects.toBeDefined();
    spy.mockRestore();
    const fresh = createBaselineOwner(settings);
    await fresh.open();
    expect(await fresh.readSnapshot()).toEqual(before);
    expect(
      await fresh.inspectReservation({
        ...ids(),
        planSha256: before!.plan.planSha256,
        item: before!.plan.plan.items[0],
      })
    ).toEqual({ executionAuthorized: false, kind: 'not-observed' });
    owner.close();
    fresh.close();
  });
  it.each(['timeout', 'close', 'versionchange'] as const)(
    'waits for accepted %s abort without either half',
    async mode => {
      const timers = new ManualTimers();
      const { owner, data, settings } = await active({ timers });
      const before = await owner.readSnapshot();
      let terminal = false;
      const put = IDBObjectStore.prototype.put;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          const request = put.call(this, value, key);
          this.transaction.addEventListener('abort', () => {
            terminal = true;
          });
          if (mode === 'timeout') timers.fire();
          else if (mode === 'close') owner.close();
          else
            this.transaction.db.dispatchEvent(
              new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
            );
          return request;
        });
      await expect(
        owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal())
      ).rejects.toMatchObject({
        code:
          mode === 'timeout'
            ? 'transaction-timeout'
            : mode === 'close'
              ? 'closed'
              : 'version-changed',
      });
      expect(terminal).toBe(true);
      spy.mockRestore();
      const fresh = createBaselineOwner(settings);
      await fresh.open();
      expect(await fresh.readSnapshot()).toEqual(before);
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );
  it.each(['timeout', 'close', 'versionchange'] as const)(
    'reports observed commit after a refused late %s abort as local facts only',
    async mode => {
      const timers = new ManualTimers();
      const { owner, data, settings } = await active({ timers });
      let terminal = false;
      const put = IDBObjectStore.prototype.put;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          const request = put.call(this, value, key);
          this.transaction.addEventListener('complete', () => {
            terminal = true;
          });
          this.transaction.commit();
          if (mode === 'timeout') timers.fire();
          else if (mode === 'close') owner.close();
          else
            this.transaction.db.dispatchEvent(
              new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
            );
          return request;
        });
      const result = await owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
      expect(terminal).toBe(true);
      expect(result.executionAuthorized).toBe(false);
      expect(result.record.phase).toBe('reserved');
      spy.mockRestore();
      const fresh = createBaselineOwner(settings);
      await fresh.open();
      expect((await fresh.readSnapshot())?.checkpoint.links).toHaveLength(1);
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );
  it.each(['commit', 'abort'] as const)(
    'missing %s terminal reports uncertainty, fences writes, and fresh inspect reconciles without retry',
    async outcome => {
      const timers = new ManualTimers();
      const { owner, data, settings } = await active({ timers });
      const before = await owner.readSnapshot(),
        terminal = deferred<void>();
      const put = IDBObjectStore.prototype.put;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(function (value, key) {
          const request = put.call(this, value, key);
          this.transaction.oncomplete = null;
          this.transaction.onabort = null;
          this.transaction.addEventListener(outcome === 'commit' ? 'complete' : 'abort', () =>
            terminal.resolve()
          );
          if (outcome === 'commit') this.transaction.commit();
          else this.transaction.abort();
          timers.fire();
          return request;
        });
      const pending = owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'transaction-outcome-unknown',
      });
      await terminal.promise;
      spy.mockRestore();
      timers.fire();
      await assertion;
      await expect(
        owner.applyControl(outcome === 'commit' ? 2 : 1, { kind: 'pause', now: 103 })
      ).rejects.toMatchObject({ code: 'transaction-outcome-unknown' });
      const fresh = createBaselineOwner(settings);
      await fresh.open();
      expect(
        await fresh.inspectReservation({
          ...ids(),
          planSha256: before!.plan.planSha256,
          item: before!.plan.plan.items[0],
        })
      ).toMatchObject({
        kind: outcome === 'commit' ? 'committed' : 'not-observed',
        executionAuthorized: false,
      });
      expect(
        (await fresh.readSnapshot())?.operations.every(record => record.phase === 'reserved')
      ).toBe(true);
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );
  it('full inventory CAS rejects an unrelated owner change during async preparation', async () => {
    const gate = deferred<void>(),
      entered = deferred<void>();
    let hold = false;
    const { owner, data, settings } = await active({
      sha256: async bytes => {
        if (hold) {
          entered.resolve();
          await gate.promise;
        }
        return (await import('./fixtures')).sha256(bytes);
      },
    });
    const other = createBaselineOwner({ ...settings, sha256: (await import('./fixtures')).sha256 });
    await other.open();
    hold = true;
    const pending = owner.reserveNextChatGpt(1, data.bytes, ids(), 102, signal());
    await entered.promise;
    await other.recoverAfterRestart(1, 102, signal());
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'revision-conflict' });
    expect((await other.readSnapshot())?.operations).toEqual([]);
    owner.close();
    other.close();
  });
});
