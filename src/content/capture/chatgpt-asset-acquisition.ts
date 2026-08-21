/**
 * Bounded acquisition of already page-resolved ChatGPT assets.
 *
 * This module never calls ChatGPT's authenticated resolver. It accepts only a
 * signed estuary URL that the marker-gated page observer already witnessed,
 * performs a credentialless one-shot GET, and returns verified runtime bytes.
 * Destination persistence remains a later orchestration step.
 */

import type {
  CaptureCompletenessState,
  RawCaptureAsset,
  RawCaptureAssetRecord,
} from '../../archive/capture';
import { binaryAssetExtension, isSafeStagedBinaryAssetId } from '../../lib/binary-asset-contract';
import { isChatGptTransientDownloadUrl } from '../../lib/chatgpt-capture-contract';
import { MAX_STAGED_BINARY_ASSET_BYTES } from '../../lib/constants';
import { sha256Hex } from '../../lib/sha256';
import type { ChatGptPageOwnedAssetCandidate } from './chatgpt-asset-resolver';

const MAX_PAGE_OWNED_ASSET_ATTEMPTS = 20;
const MAX_PAGE_OWNED_ASSET_BYTES_TOTAL = 128 * 1024 * 1024;
const DEFAULT_ASSET_TIMEOUT_MS = 30_000;

export const CHATGPT_ASSET_FETCHED_DETAIL = 'page-owned-signed-response';
export const CHATGPT_ASSET_FETCH_FAILED_DETAIL = 'page-owned-fetch-failed';
export const CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL = 'page-owned-response-rejected';

export interface AcquireChatGptPageOwnedAssetsInput {
  conversationId: string;
  assets: readonly RawCaptureAssetRecord[];
  candidates: readonly ChatGptPageOwnedAssetCandidate[];
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  /** Optional stricter caller budget; never raises the built-in 128 MiB cap. */
  maxTotalBytes?: number;
  /** Optional stricter per-asset budget; never raises the built-in 64 MiB cap. */
  maxAssetBytes?: number;
}

export interface ChatGptPageOwnedAssetAcquisition {
  records: RawCaptureAssetRecord[];
  runtimeAssets: RawCaptureAsset[];
  completeness: CaptureCompletenessState;
}

function attemptedAt(now: (() => Date) | undefined): string | undefined {
  try {
    const value = (now ?? (() => new Date()))();
    const iso = value.toISOString();
    return Number.isFinite(value.getTime()) ? iso : undefined;
  } catch {
    return undefined;
  }
}

function exactSignedAssetUrl(value: string, conversationId: string): URL | undefined {
  return isChatGptTransientDownloadUrl(value, conversationId) ? new URL(value) : undefined;
}

function normalizedMediaType(response: Response): string | undefined {
  const raw = response.headers.get('content-type');
  if (typeof raw !== 'string') return undefined;
  const mediaType = raw.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType && binaryAssetExtension(mediaType) !== undefined ? mediaType : undefined;
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The stable failed acquisition result does not depend on cancel support.
  }
}

type BoundedResponseRead =
  | { ok: true; bytes: Uint8Array; byteCost: number }
  | { ok: false; byteCost: number };

async function readBoundedResponse(
  response: Response,
  maxBytes: number
): Promise<BoundedResponseRead> {
  try {
    const declared = response.headers.get('content-length');
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
      return { ok: false, byteCost: 0 };
    }
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, byteCost: 0 };

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value || !ArrayBuffer.isView(next.value)) {
        await cancelReader(reader);
        return { ok: false, byteCost: maxBytes };
      }
      const chunk = new Uint8Array(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      byteLength += chunk.byteLength;
      if (byteLength > maxBytes) {
        await cancelReader(reader);
        return { ok: false, byteCost: maxBytes };
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, bytes, byteCost: bytes.byteLength };
  } catch {
    return { ok: false, byteCost: maxBytes };
  }
}

function failedRecord(
  record: RawCaptureAssetRecord,
  timestamp: string,
  detail: string
): RawCaptureAssetRecord {
  return {
    ...record,
    state: 'failed',
    attemptedAt: timestamp,
    relativePath: null,
    byteLength: null,
    sha256: null,
    detail,
  };
}

// eslint-disable-next-line complexity, max-lines-per-function -- Keep one abort-bounded credentialless fetch and its integrity decisions in a single lifecycle.
async function fetchOne(
  record: RawCaptureAssetRecord,
  candidate: ChatGptPageOwnedAssetCandidate,
  input: AcquireChatGptPageOwnedAssetsInput,
  timestamp: string,
  maxAssetBytes: number
): Promise<{ record: RawCaptureAssetRecord; runtime?: RawCaptureAsset; byteCost: number }> {
  const signedUrl = exactSignedAssetUrl(candidate.downloadUrl, input.conversationId);
  if (!signedUrl) {
    return {
      record: failedRecord(record, timestamp, CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL),
      byteCost: 0,
    };
  }

  const controller = new AbortController();
  const timeoutMs = Math.min(120_000, Math.max(1_000, input.timeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (input.fetcher ?? fetch)(signedUrl.href, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (
      !response.ok ||
      response.status !== 200 ||
      (response.url !== '' && !exactSignedAssetUrl(response.url, input.conversationId))
    ) {
      return {
        record: failedRecord(record, timestamp, CHATGPT_ASSET_FETCH_FAILED_DETAIL),
        byteCost: 0,
      };
    }
    const mediaType = normalizedMediaType(response);
    if (!mediaType || (record.mediaType !== null && record.mediaType !== mediaType)) {
      return {
        record: failedRecord(record, timestamp, CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: 0,
      };
    }

    const read = await readBoundedResponse(response, maxAssetBytes);
    if (!read.ok) {
      return {
        record: failedRecord(record, timestamp, CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: read.byteCost,
      };
    }
    const { bytes } = read;
    const extension = binaryAssetExtension(mediaType);
    let sha256: string;
    try {
      sha256 = await (input.sha256 ?? sha256Hex)(bytes);
    } catch {
      return {
        record: failedRecord(record, timestamp, CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: read.byteCost,
      };
    }
    if (
      !isSafeStagedBinaryAssetId(record.id) ||
      extension === undefined ||
      !/^[a-f0-9]{64}$/.test(sha256)
    ) {
      return {
        record: failedRecord(record, timestamp, CHATGPT_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: read.byteCost,
      };
    }
    const fetched: RawCaptureAssetRecord = {
      ...record,
      state: 'fetched',
      attemptedAt: timestamp,
      relativePath: `assets/${sha256}.${extension}`,
      mediaType,
      byteLength: bytes.byteLength,
      sha256,
      detail: CHATGPT_ASSET_FETCHED_DETAIL,
    };
    return { record: fetched, runtime: { record: fetched, bytes }, byteCost: read.byteCost };
  } catch {
    return {
      record: failedRecord(record, timestamp, CHATGPT_ASSET_FETCH_FAILED_DETAIL),
      byteCost: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

function acquisitionCompleteness(
  records: readonly RawCaptureAssetRecord[]
): CaptureCompletenessState {
  if (records.every(record => record.state === 'not-attempted')) return 'not-attempted';
  return records.every(record => record.state !== 'not-attempted') ? 'complete' : 'partial';
}

/** Acquire matched assets sequentially and leave every unmatched ledger record untouched. */
export async function acquireChatGptPageOwnedAssets(
  input: AcquireChatGptPageOwnedAssetsInput
): Promise<ChatGptPageOwnedAssetAcquisition> {
  const records = input.assets.map(record => ({ ...record, sourceRefs: [...record.sourceRefs] }));
  const byId = new Map(records.map((record, index) => [record.id, index]));
  const seen = new Set<string>();
  const runtimeAssets: RawCaptureAsset[] = [];
  let totalReadBytes = 0;
  let attempts = 0;
  const maxTotalBytes =
    input.maxTotalBytes === undefined || !Number.isFinite(input.maxTotalBytes)
      ? MAX_PAGE_OWNED_ASSET_BYTES_TOTAL
      : Math.min(MAX_PAGE_OWNED_ASSET_BYTES_TOTAL, Math.max(0, Math.floor(input.maxTotalBytes)));
  const maxAssetBytes =
    input.maxAssetBytes === undefined || !Number.isFinite(input.maxAssetBytes)
      ? MAX_STAGED_BINARY_ASSET_BYTES
      : Math.min(MAX_STAGED_BINARY_ASSET_BYTES, Math.max(0, Math.floor(input.maxAssetBytes)));

  for (const candidate of input.candidates) {
    if (attempts >= MAX_PAGE_OWNED_ASSET_ATTEMPTS) break;
    if (seen.has(candidate.assetId)) continue;
    seen.add(candidate.assetId);
    const index = byId.get(candidate.assetId);
    if (index === undefined || records[index].state !== 'not-attempted') continue;
    const remainingTotalBytes = maxTotalBytes - totalReadBytes;
    const attemptByteLimit = Math.min(maxAssetBytes, remainingTotalBytes);
    if (attemptByteLimit <= 0) break;
    const timestamp = attemptedAt(input.now);
    if (!timestamp) continue;
    attempts += 1;
    const acquired = await fetchOne(records[index], candidate, input, timestamp, attemptByteLimit);
    totalReadBytes += acquired.byteCost;
    records[index] = acquired.record;
    if (acquired.runtime) {
      runtimeAssets.push(acquired.runtime);
    }
  }

  return {
    records,
    runtimeAssets,
    completeness: acquisitionCompleteness(records),
  };
}
