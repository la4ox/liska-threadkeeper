// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { createProviderBaselineOwner } from '../../../src/resumability-journal/provider-baseline-owner';
import { deferred, ManualTimers, sha256 } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('provider owner bounded open', () => {
  it.each([
    ['timeout', 'completed'],
    ['close', 'completed'],
    ['timeout', 'absent'],
    ['close', 'absent'],
  ] as const)(
    'reports unknown on %s after a started upgrade with %s transaction before success',
    async (mode, state) => {
      const timers = new ManualTimers();
      const request = {} as IDBOpenDBRequest;
      const owner = createProviderBaselineOwner({
        indexedDB: { open: () => request } as unknown as IDBFactory,
        sha256,
        timers,
      });
      const opening = owner.open();
      let completed = false;
      const abort = vi.fn(() => {
        if (completed) throw new DOMException('private', 'InvalidStateError');
      });
      const close = vi.fn();
      const createObjectStore = vi.fn();
      Object.defineProperties(request, {
        transaction: { value: state === 'completed' ? { abort } : null, writable: true },
        result: { value: { objectStoreNames: { length: 0 }, createObjectStore, close } },
      });
      request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
      expect(createObjectStore).toHaveBeenCalledTimes(2);
      completed = true;
      Object.defineProperty(request, 'transaction', { value: null });
      if (mode === 'timeout') timers.fire();
      else owner.close();
      await expect(opening).rejects.toMatchObject({ code: 'open-outcome-unknown' });
      expect(abort).toHaveBeenCalledTimes(state === 'completed' ? 1 : 0);
      request.onsuccess?.call(request, new Event('success'));
      expect(close).toHaveBeenCalledOnce();
      expect(timers.pending.size).toBe(0);
      owner.close();
    }
  );

  it.each(['timeout', 'close'] as const)(
    'aborts a live upgrade after %s and retains the initiating error',
    async mode => {
      const timers = new ManualTimers();
      const factory = new IDBFactory();
      const terminal = deferred<void>();
      let request: IDBOpenDBRequest | undefined;
      const open = factory.open.bind(factory);
      vi.spyOn(factory, 'open').mockImplementation((name, version) => {
        request = open(name, version);
        request.addEventListener('error', () => terminal.resolve());
        return request;
      });
      const owner = createProviderBaselineOwner({ indexedDB: factory, sha256, timers });
      let abort: ReturnType<typeof vi.spyOn> | undefined;
      const create = IDBDatabase.prototype.createObjectStore;
      vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(
        function (name, options) {
          const store = create.call(this, name, options);
          if (name === 'operations') {
            abort = vi.spyOn(request!.transaction!, 'abort');
            if (mode === 'timeout') timers.fire();
            else owner.close();
          }
          return store;
        }
      );
      await expect(owner.open()).rejects.toMatchObject({
        code: mode === 'timeout' ? 'open-timeout' : 'closed',
      });
      await terminal.promise;
      expect(abort).toHaveBeenCalledOnce();
      expect(await factory.databases()).toEqual([]);
      expect(timers.pending.size).toBe(0);
      owner.close();
    }
  );

  it.each(['timeout', 'close'] as const)(
    'reports unknown when a committing upgrade refuses %s abort and closes late success',
    async mode => {
      const timers = new ManualTimers();
      const factory = new IDBFactory();
      const terminal = deferred<void>();
      let request: IDBOpenDBRequest | undefined;
      const open = factory.open.bind(factory);
      vi.spyOn(factory, 'open').mockImplementation((name, version) => {
        request = open(name, version);
        request.addEventListener('success', () => terminal.resolve());
        return request;
      });
      const owner = createProviderBaselineOwner({ indexedDB: factory, sha256, timers });
      let abort: ReturnType<typeof vi.spyOn> | undefined;
      let close: ReturnType<typeof vi.spyOn> | undefined;
      const create = IDBDatabase.prototype.createObjectStore;
      vi.spyOn(IDBDatabase.prototype, 'createObjectStore').mockImplementation(
        function (name, options) {
          const store = create.call(this, name, options);
          if (name === 'operations') {
            request!.transaction!.commit();
            abort = vi.spyOn(request!.transaction!, 'abort');
            close = vi.spyOn(this, 'close');
            if (mode === 'timeout') timers.fire();
            else owner.close();
          }
          return store;
        }
      );
      await expect(owner.open()).rejects.toMatchObject({ code: 'open-outcome-unknown' });
      await terminal.promise;
      expect(abort).toHaveBeenCalledOnce();
      expect(abort!.mock.results[0].type).toBe('throw');
      expect(close).toHaveBeenCalledOnce();
      expect(await factory.databases()).toHaveLength(1);
      expect(timers.pending.size).toBe(0);
      owner.close();
    }
  );

  it('rejects blocked and null-transaction upgrade gaps without late schema exposure', async () => {
    const timers = new ManualTimers();
    const request = {} as IDBOpenDBRequest;
    const owner = createProviderBaselineOwner({
      indexedDB: { open: () => request } as unknown as IDBFactory,
      sha256,
      timers,
    });
    const opening = owner.open();
    request.onblocked?.call(request, {} as IDBVersionChangeEvent);
    await expect(opening).rejects.toMatchObject({ code: 'open-blocked' });
    const abort = vi.fn();
    Object.defineProperty(request, 'transaction', { value: { abort } });
    request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
    expect(abort).toHaveBeenCalledOnce();
    owner.close();
  });
});
