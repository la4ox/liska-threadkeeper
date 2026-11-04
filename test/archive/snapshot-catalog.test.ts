import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildCaptureManifest, type RawCaptureManifest } from '../../src/archive/capture';
import {
  buildSnapshotCatalog,
  encodeSnapshotCatalog,
  SNAPSHOT_CATALOG_HARD_LIMITS,
  SnapshotCatalogError,
  type BuildSnapshotCatalogInput,
  type SnapshotCatalog,
  type SnapshotCatalogCode,
  type SnapshotCatalogLimits,
} from '../../src/archive/catalog';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sha256 = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function manifest(overrides: Partial<RawCaptureManifest> = {}): RawCaptureManifest {
  return buildCaptureManifest({
    provider: 'chatgpt',
    conversationId: 'conversation-1',
    captureId: 'capture-1',
    capturedAt: '2026-11-04T00:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'raw',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: 4,
        sha256: 'a'.repeat(64),
        endpoint: { method: 'GET', pathPattern: '/private-endpoint/{conversationId}' },
      },
    ],
    assets: [
      {
        id: 'asset-1',
        state: 'fetched',
        attemptedAt: '2026-11-04T00:00:01.000Z',
        relativePath: 'assets/private-asset.bin',
        mediaType: 'image/png',
        byteLength: 5,
        sha256: 'b'.repeat(64),
        detail: 'private detail',
        sourceRefs: [{ artifactId: 'raw', rawPointer: '/private-pointer' }],
      },
      {
        id: 'asset-2',
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: null,
        sourceRefs: [{ artifactId: 'raw', rawPointer: '/private-pointer-2' }],
      },
    ],
    completeness: {
      graph: 'complete',
      messages: 'partial',
      branches: 'unknown',
      assets: 'partial',
    },
    warnings: ['private warning'],
    observedUnknownContentTypes: ['private-type'],
    ...overrides,
  });
}

function selection(root: string, value: RawCaptureManifest | string | Uint8Array = manifest()) {
  const bytes =
    value instanceof Uint8Array
      ? value
      : encoder.encode(typeof value === 'string' ? value : JSON.stringify(value));
  return {
    files: [
      { relativePath: `${root}/manifest.json`, byteLength: bytes.byteLength },
      { relativePath: `${root}/responses/conversation.json`, byteLength: 4 },
      { relativePath: `${root}/assets/private-asset.bin`, byteLength: 5 },
    ],
    manifests: [{ relativePath: `${root}/manifest.json`, bytes }],
  };
}

function input(...parts: ReturnType<typeof selection>[]): BuildSnapshotCatalogInput {
  return {
    files: parts.flatMap(part => part.files),
    manifests: parts.flatMap(part => part.manifests),
    sha256,
  };
}

async function encoded(value: BuildSnapshotCatalogInput): Promise<string> {
  return decoder.decode(encodeSnapshotCatalog(await buildSnapshotCatalog(value)));
}

async function rejectsCode(value: BuildSnapshotCatalogInput, code: SnapshotCatalogCode) {
  await expect(buildSnapshotCatalog(value)).rejects.toMatchObject({
    name: 'SnapshotCatalogError',
    code,
  });
}

describe('manifest-only snapshot catalog', () => {
  it('keeps manifest validity, declared completeness and metadata presence separate', async () => {
    const chosen = selection('private-root');
    chosen.files.push({
      relativePath: 'private-root/canonical/liska-thread-1.json',
      byteLength: 999,
    });
    const result = await buildSnapshotCatalog(input(chosen));
    expect(result).toMatchObject({
      schema: 'liska-snapshot-catalog/1',
      algorithmVersion: 'manifest-metadata/1',
      analysisOnly: true,
      mutationAuthorized: false,
      fileEvidence: 'metadata-only-not-content-verified',
      accountBinding: 'not-recorded-in-liska-capture-1',
      selectedFileCount: 4,
      selectedManifestCount: 1,
      unassociatedFileCount: 0,
    });
    expect(result.entries[0]).toMatchObject({
      manifestValidity: 'valid',
      manifestByteLength: chosen.manifests[0].bytes.byteLength,
      declaredCompleteness: {
        graph: 'complete',
        messages: 'partial',
        branches: 'unknown',
        assets: 'partial',
      },
      artifacts: {
        count: 1,
        declaredBytes: 4,
        presentCount: 1,
        presentBytes: 4,
        sizeMatchCount: 1,
        missingCount: 0,
        sizeMismatchCount: 0,
      },
      assets: { recordCount: 2, count: 1, declaredBytes: 5, presentCount: 1, sizeMatchCount: 1 },
      canonical: { presence: 'present-unverified', byteLength: 999 },
      occurrenceCount: 1,
      issueCodes: [],
    });
    expect(result.entries[0].manifestSha256).toBe(await sha256(chosen.manifests[0].bytes));
    expect(result.entries[0].conversationKey).toBe(
      `liska-conversation-key/1:${await sha256(encoder.encode(JSON.stringify(['liska-conversation-key/1', 'chatgpt', 'conversation-1'])))}`
    );
  });

  it('is byte-identical across selected file/manifest permutations', async () => {
    const original = input(
      selection('z', manifest({ captureId: 'capture-z' })),
      selection('a', manifest({ captureId: 'capture-a' }))
    );
    const shuffled = {
      ...original,
      files: [...original.files].reverse(),
      manifests: [...original.manifests].reverse(),
    };
    expect(await encoded(shuffled)).toBe(await encoded(original));
  });

  it('separates the same conversation ID across providers and keeps every capture', async () => {
    const result = await buildSnapshotCatalog(
      input(
        selection('a'),
        selection('b', manifest({ provider: 'claude' })),
        selection('c', manifest({ captureId: 'capture-2', capturedAt: '2026-11-03T00:00:00.000Z' }))
      )
    );
    expect(result.entries).toHaveLength(3);
    const chatgpt = result.entries.filter(entry => entry.provider === 'chatgpt');
    expect(chatgpt[0].conversationKey).toBe(chatgpt[1].conversationKey);
    expect(result.entries.find(entry => entry.provider === 'claude')!.conversationKey).not.toBe(
      chatgpt[0].conversationKey
    );
    expect(
      result.entries.every(entry => !entry.issueCodes.includes('capture-identity-conflict'))
    ).toBe(true);
  });

  it('collapses identical copies explicitly but preserves different metadata projections', async () => {
    const copies = input(selection('a'), selection('b'));
    const result = await buildSnapshotCatalog(copies);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].occurrenceCount).toBe(2);
    expect(result.selectedManifestCount).toBe(2);
    const missing = selection('c');
    missing.files.pop();
    const changed = await buildSnapshotCatalog(input(selection('a'), selection('b'), missing));
    expect(changed.entries).toHaveLength(2);
    expect(changed.entries.map(entry => entry.occurrenceCount).sort()).toEqual([1, 2]);
    expect(changed.entries.find(entry => entry.occurrenceCount === 1)!.issueCodes).toContain(
      'asset-missing'
    );
  });

  it('flags every entry in a conflicting same-provider conversation/capture identity', async () => {
    const result = await buildSnapshotCatalog(
      input(
        selection('a'),
        selection('b', manifest({ capturedAt: '2026-11-03T00:00:00.000Z' })),
        selection('c')
      )
    );
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map(entry => entry.occurrenceCount).sort()).toEqual([1, 2]);
    expect(
      result.entries.every(entry => entry.issueCodes.includes('capture-identity-conflict'))
    ).toBe(true);
  });

  it('accepts non-writer JSON whitespace/key order and digests exact bytes', async () => {
    const value = manifest();
    const reformatted =
      JSON.stringify(Object.fromEntries(Object.entries(value).reverse()), null, 4) + '\n';
    const result = await buildSnapshotCatalog(
      input(selection('a', value), selection('b', reformatted))
    );
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every(entry => entry.manifestValidity === 'valid')).toBe(true);
    expect(new Set(result.entries.map(entry => entry.manifestSha256)).size).toBe(2);
  });

  it.each([
    ['unsupported', '{"schema":"liska-capture/99","title":"secret"}', 'manifest-unsupported'],
    ['invalid', '{}', 'manifest-invalid'],
    ['invalid', 'null', 'manifest-invalid'],
    ['invalid', '{', 'invalid-json'],
    ['invalid', '{"schema":1,"schema":2}', 'duplicate-json-key'],
    ['invalid', '{"schema":1,"\\u0073chema":2}', 'duplicate-json-key'],
    ['invalid', '{"__proto__":{}}', 'unsafe-json-key'],
    ['invalid', '{"nested":{"constructor":1}}', 'unsafe-json-key'],
    ['invalid', '[1e999]', 'invalid-json'],
    ['invalid', '[01]', 'invalid-json'],
    ['invalid', '\ufeff{}', 'invalid-json'],
  ] as const)('retains %s manifests as entries (%s)', async (validity, bytes, code) => {
    const result = await buildSnapshotCatalog(input(selection('a', bytes)));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      manifestValidity: validity,
      issueCodes: [code],
      provider: null,
      artifacts: null,
      occurrenceCount: 1,
    });
  });

  it('rejects malformed UTF-8 honestly and contains unsafe manifest paths as invalid entries', async () => {
    const invalid = selection('a', new Uint8Array([0xc0, 0xaf]));
    const unsafe = manifest();
    unsafe.artifacts[0].relativePath = 'responses/a:stream';
    const result = await buildSnapshotCatalog(input(invalid, selection('b', unsafe)));
    expect(result.entries.flatMap(entry => entry.issueCodes).sort()).toEqual([
      'invalid-json',
      'manifest-invalid',
    ]);
  });

  it('reports missing, mismatched and extra metadata without reading file bodies', async () => {
    const chosen = selection('a');
    chosen.files[1].byteLength = 88;
    chosen.files.pop();
    chosen.files.push({ relativePath: 'a/extra-private.bin', byteLength: 7 });
    chosen.files.push({ relativePath: 'unassociated-private.bin', byteLength: 3 });
    const hash = vi.fn(sha256);
    const result = await buildSnapshotCatalog({ ...input(chosen), sha256: hash });
    expect(hash).toHaveBeenCalledTimes(2);
    expect(result.unassociatedFileCount).toBe(1);
    expect(result.entries[0]).toMatchObject({
      artifacts: {
        count: 1,
        presentCount: 1,
        presentBytes: 88,
        sizeMatchCount: 0,
        sizeMismatchCount: 1,
      },
      assets: { count: 1, missingCount: 1, presentBytes: 0 },
      extraFileCount: 1,
      extraFileBytes: 7,
      issueCodes: ['artifact-size-mismatch', 'asset-missing', 'extra-files'],
      canonical: { presence: 'absent', byteLength: null },
    });
  });

  it('assigns nested snapshot files only to their nearest manifest root', async () => {
    const result = await buildSnapshotCatalog(input(selection('a'), selection('a/nested')));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      occurrenceCount: 2,
      extraFileCount: 0,
      issueCodes: [],
    });
    expect(result.unassociatedFileCount).toBe(0);
  });

  it('never exports titles, text, locators, paths, endpoints, source pointers or transport fields', async () => {
    const value = {
      ...manifest(),
      title: 'secret-title',
      transport: 'secret-transport',
      url: 'https://private.invalid',
    };
    const text = await encoded(input(selection('secret-local-root', JSON.stringify(value))));
    expect(text).not.toMatch(
      /secret|private|endpoint|sourceRefs|rawPointer|relativePath|filename|title|url|warning|observedUnknown|attemptedAt|mediaType|detail/iu
    );
    expect(text).not.toContain('a'.repeat(64));
    expect(text).not.toContain('b'.repeat(64));
  });

  it('has finite catalog-specific capacity for thousands of files and snapshots', async () => {
    const parts = Array.from({ length: 1100 }, (_, i) => selection(`copy-${i}`));
    const result = await buildSnapshotCatalog(input(...parts));
    expect(result.selectedManifestCount).toBe(1100);
    expect(result.selectedFileCount).toBe(3300);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].occurrenceCount).toBe(1100);
    expect(
      Object.values(SNAPSHOT_CATALOG_HARD_LIMITS).every(
        value => Number.isSafeInteger(value) && value > 0
      )
    ).toBe(true);
  }, 20_000);

  it.each(Object.keys(SNAPSHOT_CATALOG_HARD_LIMITS) as (keyof SnapshotCatalogLimits)[])(
    'enforces independent lowering-only %s',
    async key => {
      await rejectsCode({ ...input(selection('a')), limits: { [key]: 0 } }, 'limit-exceeded');
      await rejectsCode(
        { ...input(selection('a')), limits: { [key]: SNAPSHOT_CATALOG_HARD_LIMITS[key] + 1 } },
        'invalid-limits'
      );
    }
  );

  it('enforces cumulative bytes/JSON/records/hash budgets across individual valid manifests', async () => {
    const a = selection('a');
    const b = selection('b', manifest({ captureId: 'capture-2' }));
    for (const limits of [
      { maxTotalManifestBytes: a.manifests[0].bytes.byteLength },
      { maxTotalRecords: 3 },
      { maxHashCalls: 2 },
      { maxHashBytes: a.manifests[0].bytes.byteLength + 100 },
      { maxJsonWork: a.manifests[0].bytes.byteLength },
    ])
      await rejectsCode({ ...input(a, b), limits }, 'limit-exceeded');
  });

  it.each([-1, 0.5, NaN, Infinity, '1'])('rejects invalid limit values %s', async value => {
    await rejectsCode(
      { ...input(selection('a')), limits: { maxManifests: value as number } },
      'invalid-limits'
    );
  });

  it('allows a genuinely empty selection without inventing entries', async () => {
    const result = await buildSnapshotCatalog(input());
    expect(result).toMatchObject({ selectedFileCount: 0, selectedManifestCount: 0, entries: [] });
    expect(JSON.parse(decoder.decode(encodeSnapshotCatalog(result)))).toEqual(result);
  });
});

describe('catalog owned-input and strict encoding boundary', () => {
  it('copies every manifest and metadata descriptor synchronously before the first await', async () => {
    const a = selection('a');
    const b = selection('b', manifest({ captureId: 'capture-2' }));
    const chosen = input(a, b);
    const expected = await encoded(chosen);
    let first = true;
    const hash = async (bytes: Uint8Array) => {
      if (first) {
        first = false;
        a.manifests[0].bytes.fill(0);
        b.manifests[0].bytes.fill(0);
        b.files[1].byteLength = 900;
        (chosen.files as { relativePath: string; byteLength: number }[]).splice(0);
        (chosen.manifests as unknown[]).splice(0);
      }
      await Promise.resolve();
      return sha256(bytes);
    };
    expect(await encoded({ ...chosen, sha256: hash })).toBe(expected);
  });

  it('never invokes accessors or inherited/custom object code', async () => {
    let reads = 0;
    const chosen = input(selection('a'));
    const descriptor = {
      get relativePath() {
        reads += 1;
        throw new Error('private');
      },
      byteLength: 4,
    };
    await rejectsCode({ ...chosen, files: [descriptor] }, 'invalid-request');
    const getterArray = Object.defineProperty([chosen.files[0]], '0', {
      get() {
        reads += 1;
        return chosen.files[0];
      },
      enumerable: true,
    });
    await rejectsCode({ ...chosen, files: getterArray }, 'invalid-request');
    const exotic = Object.assign(Object.create({ inherited: true }), chosen.files[0]);
    await rejectsCode({ ...chosen, files: [exotic] }, 'invalid-request');
    expect(reads).toBe(0);
  });

  it('rejects observably hostile proxies and native-slot proxy byte views', async () => {
    const chosen = input(selection('a'));
    const trapped = new Proxy(chosen.files[0], {
      ownKeys() {
        throw new Error('private trap prose');
      },
    });
    await rejectsCode({ ...chosen, files: [trapped] }, 'invalid-request');
    const bytes = new Proxy(chosen.manifests[0].bytes, {});
    await rejectsCode(
      { ...chosen, manifests: [{ ...chosen.manifests[0], bytes }] },
      'invalid-request'
    );
  });

  it.each([
    '../manifest.json',
    '/manifest.json',
    'a\\manifest.json',
    'a/./manifest.json',
    'a//manifest.json',
    'a./manifest.json',
    'a:/manifest.json',
    'CON/manifest.json',
    'a/manifest.json\u0000',
  ])('rejects unsafe selected paths %s', async path => {
    const chosen = input(selection('a'));
    await rejectsCode(
      { ...chosen, files: [{ relativePath: path, byteLength: 0 }] },
      'invalid-request'
    );
  });

  it('rejects case-folded aliases, duplicate payloads, missing descriptors and byte-length lies', async () => {
    const chosen = input(selection('a'));
    await rejectsCode(
      {
        ...chosen,
        files: [...chosen.files, { ...chosen.files[0], relativePath: 'A/MANIFEST.JSON' }],
      },
      'invalid-request'
    );
    await rejectsCode(
      { ...chosen, manifests: [...chosen.manifests, chosen.manifests[0]] },
      'invalid-request'
    );
    await rejectsCode({ ...chosen, files: chosen.files.slice(1) }, 'invalid-request');
    await rejectsCode(
      { ...chosen, files: chosen.files.map(file => ({ ...file, byteLength: 0 })) },
      'invalid-request'
    );
    await rejectsCode(
      { ...chosen, files: [{ relativePath: 'a/manifest.json', byteLength: -1 }] },
      'invalid-request'
    );
    await rejectsCode({ ...chosen, manifests: [] }, 'invalid-request');
    await rejectsCode(
      {
        ...chosen,
        files: chosen.files.map(file => ({
          ...file,
          relativePath: file.relativePath.replace('manifest.json', 'Manifest.json'),
        })),
        manifests: chosen.manifests.map(file => ({
          ...file,
          relativePath: file.relativePath.replace('manifest.json', 'Manifest.json'),
        })),
      },
      'invalid-request'
    );
  });

  it('rejects shared, resizable, detached and shadowed byte views', async () => {
    const chosen = input(selection('a'));
    const shared = new Uint8Array(new SharedArrayBuffer(chosen.manifests[0].bytes.byteLength));
    await rejectsCode(
      { ...chosen, manifests: [{ ...chosen.manifests[0], bytes: shared }] },
      'invalid-request'
    );
    const resizable = new Uint8Array(
      new ArrayBuffer(chosen.manifests[0].bytes.byteLength, { maxByteLength: 10_000 })
    );
    await rejectsCode(
      { ...chosen, manifests: [{ ...chosen.manifests[0], bytes: resizable }] },
      'invalid-request'
    );
    const detached = new Uint8Array(chosen.manifests[0].bytes);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    await rejectsCode(
      { ...chosen, manifests: [{ ...chosen.manifests[0], bytes: detached }] },
      'invalid-request'
    );
    const shadowed = Object.defineProperty(new Uint8Array(chosen.manifests[0].bytes), 'buffer', {
      get() {
        throw new Error('private');
      },
    });
    await rejectsCode(
      { ...chosen, manifests: [{ ...chosen.manifests[0], bytes: shadowed }] },
      'invalid-request'
    );
  });

  it.each([
    [
      'sha256-failed',
      async () => {
        throw new Error('private hash failure');
      },
    ],
    ['sha256-invalid', async () => 'not-a-hash'],
    ['sha256-invalid', async () => 'A'.repeat(64)],
    [
      'sha256-mutated',
      async (bytes: Uint8Array) => {
        bytes.fill(0);
        return 'c'.repeat(64);
      },
    ],
    [
      'sha256-mutated',
      async (bytes: Uint8Array) => {
        structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
        return 'c'.repeat(64);
      },
    ],
    [
      'sha256-mutated',
      async (bytes: Uint8Array) => {
        Object.defineProperty(bytes, 'byteLength', {
          get() {
            throw new Error('private');
          },
        });
        return 'c'.repeat(64);
      },
    ],
    ['sha256-collision', async () => 'c'.repeat(64)],
  ] as const)('fails closed with %s and no exception prose', async (code, hash) => {
    try {
      await buildSnapshotCatalog({ ...input(selection('a')), sha256: hash });
      expect.fail('should reject');
    } catch (error) {
      expect(error).toBeInstanceOf(SnapshotCatalogError);
      expect(error).toMatchObject({ code });
      expect((error as Error).message).not.toContain('private');
    }
  });

  it('has exact encoder roundtrip and strict output-size enforcement', async () => {
    const result = await buildSnapshotCatalog(
      input(selection('a'), selection('b', manifest({ captureId: 'capture-2' })))
    );
    const bytes = encodeSnapshotCatalog(result);
    const roundtrip = JSON.parse(decoder.decode(bytes)) as SnapshotCatalog;
    expect(encodeSnapshotCatalog(roundtrip)).toEqual(bytes);
    roundtrip.entries.reverse();
    expect(encodeSnapshotCatalog(roundtrip)).toEqual(bytes);
    expect(encodeSnapshotCatalog(result, { maxOutputBytes: bytes.byteLength })).toEqual(bytes);
    expect(() => encodeSnapshotCatalog(result, { maxOutputBytes: bytes.byteLength - 1 })).toThrow(
      SnapshotCatalogError
    );
  });

  it('rejects forbidden/unknown fields, accessors, inconsistent aggregates and conflict suppression', async () => {
    const result = await buildSnapshotCatalog(input(selection('a')));
    for (const mutate of [
      (value: SnapshotCatalog) => Object.assign(value, { generatedAt: 'private' }),
      (value: SnapshotCatalog) => Object.assign(value.entries[0], { title: 'private' }),
      (value: SnapshotCatalog) => {
        value.mutationAuthorized = true as false;
      },
      (value: SnapshotCatalog) => {
        value.entries[0].artifacts!.missingCount += 1;
      },
      (value: SnapshotCatalog) => {
        value.entries[0].issueCodes.push('capture-identity-conflict');
      },
      (value: SnapshotCatalog) => {
        value.entries[0].provider = 'https://private.invalid';
      },
      (value: SnapshotCatalog) => {
        value.entries[0].occurrenceCount = 0;
      },
      (value: SnapshotCatalog) => {
        value.entries[0].issueCodes.push('extra-files');
      },
      (value: SnapshotCatalog) => {
        Object.defineProperty(value.entries[0], 'provider', {
          get() {
            throw new Error('private');
          },
          enumerable: true,
        });
      },
    ]) {
      const copy = structuredClone(result);
      mutate(copy);
      expect(() => encodeSnapshotCatalog(copy)).toThrow(SnapshotCatalogError);
    }
    const conflict = await buildSnapshotCatalog(
      input(selection('a'), selection('b', manifest({ capturedAt: '2026-11-03T00:00:00.000Z' })))
    );
    conflict.entries[0].issueCodes = [];
    expect(() => encodeSnapshotCatalog(conflict)).toThrow(SnapshotCatalogError);
  });
});

describe('catalog exact selected-file accounting', () => {
  function assertExactFiles(value: SnapshotCatalog): void {
    expect(value.selectedFileCount).toBe(
      value.unassociatedFileCount +
        value.entries.reduce(
          (total, entry) => total + entry.associatedFileCount * entry.occurrenceCount,
          0
        )
    );
    expect(encodeSnapshotCatalog(JSON.parse(decoder.decode(encodeSnapshotCatalog(value))))).toEqual(
      encodeSnapshotCatalog(value)
    );
  }

  it('reconciles collapsed occurrences, separate canonical metadata, extras and unassociated files', async () => {
    const a = selection('a');
    const b = selection('b');
    for (const part of [a, b]) {
      const root = part.manifests[0].relativePath.slice(0, -'manifest.json'.length);
      part.files.push({ relativePath: `${root}canonical/liska-thread-1.json`, byteLength: 9 });
      part.files.push({ relativePath: `${root}extra.bin`, byteLength: 2 });
    }
    const chosen = input(a, b);
    const result = await buildSnapshotCatalog({
      ...chosen,
      files: [...chosen.files, { relativePath: 'unassociated.bin', byteLength: 17 }],
    });
    expect(result).toMatchObject({
      selectedFileCount: 11,
      unassociatedFileCount: 1,
      selectedManifestCount: 2,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      associatedFileCount: 5,
      occurrenceCount: 2,
      extraFileCount: 1,
      canonical: { presence: 'present-unverified', byteLength: 9, declaredFileRole: null },
    });
    assertExactFiles(result);
    for (const delta of [-1, 1]) {
      const forged = structuredClone(result);
      forged.selectedFileCount += delta;
      expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
      forged.selectedFileCount -= delta;
      forged.unassociatedFileCount += delta;
      expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
    }
  });

  it('rejects associated count lies even when the forged global total agrees', async () => {
    const result = await buildSnapshotCatalog(input(selection('a'), selection('b')));
    for (const delta of [-1, 1]) {
      const forged = structuredClone(result);
      forged.entries[0].associatedFileCount += delta;
      forged.selectedFileCount += delta * forged.entries[0].occurrenceCount;
      expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
    }
    const occurrence = structuredClone(result);
    occurrence.entries[0].occurrenceCount += 1;
    occurrence.selectedManifestCount += 1;
    expect(() => encodeSnapshotCatalog(occurrence)).toThrow(SnapshotCatalogError);
    const duplicate = structuredClone(result);
    duplicate.entries.push(structuredClone(duplicate.entries[0]));
    duplicate.selectedFileCount *= 2;
    duplicate.selectedManifestCount *= 2;
    expect(() => encodeSnapshotCatalog(duplicate)).toThrow(SnapshotCatalogError);
  });

  it('retains exact inventory counts for invalid and unsupported manifests without inventing extra classifications', async () => {
    const a = selection('a', '{}');
    const b = selection('b', '{}');
    const c = selection('c', '{}');
    c.files.push({ relativePath: 'c/unknown-extra.bin', byteLength: 2 });
    const unsupported = selection('d', '{"schema":"liska-capture/99"}');
    unsupported.files.push({ relativePath: 'd/canonical/liska-thread-1.json', byteLength: 9 });
    const chosen = input(a, b, c, unsupported);
    const result = await buildSnapshotCatalog({
      ...chosen,
      files: [...chosen.files, { relativePath: 'outside.bin', byteLength: 1 }],
    });
    expect(result).toMatchObject({
      selectedFileCount: 15,
      selectedManifestCount: 4,
      unassociatedFileCount: 1,
    });
    expect(result.entries).toHaveLength(3);
    expect(
      result.entries.map(entry => [entry.associatedFileCount, entry.occurrenceCount]).sort()
    ).toEqual([
      [3, 2],
      [4, 1],
      [4, 1],
    ]);
    expect(
      result.entries.every(entry => entry.extraFileCount === 0 && entry.artifacts === null)
    ).toBe(true);
    assertExactFiles(result);
    for (const delta of [-1, 1]) {
      const forged = structuredClone(result);
      forged.selectedFileCount += delta;
      expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
    }
    const canonical = result.entries.find(entry => entry.manifestValidity === 'unsupported')!;
    expect(canonical.canonical).toEqual({
      presence: 'present-unverified',
      byteLength: 9,
      declaredFileRole: null,
    });
    const forged = structuredClone(result);
    const item = forged.entries.find(entry => entry.manifestValidity === 'unsupported')!;
    item.associatedFileCount = 1;
    forged.selectedFileCount -= 3;
    expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
  });

  it.each(['artifact', 'asset'] as const)(
    'counts canonical overlapping a declared %s only once',
    async role => {
      const value = manifest({ provider: 'generic-provider' });
      if (role === 'artifact') value.artifacts[0].relativePath = 'canonical/liska-thread-1.json';
      else value.assets[0].relativePath = 'canonical/liska-thread-1.json';
      const part = selection('a', value);
      part.files[role === 'artifact' ? 1 : 2].relativePath = 'a/canonical/liska-thread-1.json';
      const result = await buildSnapshotCatalog(input(part));
      expect(result.entries[0]).toMatchObject({
        manifestValidity: 'valid',
        associatedFileCount: 3,
        extraFileCount: 0,
        canonical: {
          presence: 'present-unverified',
          byteLength: role === 'artifact' ? 4 : 5,
          declaredFileRole: role,
        },
      });
      assertExactFiles(result);
      const forged = structuredClone(result);
      forged.entries[0].canonical.declaredFileRole = null;
      expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
      const missing = {
        ...part,
        files: part.files.filter(
          file => !file.relativePath.endsWith('/canonical/liska-thread-1.json')
        ),
      };
      const absent = await buildSnapshotCatalog(input(missing));
      expect(absent.entries[0]).toMatchObject({
        manifestValidity: 'valid',
        associatedFileCount: 2,
        canonical: { presence: 'absent', byteLength: null, declaredFileRole: role },
      });
      assertExactFiles(absent);
    }
  );

  it('rejects a singleton mismatch whose declared and present byte lengths are equal', async () => {
    const result = await buildSnapshotCatalog(input(selection('a')));
    const forged = structuredClone(result);
    forged.entries[0].artifacts!.sizeMatchCount = 0;
    forged.entries[0].artifacts!.sizeMismatchCount = 1;
    forged.entries[0].issueCodes = ['artifact-size-mismatch'];
    expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
  });

  it('rejects an equal-total single mismatch even when another declared file matches', async () => {
    const value = manifest({ assets: [] });
    value.artifacts.push({
      ...value.artifacts[0],
      id: 'raw-2',
      relativePath: 'responses/second.json',
      byteLength: 6,
    });
    const part = selection('a', value);
    part.files.pop();
    part.files.push({ relativePath: 'a/responses/second.json', byteLength: 6 });
    const result = await buildSnapshotCatalog(input(part));
    const forged = structuredClone(result);
    forged.entries[0].artifacts!.sizeMatchCount = 1;
    forged.entries[0].artifacts!.sizeMismatchCount = 1;
    forged.entries[0].issueCodes = ['artifact-size-mismatch'];
    expect(forged.entries[0].artifacts).toMatchObject({
      count: 2,
      missingCount: 0,
      declaredBytes: 10,
      presentBytes: 10,
    });
    expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
  });

  it('accepts an equal-total single mismatch offset by a missing declared file', async () => {
    const value = manifest({ assets: [] });
    value.artifacts.push({
      ...value.artifacts[0],
      id: 'raw-2',
      relativePath: 'responses/second.json',
      byteLength: 6,
    });
    const part = selection('a', value);
    part.files.pop();
    part.files[1].byteLength = 10;
    const result = await buildSnapshotCatalog(input(part));
    expect(result.entries[0].artifacts).toMatchObject({
      count: 2,
      presentCount: 1,
      missingCount: 1,
      declaredBytes: 10,
      presentBytes: 10,
      sizeMatchCount: 0,
      sizeMismatchCount: 1,
    });
    assertExactFiles(result);
  });

  it('rejects zero-mismatch matched-plus-missing aggregates with present bytes exceeding declared bytes', async () => {
    const value = manifest({ assets: [] });
    value.artifacts.push({
      ...value.artifacts[0],
      id: 'raw-2',
      relativePath: 'responses/second.json',
      byteLength: 6,
    });
    const part = selection('a', value);
    part.files.pop();
    const result = await buildSnapshotCatalog(input(part));
    expect(result.entries[0].artifacts).toMatchObject({
      count: 2,
      presentCount: 1,
      missingCount: 1,
      declaredBytes: 10,
      presentBytes: 4,
      sizeMatchCount: 1,
      sizeMismatchCount: 0,
    });
    assertExactFiles(result);
    const forged = structuredClone(result);
    forged.entries[0].artifacts!.declaredBytes = 3;
    expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
  });

  it('requires enough aggregate size budget for every mismatch without overflowing safe integers', async () => {
    const value = manifest({ assets: [] });
    value.artifacts[0].byteLength = 0;
    value.artifacts.push({
      ...value.artifacts[0],
      id: 'raw-2',
      relativePath: 'responses/second.json',
      byteLength: 1,
    });
    const part = selection('a', value);
    part.files.pop();
    part.files[1].byteLength = 1;
    part.files.push({ relativePath: 'a/responses/second.json', byteLength: 0 });
    const result = await buildSnapshotCatalog(input(part));
    expect(result.entries[0].artifacts).toMatchObject({
      count: 2,
      declaredBytes: 1,
      presentBytes: 1,
      sizeMismatchCount: 2,
    });
    assertExactFiles(result);
    for (const presentBytes of [0, 1]) {
      const forged = structuredClone(result);
      forged.entries[0].artifacts!.declaredBytes = 0;
      forged.entries[0].artifacts!.presentBytes = presentBytes;
      expect(() => encodeSnapshotCatalog(forged)).toThrow(SnapshotCatalogError);
    }
    // A feasible aggregate need not have an exactly representable combined sum.
    const large = structuredClone(result);
    large.entries[0].artifacts!.declaredBytes = Number.MAX_SAFE_INTEGER;
    large.entries[0].artifacts!.presentBytes = Number.MAX_SAFE_INTEGER;
    expect(() => encodeSnapshotCatalog(large)).not.toThrow();
  });

  it('accepts multiple genuine size mismatches whose byte differences offset in aggregate', async () => {
    const value = manifest({ assets: [] });
    value.artifacts.push({
      ...value.artifacts[0],
      id: 'raw-2',
      relativePath: 'responses/second.json',
      byteLength: 6,
    });
    const part = selection('a', value);
    part.files.pop();
    part.files[1].byteLength = 5;
    part.files.push({ relativePath: 'a/responses/second.json', byteLength: 5 });
    const result = await buildSnapshotCatalog(input(part));
    expect(result.entries[0].artifacts).toMatchObject({
      count: 2,
      declaredBytes: 10,
      presentBytes: 10,
      sizeMatchCount: 0,
      sizeMismatchCount: 2,
    });
    assertExactFiles(result);
  });
});
