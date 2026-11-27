// @vitest-environment node
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPickerSlots, copyLegacySlot } from '../../src/background/account-slot-actions';
import { openAccountCatalog } from '../../src/account-catalog-owner';
import {
  adoptLegacyClaudeCatalog,
  type AdoptLegacyClaudeCatalogResult,
} from '../../src/account-catalog-adoption';
import { adoptionReceipt, slotInventory } from '../../src/lib/account-slot-contract';
import { ACCOUNT_CATALOG_DATABASE } from '../../src/account-catalog-owner/database';
import { makeInput, snapshot } from '../account-catalog-owner/fixture';
import { seed, sourceSnapshot } from '../account-catalog-adoption/fixture';

afterEach(() => vi.restoreAllMocks());
describe('offline slot popup adapters', () => {
  it('inventory may initialize only fixed empty schema; never adds a slot/owner or reads owner values', async () => {
    const indexedDB = new IDBFactory(),
      open = () => openAccountCatalog({ indexedDB });
    const add = vi.spyOn(IDBObjectStore.prototype, 'add');
    expect(await listPickerSlots(open)).toEqual(slotInventory('listed'));
    expect(await indexedDB.databases()).toEqual([{ name: ACCOUNT_CATALOG_DATABASE, version: 1 }]);
    expect(await snapshot(indexedDB)).toEqual({ slots: [], owners: [] });
    expect(add).not.toHaveBeenCalled();
    const catalog = await open(),
      { slot } = await catalog.createPausedClaudeSingleScope(makeInput());
    await catalog.close();
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    add.mockClear();
    expect(await listPickerSlots(open)).toEqual(
      slotInventory('listed', [{ slotId: slot.slotId, label: slot.label, provider: 'claude' }])
    );
    expect(get.mock.contexts.map(c => c.name)).toEqual(['slots']);
    expect(add).not.toHaveBeenCalled();
  });
  it('returns content-free copied/reconciled receipts and retains the old catalog unchanged', async () => {
    const indexedDB = new IDBFactory(),
      { slotId, label } = makeInput(),
      slot = { kind: 'new' as const, slotId, label };
    const copy = () => copyLegacySlot(slot, i => adoptLegacyClaudeCatalog({ ...i, indexedDB }));
    expect(await copy()).toEqual(adoptionReceipt('legacy-absent'));
    await seed(indexedDB);
    const before = await sourceSnapshot(indexedDB);
    expect(await copy()).toEqual(adoptionReceipt('created', 'verified', 'closed'));
    expect(await copy()).toEqual(adoptionReceipt('already-created', 'verified', 'closed'));
    expect(await sourceSnapshot(indexedDB)).toEqual(before);
  });
  it('keeps fixed source and destination failure codes, verification and close truth separate', async () => {
    const slot = { kind: 'new' as const, ...makeInput() };
    const cases = [
      [{ kind: 'legacy-empty' }, adoptionReceipt('legacy-empty')],
      [{ kind: 'private' }, adoptionReceipt('result-invalid')],
      [
        { kind: 'failed', stage: 'source', code: 'transaction-outcome-unknown' },
        adoptionReceipt('source-read-unknown'),
      ],
      [
        { kind: 'failed', stage: 'source', code: 'unsupported' },
        adoptionReceipt('source-unsupported'),
      ],
      [{ kind: 'failed', stage: 'source', code: 'cancelled' }, adoptionReceipt('source-cancelled')],
      [
        {
          kind: 'failed',
          stage: 'destination',
          code: 'transaction-outcome-unknown',
          cleanup: 'close-failed',
        },
        adoptionReceipt('destination-outcome-unknown', 'not-performed', 'close-failed'),
      ],
      [
        { kind: 'failed', stage: 'destination', code: 'conflict', cleanup: 'closed' },
        adoptionReceipt('destination-conflict', 'not-performed', 'closed'),
      ],
      [
        {
          kind: 'created',
          verification: 'readback-unavailable',
          cleanup: 'close-failed',
          owner: { secret: 'private' },
        },
        adoptionReceipt('created', 'readback-unavailable', 'close-failed'),
      ],
    ] as const;
    for (const [result, expected] of cases)
      expect(
        await copyLegacySlot(slot, async () => result as unknown as AdoptLegacyClaudeCatalogResult)
      ).toEqual(expected);
    expect(
      await copyLegacySlot(slot, async () => {
        throw Error('private');
      })
    ).toEqual(adoptionReceipt('result-invalid'));
  });
});
