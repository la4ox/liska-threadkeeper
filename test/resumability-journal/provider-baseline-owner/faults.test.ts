// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore, IDBVersionChangeEvent } from 'fake-indexeddb';
import {
  createProviderBaselineOwner,
  PROVIDER_OWNER_DATABASE_NAME,
} from '../../../src/resumability-journal/provider-baseline-owner';
import { encodeWithControlHeadroom } from '../../../src/resumability-journal/purpose-persistence-v3/core/control';
import { reserved } from '../provider-baseline/fixtures';
import { active, deferred, ids, ManualTimers, sha256, signal } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('provider owner two-store atomicity and terminal outcomes', () => {
  it.each(['abort', 'close'] as const)(
    'does not write when an in-flight hash is followed by %s',
    async mode => {
      const gate = deferred<void>();
      const entered = deferred<void>();
      let delayNextHash = false;
      const { owner, bytes } = await active({
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
      const controller = new AbortController();
      delayNextHash = true;
      const pending = owner.reserveNext(1, bytes, ids(), 102, controller.signal);
      await entered.promise;
      if (mode === 'abort') controller.abort();
      else owner.close();
      gate.resolve();

      await expect(pending).rejects.toMatchObject({
        code: mode === 'abort' ? 'corrupt-owner' : 'closed',
      });
      expect(add).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      add.mockRestore();
      put.mockRestore();
      if (mode === 'abort') owner.close();
    }
  );

  it('CASes an operation-only phantom introduced during async preparation', async () => {
    const gate = deferred<void>();
    const entered = deferred<void>();
    let hold = false;
    const { owner, bytes, factory, settings } = await active({
      sha256: async input => {
        if (hold) {
          entered.resolve();
          await gate.promise;
        }
        return sha256(input);
      },
    });
    const before = await owner.readSnapshot();
    hold = true;
    const pending = owner.reserveNext(1, bytes, ids(), 102, signal());
    await entered.promise;
    const database = await new Promise<IDBDatabase>(resolve => {
      const request = factory.open(PROVIDER_OWNER_DATABASE_NAME, 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('operations', 'readwrite');
      const phantom = reserved(before!.plan, 1, 'phantom');
      transaction
        .objectStore('operations')
        .add(encodeWithControlHeadroom(phantom), phantom.operation.operationId);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    gate.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'revision-conflict' });
    const reader = createProviderBaselineOwner({ ...settings, sha256 });
    await reader.open();
    await expect(reader.readSnapshot()).rejects.toMatchObject({ code: 'corrupt-owner' });
    owner.close();
    reader.close();
  });

  it.each([
    'add-throw',
    'put-throw',
    'add-abort',
    'put-abort',
    'add-success-abort',
    'put-success-abort',
  ] as const)('rolls back both owner and operation writes on %s', async fault => {
    const { owner, bytes, settings } = await active();
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
    await expect(owner.reserveNext(1, bytes, ids(), 102, signal())).rejects.toBeDefined();
    spy.mockRestore();
    const fresh = createProviderBaselineOwner(settings);
    await fresh.open();
    expect(await fresh.readSnapshot()).toEqual(before);
    owner.close();
    fresh.close();
  });

  it.each(['timeout', 'close', 'versionchange'] as const)(
    'waits for an accepted %s abort and commits neither half',
    async mode => {
      const timers = new ManualTimers();
      const { owner, bytes, settings } = await active({ timers });
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
      await expect(owner.reserveNext(1, bytes, ids(), 102, signal())).rejects.toMatchObject({
        code:
          mode === 'timeout'
            ? 'transaction-timeout'
            : mode === 'close'
              ? 'closed'
              : 'version-changed',
      });
      expect(terminal).toBe(true);
      spy.mockRestore();
      const fresh = createProviderBaselineOwner(settings);
      await fresh.open();
      expect(await fresh.readSnapshot()).toEqual(before);
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );

  it.each(['timeout', 'close', 'versionchange'] as const)(
    'returns committed local facts after a refused late %s abort',
    async mode => {
      const timers = new ManualTimers();
      const { owner, bytes, settings } = await active({ timers });
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
      const result = await owner.reserveNext(1, bytes, ids(), 102, signal());
      expect(terminal).toBe(true);
      expect(result).toMatchObject({ executionAuthorized: false, record: { phase: 'reserved' } });
      spy.mockRestore();
      const fresh = createProviderBaselineOwner(settings);
      await fresh.open();
      expect((await fresh.readSnapshot())?.checkpoint.links).toHaveLength(1);
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );

  it.each(['commit', 'abort'] as const)(
    'reports missing %s terminal as unknown and requires reconciliation on a fresh handle',
    async outcome => {
      const timers = new ManualTimers();
      const { owner, bytes, settings, snapshot } = await active({ timers });
      const terminal = deferred<void>();
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
      const pending = owner.reserveNext(1, bytes, ids(), 102, signal());
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'transaction-outcome-unknown',
      });
      await terminal.promise;
      spy.mockRestore();
      timers.fire();
      await assertion;
      const fresh = createProviderBaselineOwner(settings);
      await fresh.open();
      expect(
        await fresh.inspectReservation({
          ...ids(),
          planSha256: snapshot.plan.planSha256,
          item: snapshot.plan.plan.items[0],
        })
      ).toMatchObject({
        executionAuthorized: false,
        kind: outcome === 'commit' ? 'committed' : 'not-observed',
      });
      owner.close();
      fresh.close();
      expect(timers.pending.size).toBe(0);
    }
  );
});
