import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_ATTACHMENT_INVENTORY_WARNING,
  inventoryDeepSeekRawAssets,
} from '../../src/archive';
import {
  deepSeekAttachmentBlock,
  deepSeekManifestAssetsBySourceRef,
  verifyDeepSeekAssetInventory,
  type DeepSeekAttachmentContext,
} from '../../src/archive/normalizers/deepseek/assets';

const fixture = JSON.parse(
  new TextDecoder().decode(
    readFileSync('test/fixtures/archive/deepseek-raw/branching-replace.json')
  )
) as Record<string, unknown>;

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function attachmentContext(): DeepSeekAttachmentContext {
  return {
    artifactId: 'conversation',
    format: 'deepseek.web.history',
    privacy: { redactions: [] },
    manifestAssetsBySourceRef: new Map(),
    assets: {},
  };
}

function validFile(): Record<string, unknown> {
  return {
    id: 'synthetic-file-1',
    file_name: 'synthetic.txt',
    file_size: 3,
    inserted_at: '2026-09-18T06:00:00.000Z',
    updated_at: '2026-09-18T06:00:00.000Z',
    status: 'ready',
    error_code: null,
    previewable: true,
    token_usage: 1,
  };
}

describe('DeepSeek metadata-only attachment inventory', () => {
  it('keeps distinct provider IDs distinct while merging only an exact repeated ID', async () => {
    const first = await inventoryDeepSeekRawAssets({
      raw: fixture,
      artifactId: 'conversation',
      sha256,
    });
    const second = await inventoryDeepSeekRawAssets({
      raw: structuredClone(fixture),
      artifactId: 'conversation',
      sha256,
    });

    expect(first).toEqual(second);
    expect(first.completeness).toBe('not-attempted');
    expect(first.warnings).toEqual([]);
    expect(first.assets).toHaveLength(2);
    expect(first.assets.map(asset => asset.id)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^deepseek-asset-[a-f0-9]{64}$/),
        expect.stringMatching(/^deepseek-asset-[a-f0-9]{64}$/),
      ])
    );
    expect(new Set(first.assets.map(asset => asset.id)).size).toBe(2);
    expect(first.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'not-attempted',
          attemptedAt: null,
          relativePath: null,
          mediaType: null,
          byteLength: null,
          sha256: null,
          sourceRefs: [
            { artifactId: 'conversation', rawPointer: '/data/biz_data/chat_messages/0/files/0' },
            { artifactId: 'conversation', rawPointer: '/data/biz_data/chat_messages/4/files/0' },
          ],
        }),
        expect.objectContaining({
          sourceRefs: [
            { artifactId: 'conversation', rawPointer: '/data/biz_data/chat_messages/2/files/0' },
          ],
        }),
      ])
    );
    expect(JSON.stringify(first.assets)).not.toContain('deepseek-file-alpha');
    expect(JSON.stringify(first.assets)).not.toContain('deepseek-file-beta');
  });

  it.each([
    [
      'a malformed files array',
      (raw: Record<string, any>) => {
        raw.data.biz_data.chat_messages[0].files = {};
      },
    ],
    [
      'conflicting metadata for one exact provider ID',
      (raw: Record<string, any>) => {
        raw.data.biz_data.chat_messages[4].files[0].file_size = 2049;
      },
    ],
    [
      'an unsafe provider ID',
      (raw: Record<string, any>) => {
        raw.data.biz_data.chat_messages[0].files[0].id = 'https://example.invalid/transport';
      },
    ],
  ])('degrades safely for %s', async (_label, mutate) => {
    const raw = structuredClone(fixture) as Record<string, any>;
    mutate(raw);

    await expect(
      inventoryDeepSeekRawAssets({ raw, artifactId: 'conversation', sha256 })
    ).resolves.toEqual({
      assets: [],
      completeness: 'unknown',
      warnings: [DEEPSEEK_ATTACHMENT_INVENTORY_WARNING],
      providerIds: expect.any(Array),
    });
  });

  it('fails closed if attachment block construction diverges from the verified inventory', () => {
    const context = attachmentContext();

    expect(() => deepSeekAttachmentBlock({}, 'message-1', 0, '/files/0', context)).toThrow(
      'DeepSeek attachment inventory changed during normalization.'
    );
    expect(() => deepSeekAttachmentBlock(validFile(), 'message-1', 0, '/files/0', context)).toThrow(
      'DeepSeek attachment pointer is absent from the manifest.'
    );

    const pointer = '/files/0';
    context.manifestAssetsBySourceRef.set('conversation\u0000/files/0', {
      id: 'deepseek-asset-synthetic',
      state: 'not-attempted',
      attemptedAt: null,
      relativePath: null,
      mediaType: null,
      byteLength: null,
      sha256: null,
      detail: 'metadata-only',
      sourceRefs: [{ artifactId: 'conversation', rawPointer: pointer }],
    });
    deepSeekAttachmentBlock(validFile(), 'message-1', 0, pointer, context);
    context.assets['deepseek-asset-synthetic'].byteLength = 4;

    expect(() => deepSeekAttachmentBlock(validFile(), 'message-2', 0, pointer, context)).toThrow(
      'Repeated DeepSeek attachment metadata disagrees.'
    );
  });

  it('degrades a recursively over-deep metadata value without preserving it', async () => {
    const raw = structuredClone(fixture) as Record<string, any>;
    let deep: unknown = 'leaf';
    for (let index = 0; index < 17; index += 1) deep = { next: deep };
    raw.data.biz_data.chat_messages[0].files[0].token_usage = deep;
    raw.data.biz_data.chat_messages[4].files[0].token_usage = deep;

    await expect(
      inventoryDeepSeekRawAssets({ raw, artifactId: 'conversation', sha256 })
    ).resolves.toEqual({
      assets: [],
      completeness: 'unknown',
      warnings: [DEEPSEEK_ATTACHMENT_INVENTORY_WARNING],
      providerIds: expect.any(Array),
    });
  });

  it('rejects ambiguous pointers and a degraded ledger without its stable warning', () => {
    const asset = {
      id: 'deepseek-asset-synthetic',
      state: 'not-attempted' as const,
      attemptedAt: null,
      relativePath: null,
      mediaType: null,
      byteLength: null,
      sha256: null,
      detail: 'metadata-only',
      sourceRefs: [{ artifactId: 'conversation', rawPointer: '/files/0' }],
    };

    expect(() => deepSeekManifestAssetsBySourceRef([asset, { ...asset, id: 'other' }])).toThrow(
      'DeepSeek attachment pointers are ambiguous.'
    );
    expect(() =>
      verifyDeepSeekAssetInventory(
        {
          assets: [],
          completeness: { assets: 'unknown' },
          warnings: [],
        } as never,
        {
          assets: [],
          completeness: 'unknown',
          warnings: [DEEPSEEK_ATTACHMENT_INVENTORY_WARNING],
          providerIds: [],
        }
      )
    ).toThrow('DeepSeek attachment inventory warning does not match the verified raw artifact.');
  });
});
