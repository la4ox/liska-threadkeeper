/** One transient PNG resolution. Deliberately separate from metric-only probes. */
import {
  isChatGptActiveResolverProviderFileId,
  isChatGptActiveResolverResponse,
  type ChatGptActiveResolverErrorCode,
  type ChatGptActiveResolverMetrics,
} from './chatgpt-active-resolver-contract';
import {
  CHATGPT_RESOLVER_KEY_DOMAIN,
  getChatGptNumericResolverFileId,
  isChatGptTransientDownloadUrl,
} from './chatgpt-capture-contract';
import { sha256Hex } from './sha256';

export interface ChatGptActiveAssetPlanItem {
  assetId: string;
  providerFileId: string;
}
export interface ChatGptActiveAssetCandidate {
  assetId: string;
  downloadUrl: string;
  resolverKey?: string;
}
export type ChatGptActiveAssetResponse =
  | {
      success: true;
      data: {
        assetId: string;
        metrics: ChatGptActiveResolverMetrics;
        candidate: ChatGptActiveAssetCandidate | null;
      };
    }
  | { success: false; code: ChatGptActiveResolverErrorCode };

export function isChatGptActiveAssetId(value: unknown): value is string {
  return typeof value === 'string' && /^chatgpt-asset-[a-f0-9]{64}$/.test(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const own = Reflect.ownKeys(value);
    return (
      own.length === keys.length &&
      keys.every(key => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && 'value' in descriptor;
      })
    );
  } catch {
    return false;
  }
}

export function isChatGptActiveAssetPlanItem(value: unknown): value is ChatGptActiveAssetPlanItem {
  return (
    exact(value, ['assetId', 'providerFileId']) &&
    isChatGptActiveAssetId(value.assetId) &&
    isChatGptActiveResolverProviderFileId(value.providerFileId)
  );
}

function exactSingleOutcome(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1 || Reflect.ownKeys(value).length !== 2)
    return false;
  const ordinal = Object.getOwnPropertyDescriptor(value, '0');
  return ordinal !== undefined && 'value' in ordinal && typeof ordinal.value === 'string';
}

/** URL remains transient; durable diagnostics are exclusively fixed metric codes. */
function validateActiveAssetResponse(value: unknown): value is ChatGptActiveAssetResponse {
  if (exact(value, ['success', 'code']))
    return value.success === false && isChatGptActiveResolverResponse(value);
  if (
    !exact(value, ['success', 'data']) ||
    value.success !== true ||
    !exact(value.data, ['assetId', 'metrics', 'candidate'])
  )
    return false;
  const { assetId, metrics, candidate } = value.data;
  if (
    !isChatGptActiveAssetId(assetId) ||
    !exact(metrics, [
      'requestedCount',
      'dispatchCount',
      'observedCount',
      'outcomes',
      'attemptedAt',
    ]) ||
    !exactSingleOutcome(metrics.outcomes) ||
    !isChatGptActiveResolverResponse({ success: true, data: metrics })
  )
    return false;
  const counts = metrics as unknown as ChatGptActiveResolverMetrics;
  if (counts.requestedCount !== 1) return false;
  if (candidate === null) return counts.observedCount === 0;
  return counts.observedCount === 1 && validateCandidate(candidate, assetId);
}

function validateCandidate(candidate: unknown, assetId: string): boolean {
  if (
    !exact(
      candidate,
      Object.prototype.hasOwnProperty.call(candidate, 'resolverKey')
        ? ['assetId', 'downloadUrl', 'resolverKey']
        : ['assetId', 'downloadUrl']
    ) ||
    candidate.assetId !== assetId
  )
    return false;
  const numericId = getChatGptNumericResolverFileId(candidate.downloadUrl);
  if (numericId !== undefined)
    return (
      typeof candidate.resolverKey === 'string' && /^[a-f0-9]{64}$/.test(candidate.resolverKey)
    );
  return (
    candidate.resolverKey === undefined && isChatGptTransientDownloadUrl(candidate.downloadUrl)
  );
}

export function isChatGptActiveAssetResponse(value: unknown): value is ChatGptActiveAssetResponse {
  try {
    return validateActiveAssetResponse(value);
  } catch {
    return false;
  }
}

export function activeAssetFailure(
  code: ChatGptActiveResolverErrorCode
): Extract<ChatGptActiveAssetResponse, { success: false }> {
  return { success: false, code };
}

/** Rebind transient candidates even when a test/substituted dependency bypasses messaging. */
export async function isBoundChatGptActiveAssetResponse(
  value: unknown,
  item: ChatGptActiveAssetPlanItem,
  conversationId: string
): Promise<boolean> {
  try {
    if (!isChatGptActiveAssetPlanItem(item) || !isChatGptActiveAssetResponse(value)) return false;
    if (!value.success) return true;
    if (value.data.assetId !== item.assetId) return false;
    const candidate = value.data.candidate;
    if (candidate === null) return true;
    const numericId = getChatGptNumericResolverFileId(candidate.downloadUrl);
    return numericId !== undefined
      ? numericId === item.providerFileId &&
          candidate.resolverKey ===
            (await sha256Hex(
              new TextEncoder().encode(`${CHATGPT_RESOLVER_KEY_DOMAIN}${item.providerFileId}`)
            ))
      : isChatGptTransientDownloadUrl(candidate.downloadUrl, conversationId);
  } catch {
    return false;
  }
}
