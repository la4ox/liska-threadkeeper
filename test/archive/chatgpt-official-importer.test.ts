import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatGptOfficialImportError,
  importChatGptOfficialConversation,
  importChatGptOfficialConversationSources,
} from '../../src/archive/importers/chatgpt-official';
import { validateLiskaThreadArchive } from '../../src/archive/validate';

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function officialConversation(id = 'official-chat-1') {
  return {
    id,
    conversation_id: id,
    title: 'Synthetic official conversation',
    create_time: 1_700_000_000,
    update_time: 1_700_000_100,
    current_node: 'assistant-current',
    mapping: {
      'root-placeholder': { id: 'root-placeholder', message: null, parent: null },
      'user-one': {
        id: 'user-one',
        parent: 'root-placeholder',
        message: {
          id: 'user-one',
          author: { role: 'user', name: null },
          content: { content_type: 'text', parts: ['Synthetic question'] },
          create_time: 1_700_000_001,
        },
      },
      'assistant-current': {
        id: 'assistant-current',
        parent: 'user-one',
        message: {
          id: 'assistant-current',
          author: { role: 'assistant', name: null },
          content: { content_type: 'reasoning_recap', content: 'Synthetic recap' },
          create_time: 1_700_000_002,
          metadata: {
            model_slug: 'synthetic-model',
            attachments: [
              {
                id: 'synthetic-file-id',
                name: 'synthetic-notes.txt',
                mime_type: 'text/plain',
                size: 12,
              },
            ],
          },
        },
      },
      'assistant-alternate': {
        id: 'assistant-alternate',
        parent: 'user-one',
        message: {
          id: 'assistant-alternate',
          author: { role: 'assistant', name: null },
          content: { content_type: 'official_future_type', payload: { retained: true } },
          create_time: 1_700_000_003,
          metadata: {},
        },
      },
    },
    default_model_slug: 'synthetic-model',
    conversation_template_id: null,
    voice: null,
    is_archived: false,
    is_study_mode: false,
    is_do_not_remember: null,
    is_read_only: null,
    is_starred: null,
    pinned_time: null,
    plugin_ids: null,
    memory_scope: 'global_enabled',
  };
}

function batch(selected = officialConversation()): Uint8Array {
  return encoder.encode(
    JSON.stringify(
      [
        {
          ...officialConversation('unrelated-neighbor'),
          title: 'UNRELATED_SENTINEL',
        },
        selected,
      ],
      null,
      2
    )
  );
}

async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    yield bytes.slice(offset, Math.min(bytes.byteLength, offset + size));
  }
}

function input(bytes = batch(), chunkSize = 37) {
  return {
    chunks: chunked(bytes, chunkSize),
    conversationId: 'official-chat-1',
    captureId: 'capture-chatgpt-official-0001',
    importedAt: '2026-10-25T00:00:00.000Z',
    sha256,
  };
}

function decode(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<
    string,
    unknown
  >;
}

function decodePointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  return pointer
    .slice(1)
    .split('/')
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((value, segment) => {
      if (Array.isArray(value)) return value[Number(segment)];
      if (typeof value === 'object' && value !== null) {
        return (value as Record<string, unknown>)[segment];
      }
      return undefined;
    }, root);
}

function collectSourceRefs(
  value: unknown
): Array<{ artifactId: string | null; rawPointer: string | null }> {
  const refs: Array<{ artifactId: string | null; rawPointer: string | null }> = [];
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate !== 'object' || candidate === null || seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const record = candidate as Record<string, unknown>;
    if (Array.isArray(record.sourceRefs)) {
      for (const sourceRef of record.sourceRefs) {
        if (typeof sourceRef === 'object' && sourceRef !== null) {
          const ref = sourceRef as Record<string, unknown>;
          refs.push({
            artifactId: typeof ref.artifactId === 'string' ? ref.artifactId : null,
            rawPointer: typeof ref.rawPointer === 'string' ? ref.rawPointer : null,
          });
        }
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return refs;
}

describe('ChatGPT official export importer', () => {
  it('retains one exact excerpt and normalizes a parent-only branched graph', async () => {
    const bytes = batch();
    const result = await importChatGptOfficialConversation(input(bytes));

    expect(result.status).toBe('normalized');
    if (result.status !== 'normalized') return;
    expect(result.selection.conversationIndex).toBe(1);
    expect(result.selection.sourcePointer).toBe('/1');
    expect(result.selection.sourceByteLength).toBe(bytes.byteLength);
    expect(new TextDecoder().decode(result.selection.bytes)).not.toContain('UNRELATED_SENTINEL');
    expect(decode(result.selection.bytes).id).toBe('official-chat-1');
    expect(result.bundle.manifest).toMatchObject({
      method: 'official-export',
      conversationId: 'official-chat-1',
      completeness: {
        graph: 'complete',
        messages: 'complete',
        branches: 'complete',
        assets: 'not-attempted',
      },
      observedUnknownContentTypes: ['official_future_type'],
    });
    expect(result.bundle.manifest.artifacts[0]).toMatchObject({
      id: 'official-conversation',
      source: {
        kind: 'official-export-slice',
        fileRole: 'conversations',
        conversationIndex: 1,
        byteStart: result.selection.byteStart,
        sourceByteLength: bytes.byteLength,
      },
    });
    expect(result.bundle.manifest.artifacts[0]).not.toHaveProperty('endpoint');
    expect(result.bundle.manifest.assets).toHaveLength(1);
    expect(result.bundle.manifest.assets[0]).toMatchObject({
      state: 'not-attempted',
      mediaType: 'text/plain',
      byteLength: null,
      relativePath: null,
    });
    expect(validateLiskaThreadArchive(result.archive)).toEqual({ valid: true, issues: [] });
    expect(result.archive.inputs[0]).toMatchObject({
      normalizer: 'chatgpt-official/1',
      extensions: {
        openai: {
          rawArtifactId: 'official-conversation',
          envelope: 'root',
          officialExport: { conversationIndex: 1 },
        },
      },
    });
    expect(result.archive.graph.nodes['root-placeholder'].childIds).toEqual(['user-one']);
    expect(result.archive.graph.nodes['user-one'].childIds).toEqual([
      'assistant-current',
      'assistant-alternate',
    ]);
    expect(result.archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'official-export-children-derived' }),
        expect.objectContaining({ code: 'capture-assets-not-attempted' }),
        expect.objectContaining({ code: 'unknown-content-type' }),
      ])
    );
  });

  it('keeps every canonical raw pointer relative to the retained excerpt', async () => {
    const result = await importChatGptOfficialConversation(input());
    expect(result.status).toBe('normalized');
    if (result.status !== 'normalized') return;
    const raw = decode(result.selection.bytes);
    const refs = collectSourceRefs(result.archive).filter(ref => ref.rawPointer !== null);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.artifactId).toBe('official-conversation');
      expect(decodePointer(raw, ref.rawPointer!)).not.toBeUndefined();
      expect(ref.rawPointer).not.toMatch(/^\/1(?:\/|$)/);
    }
  });

  it('is deterministic across different source chunking', async () => {
    const bytes = batch();
    const first = await importChatGptOfficialConversation(input(bytes, 1));
    const second = await importChatGptOfficialConversation(input(bytes, 257));

    expect(first.status).toBe('normalized');
    expect(second.status).toBe('normalized');
    expect(first.selection.bytes).toEqual(second.selection.bytes);
    expect(first.bundle.manifest).toEqual(second.bundle.manifest);
    expect(first.manifestSha256).toBe(second.manifestSha256);
    if (first.status === 'normalized' && second.status === 'normalized') {
      expect(first.archive).toEqual(second.archive);
    }
  });

  it('retains an official-export forest without inventing a single root', async () => {
    const forest = officialConversation();
    forest.mapping['second-root'] = { id: 'second-root', parent: null, message: null };
    forest.mapping['second-root-message'] = {
      id: 'second-root-message',
      parent: 'second-root',
      message: {
        id: 'second-root-message',
        author: { role: 'assistant', name: null },
        content: { content_type: 'text', parts: ['Synthetic detached root'] },
        create_time: 1_700_000_004,
        metadata: {},
      },
    };

    const result = await importChatGptOfficialConversation(input(batch(forest)));

    expect(result.status).toBe('normalized');
    if (result.status !== 'normalized') return;
    expect(result.archive.graph.rootIds).toEqual(['root-placeholder', 'second-root']);
    expect(result.archive.graph.nodes['second-root'].childIds).toEqual(['second-root-message']);
  });

  it('preserves a verified raw-only bundle when canonical normalization refuses the graph', async () => {
    const malformed = officialConversation();
    delete (malformed.mapping['assistant-current'] as { parent?: string }).parent;

    const result = await importChatGptOfficialConversation(input(batch(malformed)));

    expect(result).toMatchObject({
      status: 'raw-only',
      failureCode: 'malformed-node-links',
      bundle: {
        manifest: {
          completeness: { graph: 'unknown', messages: 'unknown', branches: 'unknown' },
          warnings: expect.arrayContaining([
            expect.stringContaining('canonical normalization failed'),
          ]),
        },
      },
    });
    expect(result.bundle.manifest.method).toBe('official-export');
    expect(result.bundle.artifacts[0].bytes).toEqual(result.selection.bytes);
    expect(result).not.toHaveProperty('archive');
  });

  it('keeps the last verified conservative raw bundle when later hashing fails', async () => {
    let calls = 0;
    const result = await importChatGptOfficialConversation({
      ...input(
        batch({
          ...officialConversation(),
          mapping: { root: { id: 'root', parent: null, message: null } },
          current_node: 'root',
        })
      ),
      sha256: bytes => {
        calls += 1;
        return calls <= 3 ? sha256(bytes) : Promise.reject(new Error('late hash failure'));
      },
    });

    expect(result.status).toBe('raw-only');
    if (result.status !== 'raw-only') return;
    expect(result.bundle.manifest.completeness).toMatchObject({
      graph: 'unknown',
      messages: 'unknown',
      branches: 'unknown',
    });
    expect(result.bundle.artifacts[0].bytes).toEqual(result.selection.bytes);
    expect(result.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns a fixed import error when hashing cannot establish provenance', async () => {
    await expect(
      importChatGptOfficialConversation({
        ...input(),
        sha256: () => Promise.reject(new Error('private provider detail')),
      })
    ).rejects.toMatchObject<Partial<ChatGptOfficialImportError>>({
      name: 'ChatGptOfficialImportError',
      code: 'hash-failed',
    });
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('private provider detail');
        },
      }
    );
    await expect(
      importChatGptOfficialConversation({
        ...input(),
        sha256: () => Promise.reject(thrown),
      })
    ).rejects.toEqual(new ChatGptOfficialImportError('hash-failed'));
  });

  it('snapshots import metadata before source awaits and rejects hostile accessors', async () => {
    const getter = vi.fn(() => sha256);
    const accessor = input();
    Object.defineProperty(accessor, 'sha256', { get: getter });
    await expect(importChatGptOfficialConversation(accessor)).rejects.toEqual(
      new ChatGptOfficialImportError('invalid-import-input')
    );
    expect(getter).not.toHaveBeenCalled();

    const request = input();
    const originalBytes = encoder.encode(JSON.stringify([officialConversation()]));
    request.chunks = (async function* () {
      request.captureId = 'mutated-capture';
      request.importedAt = '2030-01-01T00:00:00.000Z';
      request.sha256 = async () => '0'.repeat(64);
      yield originalBytes;
    })();
    const result = await importChatGptOfficialConversation(request);
    expect(result.bundle.manifest.captureId).toBe('capture-chatgpt-official-0001');
    expect(result.bundle.manifest.capturedAt).toBe('2026-10-25T00:00:00.000Z');

    const thrown = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('private');
        },
      }
    );
    const hostile = new Proxy(input(), {
      getPrototypeOf() {
        throw thrown;
      },
    });
    await expect(importChatGptOfficialConversation(hostile)).rejects.toEqual(
      new ChatGptOfficialImportError('invalid-import-input')
    );
  });

  it('imports one exact shard only after every supplied shard validates', async () => {
    const consumed: number[] = [];
    const source = (shardIndex: number, values: unknown[]) => ({
      shardIndex,
      chunks: (async function* () {
        consumed.push(shardIndex);
        yield encoder.encode(JSON.stringify(values));
      })(),
    });
    const result = await importChatGptOfficialConversationSources({
      sources: [
        source(5, [{}, {}, officialConversation('last')]),
        source(0, [officialConversation('first')]),
        source(2, [officialConversation()]),
      ],
      conversationId: 'official-chat-1',
      captureId: 'capture-chatgpt-official-shards',
      importedAt: '2026-10-25T00:00:00.000Z',
      sha256,
    });
    expect(consumed).toEqual([0, 2, 5]);
    expect(result.status).toBe('normalized');
    if (result.status !== 'normalized') return;
    expect(result.selection).toMatchObject({
      shardIndex: 2,
      conversationIndex: 0,
      ignoredEmptyRecordCount: 2,
    });
    expect(result.bundle.manifest.artifacts[0].source).toMatchObject({
      kind: 'official-export-slice',
      shardIndex: 2,
      conversationIndex: 0,
      ignoredEmptyRecordCount: 2,
    });
    expect(result.bundle.manifest.warnings).toContain(
      'Official export contained 2 empty padding record(s); they were counted and ignored during identity validation.'
    );
    expect(result.archive.inputs[0].extensions).toMatchObject({
      openai: {
        officialExport: {
          shardIndex: 2,
          conversationIndex: 0,
          ignoredEmptyRecordCount: 2,
        },
      },
    });
  });

  it('creates no partial import when a later shard fails after the target', async () => {
    await expect(
      importChatGptOfficialConversationSources({
        sources: [
          {
            shardIndex: 0,
            chunks: chunked(encoder.encode(JSON.stringify([officialConversation()])), 7),
          },
          { shardIndex: 1, chunks: chunked(encoder.encode('[{"broken":}]'), 2) },
        ],
        conversationId: 'official-chat-1',
        captureId: 'capture-chatgpt-official-shards',
        importedAt: '2026-10-25T00:00:00.000Z',
        sha256,
      })
    ).rejects.toMatchObject({ code: 'invalid-json' });
  });

  it('preserves raw-only semantics and shard provenance for a selected malformed graph', async () => {
    const malformed = officialConversation();
    delete (malformed.mapping['assistant-current'] as { parent?: string }).parent;
    const result = await importChatGptOfficialConversationSources({
      sources: [
        { shardIndex: 3, chunks: chunked(encoder.encode(JSON.stringify([malformed])), 11) },
      ],
      conversationId: 'official-chat-1',
      captureId: 'capture-chatgpt-official-shards',
      importedAt: '2026-10-25T00:00:00.000Z',
      sha256,
    });
    expect(result).toMatchObject({
      status: 'raw-only',
      failureCode: 'malformed-node-links',
      selection: { shardIndex: 3 },
      bundle: { manifest: { artifacts: [{ source: { shardIndex: 3 } }] } },
    });
  });

  it('omits shard provenance from the legacy single-source manifest and canonical archive', async () => {
    const result = await importChatGptOfficialConversation(input());
    expect(result.bundle.manifest.artifacts[0].source).not.toHaveProperty('shardIndex');
    if (result.status === 'normalized') {
      expect(
        (result.archive.inputs[0].extensions.openai as Record<string, unknown>).officialExport
      ).not.toHaveProperty('shardIndex');
    }
  });
});
