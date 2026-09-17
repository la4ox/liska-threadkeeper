import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  type RawCaptureAssetRecord,
  type RawCaptureBundle,
} from '../../src/archive';
import { MAX_CONTENT_SIZE } from '../../src/lib/constants';
import { CHATGPT_INLINE_CAPTURE_MAX_BYTES } from '../../src/lib/chatgpt-capture-contract';
import {
  appendJsonCanonicalCompanion,
  buildJsonRawManifestCompanion,
  shouldStageJsonArchiveArtifact,
} from '../../src/content/capture/json-archive-companion';

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function bundleFor(
  options: { rawPath?: string; assets?: RawCaptureAssetRecord[] } = {}
): RawCaptureBundle {
  const bytes = new TextEncoder().encode('{"ok":true}');
  const manifest = buildCaptureManifest({
    captureId: 'capture-deepseek-companion-001',
    provider: 'deepseek',
    conversationId: 'deepseek-companion-1',
    capturedAt: '2026-09-18T06:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [
      {
        id: 'conversation',
        relativePath: options.rawPath ?? 'responses/conversation.json',
        mediaType: 'application/json',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        endpoint: { method: 'GET', pathPattern: '/api/v0/chat/history_messages' },
      },
    ],
    assets: options.assets ?? [],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'not-attempted',
    },
  });
  return { manifest, artifacts: [{ record: manifest.artifacts[0], bytes }], assets: [] };
}

describe('provider-neutral JSON archive companions', () => {
  it('selects staging only above the exact raw and canonical inline boundaries', () => {
    expect(shouldStageJsonArchiveArtifact('raw', CHATGPT_INLINE_CAPTURE_MAX_BYTES)).toBe(false);
    expect(shouldStageJsonArchiveArtifact('raw', CHATGPT_INLINE_CAPTURE_MAX_BYTES + 1)).toBe(true);
    expect(shouldStageJsonArchiveArtifact('canonical', MAX_CONTENT_SIZE)).toBe(false);
    expect(shouldStageJsonArchiveArtifact('canonical', MAX_CONTENT_SIZE + 1)).toBe(true);
  });

  it.each([
    [
      'a noncanonical raw path',
      bundleFor({ rawPath: 'responses/noncanonical.json' }),
      'JSON archive raw artifact path is not canonical',
    ],
    [
      'an attempted asset inventory',
      bundleFor({
        assets: [
          {
            id: 'asset-1',
            state: 'failed',
            attemptedAt: '2026-09-18T06:01:00.000Z',
            relativePath: null,
            mediaType: null,
            byteLength: null,
            sha256: null,
            detail: 'fetch-failed',
            sourceRefs: [{ artifactId: 'conversation', rawPointer: '/data/asset' }],
          },
        ],
      }),
      'JSON archive companion requires one raw artifact and only metadata-only asset inventory records',
    ],
  ] as const)('rejects %s before creating a companion pair', async (_label, bundle, message) => {
    await expect(buildJsonRawManifestCompanion(bundle, sha256, 'deepseek')).rejects.toThrow(
      message
    );
  });

  it('keeps a metadata-only asset ledger with raw and manifest evidence', async () => {
    const bundle = bundleFor({
      assets: [
        {
          id: 'asset-1',
          state: 'not-attempted',
          attemptedAt: null,
          relativePath: null,
          mediaType: null,
          byteLength: null,
          sha256: null,
          detail: 'metadata-only',
          sourceRefs: [{ artifactId: 'conversation', rawPointer: '/data/asset' }],
        },
      ],
    });

    await expect(buildJsonRawManifestCompanion(bundle, sha256, 'deepseek')).resolves.toMatchObject({
      artifacts: [
        expect.objectContaining({ kind: 'raw' }),
        expect.objectContaining({ kind: 'manifest' }),
      ],
    });
  });

  it('rejects canonical append unless the existing pair is exactly raw then manifest', async () => {
    await expect(
      appendJsonCanonicalCompanion(
        {
          captureId: 'capture-deepseek-companion-001',
          conversationKey: 'a'.repeat(64),
          artifacts: [],
        },
        {} as never,
        sha256,
        'deepseek'
      )
    ).rejects.toThrow('Canonical companion requires an exact raw + manifest pair');
  });
});
