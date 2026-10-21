import { createHash } from 'node:crypto';
import type {
  ChatGptActiveAssetPlanItem,
  ChatGptActiveAssetResponse,
} from '../../src/lib/chatgpt-active-asset-contract';
export const ACTIVE_CONVERSATION_ID = '01234567-89ab-4cde-8f01-23456789abcd';
export const ACTIVE_AT = '2026-10-21T12:00:00.000Z';
export const activeItem = (letter = 'a'): ChatGptActiveAssetPlanItem => ({
  assetId: `chatgpt-asset-${letter.repeat(64)}`,
  providerFileId: `synthetic-png-${letter}`,
});
export const activeDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function activeSuccess(
  item = activeItem()
): Extract<ChatGptActiveAssetResponse, { success: true }> {
  return {
    success: true,
    data: {
      assetId: item.assetId,
      metrics: {
        requestedCount: 1,
        dispatchCount: 1,
        observedCount: 1,
        outcomes: ['observed'],
        attemptedAt: ACTIVE_AT,
      },
      candidate: {
        assetId: item.assetId,
        downloadUrl: `https://chatgpt.com/backend-api/estuary/content?id=${item.providerFileId}&ts=1700000000&p=fs&cid=1&sig=${'a'.repeat(64)}&v=0`,
        resolverKey: activeDigest(
          new TextEncoder().encode(`liska-chatgpt-resolver/1\u0000${item.providerFileId}`)
        ),
      },
    },
  };
}
