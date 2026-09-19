import { describe, expect, it } from 'vitest';
import {
  buildCaptureManifest,
  inventoryDeepSeekRawAssets,
  type RawCaptureBundle,
} from '../../src/archive';
import { deepSeekAttachmentIdForProviderId } from '../../src/archive/normalizers/deepseek/inventory';
import {
  deepSeekDownloadUrl,
  deriveDeepSeekAssetCandidates,
  deriveDeepSeekPageOwnedAssetCandidates,
  deriveDeepSeekSignedAssetCandidates,
  isExactDeepSeekDownloadUrl,
} from '../../src/content/capture/deepseek-asset-resolver';
import { sha256Hex } from '../../src/content/capture/response';

const PROVIDER_ID = 'file-11111111-2222-4333-8444-555555555555';
const FILE_ID = '11111111-2222-4333-8444-555555555555';
const STATE = 'synthetic-opaque-state';
const PERFORMANCE_STATE = 'synthetic-performance-state';

function performanceUrl(fileId = FILE_ID, state = PERFORMANCE_STATE): string {
  return (
    'https://files.deepseeksvc.com/api/file?' +
    new URLSearchParams({ file_id: fileId, state, ty: 'r' }).toString()
  );
}

function resource(name: string, initiatorType = 'fetch'): Record<string, unknown> {
  return { initiatorType, name };
}

async function bundleForFile(overrides: Record<string, unknown> = {}): Promise<RawCaptureBundle> {
  const file = {
    id: PROVIDER_ID,
    file_name: 'synthetic.txt',
    file_size: 93,
    status: 'SUCCESS',
    signed_path: `/file?file_id=${FILE_ID}&state=${STATE}`,
    ...overrides,
  };
  const raw = {
    data: {
      biz_data: {
        chat_messages: [{ files: [file] }],
      },
    },
  };
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const artifact = {
    id: 'conversation',
    relativePath: 'responses/conversation.json',
    mediaType: 'application/json',
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    endpoint: { method: 'GET' as const, pathPattern: '/api/v0/chat/history_messages' },
  };
  const assetId = await deepSeekAttachmentIdForProviderId(PROVIDER_ID, sha256Hex);
  const manifest = buildCaptureManifest({
    captureId: 'capture-deepseek-synthetic-resolver',
    provider: 'deepseek',
    conversationId: 'synthetic-conversation',
    capturedAt: '2026-09-19T10:00:00.000Z',
    method: 'same-origin-api',
    artifacts: [artifact],
    assets: [
      {
        id: assetId,
        state: 'not-attempted',
        attemptedAt: null,
        relativePath: null,
        mediaType: null,
        byteLength: null,
        sha256: null,
        detail: 'metadata-only',
        sourceRefs: [
          {
            artifactId: 'conversation',
            rawPointer: '/data/biz_data/chat_messages/0/files/0',
          },
        ],
      },
    ],
    completeness: {
      graph: 'complete',
      messages: 'complete',
      branches: 'complete',
      assets: 'not-attempted',
    },
  });
  return { manifest, artifacts: [{ record: artifact, bytes }], assets: [] };
}

async function bundleForFragmentFile(): Promise<RawCaptureBundle> {
  const legacy = await bundleForFile();
  const raw = JSON.parse(new TextDecoder().decode(legacy.artifacts[0].bytes)) as any;
  const file = raw.data.biz_data.chat_messages[0].files[0];
  raw.data.biz_data.chat_messages[0] = {
    fragments: [{ files: [file], id: 'synthetic-fragment-id', type: 'FILE' }],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(raw));
  const artifact = {
    ...legacy.manifest.artifacts[0],
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
  const inventory = await inventoryDeepSeekRawAssets({
    raw,
    artifactId: 'conversation',
    sha256: sha256Hex,
  });
  const manifest = buildCaptureManifest({
    ...legacy.manifest,
    artifacts: [artifact],
    assets: inventory.assets,
    completeness: { ...legacy.manifest.completeness, assets: inventory.completeness },
  });
  return { manifest, artifacts: [{ record: artifact, bytes }], assets: [] };
}

describe('DeepSeek signed-path resolver', () => {
  it('accepts only the bounded relative /file grammar and normalizes the file- prefix', () => {
    expect(deepSeekDownloadUrl(PROVIDER_ID, `/file?file_id=${FILE_ID}&state=${STATE}`)).toBe(
      `https://files.deepseeksvc.com/api/file?file_id=${FILE_ID}&state=${STATE}&ty=r`
    );
    expect(deepSeekDownloadUrl(FILE_ID, `/file?state=${STATE}&file_id=${FILE_ID}`)).toBe(
      `https://files.deepseeksvc.com/api/file?file_id=${FILE_ID}&state=${STATE}&ty=r`
    );
  });

  it.each([
    `https://evil.example/file?file_id=${FILE_ID}&state=${STATE}`,
    `//evil.example/file?file_id=${FILE_ID}&state=${STATE}`,
    `/other?file_id=${FILE_ID}&state=${STATE}`,
    `/x/../file?file_id=${FILE_ID}&state=${STATE}`,
    `/file?file_id=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&state=${STATE}`,
    `/file?file_id=${FILE_ID}&file_id=${FILE_ID}&state=${STATE}`,
    `/file?file_id=${FILE_ID}&state=${STATE}&state=duplicate`,
    `/file?file_id=${FILE_ID}&state=${STATE}&ty=r`,
    `/file?file_id=${FILE_ID}&state=${STATE}&download=1`,
    `/file?file_id=${FILE_ID}&state=`,
    `/file?file_id=${FILE_ID}`,
    `/file?file_id=${FILE_ID}&state=${STATE}#fragment`,
  ])('rejects forged or ambiguous signed_path %s', signedPath => {
    expect(deepSeekDownloadUrl(PROVIDER_ID, signedPath)).toBeUndefined();
  });

  it('binds a candidate to the hashed manifest id and exact raw source ref', async () => {
    const bundle = await bundleForFile();
    await expect(deriveDeepSeekSignedAssetCandidates(bundle)).resolves.toEqual([
      {
        assetId: bundle.manifest.assets[0].id,
        downloadUrl: `https://files.deepseeksvc.com/api/file?file_id=${FILE_ID}&state=${STATE}&ty=r`,
        declaredByteLength: 93,
      },
    ]);
  });

  it('derives the same strict candidate from the current FILE fragment source pointer', async () => {
    const bundle = await bundleForFragmentFile();
    const candidates = await deriveDeepSeekSignedAssetCandidates(bundle);

    expect(bundle.manifest.assets[0].sourceRefs).toEqual([
      {
        artifactId: 'conversation',
        rawPointer: '/data/biz_data/chat_messages/0/fragments/0/files/0',
      },
    ]);
    expect(candidates).toEqual([
      {
        assetId: bundle.manifest.assets[0].id,
        downloadUrl: `https://files.deepseeksvc.com/api/file?file_id=${FILE_ID}&state=${STATE}&ty=r`,
        declaredByteLength: 93,
      },
    ]);
    expect(new TextDecoder().decode(bundle.artifacts[0].bytes)).toContain(STATE);
    expect(JSON.stringify(bundle.manifest)).not.toContain(STATE);
    expect(JSON.stringify(bundle.manifest)).not.toContain(PROVIDER_ID);
  });

  it('binds an already observed current-document fetch to the current raw asset', async () => {
    const bundle = await bundleForFile({ signed_path: undefined });
    await expect(
      deriveDeepSeekPageOwnedAssetCandidates(bundle, 'conversation', sha256Hex, () => [
        resource(performanceUrl()),
      ])
    ).resolves.toEqual([
      {
        assetId: bundle.manifest.assets[0].id,
        downloadUrl: performanceUrl(),
        declaredByteLength: 93,
      },
    ]);
  });

  it('ignores unrelated, mismatched, malformed, and stale SPA resource entries', async () => {
    const bundle = await bundleForFile({ signed_path: undefined });
    const staleFileId = '99999999-8888-4777-8666-555555555555';
    const entries = [
      resource(performanceUrl(FILE_ID), 'xmlhttprequest'),
      resource(performanceUrl(staleFileId)),
      resource(`${performanceUrl()}&extra=1`),
      resource('https://evil.example/api/file?file_id=x&state=y&ty=r'),
      { initiatorType: 'fetch', name: 42 },
    ];
    await expect(
      deriveDeepSeekPageOwnedAssetCandidates(bundle, 'conversation', sha256Hex, () => entries)
    ).resolves.toEqual([]);
  });

  it('deduplicates observations deterministically and lets in-band signed_path win', async () => {
    const bundle = await bundleForFile();
    const entries = [
      resource(performanceUrl(FILE_ID, 'older-performance-state')),
      resource(performanceUrl()),
      resource(performanceUrl()),
    ];
    const passive = await deriveDeepSeekPageOwnedAssetCandidates(
      bundle,
      'conversation',
      sha256Hex,
      () => entries
    );
    expect(passive).toEqual([
      {
        assetId: bundle.manifest.assets[0].id,
        downloadUrl: performanceUrl(),
        declaredByteLength: 93,
      },
    ]);
    const merged = await deriveDeepSeekAssetCandidates(
      bundle,
      'conversation',
      sha256Hex,
      () => entries
    );
    expect(merged[0].downloadUrl).toContain(`state=${STATE}`);
    expect(merged[0].downloadUrl).not.toContain(PERFORMANCE_STATE);
  });

  it('fails soft for unavailable or poisoned performance APIs and entry getters', async () => {
    const bundle = await bundleForFile({ signed_path: undefined });
    const poisoned = Object.defineProperty({ initiatorType: 'fetch' }, 'name', {
      get: () => {
        throw new Error('synthetic poisoned getter');
      },
    });
    await expect(
      deriveDeepSeekPageOwnedAssetCandidates(bundle, 'conversation', sha256Hex, () => [poisoned])
    ).resolves.toEqual([]);
    await expect(
      deriveDeepSeekPageOwnedAssetCandidates(bundle, 'conversation', sha256Hex, () => {
        throw new Error('synthetic unavailable performance API');
      })
    ).resolves.toEqual([]);
  });

  it('inspects only the newest bounded resource tail', async () => {
    const bundle = await bundleForFile({ signed_path: undefined });
    const ignored = resource(performanceUrl());
    const unrelated = Array.from({ length: 512 }, (_, index) =>
      resource(performanceUrl(`stale-${index}`))
    );
    await expect(
      deriveDeepSeekPageOwnedAssetCandidates(bundle, 'conversation', sha256Hex, () => [
        ignored,
        ...unrelated,
      ])
    ).resolves.toEqual([]);
    await expect(
      deriveDeepSeekPageOwnedAssetCandidates(bundle, 'conversation', sha256Hex, () => [
        ...unrelated,
        resource(performanceUrl()),
      ])
    ).resolves.toHaveLength(1);
  });

  it('rejects an ambiguous normalized file_id binding', async () => {
    const bundle = await bundleForFile({ signed_path: undefined });
    const raw = JSON.parse(new TextDecoder().decode(bundle.artifacts[0].bytes)) as any;
    raw.data.biz_data.chat_messages[0].files.push({
      ...raw.data.biz_data.chat_messages[0].files[0],
      id: FILE_ID,
    });
    const bytes = new TextEncoder().encode(JSON.stringify(raw));
    const inventory = await inventoryDeepSeekRawAssets({
      raw,
      artifactId: 'conversation',
      sha256: sha256Hex,
    });
    bundle.manifest.assets = inventory.assets;
    bundle.artifacts[0].bytes = bytes;
    await expect(
      deriveDeepSeekPageOwnedAssetCandidates(bundle, 'conversation', sha256Hex, () => [
        resource(performanceUrl()),
      ])
    ).resolves.toEqual([]);
  });

  it.each([
    { status: 'EXPIRED' },
    { signed_path: undefined },
    { signed_path: `/file?file_id=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&state=${STATE}` },
  ])('keeps expired, missing, or mismatched raw records unresolved: %o', async overrides => {
    const bundle = await bundleForFile(overrides);
    await expect(deriveDeepSeekSignedAssetCandidates(bundle)).resolves.toEqual([]);
  });

  it('rejects a forged manifest source pointer instead of scanning nearby raw data', async () => {
    const bundle = await bundleForFile();
    bundle.manifest.assets[0].sourceRefs[0].rawPointer = '/data/biz_data/chat_messages/0/files/1';
    await expect(deriveDeepSeekSignedAssetCandidates(bundle)).resolves.toEqual([]);
  });

  it('revalidates the constructed download URL at acquisition boundaries', () => {
    const valid = deepSeekDownloadUrl(PROVIDER_ID, `/file?file_id=${FILE_ID}&state=${STATE}`)!;
    expect(isExactDeepSeekDownloadUrl(valid)).toBe(true);
    expect(isExactDeepSeekDownloadUrl('not a URL')).toBe(false);
  });

  it('returns no candidate for a missing artifact, invalid JSON, or foreign source artifact', async () => {
    const bundle = await bundleForFile();
    await expect(
      deriveDeepSeekSignedAssetCandidates({ ...bundle, artifacts: [] })
    ).resolves.toEqual([]);

    const invalidJson = {
      ...bundle,
      artifacts: [{ ...bundle.artifacts[0], bytes: new Uint8Array([0xff]) }],
    };
    await expect(deriveDeepSeekSignedAssetCandidates(invalidJson)).resolves.toEqual([]);

    bundle.manifest.assets[0].sourceRefs[0].artifactId = 'other-artifact';
    await expect(deriveDeepSeekSignedAssetCandidates(bundle)).resolves.toEqual([]);
  });

  it('rejects malformed raw records and invalid JSON pointer escapes', async () => {
    const malformed = await bundleForFile({ id: null });
    await expect(deriveDeepSeekSignedAssetCandidates(malformed)).resolves.toEqual([]);

    const escaped = await bundleForFile();
    escaped.manifest.assets[0].sourceRefs[0].rawPointer = '/data/biz_data/chat_messages/0/files/~2';
    await expect(deriveDeepSeekSignedAssetCandidates(escaped)).resolves.toEqual([]);
  });

  it('sorts multiple independently bound candidates without exposing provider ids', async () => {
    const bundle = await bundleForFile();
    const raw = JSON.parse(new TextDecoder().decode(bundle.artifacts[0].bytes)) as any;
    const providerId = 'file-22222222-3333-4444-8555-666666666666';
    const fileId = '22222222-3333-4444-8555-666666666666';
    raw.data.biz_data.chat_messages[0].files.push({
      id: providerId,
      file_name: 'second.txt',
      file_size: 7,
      status: 'SUCCESS',
      signed_path: `/file?file_id=${fileId}&state=second-state`,
    });
    bundle.artifacts[0].bytes = new TextEncoder().encode(JSON.stringify(raw));
    bundle.manifest.assets.push({
      id: await deepSeekAttachmentIdForProviderId(providerId, sha256Hex),
      state: 'not-attempted',
      attemptedAt: null,
      relativePath: null,
      mediaType: null,
      byteLength: null,
      sha256: null,
      detail: 'metadata-only',
      sourceRefs: [
        {
          artifactId: 'conversation',
          rawPointer: '/data/biz_data/chat_messages/0/files/1',
        },
      ],
    });
    const candidates = await deriveDeepSeekSignedAssetCandidates(bundle);
    expect(candidates).toHaveLength(2);
    expect(candidates.map(candidate => candidate.assetId)).toEqual(
      [...candidates.map(candidate => candidate.assetId)].sort()
    );
    expect(JSON.stringify(candidates)).not.toContain(PROVIDER_ID);
    expect(JSON.stringify(candidates)).not.toContain(providerId);
  });
});
