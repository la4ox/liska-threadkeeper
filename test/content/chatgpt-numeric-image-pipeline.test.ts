import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RawCaptureAssetRecord } from '../../src/archive/capture';
import { validateChatGptResolverObservations } from '../../src/background/chatgpt-capture';
import { acquireChatGptPageOwnedAssets } from '../../src/content/capture/chatgpt-asset-acquisition';
import { matchChatGptPageOwnedAssetResolvers } from '../../src/content/capture/chatgpt-asset-resolver';

const CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
const HELPER_FILE_ID = 'file-helper-a';
const FORGED_URL_FILE_ID = 'file-helper-b';
const FORGED_NUMERIC_EIGHT_URL =
  'https://chatgpt.com/backend-api/estuary/content?' +
  `cid=123456&id=${FORGED_URL_FILE_ID}&p=fs&sig=${'a'.repeat(64)}&ts=123456&v=1` +
  '&fn=synthetic-image.png&cd=attachment';

function digest(bytes: Uint8Array): Promise<string> {
  return Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
}

function base64Bytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function record(): RawCaptureAssetRecord {
  return {
    id: `chatgpt-asset-${'a'.repeat(64)}`,
    state: 'not-attempted',
    attemptedAt: null,
    relativePath: null,
    mediaType: 'image/png',
    byteLength: null,
    sha256: null,
    detail: 'raw-inventory-not-attempted',
    sourceRefs: [
      {
        artifactId: 'conversation',
        rawPointer: '/mapping/root/message/metadata/attachments/0',
      },
    ],
  };
}

describe('ChatGPT keyed numeric resolver pipeline', () => {
  it('rejects a lowercase native observation whose numeric eight-key URL names another raw helper file', async () => {
    const body = JSON.stringify({
      status: 'success',
      download_url: FORGED_NUMERIC_EIGHT_URL,
      metadata: { source: 'synthetic' },
      file_name: 'synthetic-image.png',
    });
    const bytes = new TextEncoder().encode(body);
    const observations = [
      {
        providerFileId: HELPER_FILE_ID,
        bodyBase64: base64Bytes(bytes),
        byteLength: bytes.byteLength,
        sha256: await digest(bytes),
        mediaType: 'application/json',
      },
    ];
    const raw = {
      mapping: {
        root: {
          message: { metadata: { attachments: [{ file_id: HELPER_FILE_ID }] } },
        },
      },
    };
    const asset = record();
    const resolvers = await validateChatGptResolverObservations(
      observations,
      CONVERSATION_ID,
      digest
    );
    const candidates = await matchChatGptPageOwnedAssetResolvers({
      raw,
      assets: [asset],
      resolvers,
      sha256: digest,
    });
    const fetcher = vi.fn<typeof fetch>();
    const acquisition = await acquireChatGptPageOwnedAssets({
      conversationId: CONVERSATION_ID,
      assets: [asset],
      candidates,
      fetcher,
      now: () => new Date('2026-08-21T12:00:00.000Z'),
      sha256: digest,
    });

    expect(resolvers).toEqual([]);
    expect(candidates).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(acquisition).toMatchObject({
      records: [{ id: asset.id, state: 'not-attempted' }],
      runtimeAssets: [],
      completeness: 'not-attempted',
    });
  });
});
