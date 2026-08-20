import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CHATGPT_ASSET_INVENTORY_DETAIL,
  CHATGPT_ASSET_INVENTORY_WARNING,
  inventoryChatGptRawAssets,
} from '../../src/archive/normalizers/chatgpt/inventory';
import {
  manifestAssetsById,
  reconcileManifestAssets,
  upsertAsset,
} from '../../src/archive/normalizers/chatgpt/assets';
import type { AssetContext } from '../../src/archive/normalizers/chatgpt/contracts';
import type { PrivacyTracker } from '../../src/archive/normalizers/chatgpt/privacy';

type RawRecord = Record<string, unknown>;

function sha256(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function rootRaw(content: unknown, metadata: Record<string, unknown> = {}): RawRecord {
  return {
    mapping: {
      root: {
        message: { content, metadata },
      },
    },
  };
}

function contentWithParts(parts: unknown[]): RawRecord {
  return { content_type: 'text', parts };
}

async function inventory(raw: unknown) {
  return inventoryChatGptRawAssets({ raw, artifactId: 'conversation', sha256 });
}

describe('ChatGPT raw attachment inventory', () => {
  it('discovers sediment and file-service pointer-only assets across nested content without retaining transport', async () => {
    const sedimentPointer = 'sediment://opaque-private-value';
    const fileServicePointer = 'file-service:opaque-private-value';
    const result = await inventory(
      rootRaw(
        contentWithParts([
          {
            content_type: 'file_asset_pointer',
            asset_pointer: sedimentPointer,
            filename: 'same-name.txt',
            mime_type: 'text/plain',
          },
          contentWithParts([
            {
              content_type: 'file_asset_pointer',
              asset_pointer: fileServicePointer,
              filename: 'same-name.txt',
              mime_type: 'application/not-a-known-type',
            },
          ]),
        ])
      )
    );

    expect(result.completeness).toBe('not-attempted');
    expect(result.warnings).toEqual([]);
    expect(result.assets).toHaveLength(2);
    expect(result.assets.map(asset => asset.mediaType).sort()).toEqual([null, 'text/plain']);
    expect(result.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^chatgpt-asset-[a-f0-9]{64}$/),
          state: 'not-attempted',
          attemptedAt: null,
          byteLength: null,
          sha256: null,
          detail: CHATGPT_ASSET_INVENTORY_DETAIL,
        }),
      ])
    );
    expect(JSON.stringify(result.assets)).not.toContain(sedimentPointer);
    expect(JSON.stringify(result.assets)).not.toContain(fileServicePointer);
    expect(JSON.stringify(result.assets)).not.toContain('same-name.txt');
  });

  it('discovers metadata-only IDs but makes no byte-length claim', async () => {
    const metadataId = 'metadata-only-private-id';
    const result = await inventory(
      rootRaw(contentWithParts(['plain text']), {
        attachments: [
          {
            id: metadataId,
            name: 'metadata-only.txt',
            mime_type: 'application/pdf',
            size: 123_456,
            library_file_id: 'library-private-id',
            source: 'library',
          },
        ],
      })
    );

    expect(result.assets).toEqual([
      expect.objectContaining({
        mediaType: 'application/pdf',
        byteLength: null,
        sha256: null,
        relativePath: null,
        sourceRefs: [
          {
            artifactId: 'conversation',
            rawPointer: '/mapping/root/message/metadata/attachments/0',
          },
        ],
      }),
    ]);
    expect(JSON.stringify(result.assets)).not.toContain(metadataId);
    expect(JSON.stringify(result.assets)).not.toContain('library-private-id');
  });

  it('deduplicates only exact identities and never filenames', async () => {
    const repeatedPointer = 'sediment://one';
    const result = await inventory(
      rootRaw(
        contentWithParts([
          {
            content_type: 'image_asset_pointer',
            asset_pointer: repeatedPointer,
            filename: 'same.png',
            mime_type: 'image/png',
          },
          {
            content_type: 'image_asset_pointer',
            asset_pointer: repeatedPointer,
            filename: 'same.png',
            mime_type: 'image/png',
          },
          {
            content_type: 'image_asset_pointer',
            asset_pointer: 'sediment://two',
            filename: 'same.png',
            mime_type: 'image/png',
          },
          {
            content_type: 'file',
            file_id: 'provider-id-one',
            filename: 'same.png',
            mime_type: 'image/png',
          },
          {
            content_type: 'file',
            file_id: 'provider-id-one',
            filename: 'different-name.png',
            mime_type: 'image/png',
          },
        ])
      )
    );

    expect(result.assets).toHaveLength(3);
    expect(result.assets.map(asset => asset.sourceRefs.length).sort()).toEqual([1, 2, 2]);
    expect(
      result.assets.flatMap(asset => asset.sourceRefs.map(source => source.rawPointer))
    ).toEqual(
      expect.arrayContaining([
        '/mapping/root/message/content/parts/0',
        '/mapping/root/message/content/parts/1',
        '/mapping/root/message/content/parts/2',
        '/mapping/root/message/content/parts/3',
        '/mapping/root/message/content/parts/4',
      ])
    );
  });

  it('deduplicates one exact provider ID across content and metadata locations', async () => {
    const sharedId = 'shared-private-provider-id';
    const result = await inventory(
      rootRaw(
        contentWithParts([
          {
            content_type: 'file',
            file_id: sharedId,
            mime_type: 'application/pdf',
          },
        ]),
        {
          attachments: [{ id: sharedId, mime_type: 'application/pdf' }],
          files: [{ fileId: sharedId, mimeType: 'application/pdf' }],
        }
      )
    );

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.sourceRefs).toEqual([
      {
        artifactId: 'conversation',
        rawPointer: '/mapping/root/message/content/parts/0',
      },
      {
        artifactId: 'conversation',
        rawPointer: '/mapping/root/message/metadata/attachments/0',
      },
      {
        artifactId: 'conversation',
        rawPointer: '/mapping/root/message/metadata/files/0',
      },
    ]);
    expect(JSON.stringify(result.assets)).not.toContain(sharedId);
  });

  it('accepts a nested conversation envelope and retains its exact raw location', async () => {
    const result = await inventory({
      conversation: rootRaw(
        contentWithParts([
          {
            content_type: 'file',
            file_id: 'nested-private-id',
            mime_type: 'text/plain',
          },
        ])
      ),
    });

    expect(result.completeness).toBe('not-attempted');
    expect(result.assets[0]?.sourceRefs).toEqual([
      {
        artifactId: 'conversation',
        rawPointer: '/conversation/mapping/root/message/content/parts/0',
      },
    ]);
  });

  it('falls back to a stable unknown inventory on malformed or ambiguous raw shape', async () => {
    const malformed = await inventory(rootRaw({ content_type: 'text', parts: 'not-an-array' }));
    const ambiguous = await inventory({
      ...rootRaw(contentWithParts([])),
      conversation: rootRaw(contentWithParts([])),
    });

    for (const result of [malformed, ambiguous]) {
      expect(result).toEqual({
        assets: [],
        completeness: 'unknown',
        warnings: [CHATGPT_ASSET_INVENTORY_WARNING],
      });
    }
  });

  it('fails closed for invalid inputs, ambiguous metadata, and non-canonical digests', async () => {
    const invalidInput = await inventoryChatGptRawAssets({
      raw: rootRaw(contentWithParts([])),
      artifactId: 1 as unknown as string,
      sha256,
    });
    const missingContentType = await inventory(
      rootRaw(contentWithParts([{ file_id: 'missing-type' }]))
    );
    const conflictingMime = await inventory(
      rootRaw(
        contentWithParts([
          { content_type: 'file', file_id: 'same-id', mime_type: 'image/png' },
          { content_type: 'file', file_id: 'same-id', mime_type: 'image/jpeg' },
        ])
      )
    );
    const invalidDigest = await inventoryChatGptRawAssets({
      raw: rootRaw(contentWithParts([{ content_type: 'file', file_id: 'digest-id' }])),
      artifactId: 'conversation',
      sha256: () => Promise.resolve('NOT-A-DIGEST'),
    });
    const collidingDigest = await inventoryChatGptRawAssets({
      raw: rootRaw(
        contentWithParts([
          { content_type: 'file', file_id: 'first' },
          { content_type: 'file', file_id: 'second' },
        ])
      ),
      artifactId: 'conversation',
      sha256: () => Promise.resolve('a'.repeat(64)),
    });

    for (const result of [
      invalidInput,
      missingContentType,
      conflictingMime,
      invalidDigest,
      collidingDigest,
    ]) {
      expect(result).toEqual({
        assets: [],
        completeness: 'unknown',
        warnings: [CHATGPT_ASSET_INVENTORY_WARNING],
      });
    }
  });

  it('uses the exact raw location when an attachment has no ID or transport pointer', async () => {
    const first = await inventory(
      rootRaw(contentWithParts([{ content_type: 'file', mime_type: 'text/plain' }]))
    );
    const second = await inventory(
      rootRaw(contentWithParts([{ content_type: 'file', mime_type: 'text/plain' }]))
    );

    expect(first.assets).toHaveLength(1);
    expect(first.assets[0]?.id).toBe(second.assets[0]?.id);
    expect(first.assets[0]?.sourceRefs[0]?.rawPointer).toBe(
      '/mapping/root/message/content/parts/0'
    );
  });

  it('deduplicates thousands of references and bounds concurrent identity hashes', async () => {
    const repeated = Array.from({ length: 2_000 }, () => ({
      content_type: 'file',
      file_id: 'one-repeated-id',
    }));
    const unique = Array.from({ length: 40 }, (_, index) => ({
      content_type: 'file',
      file_id: `unique-${index}`,
    }));
    let active = 0;
    let maximum = 0;
    const boundedSha256 = async (bytes: Uint8Array): Promise<string> => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return createHash('sha256').update(bytes).digest('hex');
    };

    const result = await inventoryChatGptRawAssets({
      raw: rootRaw(contentWithParts([...repeated, ...unique])),
      artifactId: 'conversation',
      sha256: boundedSha256,
    });

    expect(result.assets).toHaveLength(41);
    expect(result.assets.find(asset => asset.sourceRefs.length === 2_000)).toBeDefined();
    expect(maximum).toBeLessThanOrEqual(16);
  });

  it('matches manifest evidence by exact raw pointer before a provider ID and propagates attemptedAt', () => {
    const privacy: PrivacyTracker = { redactions: [] };
    const pointer = '/mapping/root/message/content/parts/0';
    const context: AssetContext = {
      assets: {},
      assetIdsByIdentity: new Map(),
      manifestAssets: manifestAssetsById([
        {
          id: `chatgpt-asset-${'a'.repeat(64)}`,
          state: 'expired',
          attemptedAt: '2026-08-17T12:00:01.000Z',
          relativePath: null,
          mediaType: 'text/plain',
          byteLength: null,
          sha256: null,
          detail: 'acquisition-expired',
          sourceRefs: [{ artifactId: 'conversation', rawPointer: pointer }],
        },
      ]),
      artifactId: 'conversation',
      format: 'synthetic',
      privacy,
    };

    const assetId = upsertAsset(
      {
        content_type: 'file',
        file_id: 'different-provider-id',
        filename: 'private-name.txt',
        mime_type: 'text/plain',
      },
      pointer,
      context
    );

    expect(assetId).toBe(`chatgpt-asset-${'a'.repeat(64)}`);
    expect(context.assets[assetId]?.acquisition).toEqual({
      state: 'expired',
      attemptedAt: '2026-08-17T12:00:01.000Z',
      detail: 'acquisition-expired',
    });
    expect(context.assets[assetId]?.sourceRefs).toContainEqual(
      expect.objectContaining({ id: 'different-provider-id', rawPointer: pointer })
    );
  });

  it('preserves manifest references to another artifact and rejects conflicting source IDs', () => {
    const privacy: PrivacyTracker = { redactions: [] };
    const manifestAsset = {
      id: `chatgpt-asset-${'b'.repeat(64)}`,
      state: 'not-attempted',
      attemptedAt: null,
      relativePath: null,
      mediaType: null,
      byteLength: null,
      sha256: null,
      detail: CHATGPT_ASSET_INVENTORY_DETAIL,
      sourceRefs: [{ artifactId: 'other-artifact', rawPointer: '/asset' }],
    };
    const foreignContext: AssetContext = {
      assets: {},
      assetIdsByIdentity: new Map(),
      manifestAssets: manifestAssetsById([manifestAsset]),
      artifactId: 'conversation',
      format: 'synthetic',
      privacy,
    };
    reconcileManifestAssets(foreignContext);
    expect(foreignContext.assets[manifestAsset.id]?.sourceRefs).toEqual([
      expect.objectContaining({ artifactId: 'other-artifact', rawPointer: '/asset' }),
    ]);

    const pointer = '/asset';
    const conflictContext: AssetContext = {
      assets: {},
      assetIdsByIdentity: new Map(),
      manifestAssets: manifestAssetsById([
        {
          ...manifestAsset,
          sourceRefs: [{ artifactId: 'conversation', rawPointer: pointer }],
        },
      ]),
      artifactId: 'conversation',
      format: 'synthetic',
      privacy: { redactions: [] },
    };
    upsertAsset({ content_type: 'file', file_id: 'first-id' }, pointer, conflictContext);
    expect(() =>
      upsertAsset({ content_type: 'file', file_id: 'second-id' }, pointer, conflictContext)
    ).toThrow(expect.objectContaining({ code: 'asset-conflict' }));
  });
});
