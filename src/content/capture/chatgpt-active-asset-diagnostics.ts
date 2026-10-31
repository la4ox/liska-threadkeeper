/** Fixed active-helper outcomes, never provider text or successful-URL byte claims. */
import type { RawCaptureAssetRecord } from '../../archive';
import type { ChatGptActiveAssetResponse } from '../../lib/chatgpt-active-asset-contract';

const BEFORE_DISPATCH = new Set([
  'invalid-conversation-id',
  'invalid-provider-file-ids',
  'permission-unavailable',
  'nonce-invalid',
  'temporary-tab-create-failed',
  'temporary-tab-missing-id',
  'unexpected-origin',
  'unexpected-path',
  'temporary-tab-ready-timeout',
  'document-id-missing',
  'command-rejected',
  'hook-state-failed',
  'source-not-eligible',
  'source-rejected',
  'source-http-4xx',
  'source-http-5xx',
  'source-http-other',
  'source-response-processing-rejected',
  'source-http-error',
  'source-non-json',
]);

export function applyChatGptActiveAssetFailure(
  records: readonly RawCaptureAssetRecord[],
  assetId: string,
  response: ChatGptActiveAssetResponse,
  now = new Date().toISOString()
): RawCaptureAssetRecord[] {
  if (response.success && response.data.candidate !== null) return [...records];
  const outcome = response.success ? response.data.metrics.outcomes[0] : response.code;
  const notDispatched = response.success
    ? response.data.metrics.dispatchCount === 0
    : BEFORE_DISPATCH.has(response.code);
  const attemptedAt = notDispatched
    ? null
    : response.success
      ? response.data.metrics.attemptedAt
      : now;
  return records.map(record =>
    record.id !== assetId
      ? record
      : {
          ...record,
          state: notDispatched
            ? 'not-attempted'
            : outcome === 'file-expired'
              ? 'expired'
              : 'failed',
          attemptedAt,
          relativePath: null,
          byteLength: null,
          sha256: null,
          detail: `active-resolver-${response.success ? '' : 'run-'}${outcome}`,
        }
  );
}

export function applyChatGptActiveAcquisitionFailure(
  records: readonly RawCaptureAssetRecord[],
  assetId: string
): RawCaptureAssetRecord[] {
  return records.map(record =>
    record.id !== assetId || record.state !== 'not-attempted'
      ? record
      : {
          ...record,
          state: 'failed',
          attemptedAt: new Date().toISOString(),
          relativePath: null,
          byteLength: null,
          sha256: null,
          detail: 'active-asset-acquisition-not-completed',
        }
  );
}
