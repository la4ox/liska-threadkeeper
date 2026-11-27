import { expect } from 'vitest';
import type { AdoptLegacyClaudeCatalogInput } from '../../src/account-catalog-adoption';
import { prepareClaudeAccountBaseline } from '../../src/claude-account-baseline-owner/codec';
import {
  CLAUDE_ACCOUNT_BASELINE_OWNER_DATABASE as SOURCE,
  CLAUDE_ACCOUNT_BASELINE_OWNER_KEY as KEY,
  CLAUDE_ACCOUNT_BASELINE_OWNER_STORE as STORE,
} from '../../src/claude-account-baseline-owner/database';
import { openRaw, slotId, terminal } from '../account-catalog-owner/fixture';
import { admitted, collectionA } from '../browser/claude-account-baseline-owner/fixture';

export const baseline = prepareClaudeAccountBaseline(collectionA, admitted());
export const label = 'Личный архив';
export { KEY, SOURCE, STORE };

export function input(indexedDB: IDBFactory, slot = 0): AdoptLegacyClaudeCatalogInput {
  return { indexedDB, slotId: slotId(slot), label, timeoutMs: 500 };
}

export async function seed(
  factory: IDBFactory,
  rows: readonly (readonly [IDBValidKey, unknown])[] = [[KEY, baseline.bytes]]
) {
  const db = await openRaw(factory, 1, db => db.createObjectStore(STORE), SOURCE);
  try {
    if (rows.length === 0) return;
    const tx = db.transaction(STORE, 'readwrite');
    for (const [key, bytes] of rows) tx.objectStore(STORE).add(bytes, key);
    expect(await terminal(tx)).toBe('complete');
  } finally {
    db.close();
  }
}

export async function sourceSnapshot(factory: IDBFactory) {
  const db = await openRaw(factory, 1, undefined, SOURCE);
  try {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const schema = {
      version: db.version,
      stores: [...db.objectStoreNames],
      keyPath: store.keyPath,
      autoIncrement: store.autoIncrement,
      indexes: [...store.indexNames],
    };
    const keys = store.getAllKeys();
    const values = store.getAll();
    expect(await terminal(tx)).toBe('complete');
    return { schema, keys: keys.result, values: values.result };
  } finally {
    db.close();
  }
}
