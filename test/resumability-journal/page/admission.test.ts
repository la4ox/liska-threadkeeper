import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { encodeSnapshotCatalog } from '../../../src/archive/catalog';
import {
  admitCatalog,
  MAX_CATALOG_BYTES,
  sha256,
  snapshotCatalogFile,
} from '../../../src/resumability-journal/page/admission';
import { catalog, CANARY, deferred } from '../../snapshot-catalog/fixtures';

describe('journal exact catalog admission', () => {
  it('hashes exact canonical bytes and retains only deduplicated identities and counts', async () => {
    const value = catalog();
    value.entries[0].occurrenceCount = 2;
    value.selectedManifestCount = 2;
    value.selectedFileCount = 7;
    const bytes = encodeSnapshotCatalog(value);
    const hash = vi.fn(async (input: Uint8Array) => {
      expect(Array.from(input)).toEqual(Array.from(bytes));
      return 'c'.repeat(64);
    });
    const result = await admitCatalog(bytes, new AbortController().signal, hash);
    expect(result.counts).toEqual({ conversations: 1, captures: 2, duplicates: 1, skipped: 0 });
    expect(result.identities).toEqual([
      {
        provider: 'chatgpt',
        conversationId: CANARY,
        conversationKey: value.entries[0].conversationKey,
      },
    ]);
    expect(Object.keys(result)).toEqual(['catalogSha256', 'identities', 'counts']);
    expect(JSON.stringify(result)).not.toContain('capturedAt');
    expect(hash).toHaveBeenCalledOnce();
  });
  it('counts invalid occurrences without admitting them and collapses different captures of one conversation', async () => {
    const value = catalog();
    const valid = value.entries[0];
    const second = { ...valid, captureId: 'other', manifestSha256: 'c'.repeat(64) };
    const invalid = {
      ...valid,
      manifestValidity: 'invalid' as const,
      provider: null,
      conversationId: null,
      conversationKey: null,
      captureId: null,
      capturedAt: null,
      method: null,
      declaredCompleteness: null,
      artifacts: null,
      assets: null,
      associatedFileCount: 1,
      extraFileCount: 0,
      extraFileBytes: 0,
      canonical: { presence: 'absent' as const, byteLength: null, declaredFileRole: null },
      issueCodes: ['manifest-invalid' as const],
      occurrenceCount: 2,
      manifestSha256: 'd'.repeat(64),
    };
    value.entries.push(second, invalid);
    value.selectedManifestCount = 4;
    value.selectedFileCount = 9;
    const result = await admitCatalog(
      encodeSnapshotCatalog(value),
      new AbortController().signal,
      async () => 'e'.repeat(64)
    );
    expect(result.counts).toEqual({ conversations: 1, captures: 2, duplicates: 1, skipped: 2 });
    expect(result.identities).toHaveLength(1);
  });
  it.each(['{}', '{"schema":"liska-thread/1"}', '{"schema":"liska-snapshot-catalog/1"}', '\uFFFD'])(
    'refuses malformed/noncatalog input %s',
    async text => {
      const hash = vi.fn();
      await expect(
        admitCatalog(new TextEncoder().encode(text), new AbortController().signal, hash)
      ).rejects.toMatchObject({ code: 'catalog-invalid' });
      expect(hash).not.toHaveBeenCalled();
    }
  );
  it('refuses whitespace, BOM, duplicated keys and unknown fields even when JSON.parse would accept them', async () => {
    const text = new TextDecoder().decode(encodeSnapshotCatalog(catalog()));
    for (const changed of [
      ' ' + text,
      text.trimEnd(),
      '\uFEFF' + text,
      text.replace('{', '{"schema":"liska-snapshot-catalog/1",'),
      text.replace('{', '{"path":"secret",'),
    ])
      await expect(
        admitCatalog(new TextEncoder().encode(changed), new AbortController().signal)
      ).rejects.toMatchObject({ code: 'catalog-invalid' });
  });
  it('snapshots the selected file reader before awaits, bounds read size, and rejects empty/multiple selection', async () => {
    const pending = deferred<ArrayBuffer>();
    const read = vi.fn(() => pending.promise);
    const file = {
      size: 2,
      slice: vi.fn(() => ({ arrayBuffer: read })),
      name: CANARY,
    } as unknown as File;
    const files = [file];
    const owned = snapshotCatalogFile(files);
    files[0] = {} as File;
    const operation = owned();
    pending.resolve(new Uint8Array([1, 2]).buffer);
    expect(await operation).toEqual(new Uint8Array([1, 2]));
    expect(read).toHaveBeenCalledOnce();
    expect(() => snapshotCatalogFile([])).toThrow('selection-invalid');
    expect(() => snapshotCatalogFile([file, file])).toThrow('selection-invalid');
    expect(() => snapshotCatalogFile([{ size: 0 } as File])).toThrow('selection-invalid');
    expect(() => snapshotCatalogFile([{ size: MAX_CATALOG_BYTES + 1 } as File])).toThrow(
      'selection-limit'
    );
    await expect(
      admitCatalog(new Uint8Array(MAX_CATALOG_BYTES + 1), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'selection-limit' });
    const wrong = snapshotCatalogFile([
      {
        size: 1,
        slice: () => ({ arrayBuffer: async () => new ArrayBuffer(2) }),
      } as unknown as File,
    ]);
    await expect(wrong()).rejects.toMatchObject({ code: 'selection-invalid' });
  });
  it('owns bytes before hashing and rejects cancelled or malformed hash results', async () => {
    const input = encodeSnapshotCatalog(catalog());
    const expected = input.slice();
    const pending = deferred<string>();
    const abort = new AbortController();
    const operation = admitCatalog(input, abort.signal, async bytes => {
      expect(Array.from(bytes)).toEqual(Array.from(expected));
      input.fill(0);
      return pending.promise;
    });
    abort.abort();
    pending.resolve('f'.repeat(64));
    await expect(operation).rejects.toMatchObject({ code: 'hash-failed' });
    await expect(
      admitCatalog(expected, new AbortController().signal, async () => CANARY)
    ).rejects.toMatchObject({ code: 'hash-failed' });
  });
  it('computes actual SHA-256 and checks cancellation on both sides of the hash await', async () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', webcrypto);
    expect(await sha256(new TextEncoder().encode('abc'), new AbortController().signal)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    const abort = new AbortController();
    abort.abort();
    await expect(sha256(new Uint8Array([1]), abort.signal)).rejects.toMatchObject({
      code: 'hash-failed',
    });
    vi.stubGlobal('crypto', original);
  });
});
