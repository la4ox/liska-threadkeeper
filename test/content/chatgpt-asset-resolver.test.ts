import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RawCaptureAssetRecord } from '../../src/archive/capture';
import {
  extractChatGptActiveResolverPlan,
  matchChatGptPageOwnedAssetResolvers,
  type ChatGptTransientResolverRecord,
} from '../../src/content/capture/chatgpt-asset-resolver';

function digest(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

async function resolver(
  fileId: string,
  downloadUrl: string
): Promise<ChatGptTransientResolverRecord> {
  return {
    resolverKey: await digest(new TextEncoder().encode(`liska-chatgpt-resolver/1\u0000${fileId}`)),
    downloadUrl,
  };
}

function asset(id: string, rawPointer: string): RawCaptureAssetRecord {
  return {
    id: `chatgpt-asset-${id.repeat(64).slice(0, 64)}`,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: 'image/png',
    byteLength: null,
    sha256: null,
    detail: 'raw-inventory-not-attempted',
    sourceRefs: [{ artifactId: 'conversation', rawPointer }],
  };
}

describe('ChatGPT page-owned asset resolver matching', () => {
  it('extracts a bounded deterministic active plan only from exact ledger pointers', () => {
    const direct = asset('a', '/mapping/root/message/metadata/attachments/0');
    const ambiguous = asset('b', '/mapping/root/message/content/parts/0');
    const duplicate = asset('c', '/mapping/root/message/metadata/attachments/1');
    const plan = extractChatGptActiveResolverPlan(
      {
        mapping: {
          root: {
            message: {
              metadata: { attachments: [{ file_id: 'one' }, { id: 'one' }] },
              content: { parts: [{ file_id: 'two', asset_id: 'three' }] },
            },
          },
        },
        unrelated: { file_id: 'must-not-be-scanned' },
      },
      [ambiguous, duplicate, direct]
    );
    expect(plan).toEqual({ providerFileIds: ['one'] });
    expect(JSON.stringify(plan)).not.toContain('must-not-be-scanned');
  });

  it('uses the active 20-ID cap without leaking rejected malformed values', () => {
    const assets = Array.from({ length: 25 }, (_, index) => asset(`x${index}`, `/asset/${index}`));
    const raw = {
      asset: Array.from({ length: 25 }, (_, index) => ({ file_id: `file_${index}` })),
    };
    const plan = extractChatGptActiveResolverPlan(raw, assets);
    expect(plan.providerFileIds).toHaveLength(20);
    expect(extractChatGptActiveResolverPlan(raw, [...assets].reverse())).toEqual(plan);
  });

  it('accepts one safe transport pointer and ignores a pointed record without one', () => {
    const pointer = asset('pointer', '/asset/0');
    const missing = asset('missing', '/asset/1');
    expect(
      extractChatGptActiveResolverPlan(
        {
          asset: [{ asset_pointer: 'sediment://pointer-one' }, { content_type: 'text' }],
        },
        [missing, pointer]
      )
    ).toEqual({ providerFileIds: ['pointer-one'] });
  });

  it('matches an exact provider ID without returning that private ID', async () => {
    const privateId = 'private-file-id';
    const signedUrl =
      'https://chatgpt.com/backend-api/estuary/content?cid=c&id=i&p=p&sig=s&ts=t&v=v';
    const metadata = asset('a', '/mapping/root/message/metadata/attachments/0');
    const result = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        mapping: {
          root: { message: { metadata: { attachments: [{ id: privateId }] } } },
        },
      },
      assets: [metadata],
      resolvers: [await resolver(privateId, signedUrl)],
      sha256: digest,
    });

    expect(result).toEqual([{ assetId: metadata.id, downloadUrl: signedUrl }]);
    expect(JSON.stringify(result)).not.toContain(privateId);
  });

  it('prefers a direct metadata ID over a pointer-only duplicate', async () => {
    const fileId = 'shared-file-id';
    const pointer = asset('a', '/mapping/root/message/content/parts/0');
    const metadata = asset('b', '/mapping/root/message/metadata/attachments/0');
    const result = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        mapping: {
          root: {
            message: {
              content: {
                parts: [{ asset_pointer: `file-service:${fileId}` }],
              },
              metadata: { attachments: [{ file_id: fileId }] },
            },
          },
        },
      },
      assets: [pointer, metadata],
      resolvers: [await resolver(fileId, 'https://chatgpt.com/signed')],
      sha256: digest,
    });

    expect(result).toEqual([{ assetId: metadata.id, downloadUrl: 'https://chatgpt.com/signed' }]);
  });

  it('accepts a pointer-only resolver and rejects ambiguous or malformed evidence', async () => {
    const pointer = asset('a', '/mapping/root/message/content/parts/0');
    const key = await resolver('pointer-id', 'https://chatgpt.com/one');
    const accepted = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        mapping: {
          root: { message: { content: { parts: [{ asset_pointer: 'sediment://pointer-id' }] } } },
        },
      },
      assets: [pointer],
      resolvers: [key],
      sha256: digest,
    });
    const rejected = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        mapping: {
          root: { message: { content: { parts: [{ asset_pointer: 'sediment://pointer-id' }] } } },
        },
      },
      assets: [pointer],
      resolvers: [key, { ...key, downloadUrl: 'https://chatgpt.com/two' }],
      sha256: digest,
    });

    expect(accepted).toEqual([{ assetId: pointer.id, downloadUrl: 'https://chatgpt.com/one' }]);
    expect(rejected).toEqual([]);
  });

  it('fails soft for invalid pointers, unsupported pointer schemes, and digest failures', async () => {
    const invalidPointer = asset('a', '/missing');
    const unsupported = asset('b', '/mapping/root/message/content/parts/0');
    const observed = await resolver('pointer-id', 'https://chatgpt.com/signed');
    const raw = {
      mapping: {
        root: { message: { content: { parts: [{ asset_pointer: 'unknown://pointer-id' }] } } },
      },
    };

    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw,
        assets: [invalidPointer, unsupported],
        resolvers: [observed],
        sha256: () => Promise.reject(new Error('unavailable')),
      })
    ).resolves.toEqual([]);
  });

  it('rejects invalid inputs and malformed resolver records before raw matching', async () => {
    await expect(matchChatGptPageOwnedAssetResolvers(null as never)).resolves.toEqual([]);
    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw: {},
        assets: [],
        resolvers: [null, { resolverKey: 'bad', downloadUrl: 1 }] as never,
        sha256: digest,
      })
    ).resolves.toEqual([]);
  });

  it('fails soft when hashing a real provider ID is unavailable', async () => {
    const direct = asset('a', '/asset');
    const observed = await resolver('direct-id', 'https://chatgpt.com/signed');

    await expect(
      matchChatGptPageOwnedAssetResolvers({
        raw: { asset: { file_id: 'direct-id' } },
        assets: [direct],
        resolvers: [observed],
        sha256: () => Promise.reject(new Error('digest unavailable')),
      })
    ).resolves.toEqual([]);
  });

  it('drops equal-strength ambiguity and deterministically sorts independent matches', async () => {
    const first = asset('a', '/first');
    const duplicate = asset('b', '/duplicate');
    const second = asset('c', '/second');
    const shared = await resolver('shared-id', 'https://chatgpt.com/shared');
    const other = await resolver('other-id', 'https://chatgpt.com/other');
    const ambiguous = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        first: { asset_pointer: 'file-service:shared-id' },
        duplicate: { asset_pointer: 'sediment://shared-id' },
      },
      assets: [first, duplicate],
      resolvers: [shared],
      sha256: digest,
    });
    const sorted = await matchChatGptPageOwnedAssetResolvers({
      raw: {
        first: { file_id: 'shared-id' },
        second: { file_id: 'other-id' },
      },
      assets: [second, first],
      resolvers: [other, shared],
      sha256: digest,
    });

    expect(ambiguous).toEqual([]);
    expect(sorted.map(candidate => candidate.assetId)).toEqual([first.id, second.id]);
  });
});
