import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  type RawCaptureBundle,
  type RawCaptureManifest,
} from '../../src/archive/capture';
import {
  ChatGptNormalizationError,
  normalizeChatGptCapture,
  type ChatGptNormalizationInput,
} from '../../src/archive/normalizers/chatgpt';
import { manifestAssetsById, upsertAsset } from '../../src/archive/normalizers/chatgpt/assets';
import type { AssetContext } from '../../src/archive/normalizers/chatgpt/contracts';
import {
  nullableAliasedString,
  nullableString,
  normalizeTimestamp,
  optionalTimestamp,
  redactSensitiveUrls,
  sanitizedCitationUrl,
  sanitizeJson,
  sourceRef,
  type PrivacyTracker,
} from '../../src/archive/normalizers/chatgpt/privacy';

type RawRecord = Record<string, unknown>;

const encoder = new TextEncoder();

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function rawWithParts(parts: unknown[] = ['synthetic text']): RawRecord {
  return {
    conversation_id: 'coverage-conversation',
    title: 'Synthetic coverage conversation',
    create_time: 1_786_963_200,
    update_time: 1_786_963_260,
    current_node: 'node/root',
    mapping: {
      'node/root': {
        id: 'node/root',
        parent: null,
        children: [],
        message: {
          id: 'message/root',
          author: { role: 'assistant', name: null },
          recipient: null,
          channel: null,
          create_time: 1_786_963_220,
          content: { content_type: 'text', parts },
          metadata: {},
        },
      },
    },
  };
}

function rootNode(raw: RawRecord): RawRecord {
  return (raw.mapping as Record<string, RawRecord>)['node/root'];
}

function rootMessage(raw: RawRecord): RawRecord {
  return rootNode(raw).message as RawRecord;
}

function rootContent(raw: RawRecord): RawRecord {
  return rootMessage(raw).content as RawRecord;
}

function rawBytes(raw: RawRecord): Uint8Array {
  return encoder.encode(JSON.stringify(raw));
}

function manifestFor(
  bytes: Uint8Array,
  options: {
    assets?: RawCaptureManifest['assets'];
    mediaType?: string;
  } = {}
): RawCaptureManifest {
  return buildCaptureManifest({
    captureId: 'coverage-capture',
    provider: 'chatgpt',
    conversationId: 'coverage-conversation',
    capturedAt: '2026-08-17T12:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: options.mediaType ?? 'application/json',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        endpoint: { method: 'GET', pathPattern: '/backend-api/conversation/{conversationId}' },
      },
    ],
    assets: options.assets ?? [],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'complete',
    },
  });
}

function bundleFor(bytes: Uint8Array, manifest: RawCaptureManifest): RawCaptureBundle {
  return { manifest, artifacts: [{ record: manifest.artifacts[0], bytes }] };
}

async function normalizeRaw(
  raw: RawRecord,
  options: {
    manifest?: RawCaptureManifest;
    manifestSha256?: string;
    sha?: ChatGptNormalizationInput['sha256'];
    sourceFormat?: string;
  } = {}
) {
  const bytes = rawBytes(raw);
  const manifest = options.manifest ?? manifestFor(bytes);
  return normalizeChatGptCapture({
    bundle: bundleFor(bytes, manifest),
    artifactId: 'conversation',
    manifestSha256:
      options.manifestSha256 ?? (await sha256(encoder.encode(JSON.stringify(manifest, null, 2)))),
    sha256: options.sha ?? sha256,
    sourceFormat: options.sourceFormat,
  });
}

async function errorCode(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ChatGptNormalizationError);
    return (error as ChatGptNormalizationError).code;
  }
  throw new Error('Expected ChatGPT normalization to fail.');
}

describe('ChatGPT normalizer coverage contracts', () => {
  it('normalizes nested conversation envelopes and compatible graph aliases', async () => {
    const conversation = rawWithParts(['nested synthetic text']);
    conversation.id = 'coverage-conversation';
    conversation.currentNodeId = 'node/root';
    delete conversation.create_time;
    delete conversation.update_time;
    conversation.created_at = '2026-08-17T12:00:00+00:00';
    conversation.updatedAt = '2026-08-17T12:01:00Z';
    const { archive } = await normalizeRaw({ conversation });

    expect(archive.conversation).toMatchObject({
      id: 'coverage-conversation',
      createdAt: '2026-08-17T12:00:00.000Z',
      updatedAt: '2026-08-17T12:01:00.000Z',
      currentNodeId: 'node/root',
    });
    expect(archive.inputs[0].extensions).toMatchObject({ openai: { envelope: 'conversation' } });
    expect(archive.graph.nodes['node/root'].sourceRefs[0].rawPointer).toBe(
      '/conversation/mapping/node~1root'
    );
  });

  it('represents markdown, HTML, provider aliases, and typed payloads without flattening them', async () => {
    const raw = rawWithParts([
      { content_type: 'markdown', text: '**synthetic markdown**' },
      { content_type: 'html', html: '<strong>synthetic HTML</strong>' },
      { content_type: 'reasoning', thoughts: 'synthetic reasoning' },
      { content_type: 'tool_use', calls: [{ recipient: 'calculator', input: { value: 2 } }] },
      { content_type: 'tool_response', results: [{ tool_name: 'calculator', output: 4 }] },
      { content_type: 'execution_result', result: { stdout: '4' } },
      {
        content_type: 'citation',
        citations: [
          { name: 'Synthetic source', link: 'https://example.invalid/source', text: 'Four.' },
        ],
      },
      { content_type: 'canvas_update', revision: 1, operation: 'replace' },
      { content_type: 'model_error', text: 'Synthetic recoverable error', code: 'retryable' },
      { content_type: 'model_error', error: { message: 'Nested synthetic error' } },
      { content_type: 'model_error' },
    ]);
    const { archive } = await normalizeRaw(raw);
    const blocks = archive.graph.nodes['node/root'].message!.blocks;

    expect(blocks.map(block => block.type)).toEqual([
      'markdown',
      'html',
      'reasoning',
      'tool_call',
      'tool_result',
      'execution_output',
      'citation',
      'canvas_event',
      'error',
      'error',
      'error',
    ]);
    expect(blocks[0]).toMatchObject({ markdown: '**synthetic markdown**' });
    expect(blocks[1]).toMatchObject({ html: '<strong>synthetic HTML</strong>' });
    expect(blocks[3]).toMatchObject({ toolName: 'calculator', arguments: { value: 2 } });
    expect(blocks[4]).toMatchObject({ toolName: 'calculator', result: 4 });
    expect(blocks[6]).toMatchObject({
      label: 'Synthetic source',
      url: 'https://example.invalid/source',
    });
  });

  it('fails closed for malformed graph envelopes and conversation identifiers', async () => {
    const cases: Array<[string, (raw: RawRecord) => void, string]> = [
      ['missing graph', (raw: RawRecord) => delete raw.mapping, 'missing-graph'],
      [
        'two graph envelopes',
        (raw: RawRecord) => {
          raw.conversation = rawWithParts();
        },
        'ambiguous-envelope',
      ],
      [
        'missing conversation ID',
        (raw: RawRecord) => delete raw.conversation_id,
        'missing-conversation-id',
      ],
      [
        'disagreeing conversation IDs',
        (raw: RawRecord) => {
          raw.id = 'other-conversation';
        },
        'ambiguous-conversation-id',
      ],
      [
        'manifest conversation mismatch',
        (raw: RawRecord) => {
          raw.conversation_id = 'another-conversation';
        },
        'conversation-id-mismatch',
      ],
    ];
    for (const [, change, expected] of cases) {
      const raw = rawWithParts();
      change(raw);
      await expect(errorCode(() => normalizeRaw(raw))).resolves.toBe(expected);
    }
  });

  it('rejects malformed graph aliases and links with stable errors', async () => {
    const cases: Array<[string, (raw: RawRecord) => void, string]> = [
      [
        'missing current-node alias',
        (raw: RawRecord) => delete raw.current_node,
        'missing-current-node',
      ],
      [
        'disagreeing current-node aliases',
        (raw: RawRecord) => {
          raw.currentNodeId = 'node/other';
        },
        'ambiguous-current-node',
      ],
      [
        'mapping key that differs from node ID',
        (raw: RawRecord) => {
          rootNode(raw).id = 'node/other';
        },
        'node-id-mismatch',
      ],
      [
        'dangling parent link',
        (raw: RawRecord) => {
          rootNode(raw).parent = 'node/missing';
        },
        'parent-missing',
      ],
      [
        'duplicate child link',
        (raw: RawRecord) => {
          rootNode(raw).children = ['node/root', 'node/root'];
        },
        'duplicate-child',
      ],
      [
        'cycle in otherwise symmetric links',
        (raw: RawRecord) => {
          rootNode(raw).parent = 'node/root';
          rootNode(raw).children = ['node/root'];
        },
        'graph-cycle',
      ],
      [
        'node missing a link field',
        (raw: RawRecord) => {
          delete rootNode(raw).children;
        },
        'malformed-node-links',
      ],
      [
        'parent that omits a child',
        (raw: RawRecord) => {
          const mapping = raw.mapping as Record<string, RawRecord>;
          mapping['node/child'] = {
            id: 'node/child',
            parent: 'node/root',
            children: [],
            message: null,
          };
        },
        'parent-child-asymmetry',
      ],
      [
        'child that omits its parent',
        (raw: RawRecord) => {
          const mapping = raw.mapping as Record<string, RawRecord>;
          rootNode(raw).children = ['node/child'];
          mapping['node/child'] = { id: 'node/child', parent: null, children: [], message: null };
        },
        'child-parent-asymmetry',
      ],
    ];
    for (const [, change, expected] of cases) {
      const raw = rawWithParts();
      change(raw);
      await expect(errorCode(() => normalizeRaw(raw))).resolves.toBe(expected);
    }
  });

  it('keeps malformed payloads out of the archive with stable errors', async () => {
    const cases: Array<[string, (raw: RawRecord) => void, string]> = [
      [
        'missing text payload',
        (raw: RawRecord) => {
          rootMessage(raw).content = { content_type: 'text' };
        },
        'malformed-content',
      ],
      [
        'non-array text parts',
        (raw: RawRecord) => {
          rootContent(raw).parts = 'not-an-array';
        },
        'malformed-content-parts',
      ],
      [
        'missing markdown value',
        (raw: RawRecord) => {
          rootMessage(raw).content = { content_type: 'markdown' };
        },
        'malformed-content',
      ],
      [
        'empty content type',
        (raw: RawRecord) => {
          rootContent(raw).content_type = '';
        },
        'invalid-content-type',
      ],
      [
        'non-array tool calls',
        (raw: RawRecord) => {
          rootMessage(raw).content = { content_type: 'tool_calls', tool_calls: {} };
        },
        'malformed-tool-call',
      ],
      [
        'non-array citations',
        (raw: RawRecord) => {
          rootMessage(raw).content = { content_type: 'citations', citations: 'not-an-array' };
        },
        'malformed-citation',
      ],
      [
        'one-sided dimensions',
        (raw: RawRecord) => {
          rootMessage(raw).content = { content_type: 'image', file_id: 'image-1', width: 100 };
        },
        'malformed-attachment',
      ],
      [
        'non-record nested error',
        (raw: RawRecord) => {
          rootMessage(raw).content = { content_type: 'error', error: 'not-an-object' };
        },
        'malformed-error',
      ],
      [
        'negative byte length',
        (raw: RawRecord) => {
          rootMessage(raw).content = { content_type: 'file', file_id: 'file-1', size: -1 };
        },
        'malformed-attachment',
      ],
      [
        'nested typed container without a block to retain its residual',
        (raw: RawRecord) => {
          rootContent(raw).parts = [
            { content_type: 'tool_calls', tool_calls: [], residual: 'must-not-be-lost' },
          ];
        },
        'invalid-output',
      ],
    ];
    for (const [, change, expected] of cases) {
      const raw = rawWithParts();
      change(raw);
      await expect(errorCode(() => normalizeRaw(raw))).resolves.toBe(expected);
    }
  });

  it('fails closed on invalid provenance inputs before parsing raw bytes', async () => {
    const raw = rawWithParts();
    const bytes = rawBytes(raw);
    const manifest = manifestFor(bytes);
    const manifestHash = await sha256(encoder.encode(JSON.stringify(manifest, null, 2)));
    const normalInput = {
      bundle: bundleFor(bytes, manifest),
      artifactId: 'conversation',
      manifestSha256: manifestHash,
      sha256,
    };

    await expect(
      errorCode(() => normalizeChatGptCapture(null as unknown as ChatGptNormalizationInput))
    ).resolves.toBe('invalid-manifest');
    await expect(
      errorCode(() => normalizeChatGptCapture({ ...normalInput, manifestSha256: 'not-a-sha256' }))
    ).resolves.toBe('invalid-manifest-hash');
    await expect(
      errorCode(() => normalizeChatGptCapture({ ...normalInput, artifactId: 'missing-artifact' }))
    ).resolves.toBe('artifact-not-in-manifest');
    await expect(
      errorCode(() => normalizeChatGptCapture({ ...normalInput, sha256: undefined as never }))
    ).resolves.toBe('invalid-manifest');
    await expect(
      errorCode(() =>
        normalizeChatGptCapture({
          ...normalInput,
          sha256: () => Promise.reject(new Error('synthetic hash failure')),
        })
      )
    ).resolves.toBe('manifest-integrity-failed');
  });

  it('converts unexpected runtime input failures into the public invalid-manifest error', async () => {
    const raw = rawWithParts();
    const bytes = rawBytes(raw);
    const manifest = manifestFor(bytes);
    const input = {
      bundle: bundleFor(bytes, manifest),
      artifactId: 'conversation',
      manifestSha256: await sha256(encoder.encode(JSON.stringify(manifest, null, 2))),
      sha256,
    };
    Object.defineProperty(input, 'sourceFormat', {
      enumerable: true,
      get: () => {
        throw new Error('synthetic runtime getter failure');
      },
    });

    await expect(
      errorCode(() => normalizeChatGptCapture(input as ChatGptNormalizationInput))
    ).resolves.toBe('invalid-manifest');
  });

  it('rejects non-JSON artifact declarations and invalid source-format declarations', async () => {
    const raw = rawWithParts();
    const bytes = rawBytes(raw);
    await expect(
      errorCode(() =>
        normalizeRaw(raw, { manifest: manifestFor(bytes, { mediaType: 'text/plain' }) })
      )
    ).resolves.toBe('invalid-manifest');
    await expect(errorCode(() => normalizeRaw(raw, { sourceFormat: '' }))).resolves.toBe(
      'invalid-source-format'
    );

    const wrongProvider = manifestFor(bytes);
    wrongProvider.provider = 'another-provider';
    await expect(errorCode(() => normalizeRaw(raw, { manifest: wrongProvider }))).resolves.toBe(
      'invalid-manifest'
    );

    const nonCanonical = manifestFor(bytes);
    nonCanonical.artifacts[0].relativePath = 'responses\\conversation.json';
    await expect(errorCode(() => normalizeRaw(raw, { manifest: nonCanonical }))).resolves.toBe(
      'invalid-manifest'
    );
  });

  it('maps direct singular tool payloads without retaining their typed fields as residual metadata', async () => {
    const directCall = rawWithParts();
    rootMessage(directCall).content = {
      content_type: 'tool_call',
      name: 'calculator',
      arguments: { expression: '2 + 2' },
      residual: 'call-residual',
    };
    const directResult = rawWithParts();
    rootMessage(directResult).content = {
      content_type: 'tool_result',
      tool_name: 'calculator',
      result: { value: 4 },
      residual: 'result-residual',
    };

    const callArchive = (await normalizeRaw(directCall)).archive;
    const resultArchive = (await normalizeRaw(directResult)).archive;

    expect(callArchive.graph.nodes['node/root'].message?.blocks).toMatchObject([
      { type: 'tool_call', toolName: 'calculator', arguments: { expression: '2 + 2' } },
    ]);
    expect(resultArchive.graph.nodes['node/root'].message?.blocks).toMatchObject([
      { type: 'tool_result', toolName: 'calculator', result: { value: 4 } },
    ]);
    expect(callArchive.graph.nodes['node/root'].message?.extensions).toMatchObject({
      openai: { contentMetadata: {} },
    });
    expect(resultArchive.graph.nodes['node/root'].message?.extensions).toMatchObject({
      openai: { contentMetadata: {} },
    });
  });

  it('makes manifest asset evidence authoritative for MIME type and SHA-256', async () => {
    const cases: Array<[string, RawRecord]> = [
      [
        'MIME type',
        {
          content_type: 'file',
          file_id: 'asset-evidence',
          filename: 'synthetic.txt',
          mime_type: 'application/json',
        },
      ],
      [
        'SHA-256',
        {
          content_type: 'file',
          file_id: 'asset-evidence',
          filename: 'synthetic.txt',
          sha256: 'a'.repeat(64),
        },
      ],
    ];
    for (const [, attachment] of cases) {
      const raw = rawWithParts([attachment]);
      const bytes = rawBytes(raw);
      const manifest = manifestFor(bytes, {
        assets: [
          {
            id: 'asset-evidence',
            state: 'fetched',
            relativePath: 'assets/evidence.bin',
            mediaType: 'text/plain',
            byteLength: 4,
            sha256: 'b'.repeat(64),
            detail: null,
          },
        ],
      });
      await expect(errorCode(() => normalizeRaw(raw, { manifest }))).resolves.toBe(
        'asset-manifest-conflict'
      );
    }
  });

  it('rejects repeated assets that disagree about dimensions, names, or metadata', async () => {
    const cases: Array<[string, RawRecord[]]> = [
      [
        'dimensions',
        [
          { content_type: 'image', file_id: 'repeated', width: 4, height: 4 },
          { content_type: 'image', file_id: 'repeated', width: 8, height: 4 },
        ],
      ],
      [
        'filename',
        [
          { content_type: 'file', file_id: 'repeated', filename: 'first.txt' },
          { content_type: 'file', file_id: 'repeated', filename: 'second.txt' },
        ],
      ],
      [
        'provider metadata',
        [
          { content_type: 'file', file_id: 'repeated', purpose: 'first' },
          { content_type: 'file', file_id: 'repeated', purpose: 'second' },
        ],
      ],
    ];
    for (const [, parts] of cases) {
      await expect(errorCode(() => normalizeRaw(rawWithParts(parts)))).resolves.toBe(
        'asset-conflict'
      );
    }
  });

  it('merges repeated asset pointers, preserves alias-free identity, and removes transport fields', async () => {
    const pointer = 'file-service:synthetic-opaque-pointer';
    const raw = rawWithParts([
      {
        content_type: 'file_asset_pointer',
        asset_pointer: pointer,
        filename: 'pointer.txt',
        width: 2,
        height: 2,
        purpose: 'synthetic',
      },
      {
        content_type: 'file_asset_pointer',
        asset_pointer: pointer,
        filename: 'pointer.txt',
        width: 2,
        height: 2,
        purpose: 'synthetic',
      },
      { content_type: 'file', filename: 'unidentified.bin' },
    ]);
    const { archive } = await normalizeRaw(raw);
    const assets = Object.values(archive.assets);

    const pointerAsset = assets.find(asset => asset.filename === 'pointer.txt');
    expect(assets).toHaveLength(2);
    expect(pointerAsset).toMatchObject({
      filename: 'pointer.txt',
      dimensions: { width: 2, height: 2 },
      acquisition: { state: 'unavailable' },
      extensions: { openai: { purpose: 'synthetic' } },
    });
    expect(pointerAsset?.sourceRefs).toHaveLength(2);
    expect(JSON.stringify(archive)).not.toContain(pointer);
    expect(archive.diagnostics.entries).toContainEqual(
      expect.objectContaining({ code: 'privacy-redacted-sensitive-asset-transport' })
    );
  });

  it('validates manifest asset records before accepting them as authoritative evidence', () => {
    expect(() =>
      manifestAssetsById([
        {
          id: 'duplicate',
          state: 'unavailable',
          relativePath: null,
          mediaType: null,
          byteLength: null,
          sha256: null,
          detail: null,
        },
        {
          id: 'duplicate',
          state: 'unavailable',
          relativePath: null,
          mediaType: null,
          byteLength: null,
          sha256: null,
          detail: null,
        },
      ])
    ).toThrow(expect.objectContaining({ code: 'invalid-manifest' }));
    expect(() => manifestAssetsById([{ id: 'broken', state: 'invented' }])).toThrow(
      expect.objectContaining({ code: 'invalid-manifest' })
    );
    expect(() =>
      manifestAssetsById([
        {
          id: 'negative-length',
          state: 'unavailable',
          relativePath: null,
          mediaType: null,
          byteLength: -1,
          sha256: null,
          detail: null,
        },
      ])
    ).toThrow(expect.objectContaining({ code: 'invalid-manifest' }));
    expect(() =>
      manifestAssetsById([
        {
          id: 'bad-hash',
          state: 'unavailable',
          relativePath: null,
          mediaType: null,
          byteLength: null,
          sha256: 'not-a-hash',
          detail: null,
        },
      ])
    ).toThrow(expect.objectContaining({ code: 'invalid-manifest' }));
  });

  it('guards repeated assets against corrupted acquisition state and invalid dimensions', async () => {
    const privacy: PrivacyTracker = { redactions: [] };
    const context: AssetContext = {
      assets: {},
      assetIdsByIdentity: new Map(),
      manifestAssets: manifestAssetsById([]),
      artifactId: 'conversation',
      format: 'synthetic',
      privacy,
    };
    const attachment = { content_type: 'file', file_id: 'repeated-asset', filename: 'same.txt' };
    const assetId = upsertAsset(attachment, '/attachments/0', context);
    context.assets[assetId].acquisition.detail = 'corrupted after creation';

    expect(() => upsertAsset(attachment, '/attachments/1', context)).toThrow(
      expect.objectContaining({ code: 'asset-conflict' })
    );
    context.assets[assetId].acquisition.detail =
      'Not attempted by the ChatGPT response normalizer.';
    context.assets[assetId].extensions.openai = null;
    expect(() => upsertAsset(attachment, '/attachments/2', context)).toThrow(
      expect.objectContaining({ code: 'asset-conflict' })
    );

    const negativeDimensions = rawWithParts();
    rootMessage(negativeDimensions).content = {
      content_type: 'image',
      file_id: 'negative-dimensions',
      width: -1,
      height: 1,
    };
    await expect(errorCode(() => normalizeRaw(negativeDimensions))).resolves.toBe(
      'malformed-attachment'
    );
  });

  it('truncates deep, oversized provider residuals and records redacted signed values', () => {
    const privacy: PrivacyTracker = { redactions: [] };
    let deep: RawRecord = { leaf: 'synthetic' };
    for (let level = 0; level < 17; level += 1) deep = { nested: deep };

    const deepResult = sanitizeJson(deep, privacy, '/deep');
    const oversizedResult = sanitizeJson('x'.repeat(32_769), privacy, '/long');
    const redactedResult = sanitizeJson(
      {
        access_token: 'secret-token',
        link: 'https://cdn.example.invalid/object?X-Amz-Signature=synthetic-signature',
      },
      privacy,
      '/payload'
    );

    expect(JSON.stringify(deepResult.value)).toContain('[truncated-depth]');
    expect(oversizedResult).toMatchObject({ truncated: true });
    expect(redactedResult).toMatchObject({ redacted: true });
    expect(JSON.stringify(redactedResult.value)).not.toContain('synthetic-signature');
    expect(privacy.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'privacy-redacted-sensitive-value' }),
        expect.objectContaining({ code: 'privacy-redacted-sensitive-url' }),
      ])
    );
  });

  it('bounds provider arrays and rejects circular residual values', () => {
    const bounded = sanitizeJson(Array.from({ length: 514 }, (_, index) => index));
    const boundedObject = sanitizeJson(
      Object.fromEntries(Array.from({ length: 514 }, (_, index) => [`entry-${index}`, index]))
    );
    const cycle: RawRecord = {};
    cycle.self = cycle;

    expect(bounded).toMatchObject({ truncated: true });
    expect(((bounded.value as RawRecord).value as unknown[]).length).toBe(512);
    expect(boundedObject).toMatchObject({ truncated: true });
    expect(() => sanitizeJson(cycle)).toThrow(expect.objectContaining({ code: 'malformed-json' }));
    expect(() => sanitizeJson(Number.POSITIVE_INFINITY)).toThrow(
      expect.objectContaining({ code: 'malformed-json' })
    );
    expect(() => sanitizeJson(new Date())).toThrow(
      expect.objectContaining({ code: 'malformed-json' })
    );
  });

  it('keeps ordinary citation URLs while redacting unsafe URI schemes and credentials', () => {
    const privacy: PrivacyTracker = { redactions: [] };

    expect(
      sanitizedCitationUrl('https://example.invalid/source', '/citation/url', { privacy })
    ).toBe('https://example.invalid/source');
    expect(
      sanitizedCitationUrl('blob:https://chatgpt.com/opaque', '/citation/link', { privacy })
    ).toBe(null);
    expect(
      redactSensitiveUrls('See https://user:password@example.invalid/private.', privacy, '/text')
    ).toBe('See [redacted-sensitive-url]');
    expect(redactSensitiveUrls('https://[not-a-valid-host', privacy, '/broken-url')).toBe(
      '[redacted-sensitive-url]'
    );
    expect(sanitizedCitationUrl('https://[not-a-valid-host', '/citation/broken', { privacy })).toBe(
      null
    );
    expect(privacy.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'privacy-redacted-signed-citation-url' }),
        expect.objectContaining({ code: 'privacy-redacted-sensitive-url' }),
      ])
    );
  });

  it('rejects unsafe provider identifiers, malformed aliases, and invalid raw pointers', async () => {
    const unsafeIdentifier = rawWithParts();
    unsafeIdentifier.current_node = 'blob:https://chatgpt.com/not-an-id';
    const malformedRole = rawWithParts();
    (rootMessage(malformedRole).author as RawRecord).role = '';

    await expect(errorCode(() => normalizeRaw(unsafeIdentifier))).resolves.toBe('unsafe-id');
    await expect(errorCode(() => normalizeRaw(malformedRole))).resolves.toBe(
      'malformed-string-field'
    );
    expect(() => normalizeTimestamp('2026-13-40T12:00:00Z', 'synthetic')).toThrow(
      expect.objectContaining({ code: 'invalid-timestamp' })
    );
    expect(() => normalizeTimestamp(Number.POSITIVE_INFINITY, 'synthetic')).toThrow(
      expect.objectContaining({ code: 'invalid-timestamp' })
    );
    expect(() =>
      optionalTimestamp({ first: 1, second: 2 }, ['first', 'second'], '/timestamp')
    ).toThrow(expect.objectContaining({ code: 'ambiguous-timestamp' }));
    expect(() => nullableString({ label: 1 }, 'label', '/label')).toThrow(
      expect.objectContaining({ code: 'malformed-string-field' })
    );
    expect(() =>
      nullableAliasedString([[{ model: 1 }, 'model', '/message']], 'ambiguous-model')
    ).toThrow(expect.objectContaining({ code: 'malformed-string-field' }));
    expect(() =>
      sourceRef(
        { artifactId: 'conversation', format: 'synthetic' },
        'message',
        null,
        'not-a-pointer'
      )
    ).toThrow(expect.objectContaining({ code: 'invalid-pointer' }));
  });
});
