import { expect } from 'vitest';
import type { AccountCatalogOwnerLocator } from '../../src/account-catalog-owner';
import { ACCOUNT_CATALOG_DATABASE, OWNERS, SLOTS } from '../../src/account-catalog-owner/database';
import { admitted, collectionA } from '../browser/claude-account-baseline-owner/fixture';

export const slotId = (index: number) => 'account-slot/1:' + index.toString(16).padStart(32, '0');
export const scope = (index: number) =>
  'claude-list-scope/1:' + index.toString(16).padStart(64, '0');
export const makeInput = (slot = 0, key = 0, count = 1, marker?: string) => {
  const input = admitted(count, marker);
  return {
    slotId: slotId(slot),
    label: 'Пример / 個人 ' + slot,
    collectionId: collectionA,
    admission: { ...input, catalog: { ...input.catalog, scopeKey: scope(key) } },
  };
};
export const locator = (slot = 0, key = 0): AccountCatalogOwnerLocator => ({
  provider: 'claude',
  slotId: slotId(slot),
  scopeKey: scope(key),
});
export const primary = (slot = 0, key = 0) => ['claude', slotId(slot), scope(key)];
export const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

export function terminal(transaction: IDBTransaction): Promise<'complete' | 'abort'> {
  return new Promise(resolve => {
    transaction.addEventListener('complete', () => resolve('complete'), { once: true });
    transaction.addEventListener('abort', () => resolve('abort'), { once: true });
  });
}

export function openRaw(
  factory: IDBFactory,
  version = 1,
  initialize?: (database: IDBDatabase) => void,
  name = ACCOUNT_CATALOG_DATABASE
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => initialize?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function snapshot(
  factory: IDBFactory,
  names = [SLOTS, OWNERS],
  databaseName?: string
) {
  const db = await openRaw(factory, 1, undefined, databaseName);
  try {
    const tx = db.transaction(names, 'readonly');
    const reads = names.map(name => {
      const store = tx.objectStore(name);
      return [name, store.getAllKeys(), store.getAll()] as const;
    });
    expect(await terminal(tx)).toBe('complete');
    return Object.fromEntries(
      reads.map(([name, keys, values]) => [
        name,
        keys.result.map((key, index) => [key, values.result[index]]),
      ])
    );
  } finally {
    db.close();
  }
}

export async function rawPut(
  factory: IDBFactory,
  name: typeof SLOTS | typeof OWNERS,
  key: IDBValidKey,
  value: unknown
) {
  const db = await openRaw(factory);
  try {
    const tx = db.transaction(name, 'readwrite');
    tx.objectStore(name).put(value, key);
    expect(await terminal(tx)).toBe('complete');
  } finally {
    db.close();
  }
}

export function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const entry of Object.values(value)) expectDeepFrozen(entry);
}
