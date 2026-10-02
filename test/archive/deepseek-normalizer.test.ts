import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  DeepSeekNormalizationError,
  inventoryDeepSeekRawAssets,
  normalizeDeepSeekCapture,
  preflightDeepSeekHistoryArtifact,
  validateLiskaThreadArchive,
  type LiskaThreadArchive,
  type RawCaptureBundle,
} from '../../src/archive';
import { projectArchiveBranch } from '../../src/content/archive-projection';
import { redactSensitiveText, sanitizeJson } from '../../src/archive/normalizers/deepseek/privacy';

const fixtureBytes = new Uint8Array(
  readFileSync('test/fixtures/archive/deepseek-raw/branching-replace.json')
);
const fixture = JSON.parse(new TextDecoder().decode(fixtureBytes)) as DeepSeekRaw;

interface DeepSeekRaw extends Record<string, unknown> {
  data: {
    biz_code: number;
    biz_data: {
      cache_control?: string | null;
      chat_session: Record<string, unknown>;
      chat_messages: Array<Record<string, unknown>>;
    };
  };
}

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function observedUnknownTypes(bytes: Uint8Array, conversationId: string): string[] {
  try {
    return preflightDeepSeekHistoryArtifact(bytes, conversationId);
  } catch {
    return [];
  }
}

async function bundleFor(
  bytes: Uint8Array,
  conversationId = 'deepseek-branching-1'
): Promise<RawCaptureBundle> {
  let raw: unknown = null;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    // The normalizer remains responsible for reporting malformed raw bytes.
  }
  const assetInventory = await inventoryDeepSeekRawAssets({
    raw,
    artifactId: 'conversation',
    sha256,
  });
  const manifest = buildCaptureManifest({
    captureId: 'capture-deepseek-normalizer-001',
    provider: 'deepseek',
    conversationId,
    capturedAt: '2026-09-18T06:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: bytes.byteLength,
        sha256: hash(bytes),
        endpoint: { method: 'GET', pathPattern: '/api/v0/chat/history_messages' },
      },
    ],
    assets: assetInventory.assets,
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: assetInventory.completeness,
    },
    warnings:
      assetInventory.completeness === 'not-attempted'
        ? ['DeepSeek attachment metadata was inventoried; binary acquisition was not attempted.']
        : assetInventory.warnings,
    observedUnknownContentTypes: observedUnknownTypes(bytes, conversationId),
  });
  return { manifest, artifacts: [{ record: manifest.artifacts[0], bytes }], assets: [] };
}

async function normalizeBytes(bytes: Uint8Array = fixtureBytes) {
  const bundle = await bundleFor(bytes);
  const manifestSha256 = hash(new TextEncoder().encode(JSON.stringify(bundle.manifest, null, 2)));
  return normalizeDeepSeekCapture({
    bundle,
    artifactId: 'conversation',
    manifestSha256,
    sha256,
  });
}

function encodedRaw(mutator: (raw: DeepSeekRaw) => void): Uint8Array {
  const raw = structuredClone(fixture);
  mutator(raw);
  return new TextEncoder().encode(JSON.stringify(raw));
}

const timestampTargets = [
  {
    label: 'session createdAt',
    scope: 'session',
    aliases: ['created_at', 'create_time'],
    canonicalField: 'createdAt',
    pointer: '/data/biz_data/chat_session',
  },
  {
    label: 'session updatedAt',
    scope: 'session',
    aliases: ['updated_at', 'update_time'],
    canonicalField: 'updatedAt',
    pointer: '/data/biz_data/chat_session',
  },
  {
    label: 'message createdAt',
    scope: 'message',
    aliases: ['created_at', 'create_time'],
    canonicalField: 'createdAt',
    pointer: '/data/biz_data/chat_messages/4',
  },
  {
    label: 'message updatedAt',
    scope: 'message',
    aliases: ['updated_at', 'update_time'],
    canonicalField: 'updatedAt',
    pointer: '/data/biz_data/chat_messages/4',
  },
] as const;
type TimestampTarget = (typeof timestampTargets)[number];

const timestampIso = '2026-09-18T06:00:00.000Z';
const timestampTimezone = '2026-09-18T11:00:00+05:00';
const timestampSeconds = 1_789_711_200;
const timestampMilliseconds = timestampSeconds * 1000;
const epochIso = '1970-01-01T00:00:00.000Z';
const invalidTimestamp = 'synthetic-private-invalid-timestamp';
const validTimestampCases = [
  { label: 'missing aliases', values: [undefined, undefined], expected: null },
  { label: 'missing and null', values: [undefined, null], expected: null },
  { label: 'null and missing', values: [null, undefined], expected: null },
  { label: 'null aliases', values: [null, null], expected: null },
  { label: 'primary only', values: [timestampIso, undefined], expected: timestampIso },
  { label: 'secondary only', values: [undefined, timestampIso], expected: timestampIso },
  { label: 'null then valid', values: [null, timestampIso], expected: timestampIso },
  { label: 'valid then null', values: [timestampIso, null], expected: timestampIso },
  { label: 'primary epoch zero', values: [0, null], expected: epochIso },
  { label: 'secondary epoch zero', values: [null, 0], expected: epochIso },
  { label: 'identical ISO instants', values: [timestampIso, timestampIso], expected: timestampIso },
  { label: 'ISO and timezone', values: [timestampIso, timestampTimezone], expected: timestampIso },
  { label: 'timezone and ISO', values: [timestampTimezone, timestampIso], expected: timestampIso },
  {
    label: 'Unix seconds and milliseconds',
    values: [timestampSeconds, timestampMilliseconds],
    expected: timestampIso,
  },
  {
    label: 'Unix milliseconds and seconds',
    values: [timestampMilliseconds, timestampSeconds],
    expected: timestampIso,
  },
  {
    label: 'ISO and Unix seconds',
    values: [timestampIso, timestampSeconds],
    expected: timestampIso,
  },
  {
    label: 'Unix seconds and ISO',
    values: [timestampSeconds, timestampIso],
    expected: timestampIso,
  },
  {
    label: 'ISO and Unix milliseconds',
    values: [timestampIso, timestampMilliseconds],
    expected: timestampIso,
  },
  {
    label: 'Unix milliseconds and ISO',
    values: [timestampMilliseconds, timestampIso],
    expected: timestampIso,
  },
  { label: 'epoch zero and ISO', values: [0, epochIso], expected: epochIso },
  { label: 'ISO and epoch zero', values: [epochIso, 0], expected: epochIso },
] as const;
const invalidTimestampCases = [
  {
    label: 'conflicting ISO instants',
    values: [timestampIso, '2026-09-18T06:00:00.001Z'],
    code: 'ambiguous-timestamp',
  },
  {
    label: 'conflicting Unix instants',
    values: [timestampSeconds, timestampMilliseconds + 1],
    code: 'ambiguous-timestamp',
  },
  {
    label: 'invalid and valid',
    values: [invalidTimestamp, timestampIso],
    code: 'invalid-timestamp',
  },
  { label: 'invalid and null', values: [invalidTimestamp, null], code: 'invalid-timestamp' },
  {
    label: 'invalid and missing',
    values: [invalidTimestamp, undefined],
    code: 'invalid-timestamp',
  },
  {
    label: 'object and valid',
    values: [{ secret: invalidTimestamp }, timestampIso],
    code: 'invalid-timestamp',
  },
  { label: 'boolean and valid', values: [false, timestampIso], code: 'invalid-timestamp' },
  {
    label: 'out-of-range number and valid',
    values: [8_640_000_000_000_001, timestampIso],
    code: 'invalid-timestamp',
  },
] as const;

function encodedTimestampAliases(
  target: TimestampTarget,
  values: readonly unknown[],
  reverseInsertion = false
): Uint8Array {
  return encodedRaw(raw => {
    const record =
      target.scope === 'session'
        ? raw.data.biz_data.chat_session
        : raw.data.biz_data.chat_messages[4];
    target.aliases.forEach(alias => delete record[alias]);
    const indexes = reverseInsertion ? [1, 0] : [0, 1];
    indexes.forEach(index => {
      // Undefined represents an omitted alias at the raw JSON boundary.
      if (values[index] !== undefined) record[target.aliases[index]] = values[index];
    });
  });
}

function canonicalTimestampRecord(archive: LiskaThreadArchive, target: TimestampTarget) {
  return target.scope === 'session'
    ? archive.conversation
    : archive.graph.nodes['current-answer'].message!;
}

const typedFragmentTypes = ['REQUEST', 'RESPONSE', 'TEMPLATE_RESPONSE', 'THINK'] as const;
const unusableFragmentContents = [
  { label: 'empty', content: '' },
  { label: 'missing', content: undefined },
  { label: 'null', content: null },
  { label: 'number', content: 42 },
  { label: 'boolean', content: false },
  { label: 'object', content: { text: 'fragment shape', api_key: 'synthetic-fragment-secret' } },
  { label: 'array', content: ['fragment shape'] },
];

function expectedStringFragmentBlock(type: string, content: string): Record<string, string> {
  if (type === 'REQUEST') return { type: 'text', text: content };
  if (type === 'THINK') return { type: 'reasoning', text: content };
  return { type: 'markdown', markdown: content };
}

function encodedTypedFragment(type: string, content: unknown, fallback: unknown): Uint8Array {
  return encodedRaw(raw => {
    const message = raw.data.biz_data.chat_messages[4];
    message.role = type === 'REQUEST' ? 'USER' : 'ASSISTANT';
    message.fragments = [{ type, ...(content === undefined ? {} : { content }) }];
    message[type === 'THINK' ? 'thinking_content' : 'content'] = fallback;
    delete message.files;
  });
}

function liveFragmentFile(): Record<string, unknown> {
  return {
    audit_result: null,
    error_code: null,
    file_name: 'synthetic-live.txt',
    file_size: 93,
    from_share: false,
    id: 'file-11111111-2222-4333-8444-555555555555',
    inserted_at: '2026-09-19T06:00:00.000Z',
    is_image: false,
    model_kind: 'document',
    signed_path: '/file?file_id=11111111-2222-4333-8444-555555555555&state=synthetic-live-state',
    status: 'SUCCESS',
    token_usage: 7,
    updated_at: '2026-09-19T06:00:00.000Z',
  };
}

async function expectCode(bytes: Uint8Array, code: string): Promise<void> {
  await expect(normalizeBytes(bytes)).rejects.toMatchObject<Partial<DeepSeekNormalizationError>>({
    code,
  });
}

describe('DeepSeek liska-thread/1 normalizer', () => {
  it('preserves the complete branching graph and exact current branch deterministically', async () => {
    const first = await normalizeBytes();
    const second = await normalizeBytes();
    const archive = first.archive;

    expect(first).toEqual(second);
    expect(Object.keys(archive.graph.nodes)).toEqual([
      'root-question',
      'first-answer',
      'follow-up',
      'inactive-answer',
      'current-answer',
    ]);
    expect(archive.graph.rootIds).toEqual(['root-question']);
    expect(archive.graph.nodes['follow-up'].childIds).toEqual([
      'inactive-answer',
      'current-answer',
    ]);
    expect(archive.conversation.currentNodeId).toBe('current-answer');
    expect(archive.inputs[0].manifestSha256).toBe(
      hash(
        new TextEncoder().encode(JSON.stringify((await bundleFor(fixtureBytes)).manifest, null, 2))
      )
    );
    expect(archive.graph.nodes['current-answer'].message?.sourceRefs[0].rawPointer).toBe(
      '/data/biz_data/chat_messages/4'
    );
  });

  it('normalizes agreeing provider id aliases and human or bot roles', async () => {
    const bytes = encodedRaw(raw => {
      raw.data.biz_data.chat_session.chat_session_id = 'deepseek-branching-1';
      raw.data.biz_data.chat_messages[0].id = 'root-question';
      raw.data.biz_data.chat_messages[0].role = 'HUMAN';
      raw.data.biz_data.chat_messages[1].role = 'BOT';
    });

    const { archive } = await normalizeBytes(bytes);

    expect(archive.conversation.id).toBe('deepseek-branching-1');
    expect(archive.graph.nodes['root-question'].message?.author.role).toBe('user');
    expect(archive.graph.nodes['first-answer'].message?.author.role).toBe('assistant');
  });

  it.each(['primary', 'secondary'] as const)(
    'skips null identifier aliases when the %s alias is usable',
    async usableAlias => {
      const bytes = encodedRaw(raw => {
        const session = raw.data.biz_data.chat_session;
        const message = raw.data.biz_data.chat_messages[0];
        if (usableAlias === 'primary') {
          session.chat_session_id = null;
          message.id = null;
        } else {
          session.chat_session_id = session.id;
          session.id = null;
          message.id = message.message_id;
          message.message_id = null;
        }
      });

      const { archive } = await normalizeBytes(bytes);

      expect(archive.conversation.id).toBe('deepseek-branching-1');
      expect(archive.graph.nodes['root-question'].message?.id).toBe('root-question');
      expect(validateLiskaThreadArchive(archive).valid).toBe(true);
    }
  );

  describe.each(timestampTargets)('timestamp aliases: $label', target => {
    it.each(validTimestampCases)('reconciles $label deterministically', async testCase => {
      const bytes = encodedTimestampAliases(target, testCase.values);
      const first = await normalizeBytes(bytes);
      const second = await normalizeBytes(bytes);
      const reordered = await normalizeBytes(
        encodedTimestampAliases(target, testCase.values, true)
      );
      const record = canonicalTimestampRecord(first.archive, target);

      expect(first).toEqual(second);
      expect(record[target.canonicalField]).toBe(testCase.expected);
      expect(validateLiskaThreadArchive(first.archive).valid).toBe(true);
      expect(validateLiskaThreadArchive(reordered.archive).valid).toBe(true);
      // Different raw byte order changes provenance hashes, not canonical records.
      expect(reordered.archive.conversation).toEqual(first.archive.conversation);
      expect(reordered.archive.graph).toEqual(first.archive.graph);
      target.aliases.forEach(alias => expect(record.extensions.deepseek).not.toHaveProperty(alias));
    });

    it.each(invalidTimestampCases)('rejects $label in either alias order', async testCase => {
      for (const reverse of [false, true]) {
        const values = reverse ? [...testCase.values].reverse() : testCase.values;
        const bytes = encodedTimestampAliases(target, values, reverse);
        const error = await normalizeBytes(bytes).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(DeepSeekNormalizationError);
        expect(error).toMatchObject({ code: testCase.code });
        const message = (error as DeepSeekNormalizationError).message;
        expect(message).toBe(
          testCase.code === 'ambiguous-timestamp'
            ? `Timestamp aliases at ${target.pointer} disagree.`
            : `${target.pointer}/${target.aliases[reverse ? 1 : 0]} must be an ISO timestamp or Unix time.`
        );
        expect(message).not.toContain(invalidTimestamp);
        expect(message).not.toContain(timestampIso);
        expect(message).not.toContain(String(timestampSeconds));
      }
    });
  });

  it('reconciles a metadata-only attachment ledger before appending deterministic blocks', async () => {
    const { archive } = await normalizeBytes();
    const rootBlocks = archive.graph.nodes['root-question'].message?.blocks ?? [];
    const currentBlocks = archive.graph.nodes['current-answer'].message?.blocks ?? [];
    const attachments = Object.values(archive.graph.nodes).flatMap(
      node => node.message?.blocks.filter(block => block.type === 'attachment') ?? []
    );
    const blockIds = Object.values(archive.graph.nodes).flatMap(
      node => node.message?.blocks.map(block => block.id) ?? []
    );

    expect(Object.keys(archive.assets)).toHaveLength(2);
    expect(rootBlocks.at(-1)).toMatchObject({
      type: 'attachment',
      sourceRefs: [
        {
          id: null,
          rawPointer: '/data/biz_data/chat_messages/0/files/0',
        },
      ],
    });
    expect(currentBlocks.at(-1)).toMatchObject({
      type: 'attachment',
      sourceRefs: [
        {
          id: null,
          rawPointer: '/data/biz_data/chat_messages/4/files/0',
        },
      ],
    });
    expect(attachments).toHaveLength(3);
    expect(new Set(blockIds).size).toBe(blockIds.length);
    expect(
      Object.values(archive.assets).find(asset => asset.sourceRefs.length === 2)
    ).toMatchObject({
      filename: 'shared-report.txt',
      mimeType: null,
      byteLength: 2048,
      sha256: null,
      localArtifactRef: null,
      acquisition: { state: 'not-attempted', attemptedAt: null },
      sourceRefs: [expect.objectContaining({ id: null }), expect.objectContaining({ id: null })],
      extensions: {
        deepseek: expect.objectContaining({
          inserted_at: '2026-09-18T05:00:00.000Z',
          updated_at: '2026-09-18T05:01:00.000Z',
          status: 'ready',
          error_code: null,
          previewable: true,
          token_usage: 512,
        }),
      },
    });
    expect(archive.graph.nodes['root-question'].message?.extensions.deepseek).not.toHaveProperty(
      'files'
    );
    expect(
      JSON.stringify(Object.values(archive.assets).map(asset => asset.extensions.deepseek))
    ).not.toContain('deepseek-file-alpha');
  });

  it('retains sanitized FILE metadata before ordered attachments without transport leakage', async () => {
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[0] as Record<string, any>;
      const secondFile = {
        ...liveFragmentFile(),
        file_name: 'synthetic-second.txt',
        id: 'file-66666666-7777-4888-8999-000000000000',
        signed_path:
          '/file?file_id=66666666-7777-4888-8999-000000000000&state=synthetic-second-state',
      };
      message.fragments = [
        {
          files: [liveFragmentFile(), secondFile],
          id: 'synthetic-fragment-id',
          custom_metadata: {
            label: 'retained-label',
            embedded_value: 'before-file-11111111-2222-4333-8444-555555555555-after',
            ['dynamic-file-11111111-2222-4333-8444-555555555555-key']: 'hidden-value',
            file_id: 'file-11111111-2222-4333-8444-555555555555',
            download_url: 'https://files.invalid/download?access_token=fragment-secret',
          },
          type: 'FILE',
        },
        ...message.fragments,
      ];
      delete message.files;
    });
    const bundle = await bundleFor(bytes);
    const normalized = await normalizeDeepSeekCapture({
      bundle,
      artifactId: 'conversation',
      manifestSha256: hash(new TextEncoder().encode(JSON.stringify(bundle.manifest, null, 2))),
      sha256,
    });
    const blocks = normalized.archive.graph.nodes['root-question'].message?.blocks ?? [];
    const serializedManifest = JSON.stringify(bundle.manifest);
    const serializedCanonical = JSON.stringify(normalized.archive);

    expect(blocks[0]).toMatchObject({
      type: 'unknown',
      providerType: 'FILE:metadata',
      raw: {
        id: 'synthetic-fragment-id',
        custom_metadata: {
          label: 'retained-label',
          embedded_value: {
            _liskaRedactedProviderMetadata: true,
          },
        },
        _liskaRedactedSensitiveValue: true,
        _liskaRedactedProviderMetadata: true,
      },
      sourceRefs: [
        {
          id: 'root-question',
          rawPointer: '/data/biz_data/chat_messages/0/fragments/0',
        },
      ],
    });
    expect(blocks.slice(1, 3)).toEqual([
      expect.objectContaining({
        type: 'attachment',
        sourceRefs: [
          expect.objectContaining({
            rawPointer: '/data/biz_data/chat_messages/0/fragments/0/files/0',
          }),
        ],
      }),
      expect.objectContaining({
        type: 'attachment',
        sourceRefs: [
          expect.objectContaining({
            rawPointer: '/data/biz_data/chat_messages/0/fragments/0/files/1',
          }),
        ],
      }),
    ]);
    expect(blocks[3]).toMatchObject({ type: 'text', text: 'First question' });
    expect(bundle.manifest.observedUnknownContentTypes).toContain('FILE:metadata');
    expect(Object.values(normalized.archive.assets)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filename: 'synthetic-live.txt',
          byteLength: 93,
          extensions: {
            deepseek: expect.objectContaining({
              audit_result: null,
              from_share: false,
              is_image: false,
              model_kind: 'document',
            }),
          },
        }),
      ])
    );
    expect(new TextDecoder().decode(bytes)).toContain('synthetic-live-state');
    for (const durable of [serializedManifest, serializedCanonical]) {
      expect(durable).not.toContain('signed_path');
      expect(durable).not.toContain('synthetic-live-state');
      expect(durable).not.toContain('synthetic-second-state');
      expect(durable).not.toContain('file-11111111-2222-4333-8444-555555555555');
      expect(durable).not.toContain('file-66666666-7777-4888-8999-000000000000');
      expect(durable).not.toContain('fragment-secret');
    }
    expect(projectArchiveBranch(normalized.archive).warnings).toContain(
      'Legacy Markdown omitted 2 unknown provider block(s); the canonical archive companion preserves them only when its selected output write succeeds.'
    );
  });

  it('does not add FILE metadata noise when a fragment contains only non-empty files', async () => {
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[0] as Record<string, any>;
      message.fragments = [{ files: [liveFragmentFile()], type: 'FILE' }, ...message.fragments];
      delete message.files;
    });
    const bundle = await bundleFor(bytes);
    const normalized = await normalizeDeepSeekCapture({
      bundle,
      artifactId: 'conversation',
      manifestSha256: hash(new TextEncoder().encode(JSON.stringify(bundle.manifest, null, 2))),
      sha256,
    });
    const blocks = normalized.archive.graph.nodes['root-question'].message?.blocks ?? [];

    expect(blocks[0]).toMatchObject({ type: 'attachment' });
    expect(blocks[1]).toMatchObject({ type: 'text', text: 'First question' });
    expect(blocks).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ providerType: 'FILE:metadata' })])
    );
    expect(bundle.manifest.observedUnknownContentTypes).not.toContain('FILE:metadata');
  });

  it('preserves an empty FILE fragment as exact-pointer metadata', async () => {
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[0] as Record<string, any>;
      message.fragments = [{ files: [], type: 'FILE' }, ...message.fragments];
      delete message.files;
    });
    const bundle = await bundleFor(bytes);
    const normalized = await normalizeDeepSeekCapture({
      bundle,
      artifactId: 'conversation',
      manifestSha256: hash(new TextEncoder().encode(JSON.stringify(bundle.manifest, null, 2))),
      sha256,
    });
    const blocks = normalized.archive.graph.nodes['root-question'].message?.blocks ?? [];

    expect(blocks[0]).toMatchObject({
      type: 'unknown',
      providerType: 'FILE:metadata',
      raw: {},
      sourceRefs: [
        {
          id: 'root-question',
          rawPointer: '/data/biz_data/chat_messages/0/fragments/0',
        },
      ],
    });
    expect(blocks[1]).toMatchObject({ type: 'text', text: 'First question' });
    expect(bundle.manifest.observedUnknownContentTypes).toContain('FILE:metadata');
  });

  it('redacts short provider IDs from successful FILE metadata keys and values', async () => {
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[0] as Record<string, any>;
      message.fragments = [
        {
          files: [{ ...liveFragmentFile(), id: 'x' }],
          id: 'fragment-xsafe',
          custom_metadata: {
            label: 'kept',
            embedded: 'prefix-xsuffix',
            ['dynamic-x-key']: 'hidden',
          },
          type: 'FILE',
        },
        ...message.fragments,
      ];
      delete message.files;
    });
    const { archive } = await normalizeBytes(bytes);
    const metadataBlock = archive.graph.nodes['root-question'].message?.blocks.find(
      block => block.type === 'unknown' && block.providerType === 'FILE:metadata'
    );

    expect(metadataBlock).toMatchObject({
      type: 'unknown',
      raw: {
        custom_metadata: {
          label: 'kept',
          embedded: { _liskaRedactedProviderMetadata: true },
        },
        _liskaRedactedProviderMetadata: true,
      },
    });
    expect(
      JSON.stringify(metadataBlock && metadataBlock.type === 'unknown' ? metadataBlock.raw : null)
    ).not.toContain('x');
  });

  it('scrubs provider-ID keys before privacy diagnostics can retain their raw pointer', async () => {
    const providerId = 'file-11111111-2222-4333-8444-555555555555';
    const secret = 'dynamic-provider-key-secret';
    const safePointerSecret = 'safe-pointer-secret';
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[0] as Record<string, any>;
      message.fragments = [
        {
          files: [liveFragmentFile()],
          id: 'safe-fragment-id',
          custom_metadata: {
            [providerId]: {
              download_url: `https://files.invalid/download?access_token=${secret}`,
            },
            safe: {
              download_url: `https://files.invalid/download?access_token=${safePointerSecret}`,
            },
          },
          type: 'FILE',
        },
        ...message.fragments,
      ];
      delete message.files;
    });
    const rawText = new TextDecoder().decode(bytes);
    const { archive } = await normalizeBytes(bytes);
    const serialized = JSON.stringify(archive);
    const metadataBlock = archive.graph.nodes['root-question'].message?.blocks.find(
      block => block.type === 'unknown' && block.providerType === 'FILE:metadata'
    );

    expect(rawText).toContain(providerId);
    expect(rawText).toContain(secret);
    expect(metadataBlock).toMatchObject({
      type: 'unknown',
      raw: {
        id: 'safe-fragment-id',
        custom_metadata: { safe: {} },
        _liskaRedactedProviderMetadata: true,
        _liskaRedactedSensitiveValue: true,
      },
    });
    expect(serialized).not.toContain(providerId);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(safePointerSecret);
    expect(serialized).not.toContain('files.invalid');
    expect(JSON.stringify(archive.diagnostics)).not.toContain(providerId);
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'privacy-redacted-sensitive-extension-field',
          sourceRefs: [
            expect.objectContaining({
              rawPointer:
                '/data/biz_data/chat_messages/0/fragments/0/custom_metadata/safe/download_url',
            }),
          ],
        }),
      ])
    );
    expect(JSON.stringify(metadataBlock?.sourceRefs ?? [])).not.toContain(providerId);
  });

  it.each([
    [
      'provider ID count',
      Array.from({ length: 65 }, (_, index) => `provider-${String(index).padStart(3, '0')}`),
    ],
    [
      'provider ID characters',
      Array.from(
        { length: 17 },
        (_, index) => `long-${String(index).padStart(2, '0')}-${'a'.repeat(240)}`
      ),
    ],
  ])('fails closed on successful FILE metadata beyond the %s bound', async (_label, ids) => {
    const providerFiles = ids.map((id, index) => ({
      ...liveFragmentFile(),
      file_name: `synthetic-${index}.txt`,
      id,
    }));
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[0] as Record<string, any>;
      message.fragments = [
        {
          files: providerFiles,
          id: 'fragment-would-otherwise-survive',
          custom_metadata: {
            label: 'would-otherwise-survive',
            signed_path: `/file?file_id=${ids[0]}&state=bounded-secret`,
          },
          type: 'FILE',
        },
        ...message.fragments,
      ];
      delete message.files;
    });
    const { archive } = await normalizeBytes(bytes);
    const blocks = archive.graph.nodes['root-question'].message?.blocks ?? [];

    expect(blocks[0]).toMatchObject({
      type: 'unknown',
      providerType: 'FILE:metadata',
      raw: { _liskaRedactedProviderMetadata: true },
    });
    const attachmentBlocks = blocks.slice(1, providerFiles.length + 1);
    expect(attachmentBlocks).toHaveLength(providerFiles.length);
    expect(attachmentBlocks.every(block => block.type === 'attachment')).toBe(true);
    expect(JSON.stringify(blocks[0])).not.toContain('bounded-secret');
    expect(JSON.stringify(blocks[0])).not.toContain('would-otherwise-survive');
    expect(JSON.stringify(blocks[0])).not.toContain(ids[0]);
  });

  it('marks an uninspected FILE metadata subtree when the character budget is exhausted', async () => {
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[0] as Record<string, any>;
      message.fragments = [
        {
          files: [liveFragmentFile()],
          custom_metadata: {
            first: 'z'.repeat(32_768),
            second: 'z'.repeat(32_768),
            third_uninspected: 'never-emit-this-raw-string',
          },
          type: 'FILE',
        },
        ...message.fragments,
      ];
      delete message.files;
    });
    const { archive } = await normalizeBytes(bytes);
    const metadataBlock = archive.graph.nodes['root-question'].message?.blocks.find(
      block => block.type === 'unknown' && block.providerType === 'FILE:metadata'
    );
    const serialized = JSON.stringify(
      metadataBlock && metadataBlock.type === 'unknown' ? metadataBlock.raw : null
    );

    expect(metadataBlock).toMatchObject({
      type: 'unknown',
      raw: expect.objectContaining({ _liskaRedactedProviderMetadata: true }),
    });
    expect(serialized).not.toContain('third_uninspected');
    expect(serialized).not.toContain('never-emit-this-raw-string');
  });

  it('degrades a malformed attachment ledger without fabricating asset blocks', async () => {
    const bytes = encodedRaw(raw => {
      raw.data.biz_data.chat_messages[0].files = { malformed: true };
    });
    const { archive } = await normalizeBytes(bytes);

    expect(archive.assets).toEqual({});
    expect(archive.graph.nodes['root-question'].message?.extensions.deepseek).toMatchObject({
      files: { malformed: true },
    });
    expect(
      Object.values(archive.graph.nodes).flatMap(
        node => node.message?.blocks.filter(block => block.type === 'attachment') ?? []
      )
    ).toEqual([]);
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'deepseek-attachment-inventory-unavailable',
          severity: 'warning',
        }),
      ])
    );
  });

  it('keeps degraded file metadata sanitized without retaining a provider ID', async () => {
    const bytes = encodedRaw(raw => {
      raw.data.biz_data.chat_messages[4].files[0].file_size = 2049;
      raw.data.biz_data.chat_messages[0].files[0].error_code =
        'Authorization: Bearer synthetic-file-secret';
      raw.data.biz_data.chat_messages[0].files[0].metadata = {
        file_id: 'nested-provider-id',
        nested: [{ id: 'deep-provider-id' }],
        alias: 'deepseek-file-alpha',
      };
    });
    const { archive } = await normalizeBytes(bytes);
    const serialized = JSON.stringify(archive);

    expect(archive.assets).toEqual({});
    expect(archive.graph.nodes['root-question'].message?.extensions.deepseek).toMatchObject({
      files: [
        expect.objectContaining({
          error_code: '[redacted-credential]',
        }),
      ],
    });
    expect(serialized).not.toContain('deepseek-file-alpha');
    expect(serialized).not.toContain('deepseek-file-beta');
    expect(serialized).not.toContain('nested-provider-id');
    expect(serialized).not.toContain('deep-provider-id');
    expect(serialized).not.toContain('synthetic-file-secret');
  });

  it('sanitizes relative signed paths and provider ids in a degraded FILE fragment', async () => {
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[0] as Record<string, any>;
      message.fragments = [
        { files: [liveFragmentFile()], id: 'synthetic-fragment-id', type: 'FILE' },
        ...message.fragments,
      ];
      delete message.files;
      raw.data.biz_data.chat_messages[1].files = { malformed: true };
    });
    const { archive } = await normalizeBytes(bytes);
    const serialized = JSON.stringify(archive);
    const fileBlock = archive.graph.nodes['root-question'].message?.blocks.find(
      block => block.type === 'unknown' && block.providerType === 'FILE'
    );
    const rootBlocks = archive.graph.nodes['root-question'].message?.blocks ?? [];

    expect(fileBlock).toMatchObject({ type: 'unknown', providerType: 'FILE' });
    expect(
      rootBlocks.filter(block => block.type === 'unknown' && block.providerType === 'FILE')
    ).toHaveLength(1);
    expect(rootBlocks).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ providerType: 'FILE:metadata' })])
    );
    expect(
      Object.values(archive.graph.nodes).flatMap(
        node => node.message?.blocks.filter(block => block.type === 'attachment') ?? []
      )
    ).toEqual([]);
    expect(serialized).not.toContain('signed_path');
    expect(serialized).not.toContain('synthetic-live-state');
    expect(serialized).not.toContain('file-11111111-2222-4333-8444-555555555555');
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'privacy-redacted-sensitive-extension-field' }),
      ])
    );
  });

  it('does not retain ignored synthetic file transport fields in a successful ledger', async () => {
    const bytes = encodedRaw(raw => {
      raw.data.biz_data.chat_messages[0].files[0].download_url =
        'https://files.invalid/download?access_token=synthetic-transport-secret';
    });
    const { archive } = await normalizeBytes(bytes);
    const serialized = JSON.stringify(archive);

    expect(Object.keys(archive.assets)).toHaveLength(2);
    expect(serialized).not.toContain('files.invalid');
    expect(serialized).not.toContain('synthetic-transport-secret');
  });

  it('rejects a manifest whose attachment IDs or raw pointers no longer match the raw artifact', async () => {
    const bundle = await bundleFor(fixtureBytes);
    bundle.manifest.assets = [];
    const manifestSha256 = hash(new TextEncoder().encode(JSON.stringify(bundle.manifest, null, 2)));

    await expect(
      normalizeDeepSeekCapture({
        bundle,
        artifactId: 'conversation',
        manifestSha256,
        sha256,
      })
    ).rejects.toMatchObject<Partial<DeepSeekNormalizationError>>({
      code: 'asset-inventory-mismatch',
    });
  });

  it('projects only the selected branch while retaining reasoning and inactive siblings canonically', async () => {
    const { archive } = await normalizeBytes();
    const withoutThinking = projectArchiveBranch(archive, { includeToolContent: false });
    const withThinking = projectArchiveBranch(archive, { includeToolContent: true });

    expect(withoutThinking.selectedNodeIds).toEqual([
      'root-question',
      'first-answer',
      'follow-up',
      'current-answer',
    ]);
    expect(withoutThinking.data.messages.map(message => message.content).join('\n')).not.toContain(
      'Inactive sibling answer'
    );
    expect(archive.graph.nodes['inactive-answer'].message?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'markdown', markdown: 'Inactive sibling answer' }),
      ])
    );
    expect(withoutThinking.data.messages.every(message => message.toolContent === undefined)).toBe(
      true
    );
    expect(
      withThinking.data.messages.some(message => message.toolContent?.includes('Current reasoning'))
    ).toBe(true);
    expect(archive.graph.nodes['current-answer'].message?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'reasoning', text: 'Current reasoning' }),
      ])
    );
  });

  it('accepts an omitted cache-control marker when the response graph is self-contained', async () => {
    const bytes = encodedRaw(raw => {
      delete raw.data.biz_data.cache_control;
    });

    const { archive } = await normalizeBytes(bytes);

    expect(Object.keys(archive.graph.nodes)).toHaveLength(5);
    expect(archive.conversation.currentNodeId).toBe('current-answer');
  });

  it('keeps unknown fragments bounded with an exact raw pointer and removes credential-like fields', async () => {
    const { archive } = await normalizeBytes();
    const unknown = archive.graph.nodes['current-answer'].message?.blocks.find(
      block => block.type === 'unknown'
    );
    expect(unknown).toMatchObject({
      type: 'unknown',
      providerType: 'FUTURE_WIDGET',
      sourceRefs: [{ rawPointer: '/data/biz_data/chat_messages/4/fragments/2' }],
    });
    expect(JSON.stringify(archive)).not.toContain('must-not-enter-canonical');
    expect(JSON.stringify(archive)).not.toContain('must-also-stay-raw-only');
    expect(
      JSON.stringify(unknown && unknown.type === 'unknown' ? unknown.raw : null)
    ).not.toContain('api_key');
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'privacy-redacted-sensitive-extension-field' }),
      ])
    );
  });

  it.each([
    [
      'known non-text fragment',
      (message: Record<string, unknown>) => {
        message.fragments = [{ type: 'RESPONSE', content: { text: 'future shape' } }];
      },
      ['RESPONSE:non-text'],
    ],
    [
      'non-text fallback fields',
      (message: Record<string, unknown>) => {
        delete message.fragments;
        message.content = { text: 'future content shape' };
        message.thinking_content = { text: 'future reasoning shape' };
      },
      ['message.content', 'message.thinking_content'],
    ],
  ] as const)('uses one manifest/canonical classifier for %s', async (_label, mutate, expected) => {
    const bytes = encodedRaw(raw => mutate(raw.data.biz_data.chat_messages[4]));
    expect(preflightDeepSeekHistoryArtifact(bytes, 'deepseek-branching-1')).toEqual(expected);

    const { archive, observedUnknownContentTypes } = await normalizeBytes(bytes);

    expect(observedUnknownContentTypes).toEqual(expected);
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining(
        expected.map(type =>
          expect.objectContaining({
            code: 'unknown-content-type',
            extensions: { deepseek: { contentType: type } },
          })
        )
      )
    );
  });

  describe.each(typedFragmentTypes)('%s fragment fallback', type => {
    const fallbackField = type === 'THINK' ? 'thinking_content' : 'content';
    const messagePointer = '/data/biz_data/chat_messages/4';

    it.each(unusableFragmentContents)(
      'preserves the $label fragment and its distinctive string fallback',
      async ({ label, content }) => {
        const fallback = `fallback:${type}:${label}`;
        const bytes = encodedTypedFragment(type, content, fallback);
        const expectedUnknown = content === '' ? [] : [`${type}:non-text`];
        const { archive, observedUnknownContentTypes } = await normalizeBytes(bytes);
        const blocks = archive.graph.nodes['current-answer'].message?.blocks ?? [];

        expect(preflightDeepSeekHistoryArtifact(bytes, 'deepseek-branching-1')).toEqual(
          expectedUnknown
        );
        expect(observedUnknownContentTypes).toEqual(expectedUnknown);
        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({
          ...(content === ''
            ? expectedStringFragmentBlock(type, '')
            : { type: 'unknown', providerType: `${type}:non-text`, raw: { type } }),
          id: 'current-answer:block:0',
          sourceRefs: [
            {
              rawPointer: `${messagePointer}/fragments/0${content === '' ? '/content' : ''}`,
            },
          ],
        });
        expect(blocks[1]).toMatchObject({
          ...expectedStringFragmentBlock(type, fallback),
          id: 'current-answer:block:1',
          sourceRefs: [{ rawPointer: `${messagePointer}/${fallbackField}` }],
        });
        expect(JSON.stringify(archive)).not.toContain('synthetic-fragment-secret');
      }
    );

    it.each(unusableFragmentContents.filter(sample => sample.content !== ''))(
      'classifies both the $label fragment and its non-string fallback',
      async ({ content }) => {
        const fallback = { text: 'fallback shape', api_key: 'synthetic-fallback-secret' };
        const bytes = encodedTypedFragment(type, content, fallback);
        const expectedUnknown = [`${type}:non-text`, `message.${fallbackField}`].sort();
        const bundle = await bundleFor(bytes);
        const { archive, observedUnknownContentTypes } = await normalizeBytes(bytes);

        expect(preflightDeepSeekHistoryArtifact(bytes, 'deepseek-branching-1')).toEqual(
          expectedUnknown
        );
        expect(bundle.manifest.observedUnknownContentTypes).toEqual(expectedUnknown);
        expect(observedUnknownContentTypes).toEqual(expectedUnknown);
        expect(archive.graph.nodes['current-answer'].message?.blocks).toMatchObject([
          {
            type: 'unknown',
            providerType: `${type}:non-text`,
            raw: { type },
            sourceRefs: [{ rawPointer: `${messagePointer}/fragments/0` }],
          },
          {
            type: 'unknown',
            providerType: `message.${fallbackField}`,
            raw: { text: 'fallback shape' },
            sourceRefs: [{ rawPointer: `${messagePointer}/${fallbackField}` }],
          },
        ]);
        expect(archive.diagnostics.entries).toEqual(
          expect.arrayContaining(
            expectedUnknown.map(contentType =>
              expect.objectContaining({
                code: 'unknown-content-type',
                extensions: { deepseek: { contentType } },
              })
            )
          )
        );
        expect(JSON.stringify(archive)).not.toContain('synthetic-fallback-secret');
      }
    );

    it.each(['retained fragment', ' \t\n'])(
      'suppresses even a non-string fallback for non-empty content %j without trimming',
      async content => {
        const bytes = encodedTypedFragment(type, content, { text: 'suppressed fallback' });
        const { archive, observedUnknownContentTypes } = await normalizeBytes(bytes);

        expect(preflightDeepSeekHistoryArtifact(bytes, 'deepseek-branching-1')).toEqual([]);
        expect(observedUnknownContentTypes).toEqual([]);
        expect(archive.graph.nodes['current-answer'].message?.blocks).toMatchObject([
          expectedStringFragmentBlock(type, content),
        ]);
        expect(JSON.stringify(archive)).not.toContain('suppressed fallback');
      }
    );
  });

  it('suppresses category fallbacks after mixed empty, invalid, and non-empty fragments in order', async () => {
    const bytes = encodedRaw(raw => {
      const message = raw.data.biz_data.chat_messages[4];
      message.fragments = [
        { type: 'REQUEST', content: '' },
        { type: 'RESPONSE', content: { text: 'invalid visible fragment' } },
        { type: 'TEMPLATE_RESPONSE', content: 'retained visible fragment' },
        { type: 'THINK', content: '' },
        { type: 'THINK', content: null },
        { type: 'THINK', content: 'retained reasoning fragment' },
      ];
      message.content = 'suppressed visible fallback';
      message.thinking_content = 'suppressed reasoning fallback';
      delete message.files;
    });
    const { archive, observedUnknownContentTypes } = await normalizeBytes(bytes);
    const blocks = archive.graph.nodes['current-answer'].message?.blocks ?? [];
    const expectedUnknown = ['RESPONSE:non-text', 'THINK:non-text'];

    expect(preflightDeepSeekHistoryArtifact(bytes, 'deepseek-branching-1')).toEqual(
      expectedUnknown
    );
    expect(observedUnknownContentTypes).toEqual(expectedUnknown);
    expect(blocks).toMatchObject([
      { type: 'text', text: '' },
      { type: 'unknown', providerType: 'RESPONSE:non-text' },
      { type: 'markdown', markdown: 'retained visible fragment' },
      { type: 'reasoning', text: '' },
      { type: 'unknown', providerType: 'THINK:non-text' },
      { type: 'reasoning', text: 'retained reasoning fragment' },
    ]);
    expect(blocks.map(block => block.id)).toEqual(
      Array.from({ length: 6 }, (_, index) => `current-answer:block:${index}`)
    );
    expect(JSON.stringify(archive)).not.toContain('suppressed visible fallback');
    expect(JSON.stringify(archive)).not.toContain('suppressed reasoning fallback');
  });

  it.each(['ASSISTANT', ' ai ', ' bot '])(
    'projects visible fallback and gates reasoning fallback for normalized role %j and type casing',
    async role => {
      const bytes = encodedRaw(raw => {
        const message = raw.data.biz_data.chat_messages[4];
        message.role = role;
        message.fragments = [
          { type: ' response ', content: '' },
          { type: ' think ', content: false },
        ];
        message.content = 'projected visible fallback';
        message.thinking_content = 'gated reasoning fallback';
        delete message.files;
      });
      const { archive, observedUnknownContentTypes } = await normalizeBytes(bytes);
      const message = archive.graph.nodes['current-answer'].message;
      const withoutThinking = projectArchiveBranch(archive, { includeToolContent: false });
      const withThinking = projectArchiveBranch(archive, { includeToolContent: true });

      expect(preflightDeepSeekHistoryArtifact(bytes, 'deepseek-branching-1')).toEqual([
        'THINK:non-text',
      ]);
      expect(observedUnknownContentTypes).toEqual(['THINK:non-text']);
      expect(message?.author.role).toBe('assistant');
      expect(message?.blocks).toMatchObject([
        { type: 'markdown', markdown: '' },
        { type: 'unknown', providerType: 'THINK:non-text' },
        { type: 'markdown', markdown: 'projected visible fallback' },
        { type: 'reasoning', text: 'gated reasoning fallback' },
      ]);
      expect(withoutThinking.data.messages.at(-1)).toMatchObject({
        id: 'current-answer',
        content: 'projected visible fallback',
        toolContent: undefined,
      });
      expect(JSON.stringify(withoutThinking.data)).not.toContain('gated reasoning fallback');
      expect(withThinking.data.messages.at(-1)).toMatchObject({
        id: 'current-answer',
        content: 'projected visible fallback',
        toolContent: '**Reasoning**\ngated reasoning fallback',
      });
    }
  );

  it('redacts credentials and signed URLs from typed title and message blocks', async () => {
    const bytes = encodedRaw(raw => {
      raw.data.biz_data.chat_session.title = 'Authorization: Bearer title-secret';
      raw.data.biz_data.chat_messages[4].fragments = [
        {
          type: 'RESPONSE',
          content: 'Download https://chat.deepseek.com/file?id=1&access_token=message-secret',
        },
      ];
    });
    const { archive } = await normalizeBytes(bytes);
    const serialized = JSON.stringify(archive);

    expect(archive.conversation.title).toContain('[redacted-credential]');
    expect(serialized).toContain('[redacted-sensitive-url]');
    expect(serialized).not.toContain('title-secret');
    expect(serialized).not.toContain('message-secret');
  });

  it('keeps DeepSeek file transport URLs and relative signed paths raw-only', async () => {
    const fileId = '11111111-2222-4333-8444-555555555555';
    const state = 'synthetic-typed-transport-state';
    const bytes = encodedRaw(raw => {
      raw.data.biz_data.chat_session.title =
        'Safe reference https://example.invalid/path-/file?state=public';
      raw.data.biz_data.chat_messages[4].fragments = [
        {
          type: 'RESPONSE',
          content:
            `Download https://files.deepseeksvc.com/api/file?file_id=${fileId}` +
            `&state=${state}&ty=r or /file?file_id=${fileId}&state=${state}`,
        },
      ];
      raw.data.biz_data.chat_messages[4].extension_data = {
        transport: `https://files.deepseeksvc.com/api/file?file_id=${fileId}&state=${state}&ty=r`,
      };
    });

    const { archive } = await normalizeBytes(bytes);
    const serialized = JSON.stringify(archive);

    expect(archive.conversation.title).toContain('https://example.invalid/path-/file?state=public');
    expect(serialized).toContain('[redacted-sensitive-url]');
    expect(serialized).not.toContain(fileId);
    expect(serialized).not.toContain(state);
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'privacy-redacted-sensitive-extension-field' }),
      ])
    );
  });

  it('retains safe extension values while omitting sensitive and unsafe extension fields', async () => {
    const bytes = encodedRaw(raw => {
      raw.data.biz_data.chat_messages[4].extension_data = JSON.parse(
        '{"retained":true,"items":[1,null,"safe"],"api_key":"must-stay-raw","__proto__":"also-raw"}'
      );
    });

    const { archive } = await normalizeBytes(bytes);
    const extensions = archive.graph.nodes['current-answer'].message?.extensions.deepseek as {
      extension_data: unknown;
      _liskaRedactedSensitiveValue: boolean;
    };
    const serialized = JSON.stringify(extensions);

    expect(extensions).toMatchObject({
      extension_data: { retained: true, items: [1, null, 'safe'] },
      _liskaRedactedSensitiveValue: true,
    });
    expect(serialized).not.toContain('must-stay-raw');
    expect(serialized).not.toContain('also-raw');
    expect(archive.diagnostics.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'privacy-redacted-sensitive-extension-field',
          path: null,
          sourceRefs: [
            expect.objectContaining({
              rawPointer: '/data/biz_data/chat_messages/4/extension_data/api_key',
            }),
          ],
        }),
      ])
    );
  });

  it('bounds privacy sanitization and fails closed for malformed sensitive URLs', () => {
    const tracker = { redactions: [] };
    let deep: unknown = 'leaf';
    for (let depth = 0; depth < 17; depth += 1) deep = { next: deep };

    expect(sanitizeJson(deep, tracker, '/deep')).toMatchObject({ _liskaTruncated: true });
    expect(
      sanitizeJson(
        Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`key-${index}`, index])),
        tracker,
        '/many'
      )
    ).toMatchObject({ _liskaTruncated: true });
    expect(sanitizeJson('x'.repeat(32_769), tracker, '/long')).toMatchObject({
      _liskaTruncated: true,
    });
    expect(redactSensitiveText('Use http://[invalid', tracker, '/url')).toBe(
      'Use [redacted-sensitive-url]'
    );
    expect(
      redactSensitiveText(
        'Use /file?file_id=11111111-2222-4333-8444-555555555555&state=relative-state',
        tracker,
        '/relative-url'
      )
    ).toBe('Use [redacted-sensitive-url]');
    expect(
      redactSensitiveText(
        'Use https://example.invalid/page?next=/file?state=public and //example.invalid/file?state=public and www.example.invalid/file?state=public',
        tracker,
        '/safe-file-paths'
      )
    ).toBe(
      'Use https://example.invalid/page?next=/file?state=public and //example.invalid/file?state=public and www.example.invalid/file?state=public'
    );
    expect(
      sanitizeJson(
        {
          signed_path:
            '/file?file_id=11111111-2222-4333-8444-555555555555&state=synthetic-relative-state',
        },
        tracker,
        '/relative-file'
      )
    ).not.toHaveProperty('signed_path');
    expect(tracker.redactions).toEqual(
      expect.arrayContaining([expect.objectContaining({ pointer: '/url' })])
    );
  });

  it('fails closed when the manifest omits observed unknown content types', async () => {
    const bundle = await bundleFor(fixtureBytes);
    bundle.manifest.observedUnknownContentTypes = [];
    const manifestSha256 = hash(new TextEncoder().encode(JSON.stringify(bundle.manifest, null, 2)));

    await expect(
      normalizeDeepSeekCapture({
        bundle,
        artifactId: 'conversation',
        manifestSha256,
        sha256,
      })
    ).rejects.toMatchObject<Partial<DeepSeekNormalizationError>>({
      code: 'unknown-content-types-mismatch',
    });
  });

  it.each([
    [
      'delta',
      (raw: DeepSeekRaw) => (raw.data.biz_data.cache_control = 'APPEND'),
      'incomplete-cache-response',
    ],
    [
      'session mismatch',
      (raw: DeepSeekRaw) => (raw.data.biz_data.chat_session.id = 'other-session'),
      'conversation-id-mismatch',
    ],
    [
      'duplicate ids',
      (raw: DeepSeekRaw) => (raw.data.biz_data.chat_messages[4].message_id = 'inactive-answer'),
      'duplicate-message-id',
    ],
    [
      'non-string role',
      (raw: DeepSeekRaw) => (raw.data.biz_data.chat_messages[4].role = 1),
      'invalid-role',
    ],
    [
      'unsafe role',
      (raw: DeepSeekRaw) => (raw.data.biz_data.chat_messages[4].role = 'assistant role'),
      'invalid-role',
    ],
    [
      'missing parent',
      (raw: DeepSeekRaw) => (raw.data.biz_data.chat_messages[4].parent_id = 'missing'),
      'parent-message-missing',
    ],
    [
      'missing current',
      (raw: DeepSeekRaw) => (raw.data.biz_data.chat_session.current_message_id = 'missing'),
      'current-message-missing',
    ],
    [
      'absent current field',
      (raw: DeepSeekRaw) => {
        delete raw.data.biz_data.chat_session.current_message_id;
      },
      'current-message-missing',
    ],
    [
      'absent parent field',
      (raw: DeepSeekRaw) => {
        delete raw.data.biz_data.chat_messages[1].parent_id;
      },
      'missing-parent-id',
    ],
    [
      'cycle',
      (raw: DeepSeekRaw) => (raw.data.biz_data.chat_messages[0].parent_id = 'current-answer'),
      'graph-cycle',
    ],
  ] as const)('rejects %s deterministically', async (_label, mutate, code) => {
    await expectCode(encodedRaw(mutate), code);
  });

  it('rejects malformed JSON and malformed UTF-8', async () => {
    await expectCode(new TextEncoder().encode('{'), 'malformed-raw-artifact');
    await expectCode(
      new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
      'malformed-raw-artifact'
    );
  });

  it('fails closed on raw and manifest integrity drift', async () => {
    const rawBundle = await bundleFor(fixtureBytes);
    rawBundle.artifacts[0].bytes = new Uint8Array(
      fixtureBytes.map((byte, index) => (index === 0 ? byte ^ 1 : byte))
    );
    const rawManifestSha = hash(
      new TextEncoder().encode(JSON.stringify(rawBundle.manifest, null, 2))
    );
    await expect(
      normalizeDeepSeekCapture({
        bundle: rawBundle,
        artifactId: 'conversation',
        manifestSha256: rawManifestSha,
        sha256,
      })
    ).rejects.toMatchObject({ code: 'artifact-integrity-failed' });

    const cleanBundle = await bundleFor(fixtureBytes);
    await expect(
      normalizeDeepSeekCapture({
        bundle: cleanBundle,
        artifactId: 'conversation',
        manifestSha256: '0'.repeat(64),
        sha256,
      })
    ).rejects.toMatchObject({ code: 'manifest-integrity-failed' });
  });

  it('normalizes a 2500-node chain without recursive graph traversal', async () => {
    const count = 2_500;
    const raw = structuredClone(fixture);
    raw.data.biz_data.chat_session.current_message_id = String(count);
    raw.data.biz_data.chat_messages = Array.from({ length: count }, (_, index) => ({
      message_id: String(index + 1),
      parent_id: index === 0 ? null : String(index),
      role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
      content: `Message ${index + 1}`,
    }));
    const result = await normalizeBytes(new TextEncoder().encode(JSON.stringify(raw)));
    expect(Object.keys(result.archive.graph.nodes)).toHaveLength(count);
    expect(result.archive.conversation.currentNodeId).toBe(String(count));
  });
});
