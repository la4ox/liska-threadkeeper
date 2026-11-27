/** Sequential acquisition of exact, raw-bound Claude original file responses. */

import type { RawCaptureAsset, RawCaptureAssetRecord } from '../../archive/capture';
import {
  CLAUDE_ASSET_DETAIL,
  safeClaudeAssetMediaType,
} from '../../archive/normalizers/claude/inventory';
import {
  createStagedBinaryAssetDescriptor,
  isSafeStagedBinaryAssetId,
} from '../../lib/binary-asset-contract';
import { MAX_STAGED_BINARY_ASSET_BYTES } from '../../lib/constants';
import { type ClaudeAssetCandidate, isExactClaudeContentsUrl } from './claude-asset-resolver';
import { cancelResponseBody } from './response';

export const CLAUDE_ASSET_ATTEMPT_LIMIT = 32;
export const CLAUDE_ASSET_TOTAL_BYTE_LIMIT = 128 * 1024 * 1024;
export const CLAUDE_ASSET_TIMEOUT_MS = 30_000;

export interface AcquireClaudeAssetsInput {
  assets: readonly RawCaptureAssetRecord[];
  candidates: readonly ClaudeAssetCandidate[];
  isConversationCurrent?: () => boolean;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: () => Date;
  /** Caller-provided values can only tighten the fixed ceilings. */
  timeoutMs?: number;
  maxAssetBytes?: number;
  maxTotalBytes?: number;
}

export interface ClaudeAssetAcquisition {
  records: RawCaptureAssetRecord[];
  runtimeAssets: RawCaptureAsset[];
}

type FailureDetail = Exclude<
  (typeof CLAUDE_ASSET_DETAIL)[keyof typeof CLAUDE_ASSET_DETAIL],
  typeof CLAUDE_ASSET_DETAIL.fetched
>;

type AttemptResult = { asset: RawCaptureAsset } | { detail: FailureDetail };

interface Attempt {
  readonly controller: AbortController;
  readonly remainingBytes: number;
  response?: Response;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  byteCost: number;
}

function bound(value: number | undefined, maximum: number): number {
  return value === undefined || !Number.isFinite(value)
    ? maximum
    : Math.min(maximum, Math.max(0, Math.floor(value)));
}

function copyRecord(record: RawCaptureAssetRecord): RawCaptureAssetRecord {
  return { ...record, sourceRefs: record.sourceRefs.map(reference => ({ ...reference })) };
}

export function failedClaudeAssetRecord(
  record: RawCaptureAssetRecord,
  attemptedAt: string | null,
  detail: FailureDetail
): RawCaptureAssetRecord {
  return {
    ...record,
    state: 'failed',
    attemptedAt,
    relativePath: null,
    mediaType: null,
    byteLength: null,
    sha256: null,
    detail,
  };
}

function cancelAttemptBody(attempt: Attempt): void {
  if (attempt.reader) {
    void attempt.reader.cancel().catch(() => {});
  } else if (attempt.response && !attempt.response.bodyUsed) {
    void cancelResponseBody(attempt.response);
  }
}

function lengthHeadersMatch(response: Response, declaredByteLength: number): boolean {
  return ['content-length', 'x-served-file-size'].every(name => {
    const header = response.headers.get(name);
    // Exact decimal string comparison rejects padded, partial, and duplicate fields.
    return header === null || header === String(declaredByteLength);
  });
}

async function readExactContents(
  attempt: Attempt,
  response: Response,
  declaredByteLength: number
): Promise<Uint8Array | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return declaredByteLength === 0 ? new Uint8Array(0) : undefined;
  attempt.reader = reader;
  const bytes = new Uint8Array(declaredByteLength);
  let offset = 0;
  try {
    while (!attempt.controller.signal.aborted) {
      const chunk = await reader.read();
      if (attempt.controller.signal.aborted) return undefined;
      if (chunk.done) return offset === declaredByteLength ? bytes : undefined;
      attempt.byteCost = Math.min(attempt.remainingBytes, offset + chunk.value.byteLength);
      if (offset + chunk.value.byteLength > declaredByteLength) {
        cancelAttemptBody(attempt);
        return undefined;
      }
      // Native Response streams supply byte chunks; copy rather than retaining backing buffers.
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
    return undefined;
  } finally {
    reader.releaseLock();
    delete attempt.reader;
  }
}

// eslint-disable-next-line max-lines-per-function -- Keep transport validation before accepting or hashing any body.
async function fetchContents(
  record: RawCaptureAssetRecord,
  candidate: ClaudeAssetCandidate,
  attempt: Attempt,
  fetcher: typeof fetch,
  timestamp: string
): Promise<AttemptResult> {
  const signal = attempt.controller.signal;
  const response = await fetcher(candidate.contentsUrl, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal,
  });
  attempt.response = response;
  // A transport that ignores abort can still return a late Response: cancel, never consume it.
  if (signal.aborted) {
    cancelAttemptBody(attempt);
    return { detail: CLAUDE_ASSET_DETAIL.timeout };
  }

  const rejection = rejectResponse(response, candidate);
  if (rejection) {
    cancelAttemptBody(attempt);
    return { detail: rejection };
  }
  const bytes = await readExactContents(attempt, response, candidate.declaredByteLength);
  if (!bytes) return { detail: CLAUDE_ASSET_DETAIL.sizeMismatch };
  const mediaType =
    safeClaudeAssetMediaType(response.headers.get('content-type')) ??
    safeClaudeAssetMediaType(candidate.declaredMediaType) ??
    'application/octet-stream';
  const descriptor = await createStagedBinaryAssetDescriptor({
    assetId: record.id,
    mediaType,
    bytes,
  });
  if (!descriptor) return { detail: CLAUDE_ASSET_DETAIL.responseRejected };
  return {
    asset: {
      bytes,
      record: {
        ...record,
        state: 'fetched',
        attemptedAt: timestamp,
        relativePath: descriptor.relativePath,
        mediaType: descriptor.mediaType,
        byteLength: descriptor.byteLength,
        sha256: descriptor.sha256,
        detail: CLAUDE_ASSET_DETAIL.fetched,
      },
    },
  };
}

function rejectResponse(
  response: Response,
  candidate: ClaudeAssetCandidate
): FailureDetail | undefined {
  if (response.status !== 200) return CLAUDE_ASSET_DETAIL.httpFailed;
  if (
    response.url !== candidate.contentsUrl ||
    response.redirected ||
    response.headers.get('x-served-file-variant') !== 'original'
  ) {
    return CLAUDE_ASSET_DETAIL.responseRejected;
  }
  if (!lengthHeadersMatch(response, candidate.declaredByteLength)) {
    return CLAUDE_ASSET_DETAIL.sizeMismatch;
  }
  return undefined;
}

async function acquireOne(
  record: RawCaptureAssetRecord,
  candidate: ClaudeAssetCandidate,
  input: AcquireClaudeAssetsInput,
  timestamp: string,
  remainingBytes: number
): Promise<{ outcome: AttemptResult; byteCost: number }> {
  const attempt: Attempt = { controller: new AbortController(), remainingBytes, byteCost: 0 };
  let onDeadline: (() => void) | undefined;
  const deadline = new Promise<AttemptResult>(resolve => {
    onDeadline = () => {
      resolve({ detail: CLAUDE_ASSET_DETAIL.timeout });
      attempt.controller.abort();
      cancelAttemptBody(attempt);
    };
  });
  const timer = setTimeout(onDeadline!, bound(input.timeoutMs, CLAUDE_ASSET_TIMEOUT_MS));
  input.signal?.addEventListener('abort', onDeadline!, { once: true });
  try {
    const request = fetchContents(record, candidate, attempt, input.fetcher ?? fetch, timestamp);
    const outcome = await Promise.race([request, deadline]);
    return { outcome, byteCost: attempt.byteCost };
  } catch {
    cancelAttemptBody(attempt);
    return { outcome: { detail: CLAUDE_ASSET_DETAIL.fetchFailed }, byteCost: attempt.byteCost };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onDeadline!);
  }
}

function canAttempt(
  candidate: ClaudeAssetCandidate,
  record: RawCaptureAssetRecord | undefined,
  limit: number
): record is RawCaptureAssetRecord {
  return (
    record?.state === 'not-attempted' &&
    isSafeStagedBinaryAssetId(record.id) &&
    isExactClaudeContentsUrl(candidate.contentsUrl) &&
    Number.isSafeInteger(candidate.declaredByteLength) &&
    candidate.declaredByteLength >= 0 &&
    candidate.declaredByteLength <= limit
  );
}

/** Unstarted, unresolved and known-over-limit records remain not-attempted. */
// eslint-disable-next-line max-lines-per-function -- Network, remaining byte budget, and the terminal ledger advance together.
export async function acquireClaudeAssets(
  input: AcquireClaudeAssetsInput
): Promise<ClaudeAssetAcquisition> {
  const records = input.assets.map(copyRecord);
  const indices = new Map(records.map((record, index) => [record.id, index]));
  const runtimeAssets: RawCaptureAsset[] = [];
  const seen = new Set<string>();
  const retainedPaths = new Set<string>();
  const maxAssetBytes = bound(input.maxAssetBytes, MAX_STAGED_BINARY_ASSET_BYTES);
  let remainingBytes = bound(input.maxTotalBytes, CLAUDE_ASSET_TOTAL_BYTE_LIMIT);
  let attempts = 0;
  for (const candidate of input.candidates) {
    if (
      attempts >= CLAUDE_ASSET_ATTEMPT_LIMIT ||
      input.signal?.aborted ||
      input.isConversationCurrent?.() === false
    )
      break;
    if (seen.has(candidate.assetId)) continue;
    seen.add(candidate.assetId);
    const index = indices.get(candidate.assetId);
    if (index === undefined) continue;
    const record = records[index];
    if (!canAttempt(candidate, record, Math.min(maxAssetBytes, remainingBytes))) continue;
    const timestamp = (input.now ?? (() => new Date()))().toISOString();
    attempts += 1;
    const { outcome, byteCost } = await acquireOne(
      record,
      candidate,
      input,
      timestamp,
      remainingBytes
    );
    remainingBytes -= byteCost;
    if ('asset' in outcome) {
      const path = outcome.asset.record.relativePath!;
      // Preserve both raw identities, but the manifest allows only one claim to this path.
      if (retainedPaths.has(path)) {
        records[index] = failedClaudeAssetRecord(
          record,
          timestamp,
          CLAUDE_ASSET_DETAIL.duplicatePath
        );
      } else {
        retainedPaths.add(path);
        records[index] = outcome.asset.record;
        runtimeAssets.push(outcome.asset);
      }
    } else {
      records[index] = failedClaudeAssetRecord(record, timestamp, outcome.detail);
    }
  }
  return { records, runtimeAssets };
}
