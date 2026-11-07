// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { createBaselineOwner } from '../../../src/resumability-journal/baseline-owner';
import { ManualTimers, sha256, deferred } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('bounded open ownership', () => {
  it.each([
    ['timeout', 'completed'],
    ['close', 'completed'],
    ['timeout', 'absent'],
    ['close', 'absent'],
  ] as const)(
    'reports unknown on %s after started upgrade with %s transaction before open success',
    async (mode, state) => {
      const timers = new ManualTimers(),
        request = {} as IDBOpenDBRequest;
      const owner = createBaselineOwner({
        indexedDB: { open: () => request } as unknown as IDBFactory,
        sha256,
        timers,
      });
      const opening = owner.open();
      let completed = false;
      const abort = vi.fn(() => {
        if (completed) throw new DOMException('private', 'InvalidStateError');
      });
      const close = vi.fn(),
        createObjectStore = vi.fn();
      Object.defineProperties(request, {
        transaction: { value: state === 'completed' ? { abort } : null, writable: true },
        result: { value: { objectStoreNames: { length: 0 }, createObjectStore, close } },
      });
      request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
      expect(createObjectStore).toHaveBeenCalledTimes(2);
      completed = true;
      // Model the spec interval after upgrade completion, before the queued open success event.
      Object.defineProperty(request, 'transaction', { value: null });
      if (mode === 'timeout') timers.fire();
      else owner.close();
      await expect(opening).rejects.toMatchObject({ code: 'open-outcome-unknown' });
      expect(abort).toHaveBeenCalledTimes(state === 'completed' ? 1 : 0);
      request.onsuccess?.call(request, new Event('success'));
      expect(close).toHaveBeenCalledOnce();
      await expect(owner.readSnapshot()).rejects.toMatchObject({
        code: mode === 'close' ? 'closed' : 'not-open',
      });
      expect(timers.pending.size).toBe(0);
      owner.close();
    }
  );
  it('preserves a schema failure whose retained upgrade abort was accepted, even after a late error', async () => {
    const timers = new ManualTimers(),
      request = {} as IDBOpenDBRequest;
    const owner = createBaselineOwner({
      indexedDB: { open: () => request } as unknown as IDBFactory,
      sha256,
      timers,
    });
    const opening = owner.open(),
      abort = vi.fn();
    Object.defineProperties(request, {
      transaction: { value: { abort }, writable: true },
      result: {
        value: {
          objectStoreNames: { length: 0 },
          createObjectStore: () => {
            throw new DOMException('private', 'QuotaExceededError');
          },
        },
      },
    });
    request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
    await expect(opening).rejects.toMatchObject({ code: 'quota-exceeded' });
    Object.defineProperty(request, 'transaction', { value: null });
    request.onerror?.call(request, new Event('error'));
    await expect(owner.open()).rejects.toMatchObject({ code: 'quota-exceeded' });
    expect(abort).toHaveBeenCalledOnce();
    owner.close();
  });
  it.each(['timeout', 'close'] as const)(
    'aborts an already-started upgrade after %s and retains the initiating error',
    async mode => {
      const timers = new ManualTimers(),
        factory = new IDBFactory(),
        terminal = deferred<void>();
      let request: IDBOpenDBRequest | undefined;
      const open = factory.open.bind(factory);
      vi.spyOn(factory, 'open').mockImplementation((name, version) => {
        request = open(name, version);
        request.addEventListener('error', () => terminal.resolve());
        return request;
      });
      const owner = createBaselineOwner({ indexedDB: factory, sha256, timers });
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
      expect(abort!.mock.results[0].type).toBe('return');
      expect(await factory.databases()).toEqual([]);
      expect(timers.pending.size).toBe(0);
      owner.close();
    }
  );
  it.each(['timeout', 'close'] as const)(
    'reports unknown when an already-committing upgrade refuses %s abort and closes late success',
    async mode => {
      const timers = new ManualTimers(),
        factory = new IDBFactory(),
        terminal = deferred<void>();
      let request: IDBOpenDBRequest | undefined;
      const open = factory.open.bind(factory);
      vi.spyOn(factory, 'open').mockImplementation((name, version) => {
        request = open(name, version);
        request.addEventListener('success', () => terminal.resolve());
        return request;
      });
      const owner = createBaselineOwner({ indexedDB: factory, sha256, timers });
      let abort: ReturnType<typeof vi.spyOn> | undefined,
        close: ReturnType<typeof vi.spyOn> | undefined;
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
      expect(abort!.mock.results[0]).toMatchObject({
        type: 'throw',
        value: { name: 'InvalidStateError' },
      });
      expect(close).toHaveBeenCalledOnce();
      expect(await factory.databases()).toHaveLength(1);
      await expect(owner.readSnapshot()).rejects.toMatchObject({
        code: mode === 'close' ? 'closed' : 'not-open',
      });
      expect(timers.pending.size).toBe(0);
      owner.close();
    }
  );
  it('does not replace an unknown upgrade outcome with a late request error', async () => {
    const timers = new ManualTimers();
    const request = {} as IDBOpenDBRequest;
    const owner = createBaselineOwner({
      indexedDB: { open: () => request } as unknown as IDBFactory,
      sha256,
      timers,
    });
    const opening = owner.open();
    const createObjectStore = vi.fn(),
      abort = vi.fn(() => {
        throw new DOMException('private', 'InvalidStateError');
      });
    Object.defineProperties(request, {
      transaction: { value: { abort } },
      result: { value: { objectStoreNames: { length: 0 }, createObjectStore } },
    });
    request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
    expect(createObjectStore).toHaveBeenCalledTimes(2);
    timers.fire();
    await expect(opening).rejects.toMatchObject({
      code: 'open-outcome-unknown',
      message: 'open-outcome-unknown',
    });
    request.onerror?.call(request, new Event('error'));
    await expect(owner.open()).rejects.toMatchObject({ code: 'open-outcome-unknown' });
    expect(abort).toHaveBeenCalledOnce();
    owner.close();
  });
  it.each(['timeout', 'blocked', 'close'] as const)(
    'rejects %s open and late schema creation',
    async mode => {
      const timers = new ManualTimers(),
        request = {} as IDBOpenDBRequest;
      const owner = createBaselineOwner({
        indexedDB: { open: () => request } as unknown as IDBFactory,
        sha256,
        timers,
      });
      const opening = owner.open();
      const assertion = expect(opening).rejects.toMatchObject({
        code: mode === 'timeout' ? 'open-timeout' : mode === 'blocked' ? 'open-blocked' : 'closed',
      });
      if (mode === 'timeout') timers.fire();
      else if (mode === 'blocked') request.onblocked?.call(request, {} as IDBVersionChangeEvent);
      else owner.close();
      await assertion;
      const abort = vi.fn(),
        close = vi.fn();
      Object.defineProperty(request, 'transaction', { value: { abort } });
      request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
      expect(abort).toHaveBeenCalledOnce();
      Object.defineProperty(request, 'result', { value: { close } });
      request.onsuccess?.call(request, new Event('success'));
      expect(close).toHaveBeenCalledOnce();
      expect(timers.pending.size).toBe(0);
      owner.close();
    }
  );
  it('does not reopen a terminally closed object and bounds injected timeouts', async () => {
    const owner = createBaselineOwner({ indexedDB: new IDBFactory(), sha256 });
    await owner.open();
    owner.close();
    await expect(owner.open()).rejects.toMatchObject({ code: 'closed' });
    for (const transactionTimeoutMs of [0, -1, 30001, NaN])
      expect(() => createBaselineOwner({ sha256, transactionTimeoutMs })).toThrow('open-failed');
  });
});
