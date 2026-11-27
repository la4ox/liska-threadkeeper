// @vitest-environment node
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adoptLegacyClaudeCatalog,
  type AdoptLegacyClaudeCatalogInput,
} from '../../src/account-catalog-adoption';
import { openAccountCatalog } from '../../src/account-catalog-owner';
import { ACCOUNT_CATALOG_DATABASE as DESTINATION } from '../../src/account-catalog-owner/database';
import { bytes, openRaw, slotId, makeInput } from '../account-catalog-owner/fixture';
import { collectionB } from '../browser/claude-account-baseline-owner/fixture';
import { baseline, input, KEY, label, seed, SOURCE, sourceSnapshot, STORE } from './fixture';

afterEach(() => vi.restoreAllMocks());

describe('explicit copy-only adoption', () => {
  it('returns distinct absent and empty outcomes; does not create either missing database', async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      kind: 'legacy-absent',
    });
    expect(open).not.toHaveBeenCalled();
    expect(await factory.databases()).toEqual([]);

    await seed(factory, []);
    const before = await sourceSnapshot(factory);
    open.mockClear();
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      kind: 'legacy-empty',
    });
    expect(open.mock.calls).toEqual([[SOURCE, 1]]);
    expect(await factory.databases()).toEqual([{ name: SOURCE, version: 1 }]);
    expect(await sourceSnapshot(factory)).toEqual(before);
  });

  it('copies a canonical paused seed, verifies the exact tuple and reruns without inserting', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const before = await sourceSnapshot(factory);
    const tx = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    const close = vi.spyOn(IDBDatabase.prototype, 'close');
    const open = vi.spyOn(factory, 'open');
    const sourceWrites = vi.spyOn(factory, 'deleteDatabase');
    const expectedOwner = {
      schema: 'liska-account-catalog-owner/1',
      provider: 'claude',
      slotId: slotId(0),
      scopeKey: baseline.value.admission.catalog.scopeKey,
      collectionId: baseline.value.collectionId,
      admission: baseline.value.admission,
      phase: 'paused',
      revision: 0,
      accountComplete: false,
      executionAuthorized: false,
    };
    const expected = {
      kind: 'created',
      verification: 'verified',
      cleanup: 'closed',
      slot: {
        schema: 'liska-account-catalog-slot/1',
        provider: 'claude',
        label,
        slotId: slotId(0),
      },
      owner: expectedOwner,
    };
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual(expected);
    expect(add).toHaveBeenCalledTimes(2);
    const exactKey = ['claude', slotId(0), expectedOwner.scopeKey];
    expect(get.mock.calls).toContainEqual([exactKey]);
    expect(tx.mock.calls.filter((_, index) => tx.mock.contexts[index].name === SOURCE)).toEqual([
      [STORE, 'readonly'],
    ]);
    expect(open.mock.calls).toEqual([
      [SOURCE, 1],
      [DESTINATION, 1],
    ]);
    expect(close.mock.contexts.map(database => database.name)).toEqual([SOURCE, DESTINATION]);
    expect(sourceWrites).not.toHaveBeenCalled();
    add.mockClear();
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      ...expected,
      kind: 'already-created',
    });
    expect(add).not.toHaveBeenCalled();
    expect(await sourceSnapshot(factory)).toEqual(before);
  });

  it('allows a second explicit slot for the same scope; a changed label conflicts', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const original = await adoptLegacyClaudeCatalog(input(factory));
    const second = await adoptLegacyClaudeCatalog(input(factory, 1));
    expect(second).toMatchObject({
      kind: 'created',
      verification: 'verified',
      owner: {
        slotId: slotId(1),
        scopeKey: baseline.value.admission.catalog.scopeKey,
        collectionId: baseline.value.collectionId,
      },
    });
    await expect(
      adoptLegacyClaudeCatalog({ ...input(factory), label: 'Новая подпись' })
    ).resolves.toEqual({
      kind: 'failed',
      stage: 'destination',
      code: 'conflict',
      cleanup: 'closed',
    });
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      ...original,
      kind: 'already-created',
    });
    const catalog = await openAccountCatalog({ indexedDB: factory });
    try {
      expect(await catalog.listOwners()).toHaveLength(2);
    } finally {
      await catalog.close();
    }
  });

  it('cannot extend an occupied slot with a second scope even when the display label matches', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const catalog = await openAccountCatalog({ indexedDB: factory });
    try {
      const original = await catalog.createPausedClaude({ ...makeInput(0, 7), label });
      expect(await adoptLegacyClaudeCatalog(input(factory))).toMatchObject({
        kind: 'failed',
        stage: 'destination',
        code: 'conflict',
      });
      expect(await catalog.listOwners()).toEqual([original.owner]);
    } finally {
      await catalog.close();
    }
  });
  it('rejects an occupied locator with different seed data and leaves both domains intact', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const before = await sourceSnapshot(factory);
    const catalog = await openAccountCatalog({ indexedDB: factory });
    try {
      const created = await catalog.createPausedClaude({
        slotId: slotId(0),
        label,
        collectionId: collectionB,
        admission: baseline.value.admission,
      });
      await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
        kind: 'failed',
        stage: 'destination',
        code: 'conflict',
        cleanup: 'closed',
      });
      expect(await catalog.listOwners()).toEqual([created.owner]);
      expect(await sourceSnapshot(factory)).toEqual(before);
    } finally {
      await catalog.close();
    }
  });

  it.each([
    'version',
    'missing-store',
    'extra-store',
    'keyPath',
    'autoIncrement',
    'index',
  ] as const)('rejects and preserves the legacy %s schema', async mismatch => {
    const factory = new IDBFactory();
    const version = mismatch === 'version' ? 2 : 1;
    const db = await openRaw(
      factory,
      version,
      db => {
        if (mismatch === 'missing-store') return;
        const store = db.createObjectStore(STORE, {
          ...(mismatch === 'keyPath' ? { keyPath: 'wrongKey' } : {}),
          autoIncrement: mismatch === 'autoIncrement',
        });
        if (mismatch === 'index') store.createIndex('wrong', 'wrong');
        if (mismatch === 'extra-store') db.createObjectStore('extra');
      },
      SOURCE
    );
    const names = [...db.objectStoreNames];
    db.close();
    const open = vi.spyOn(factory, 'open');
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      kind: 'failed',
      stage: 'source',
      code: 'unsupported',
    });
    expect(open.mock.calls).toEqual(mismatch === 'version' ? [] : [[SOURCE, 1]]);
    expect(await factory.databases()).toEqual([{ name: SOURCE, version }]);
    const unchanged = await openRaw(factory, version, undefined, SOURCE);
    try {
      expect([...unchanged.objectStoreNames]).toEqual(names);
      if (mismatch !== 'missing-store') {
        const store = unchanged.transaction(STORE, 'readonly').objectStore(STORE);
        expect(store.keyPath).toBe(mismatch === 'keyPath' ? 'wrongKey' : null);
        expect(store.autoIncrement).toBe(mismatch === 'autoIncrement');
        expect([...store.indexNames]).toEqual(mismatch === 'index' ? ['wrong'] : []);
      }
    } finally {
      unchanged.close();
    }
  });

  it.each([
    ['foreign key', [['foreign', baseline.bytes]]],
    [
      'extra key',
      [
        [KEY, baseline.bytes],
        ['foreign', baseline.bytes],
      ],
    ],
    ['undefined row', [[KEY, undefined]]],
    ['invalid UTF-8', [[KEY, new Uint8Array([0xff])]]],
    ['noncanonical JSON', [[KEY, new TextEncoder().encode(JSON.stringify(baseline.value) + ' ')]]],
    ['nonpaused revision', [[KEY, bytes({ ...baseline.value, revision: 1 })]]],
  ] satisfies [string, [IDBValidKey, unknown][]][])(
    'rejects corrupt inventory or record bytes: %s',
    async (_, rows) => {
      const factory = new IDBFactory();
      await seed(factory, rows);
      const before = await sourceSnapshot(factory);
      const open = vi.spyOn(factory, 'open');
      const keys = vi.spyOn(IDBObjectStore.prototype, 'getAllKeys');
      const get = vi.spyOn(IDBObjectStore.prototype, 'get');
      await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
        kind: 'failed',
        stage: 'source',
        code: 'corrupt',
      });
      expect(keys.mock.calls).toEqual([[undefined, 2]]);
      expect(get.mock.calls).toEqual(rows.length === 1 && rows[0][0] === KEY ? [[KEY]] : []);
      expect(open.mock.calls).toEqual([[SOURCE, 1]]);
      expect(await sourceSnapshot(factory)).toEqual(before);
    }
  );

  it.each([
    ['unsupported', bytes({ ...baseline.value, schema: 'unsupported' })],
    ['limit-exceeded', new Uint8Array(65_537)],
  ])('never rewrites a record with codec rejection %s', async (code, stored) => {
    const factory = new IDBFactory();
    await seed(factory, [[KEY, stored]]);
    await expect(adoptLegacyClaudeCatalog(input(factory))).resolves.toEqual({
      kind: 'failed',
      stage: 'source',
      code,
    });
    expect(await factory.databases()).toEqual([{ name: SOURCE, version: 1 }]);
  });

  it('rejects non-own/non-data input, invalid options and fake signals without effects', async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open');
    const discover = vi.spyOn(factory, 'databases');
    const getter = vi.fn(() => {
      throw Error('private detail');
    });
    const fixture = input(factory);
    const invalid = [
      null,
      [],
      {},
      { ...fixture, slotId: undefined },
      { ...fixture, slotId: 'latest' },
      Object.assign(Object.create({ slotId: fixture.slotId }), { label, indexedDB: factory }),
      { ...fixture, extra: 'no' },
      { ...fixture, [Symbol('extra')]: 1 },
      ...['slotId', 'label', 'indexedDB', 'signal', 'timeoutMs'].map(key =>
        Object.defineProperty({ ...fixture }, key, { enumerable: true, get: getter })
      ),
      Object.defineProperty({ ...fixture }, 'label', { enumerable: false }),
      {
        ...fixture,
        signal: {
          get aborted() {
            return getter();
          },
        },
      },
      { ...fixture, timeoutMs: 0 },
      { ...fixture, timeoutMs: 5001 },
      { ...fixture, timeoutMs: NaN },
      { ...fixture, indexedDB: {} },
      { ...fixture, indexedDB: null },
      { ...fixture, indexedDB: Object.defineProperty({}, 'open', { get: getter }) },
      { ...fixture, label: ' a' },
      { ...fixture, label: 'x'.repeat(81) },
      { ...fixture, label: '😀'.repeat(65) },
      { ...fixture, label: 'e\u0301' },
      { ...fixture, label: '\u200dx' },
    ];
    for (const raw of invalid) {
      await expect(adoptLegacyClaudeCatalog(raw as AdoptLegacyClaudeCatalogInput)).resolves.toEqual(
        {
          kind: 'failed',
          stage: 'input',
          code: 'invalid-input',
        }
      );
    }
    expect(getter).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
  });
});
