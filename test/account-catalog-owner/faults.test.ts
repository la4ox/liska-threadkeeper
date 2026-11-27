// @vitest-environment node
import { IDBDatabase, IDBFactory, IDBObjectStore, IDBVersionChangeEvent } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAccountCatalog } from '../../src/account-catalog-owner';
import { ACCOUNT_CATALOG_DATABASE, OWNERS, SLOTS } from '../../src/account-catalog-owner/database';
import { locator, makeInput, openRaw, slotId, snapshot, terminal } from './fixture';

afterEach(() => vi.restoreAllMocks());

function afterAdd(store: string, action: (tx: IDBTransaction) => void) {
  const add = IDBObjectStore.prototype.add;
  return vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key
  ) {
    const request = add.call(this, value, key);
    if (this.name === store)
      request.addEventListener('success', () => action(this.transaction), { once: true });
    return request;
  });
}

describe('account catalog transaction and schema truth', () => {
  it('starts one strict two-store write transaction; unsupported durability never falls back', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const original = IDBDatabase.prototype.transaction;
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
    await catalog.createPausedClaude(makeInput());
    expect(transaction.mock.calls).toEqual([
      [[SLOTS, OWNERS], 'readwrite', { durability: 'strict' }],
    ]);
    const before = await snapshot(indexedDB);
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    for (const legacy of ['rejected', 'ignored'] as const) {
      transaction.mockClear();
      transaction.mockImplementation(function (this: IDBDatabase, names, mode, options) {
        if (options && legacy === 'rejected') throw new TypeError('legacy signature');
        return original.call(this, names, mode);
      });
      await expect(catalog.createPausedClaude(makeInput(1))).rejects.toMatchObject({
        code: 'unsupported',
      });
      expect(transaction.mock.calls).toEqual([
        [[SLOTS, OWNERS], 'readwrite', { durability: 'strict' }],
      ]);
    }
    expect(add).not.toHaveBeenCalled();
    transaction.mockRestore();
    expect(await snapshot(indexedDB)).toEqual(before);
    await catalog.close();
  });

  it('rejects pre-aborted, fake signal and accessor options without a transaction or open', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const open = vi.spyOn(indexedDB, 'open');
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const get = vi.fn(() => {
      throw Error('getter invoked');
    });
    await expect(
      catalog.createPausedClaude(makeInput(), AbortSignal.abort())
    ).rejects.toMatchObject({ code: 'transaction-aborted' });
    await expect(
      catalog.createPausedClaude(makeInput(), {
        get aborted() {
          return get();
        },
      } as unknown as AbortSignal)
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      openAccountCatalog(Object.defineProperty({ indexedDB }, 'timeoutMs', { get }))
    ).rejects.toMatchObject({ code: 'invalid-options' });
    expect(get).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await catalog.close();
  });

  it('waits for complete, not the insert request, and returns creates only after both requests', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const events: string[] = [];
    afterAdd(OWNERS, transaction => {
      events.push('request-success');
      transaction.addEventListener('complete', () => events.push('complete'), { once: true });
    });
    const created = await catalog.createPausedClaude(makeInput());
    events.push('api-success');
    expect(events).toEqual(['request-success', 'complete', 'api-success']);
    expect(await catalog.readSlot(slotId(0))).toEqual(created.slot);
    expect(await catalog.readOwner(locator())).toEqual(created.owner);
    await catalog.close();
  });

  it('observes abort after both add requests report success and rolls both back', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const sibling = await catalog.createPausedClaude(makeInput(0, 1));
    const before = await snapshot(indexedDB);
    const controller = new AbortController();
    let outcome: Promise<string> | undefined;
    const successes: string[] = [];
    // One interceptor sees both ends of the native queue without taking over event properties.
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key
    ) {
      const request = add.call(this, value, key);
      request.addEventListener(
        'success',
        () => {
          successes.push(this.name);
          if (this.name !== OWNERS) return;
          outcome = terminal(this.transaction);
          controller.abort('private reason');
        },
        { once: true }
      );
      return request;
    });
    await expect(catalog.createPausedClaude(makeInput(1), controller.signal)).rejects.toMatchObject(
      {
        code: 'transaction-aborted',
        message: 'transaction-aborted',
      }
    );
    expect(await outcome).toBe('abort');
    expect(successes).toEqual([SLOTS, OWNERS]);
    expect(await snapshot(indexedDB)).toEqual(before);
    expect(await catalog.readOwner(locator(0, 1))).toEqual(sibling.owner);
    await catalog.close();
  });

  it('returns the committed seed if cancellation arrives after commit starts', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const controller = new AbortController();
    let outcome: Promise<string> | undefined;
    afterAdd(OWNERS, transaction => {
      outcome = terminal(transaction);
      transaction.commit();
      controller.abort();
    });
    const result = await catalog.createPausedClaude(makeInput(), controller.signal);
    expect(await outcome).toBe('complete');
    expect(controller.signal.aborted).toBe(true);
    expect(await catalog.readOwner(locator())).toEqual(result.owner);
    await catalog.close();
  });

  it.each(['close', 'versionchange'] as const)(
    'fences new work on %s and waits for in-flight abort',
    async event => {
      const indexedDB = new IDBFactory();
      const catalog = await openAccountCatalog({ indexedDB });
      let outcome: Promise<string> | undefined;
      let closing: Promise<void> | undefined;
      afterAdd(OWNERS, transaction => {
        outcome = terminal(transaction);
        if (event === 'close') closing = catalog.close();
        else
          transaction.db.dispatchEvent(
            new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 })
          );
      });
      await expect(catalog.createPausedClaude(makeInput())).rejects.toMatchObject({
        code: 'transaction-aborted',
      });
      expect(await outcome).toBe('abort');
      await closing;
      await expect(catalog.listSlots()).rejects.toMatchObject({
        code: event === 'close' ? 'closed' : 'version-changed',
      });
      expect(await snapshot(indexedDB)).toEqual({ slots: [], owners: [] });
      await catalog.close();
    }
  );

  it.each(['complete', 'abort'] as const)(
    'fences unknown outcome when native %s is not observed by the owner',
    async event => {
      const indexedDB = new IDBFactory();
      const catalog = await openAccountCatalog({ indexedDB, timeoutMs: 100 });
      const controller = new AbortController();
      let outcome: Promise<string> | undefined;
      const add = afterAdd(OWNERS, transaction => {
        outcome = terminal(transaction);
        if (event === 'complete') transaction.oncomplete = null;
        else {
          transaction.onabort = null;
          controller.abort();
        }
      });
      await expect(
        catalog.createPausedClaude(makeInput(), controller.signal)
      ).rejects.toMatchObject({ code: 'transaction-outcome-unknown' });
      expect(await outcome).toBe(event);
      expect(add).toHaveBeenCalledTimes(2);
      add.mockRestore();
      await expect(catalog.listOwners()).rejects.toMatchObject({
        code: 'transaction-outcome-unknown',
      });
      await expect(catalog.createPausedClaude(makeInput(1))).rejects.toMatchObject({
        code: 'transaction-outcome-unknown',
      });
      const reopened = await openAccountCatalog({ indexedDB });
      expect((await reopened.listOwners()).length).toBe(event === 'complete' ? 1 : 0);
      expect((await reopened.listSlots()).length).toBe(event === 'complete' ? 1 : 0);
      await Promise.all([catalog.close(), reopened.close()]);
    }
  );

  it('classifies quota only after rollback; does not auto-retry or leave the staged slot', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const sibling = await catalog.createPausedClaude(makeInput());
    const before = await snapshot(indexedDB);
    const add = IDBObjectStore.prototype.add;
    let outcome: Promise<string> | undefined;
    const stub = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key
    ) {
      if (this.name === OWNERS) {
        outcome = terminal(this.transaction);
        throw new DOMException('unreported host details', 'QuotaExceededError');
      }
      return add.call(this, value, key);
    });
    await expect(catalog.createPausedClaude(makeInput(1))).rejects.toMatchObject({
      code: 'quota-exceeded',
      message: 'quota-exceeded',
    });
    expect(await outcome).toBe('abort');
    expect(stub).toHaveBeenCalledTimes(2);
    expect(await snapshot(indexedDB)).toEqual(before);
    expect(await catalog.readOwner(locator())).toEqual(sibling.owner);
    await catalog.close();
  });

  it.each(['version', 'extra', 'keyPath', 'autoIncrement', 'index'] as const)(
    'rejects and preserves incompatible physical %s',
    async mismatch => {
      const indexedDB = new IDBFactory();
      const version = mismatch === 'version' ? 2 : 1;
      const db = await openRaw(indexedDB, version, db => {
        db.createObjectStore(SLOTS, mismatch === 'keyPath' ? { keyPath: 'slotId' } : undefined);
        const owners = db.createObjectStore(OWNERS, {
          autoIncrement: mismatch === 'autoIncrement',
        });
        if (mismatch === 'index') owners.createIndex('wrong-index', 'wrongField');
        if (mismatch === 'extra') db.createObjectStore('extra');
      });
      const names = [...db.objectStoreNames];
      db.close();
      await expect(openAccountCatalog({ indexedDB })).rejects.toMatchObject({
        code: 'unsupported',
      });
      expect(await indexedDB.databases()).toEqual([{ name: ACCOUNT_CATALOG_DATABASE, version }]);
      const unchanged = await openRaw(indexedDB, version);
      expect([...unchanged.objectStoreNames]).toEqual(names);
      const tx = unchanged.transaction([SLOTS, OWNERS]);
      const slots = tx.objectStore(SLOTS);
      const owners = tx.objectStore(OWNERS);
      expect(slots.keyPath).toBe(mismatch === 'keyPath' ? 'slotId' : null);
      expect(owners.autoIncrement).toBe(mismatch === 'autoIncrement');
      expect([...owners.indexNames]).toEqual(mismatch === 'index' ? ['wrong-index'] : []);
      expect(await terminal(tx)).toBe('complete');
      unchanged.close();
    }
  );

  it('does not open, delete, re-version or change either existing owner domain', async () => {
    const indexedDB = new IDBFactory();
    const oldNames = ['liska-claude-account-baseline-owner-v1', 'liska-baseline-owner-v2'];
    for (const name of oldNames) {
      const old = await openRaw(indexedDB, 1, db => db.createObjectStore('preserved'), name);
      const tx = old.transaction('preserved', 'readwrite');
      tx.objectStore('preserved').add(new Uint8Array([1, 23, 255]), 'row');
      expect(await terminal(tx)).toBe('complete');
      old.close();
    }
    const oldBefore = await Promise.all(
      oldNames.map(name => snapshot(indexedDB, ['preserved'], name))
    );
    const open = vi.spyOn(indexedDB, 'open');
    const remove = vi.spyOn(indexedDB, 'deleteDatabase');
    const catalog = await openAccountCatalog({ indexedDB });
    await catalog.createPausedClaude(makeInput());
    await catalog.listSlots();
    await catalog.listOwners();
    await catalog.close();
    const reopened = await openAccountCatalog({ indexedDB });
    await reopened.readOwner(locator());
    await reopened.close();
    expect(open.mock.calls).toEqual(Array(2).fill([ACCOUNT_CATALOG_DATABASE, 1]));
    expect(remove).not.toHaveBeenCalled();
    expect(await indexedDB.databases()).toEqual(
      expect.arrayContaining(oldNames.map(name => ({ name, version: 1 })))
    );
    expect(
      await Promise.all(oldNames.map(name => snapshot(indexedDB, ['preserved'], name)))
    ).toEqual(oldBefore);
  });
});
