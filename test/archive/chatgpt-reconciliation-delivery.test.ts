import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS,
  ChatGptReconciliationDeliveryError,
  prepareChatGptReconciliationDelivery,
  type ChatGptReconciliationDelivery,
  type ChatGptReconciliationDeliveryErrorCode,
  type PrepareChatGptReconciliationDeliveryInput,
} from '../../src/archive/reconciliation/chatgpt-delivery';
import type { LiskaThreadArchive } from '../../src/archive/types';
import { validateLiskaThreadArchiveBounded } from '../../src/archive/validate';
import fixture from '../fixtures/archive/branching-chatgpt-thread.json';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ID = 'delivery-chat-1';
const PRIVATE_TITLE = 'PRIVATE-TITLE-SENTINEL';
const PRIVATE_TEXT = 'PRIVATE-MESSAGE-SENTINEL-Лиска-♥';
const PRIVATE_NAME = 'PRIVATE-FILENAME-SENTINEL.txt';
const PRIVATE_PATH = '/PRIVATE-LOCAL-PATH-SENTINEL';

function hash(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function web(): LiskaThreadArchive {
  const value = JSON.parse(JSON.stringify(fixture)) as LiskaThreadArchive;
  value.conversation.id = ID;
  value.conversation.title = PRIVATE_TITLE;
  value.conversation.metadata = { private: PRIVATE_TEXT };
  value.assets['asset-synthetic-image'].filename = PRIVATE_NAME;
  value.assets['asset-synthetic-image'].localArtifactRef = PRIVATE_PATH;
  return value;
}

function official(id = ID) {
  return {
    id,
    conversation_id: id,
    title: PRIVATE_TITLE,
    current_node: 'assistant',
    create_time: 1_700_000_000,
    update_time: 1_700_000_100,
    mapping: {
      root: { id: 'root', parent: null, message: null },
      user: {
        id: 'user',
        parent: 'root',
        message: {
          id: 'user',
          author: { role: 'user', name: null },
          content: { content_type: 'text', parts: [PRIVATE_TEXT] },
          create_time: 1_700_000_001,
        },
      },
      assistant: {
        id: 'assistant',
        parent: 'user',
        message: {
          id: 'assistant',
          author: { role: 'assistant', name: null },
          content: { content_type: 'text', parts: ['Synthetic answer'] },
          create_time: 1_700_000_002,
          metadata: {
            attachments: [{ id: 'file-synthetic', name: PRIVATE_NAME, mime_type: 'text/plain' }],
          },
        },
      },
    },
  };
}

function officialBytes(value = official()): Uint8Array {
  return encoder.encode(JSON.stringify([official('unrelated-neighbor'), value], null, 2));
}

async function* chunks(bytes: Uint8Array, size = 37): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size)
    yield bytes.slice(offset, offset + size);
}

function input(
  canonical = encoder.encode(JSON.stringify(web(), null, 2)),
  source = officialBytes()
): PrepareChatGptReconciliationDeliveryInput {
  return {
    webCanonicalBytes: canonical,
    officialChunks: chunks(source),
    captureId: 'capture-official-delivery-1',
    importedAt: '2026-10-25T00:00:00.000Z',
    sha256: hash,
  };
}

function parseArtifact(
  result: ChatGptReconciliationDelivery,
  path: string
): Record<string, unknown> {
  const artifact = result.artifacts.find(entry => entry.relativePath === path);
  expect(artifact).toBeDefined();
  return JSON.parse(decoder.decode(artifact!.bytes));
}

async function expectError(
  request: PrepareChatGptReconciliationDeliveryInput,
  code: ChatGptReconciliationDeliveryErrorCode
): Promise<void> {
  const error = await prepareChatGptReconciliationDelivery(request).catch(value => value);
  expect(error).toBeInstanceOf(ChatGptReconciliationDeliveryError);
  expect(error.code).toBe(code);
  expect(error.message).toBe(`ChatGPT reconciliation delivery failed (${code}).`);
  expect(error.cause).toBeUndefined();
  for (const sentinel of [PRIVATE_TEXT, PRIVATE_TITLE, PRIVATE_NAME, PRIVATE_PATH])
    expect(JSON.stringify(error)).not.toContain(sentinel);
}

function expectContentFree(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of [
    PRIVATE_TEXT,
    PRIVATE_TITLE,
    PRIVATE_NAME,
    PRIVATE_PATH,
    'sourceRefs',
    'extensions',
    'rawPointer',
  ])
    expect(serialized).not.toContain(sentinel);
}

describe('prepareChatGptReconciliationDelivery', () => {
  it('prepares an ordered exact-byte bundle with capture-scoped comparison provenance', async () => {
    const request = input();
    const original = request.webCanonicalBytes.slice();
    const result = await prepareChatGptReconciliationDelivery(request);
    expect(result.status).toBe('normalized');
    expect(result.failureCode).toBeNull();
    expect(result.artifacts.map(entry => entry.relativePath)).toEqual([
      'official/conversation.json',
      'official/manifest.json',
      'official/canonical/liska-thread-1.json',
      'comparison/liska-chatgpt-comparison-1.json',
      'manifest.json',
    ]);
    for (const artifact of result.artifacts) {
      expect(artifact.mediaType).toBe('application/json');
      expect(artifact.byteLength).toBe(artifact.bytes.length);
      expect(artifact.sha256).toBe(await hash(artifact.bytes));
      expect(artifact.bytes.byteOffset).toBe(0);
      expect(artifact.bytes.buffer.byteLength).toBe(artifact.byteLength);
    }
    expect(result.bundleId).toBe(await hash(result.artifacts[4].bytes));
    expect(result.conversationKey).toBe(await hash(encoder.encode(ID)));
    expect(request.webCanonicalBytes).toEqual(original);
    expect(result.manifest.schema).toBe('liska-chatgpt-reconciliation-bundle/1');
    expect(result.manifest.artifacts.map(entry => entry.relativePath)).not.toContain(
      'manifest.json'
    );
    expect(parseArtifact(result, 'manifest.json')).toEqual(result.manifest);
    expect(result.manifest.webCanonical).toEqual({
      byteLength: original.length,
      sha256: await hash(original),
      provenanceVerification: 'canonical-declarations-only',
    });
    expect(result.manifest.official.declaredManifestSha256).toBe(result.artifacts[1].sha256);
    const raw = parseArtifact(result, 'official/conversation.json');
    expect(raw.id).toBe(ID);
    const provenance = result.manifest.official.provenance;
    expect(Array.from(result.artifacts[0].bytes)).toEqual(
      Array.from(officialBytes().subarray(provenance.byteStart, provenance.byteEndExclusive))
    );
    expect(decoder.decode(result.artifacts[0].bytes)).not.toContain('unrelated-neighbor');
    const manifest = parseArtifact(result, 'official/manifest.json');
    expect(decoder.decode(result.artifacts[1].bytes)).toBe(JSON.stringify(manifest, null, 2));
    expect(manifest.artifacts).toMatchObject([{ relativePath: 'official/conversation.json' }]);
    const envelope = parseArtifact(result, 'comparison/liska-chatgpt-comparison-1.json');
    expect(envelope.schema).toBe('liska-chatgpt-comparison-artifact/1');
    expect(envelope.comparison).toMatchObject({
      schema: 'liska-chatgpt-comparison/1',
      identity: { provider: 'chatgpt', conversationId: ID },
    });
    expect(envelope.webCanonical).toEqual(result.manifest.webCanonical);
    expect(envelope.official).toEqual(result.manifest.official);
    expectContentFree(envelope);
    expectContentFree(result.manifest);
    for (const path of [
      'official/canonical/liska-thread-1.json',
      'comparison/liska-chatgpt-comparison-1.json',
      'manifest.json',
    ]) {
      const artifact = result.artifacts.find(entry => entry.relativePath === path)!;
      expect(artifact.bytes[artifact.bytes.length - 1]).toBe(10);
    }
  });

  it('preserves raw-only exact official bytes and manifest without canonical or comparison claims', async () => {
    const broken = official();
    delete (broken.mapping.assistant as { parent?: string }).parent;
    const source = officialBytes(broken);
    const result = await prepareChatGptReconciliationDelivery(input(undefined, source));
    expect(result.status).toBe('raw-only');
    expect(result.failureCode).toBe('official-normalization-failed');
    expect(result.artifacts.map(entry => entry.relativePath)).toEqual([
      'official/conversation.json',
      'official/manifest.json',
      'manifest.json',
    ]);
    expect(parseArtifact(result, 'official/conversation.json')).toEqual(broken);
    expect(parseArtifact(result, 'official/manifest.json')).toMatchObject({
      completeness: { graph: 'unknown', messages: 'unknown', branches: 'unknown' },
    });
    expect(result.manifest.status).toBe('raw-only');
    expect(result.manifest.failureCode).toBe('official-normalization-failed');
    expectContentFree(result.manifest);
  });

  it('binds the exact web identity, not a matching title or an array ordinal', async () => {
    const sameTitleWrongId = official('different-chat');
    await expectError(input(undefined, officialBytes(sameTitleWrongId)), 'official-import-failed');
    const selected = official();
    const source = encoder.encode(
      JSON.stringify([sameTitleWrongId, selected, official('third-chat')])
    );
    const result = await prepareChatGptReconciliationDelivery(input(undefined, source));
    expect(result.manifest.official.provenance.conversationIndex).toBe(1);
    expect(parseArtifact(result, 'official/conversation.json').id).toBe(ID);
  });

  it.each(['provider', 'normalizer', 'multiple-inputs', 'nonportable-id'] as const)(
    'rejects %s before consuming the official source',
    async kind => {
      const canonical = web();
      if (kind === 'provider') canonical.conversation.provider = 'other';
      if (kind === 'normalizer') canonical.inputs[0].normalizer = 'chatgpt-official/1';
      if (kind === 'multiple-inputs')
        canonical.inputs.push({ ...canonical.inputs[0], captureId: 'second' });
      if (kind === 'nonportable-id') canonical.conversation.id = PRIVATE_PATH;
      const source = vi.fn(async function* () {
        yield officialBytes();
      });
      await expectError(
        {
          ...input(encoder.encode(JSON.stringify(canonical))),
          officialChunks: { [Symbol.asyncIterator]: source },
        },
        'web-identity-invalid'
      );
      expect(source).not.toHaveBeenCalled();
    }
  );

  it('rejects missing canonical identity and invalid canonical structure', async () => {
    const canonical = web();
    delete (canonical.conversation as Partial<LiskaThreadArchive['conversation']>).id;
    await expectError(input(encoder.encode(JSON.stringify(canonical))), 'web-archive-invalid');
    await expectError(input(encoder.encode('{}')), 'web-archive-invalid');
    await expectError(input(encoder.encode('[]')), 'web-invalid-json');
  });

  it('enforces the web byte cap before decoding or consuming the source', async () => {
    const source = vi.fn(async function* () {
      yield officialBytes();
    });
    const sha = vi.fn(hash);
    await expectError(
      {
        ...input(new Uint8Array([255])),
        officialChunks: { [Symbol.asyncIterator]: source },
        sha256: sha,
        limits: { maxWebCanonicalBytes: 0 },
      },
      'web-size-limit'
    );
    expect(source).not.toHaveBeenCalled();
    expect(sha).not.toHaveBeenCalled();
  });

  it('rejects oversized malformed archive collections before collect-all validation', async () => {
    const canonical = web();
    canonical.graph.nodes = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`node-${index}`, {}])
    ) as never;
    const source = vi.fn(async function* () {
      yield officialBytes();
    });
    const sha = vi.fn(hash);
    await expectError(
      {
        ...input(encoder.encode(JSON.stringify(canonical))),
        officialChunks: { [Symbol.asyncIterator]: source },
        sha256: sha,
        limits: { comparison: { maxNodes: 100 } },
      },
      'web-archive-limit'
    );
    expect(source).not.toHaveBeenCalled();
    expect(sha).not.toHaveBeenCalled();

    const bounded = validateLiskaThreadArchiveBounded(canonical, 1);
    expect(bounded).toMatchObject({ valid: false, truncated: true });
    expect(bounded.issues).toHaveLength(1);
  });

  it('rejects oversized input cardinality before traversing archive records', async () => {
    const canonical = web();
    canonical.inputs = Array.from({ length: 5_000 }, () => ({ ...canonical.inputs[0] }));
    const source = vi.fn(async function* () {
      yield officialBytes();
    });
    await expectError(
      {
        ...input(encoder.encode(JSON.stringify(canonical))),
        officialChunks: { [Symbol.asyncIterator]: source },
      },
      'web-identity-invalid'
    );
    expect(source).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8, UTF-8 BOM and malformed JSON with fixed errors', async () => {
    await expectError(input(new Uint8Array([255])), 'web-invalid-utf8');
    await expectError(
      input(new Uint8Array([239, 187, 191, ...encoder.encode('{}')])),
      'web-bom-not-supported'
    );
    await expectError(input(encoder.encode('{"broken":"\\uZZZZ"}')), 'web-invalid-json');
    await expectError(input(encoder.encode('{"broken":1} trailing')), 'web-invalid-json');
  });

  it.each([
    '{"schema":"first","schema":"second"}',
    '{"nested":{"title":1,"title":2}}',
    '{"nested":[{"ti\\u0074le":1,"title":2}]}',
  ])('rejects duplicate decoded keys at every nesting depth', async text => {
    await expectError(input(encoder.encode(text)), 'web-duplicate-key');
  });

  it('does not confuse value strings, quoted delimiters or repeated array values with duplicate keys', async () => {
    const canonical = web();
    canonical.conversation.metadata = { a: ['quoted } [ , : " \\ ♥', 'same', 'same'], b: { a: 1 } };
    expect(
      (await prepareChatGptReconciliationDelivery(input(encoder.encode(JSON.stringify(canonical)))))
        .status
    ).toBe('normalized');
  });

  it('validates the complete official stream and sanitizes source failures', async () => {
    const valid = decoder.decode(officialBytes());
    await expectError(
      input(undefined, encoder.encode(`${valid} trailing`)),
      'official-import-failed'
    );
    const officialChunks = (async function* () {
      yield officialBytes();
      throw new Error(PRIVATE_TEXT);
    })();
    await expectError({ ...input(), officialChunks }, 'official-import-failed');
  });

  it('measures exact final comparison-envelope bytes including Unicode and the trailing LF', async () => {
    const canonical = web();
    canonical.inputs[0].captureId = 'capture-Лиска-♥';
    const request = () => input(encoder.encode(JSON.stringify(canonical)));
    const baseline = await prepareChatGptReconciliationDelivery(request());
    const report = baseline.artifacts.find(
      entry => entry.relativePath === 'comparison/liska-chatgpt-comparison-1.json'
    )!;
    expect(
      (
        await prepareChatGptReconciliationDelivery({
          ...request(),
          limits: { maxComparisonArtifactBytes: report.byteLength },
        })
      ).artifacts
    ).toEqual(baseline.artifacts);
    await expectError(
      { ...request(), limits: { maxComparisonArtifactBytes: report.byteLength - 1 } },
      'comparison-artifact-limit'
    );
    expect(report.bytes[report.bytes.length - 1]).toBe(10);
    expect(report.byteLength).toBeGreaterThan(decoder.decode(report.bytes).length);
  });

  it('enforces exact aggregate artifact bytes and individual artifact limits', async () => {
    const baseline = await prepareChatGptReconciliationDelivery(input());
    const maximum = Math.max(...baseline.artifacts.map(entry => entry.byteLength));
    const aggregate = baseline.artifacts.reduce((sum, entry) => sum + entry.byteLength, 0);
    expect(
      (
        await prepareChatGptReconciliationDelivery({
          ...input(),
          limits: { maxArtifactBytes: maximum, maxBundleBytes: aggregate },
        })
      ).artifacts
    ).toEqual(baseline.artifacts);
    await expectError({ ...input(), limits: { maxArtifactBytes: maximum - 1 } }, 'artifact-limit');
    await expectError({ ...input(), limits: { maxBundleBytes: aggregate - 1 } }, 'bundle-limit');
  });

  it('rejects raised, unknown and non-integral limits, including nested importer/comparator ceilings', async () => {
    for (const [key, value] of Object.entries(CHATGPT_RECONCILIATION_DELIVERY_HARD_LIMITS)) {
      await expectError({ ...input(), limits: { [key]: value + 1 } }, 'invalid-limits');
      await expectError({ ...input(), limits: { [key]: -1 } }, 'invalid-limits');
      await expectError({ ...input(), limits: { [key]: 1.5 } }, 'invalid-limits');
    }
    await expectError({ ...input(), limits: { unknown: 1 } as never }, 'invalid-limits');
    await expectError(
      { ...input(), limits: { official: { maxSourceBytes: 2 ** 32 } } },
      'invalid-limits'
    );
    await expectError(
      { ...input(), limits: { comparison: { maxNodes: 50_001 } } },
      'invalid-limits'
    );
    await expectError({ ...input(), limits: { maxWebJsonDepth: 0 } }, 'web-json-limit');
    await expectError({ ...input(), limits: { maxWebJsonValues: 0 } }, 'web-json-limit');
    await expectError(
      { ...input(), limits: { official: { maxSourceBytes: 1 } } },
      'official-import-failed'
    );
    await expectError({ ...input(), limits: { comparison: { maxNodes: 0 } } }, 'web-archive-limit');
  });

  it('repeats deterministically under different official source chunking', async () => {
    const a = await prepareChatGptReconciliationDelivery(input());
    const b = await prepareChatGptReconciliationDelivery({
      ...input(),
      officialChunks: chunks(officialBytes(), 1),
    });
    expect(b).toEqual(a);
  });

  it('detaches web bytes before first await and accepts reused official chunk buffers', async () => {
    const request = input();
    const expected = await prepareChatGptReconciliationDelivery(input());
    const source = officialBytes();
    const scratch = new Uint8Array(101);
    const officialChunks = (async function* () {
      request.webCanonicalBytes.fill(0);
      for (let offset = 0; offset < source.length; offset += scratch.length) {
        const count = Math.min(scratch.length, source.length - offset);
        scratch.fill(0);
        scratch.set(source.subarray(offset, offset + count));
        yield scratch.subarray(0, count);
      }
      scratch.fill(0);
    })();
    expect(await prepareChatGptReconciliationDelivery({ ...request, officialChunks })).toEqual(
      expected
    );
  });

  it('keeps exact input byte receipts distinct from reserialized JSON', async () => {
    const canonical = web();
    const compact = encoder.encode(JSON.stringify(canonical));
    const pretty = encoder.encode(`${JSON.stringify(canonical, null, 2)}\n`);
    const a = await prepareChatGptReconciliationDelivery(input(compact));
    const b = await prepareChatGptReconciliationDelivery(input(pretty));
    expect(a.manifest.webCanonical.sha256).toBe(await hash(compact));
    expect(b.manifest.webCanonical.sha256).toBe(await hash(pretty));
    expect(a.manifest.webCanonical.sha256).not.toBe(b.manifest.webCanonical.sha256);
  });

  it('rejects malformed, throwing and mutating hash callbacks without leaking or changing source bytes', async () => {
    for (const digest of ['A'.repeat(64), 'a'.repeat(63), PRIVATE_TEXT, null])
      await expectError({ ...input(), sha256: async () => digest as string }, 'hash-invalid');
    await expectError(
      {
        ...input(),
        sha256: async () => {
          throw new Error(PRIVATE_TEXT);
        },
      },
      'hash-failed'
    );
    const request = input();
    const original = request.webCanonicalBytes.slice();
    await expectError(
      {
        ...request,
        sha256: async bytes => {
          const digest = await hash(bytes);
          bytes[0] ^= 1;
          return digest;
        },
      },
      'hash-mutated'
    );
    expect(request.webCanonicalBytes).toEqual(original);
  });

  it('does not silently downgrade a late hash failure to raw-only success', async () => {
    let calls = 0;
    await expectError(
      {
        ...input(),
        sha256: bytes => {
          calls += 1;
          return calls < 5 ? hash(bytes) : Promise.reject(new Error(PRIVATE_TEXT));
        },
      },
      'hash-failed'
    );
  });

  it.each([
    { captureId: '../bad' },
    { captureId: '' },
    { importedAt: 'yesterday' },
    { importedAt: '2026-02-30T00:00:00.000Z' },
    { sha256: null },
    { officialChunks: null },
  ])('rejects invalid runtime metadata without source values', async patch => {
    await expectError({ ...input(), ...patch } as never, 'invalid-input');
  });

  it('sanitizes hostile thrown Proxy values without inspecting their prototype', async () => {
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(PRIVATE_TEXT);
        },
      }
    );
    const request = new Proxy(input(), {
      getPrototypeOf() {
        throw thrown;
      },
    });
    await expectError(request, 'invalid-input');
  });
});
