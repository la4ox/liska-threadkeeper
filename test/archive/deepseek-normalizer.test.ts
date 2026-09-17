import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  DeepSeekNormalizationError,
  inventoryDeepSeekRawAssets,
  normalizeDeepSeekCapture,
  preflightDeepSeekHistoryArtifact,
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
          id: 'deepseek-file-alpha',
          rawPointer: '/data/biz_data/chat_messages/0/files/0',
        },
      ],
    });
    expect(currentBlocks.at(-1)).toMatchObject({
      type: 'attachment',
      sourceRefs: [
        {
          id: 'deepseek-file-alpha',
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
      sourceRefs: [
        expect.objectContaining({ id: 'deepseek-file-alpha' }),
        expect.objectContaining({ id: 'deepseek-file-alpha' }),
      ],
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
