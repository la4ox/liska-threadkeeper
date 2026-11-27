// @vitest-environment node
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openAccountCatalog, type CreatePausedClaudeInput } from '../../src/account-catalog-owner';
import {
  MAX_LABEL_BYTES,
  MAX_LABEL_SCALARS,
  MAX_OWNER_BYTES,
  MAX_OWNERS,
  MAX_SLOT_BYTES,
  MAX_SLOTS,
  prepareClaude,
} from '../../src/account-catalog-owner/codec';
import { ACCOUNT_CATALOG_DATABASE, OWNERS, SLOTS } from '../../src/account-catalog-owner/database';
import { collectionB } from '../browser/claude-account-baseline-owner/fixture';
import {
  bytes,
  expectDeepFrozen,
  locator,
  makeInput,
  openRaw,
  primary,
  rawPut,
  scope,
  slotId,
  snapshot,
  terminal,
} from './fixture';

afterEach(() => vi.restoreAllMocks());

describe('rollback-isolated multi-account catalog', () => {
  it('isolates two slots, two scopes in one slot, and identical conversations in different owners', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    expect(Object.keys(catalog).sort()).toEqual([
      'close',
      'createPausedClaude',
      'listOwners',
      'listSlots',
      'readOwner',
      'readSlot',
    ]);
    expect(await catalog.listSlots()).toEqual([]);
    expect(await catalog.listOwners()).toEqual([]);
    const inputs = [makeInput(1, 0), makeInput(0, 1), makeInput(0, 0)];
    const [c, b, a] = await Promise.all(inputs.map(input => catalog.createPausedClaude(input)));
    const inventories = [
      await catalog.listSlots(),
      await catalog.listOwners(),
      await catalog.listOwners(slotId(0)),
    ];
    expect(inventories).toEqual([
      [a.slot, c.slot],
      [a.owner, b.owner, c.owner],
      [a.owner, b.owner],
    ]);
    expect([a, b, c].map(row => row.owner.admission.catalog.targets[0].conversationId)).toEqual(
      Array(3).fill(a.owner.admission.catalog.targets[0].conversationId)
    );
    expect(a.owner).toMatchObject({
      ...locator(),
      schema: 'liska-account-catalog-owner/1',
      collectionId: inputs[0].collectionId,
      phase: 'paused',
      revision: 0,
      accountComplete: false,
      executionAuthorized: false,
    });
    expect(a.slot).toEqual({
      schema: 'liska-account-catalog-slot/1',
      slotId: slotId(0),
      provider: 'claude',
      label: inputs[2].label,
    });
    expect(await catalog.readSlot(slotId(3))).toBeNull();
    expect(await catalog.readOwner(locator(0, 3))).toBeNull();
    expect(await catalog.listOwners(slotId(3))).toEqual([]);
    expectDeepFrozen(a);
    for (const inventory of inventories) expectDeepFrozen(inventory);
    const raw = await snapshot(indexedDB);
    for (const input of inputs) {
      const prepared = prepareClaude(input);
      expect(raw.slots).toContainEqual([input.slotId, prepared.slot.bytes]);
      expect(raw.owners).toContainEqual([
        ['claude', input.slotId, input.admission.catalog.scopeKey],
        prepared.owner.bytes,
      ]);
    }
    expect(raw.slots).toHaveLength(2);
    expect(raw.owners).toHaveLength(3);
    const db = await openRaw(indexedDB);
    expect(db.name).toBe(ACCOUNT_CATALOG_DATABASE);
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames]).toEqual([OWNERS, SLOTS]);
    const tx = db.transaction([SLOTS, OWNERS]);
    for (const name of [SLOTS, OWNERS]) {
      const store = tx.objectStore(name);
      expect([store.keyPath, store.autoIncrement, [...store.indexNames]]).toEqual([
        null,
        false,
        [],
      ]);
    }
    expect(await terminal(tx)).toBe('complete');
    db.close();
    await catalog.close();
    const reopened = await openAccountCatalog({ indexedDB });
    const again = await reopened.readOwner(locator());
    expect(again).toEqual(a.owner);
    expect(again).not.toBe(a.owner);
    expect(again?.admission.catalog.targets).not.toBe(a.owner.admission.catalog.targets);
    expectDeepFrozen(again);
    const slot = await reopened.readSlot(slotId(0));
    expect(slot).toEqual(a.slot);
    expect(slot).not.toBe(a.slot);
    await reopened.close();
  });

  it('reconciles exact normalized bytes, detaches caller data, and never overwrites an occupied key', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const input = makeInput();
    const pending = catalog.createPausedClaude(input);
    Object.assign(input.admission.catalog.targets[0].marker!, { token: 'mutated by caller' });
    const created = await pending;
    expect(created.owner.admission.catalog.targets[0].marker?.token).toBe('synthetic-marker');
    expect(Object.isFrozen(input.admission)).toBe(false);
    const before = await snapshot(indexedDB);
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    const equivalent = makeInput();
    const admission = Object.fromEntries(Object.entries(equivalent.admission).reverse());
    const same = await catalog.createPausedClaude({ ...equivalent, admission });
    expect(same).toEqual({ ...created, kind: 'already-created' });
    expect(same.owner).not.toBe(created.owner);
    for (const conflicting of [
      makeInput(0, 0, 1, 'different'),
      { ...makeInput(), collectionId: collectionB },
      { ...makeInput(0, 1), label: 'different slot metadata' },
    ])
      await expect(catalog.createPausedClaude(conflicting)).rejects.toMatchObject({
        code: 'conflict',
      });
    expect(add).not.toHaveBeenCalled();
    expect(await snapshot(indexedDB)).toEqual(before);
    await catalog.close();
  });

  it('serializes competing handles: one winner for different seeds, one creator for identical seeds', async () => {
    const indexedDB = new IDBFactory();
    const first = await openAccountCatalog({ indexedDB });
    const second = await openAccountCatalog({ indexedDB });
    const sibling = await first.createPausedClaude(makeInput(0, 1));
    const siblingBytes = (await snapshot(indexedDB)).owners[0];
    const results = await Promise.allSettled([
      first.createPausedClaude(makeInput()),
      second.createPausedClaude({ ...makeInput(), collectionId: collectionB }),
    ]);
    const winners = results.filter(result => result.status === 'fulfilled');
    const losers = results.filter(result => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0].value.kind).toBe('created');
    expect(losers[0].reason).toMatchObject({ code: 'conflict' });
    expect(await second.readOwner(locator())).toEqual(winners[0].value.owner);
    expect(await second.readOwner(locator(0, 1))).toEqual(sibling.owner);
    expect((await snapshot(indexedDB)).owners).toContainEqual(siblingBytes);
    const identical = await Promise.all([
      first.createPausedClaude(makeInput(1, 0)),
      second.createPausedClaude(makeInput(1, 0)),
    ]);
    expect(identical.map(row => row.kind).sort()).toEqual(['already-created', 'created']);
    await Promise.all([first.close(), second.close()]);
  });

  it('rejects a key/envelope/seed mismatch only for the affected scope without touching siblings', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const a = await catalog.createPausedClaude(makeInput(0, 0));
    const b = await catalog.createPausedClaude(makeInput(0, 1));
    const c = await catalog.createPausedClaude(makeInput(1, 0));
    for (const wrong of [a.owner, { ...a.owner, scopeKey: scope(1) }]) {
      await rawPut(indexedDB, OWNERS, primary(0, 1), bytes(wrong));
      const before = await snapshot(indexedDB);
      await expect(catalog.readOwner(locator(0, 1))).rejects.toMatchObject({ code: 'corrupt' });
      await expect(catalog.createPausedClaude(makeInput(0, 1))).rejects.toMatchObject({
        code: 'corrupt',
      });
      await expect(catalog.listOwners()).rejects.toMatchObject({ code: 'corrupt' });
      expect(await catalog.readOwner(locator())).toEqual(a.owner);
      expect(await catalog.listOwners(slotId(1))).toEqual([c.owner]);
      expect(await snapshot(indexedDB)).toEqual(before);
    }
    expect((await catalog.readSlot(slotId(0)))?.slotId).toBe(b.owner.slotId);
    const d = await catalog.createPausedClaude(makeInput(0, 2));
    expect(await catalog.readOwner(locator(0, 2))).toEqual(d.owner);
    await catalog.close();
  });

  it.each([
    { name: SLOTS, key: 'alien-slot' },
    { name: OWNERS, key: ['chatgpt', slotId(0), scope(0)] },
    { name: OWNERS, key: [...primary(), 'surplus-binding'] },
    { name: OWNERS, key: ['claude', slotId(0), 'arbitrary scope'] },
    { name: OWNERS, key: primary(6, 0) },
  ] as const)('fails closed on foreign or orphaned inventory (%#)', async ({ name, key }) => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    await catalog.createPausedClaude(makeInput());
    await rawPut(indexedDB, name, typeof key === 'string' ? key : [...key], 'opaque');
    const before = await snapshot(indexedDB);
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    await expect(catalog.listOwners()).rejects.toMatchObject({ code: 'corrupt' });
    await expect(catalog.createPausedClaude(makeInput(1))).rejects.toMatchObject({
      code: 'corrupt',
    });
    expect(get).not.toHaveBeenCalled();
    expect(await snapshot(indexedDB)).toEqual(before);
    await catalog.close();
  });

  it.each([
    { store: SLOTS, key: slotId(0), value: new Uint8Array(MAX_SLOT_BYTES + 1), code: 'corrupt' },
    { store: OWNERS, key: primary(), value: new Uint8Array(MAX_OWNER_BYTES + 1), code: 'corrupt' },
    { store: OWNERS, key: primary(), value: new Uint8Array([0xff]), code: 'corrupt' },
    { store: OWNERS, key: primary(), value: { schema: 'foreign/2' }, code: 'corrupt' },
    {
      store: SLOTS,
      key: slotId(0),
      value: bytes({ ...prepareClaude(makeInput()).slot.value, schema: 'foreign/2' }),
      code: 'unsupported',
    },
    {
      store: OWNERS,
      key: primary(),
      value: bytes({ ...prepareClaude(makeInput()).owner.value, schema: 'foreign/2' }),
      code: 'unsupported',
    },
    {
      store: OWNERS,
      key: primary(),
      value: bytes({ ...prepareClaude(makeInput()).owner.value, executionAuthorized: true }),
      code: 'corrupt',
    },
    {
      store: OWNERS,
      key: primary(),
      value: bytes(
        Object.fromEntries(Object.entries(prepareClaude(makeInput()).owner.value).reverse())
      ),
      code: 'corrupt',
    },
  ] as const)(
    'does not adopt or rewrite foreign/oversized/noncanonical values (%#)',
    async ({ store, key, value, code }) => {
      const indexedDB = new IDBFactory();
      const catalog = await openAccountCatalog({ indexedDB });
      await catalog.createPausedClaude(makeInput());
      await rawPut(indexedDB, store, key, value);
      const before = await snapshot(indexedDB);
      await expect(catalog.readOwner(locator())).rejects.toMatchObject({ code });
      await expect(catalog.createPausedClaude(makeInput())).rejects.toMatchObject({ code });
      expect(await snapshot(indexedDB)).toEqual(before);
      await catalog.close();
    }
  );

  it('rejects accessor, prototype, unknown fields and invalid IDs before any operation touches IDB', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const get = vi.fn(() => {
      throw new Error('must not read getter');
    });
    const data = makeInput();
    const foreign = { ...data, provider: 'chatgpt' };
    const nested = {
      ...data,
      admission: Object.defineProperty({ ...data.admission }, 'catalog', { get }),
    };
    const inherited = Object.assign(Object.create({ injected: true }), data);
    const top = Object.defineProperty({ ...data }, 'label', { get });
    for (const input of [
      foreign,
      nested,
      inherited,
      top,
      { ...data, slotId: data.slotId + '\n' },
      { ...data, collectionId: 'invalid' },
    ])
      await expect(catalog.createPausedClaude(input)).rejects.toMatchObject({
        code: 'invalid-input',
      });
    await expect(
      catalog.readOwner(Object.defineProperty(locator(), 'scopeKey', { get }))
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(catalog.readSlot(Object.create({ toString: get }))).rejects.toMatchObject({
      code: 'invalid-input',
    });
    await expect(
      catalog.createPausedClaude({ ...data, admission: makeInput(0, 0, 31).admission })
    ).rejects.toMatchObject({ code: 'limit-exceeded' });
    expect(get).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    await catalog.close();
  });

  it('enforces label scalar, byte and display grammar, and fits the largest admitted seed', async () => {
    const indexedDB = new IDBFactory();
    const catalog = await openAccountCatalog({ indexedDB });
    const input = makeInput(0, 0, 30, '\u0000'.repeat(128) + '\ud800'.repeat(128));
    for (const label of [
      '',
      ' padded',
      'newline\ninside',
      'line\u2028separator',
      'bidi\u202eoverride',
      '\ud800',
      'e\u0301',
      'a'.repeat(MAX_LABEL_SCALARS + 1),
      '😺'.repeat(MAX_LABEL_BYTES / 4 + 1),
    ])
      await expect(catalog.createPausedClaude({ ...input, label })).rejects.toMatchObject({
        code: 'invalid-input',
      });
    const largest = { ...input, label: '😺'.repeat(MAX_LABEL_BYTES / 4) };
    const result = await catalog.createPausedClaude(largest);
    expect(result.owner.admission.catalog.targets).toHaveLength(30);
    const stored = await snapshot(indexedDB);
    expect(stored.slots[0][1].byteLength).toBeLessThan(MAX_SLOT_BYTES);
    expect(stored.owners[0][1].byteLength).toBeLessThan(MAX_OWNER_BYTES);
    expect(await catalog.readOwner(locator())).toEqual(result.owner);
    await catalog.close();
  });

  it.each(['slot', 'owner'] as const)(
    'enforces exact %s capacity without partial insert and rejects over-capacity inventory',
    async dimension => {
      const indexedDB = new IDBFactory();
      const catalog = await openAccountCatalog({ indexedDB });
      const slotCapacity = dimension === 'slot';
      const capacity = slotCapacity ? MAX_SLOTS : MAX_OWNERS;
      const seed = (index: number): CreatePausedClaudeInput =>
        slotCapacity ? makeInput(index, 0) : makeInput(0, index);
      for (let index = 0; index < capacity; index++) await catalog.createPausedClaude(seed(index));
      expect(await catalog.listOwners()).toHaveLength(capacity);
      expect(await catalog.listSlots()).toHaveLength(slotCapacity ? capacity : 1);
      const before = await snapshot(indexedDB);
      await expect(catalog.createPausedClaude(seed(0))).resolves.toMatchObject({
        kind: 'already-created',
      });
      await expect(catalog.createPausedClaude(makeInput(capacity, 0))).rejects.toMatchObject({
        code: 'capacity',
      });
      expect(await snapshot(indexedDB)).toEqual(before);
      const extra = prepareClaude(seed(capacity));
      if (slotCapacity) await rawPut(indexedDB, SLOTS, slotId(capacity), extra.slot.bytes);
      else await rawPut(indexedDB, OWNERS, primary(0, capacity), extra.owner.bytes);
      const after = await snapshot(indexedDB);
      const get = vi.spyOn(IDBObjectStore.prototype, 'get');
      await expect(catalog.listOwners()).rejects.toMatchObject({ code: 'corrupt' });
      await expect(catalog.listSlots()).rejects.toMatchObject({ code: 'corrupt' });
      expect(get).not.toHaveBeenCalled();
      expect(await snapshot(indexedDB)).toEqual(after);
      await catalog.close();
    }
  );
});
