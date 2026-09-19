/** Bounded credential-free acquisition of verified DeepSeek signed paths. */

import type {
  CaptureCompletenessState,
  RawCaptureAsset,
  RawCaptureAssetRecord,
} from '../../archive/capture';
import { binaryAssetExtension, isSafeStagedBinaryAssetId } from '../../lib/binary-asset-contract';
import { MAX_STAGED_BINARY_ASSET_BYTES } from '../../lib/constants';
import { sha256Hex } from '../../lib/sha256';
import {
  isExactDeepSeekDownloadUrl,
  type DeepSeekSignedAssetCandidate,
} from './deepseek-asset-resolver';

const MAX_DEEPSEEK_ASSET_ATTEMPTS = 20;
const MAX_DEEPSEEK_ASSET_BYTES_TOTAL = 128 * 1024 * 1024;
const DEFAULT_ASSET_TIMEOUT_MS = 30_000;

export const DEEPSEEK_ASSET_FETCHED_DETAIL = 'deepseek-signed-response';
export const DEEPSEEK_ASSET_FETCH_FAILED_DETAIL = 'deepseek-signed-fetch-failed';
export const DEEPSEEK_ASSET_HTTP_FAILED_DETAIL = 'deepseek-signed-http-failed';
export const DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL = 'deepseek-signed-response-rejected';
export const DEEPSEEK_ASSET_SIZE_MISMATCH_DETAIL = 'deepseek-declared-size-mismatch';
export const DEEPSEEK_ASSET_TIMEOUT_DETAIL = 'deepseek-signed-fetch-timeout';

export interface AcquireDeepSeekAssetsInput {
  assets: readonly RawCaptureAssetRecord[];
  candidates: readonly DeepSeekSignedAssetCandidate[];
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  sha256?: (bytes: Uint8Array) => Promise<string>;
  /** Test/caller values can only tighten the built-in caps. */
  maxTotalBytes?: number;
  maxAssetBytes?: number;
}

export interface DeepSeekAssetAcquisition {
  records: RawCaptureAssetRecord[];
  runtimeAssets: RawCaptureAsset[];
  completeness: CaptureCompletenessState;
}

function boundedValue(value: number | undefined, maximum: number): number {
  return value === undefined || !Number.isFinite(value)
    ? maximum
    : Math.min(maximum, Math.max(0, Math.floor(value)));
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

function cloneRecord(record: RawCaptureAssetRecord): RawCaptureAssetRecord {
  return { ...record, sourceRefs: record.sourceRefs.map(sourceRef => ({ ...sourceRef })) };
}

function failedRecord(
  record: RawCaptureAssetRecord,
  timestamp: string,
  detail: string
): RawCaptureAssetRecord {
  return {
    ...cloneRecord(record),
    state: 'failed',
    attemptedAt: timestamp,
    relativePath: null,
    mediaType: null,
    byteLength: null,
    sha256: null,
    detail,
  };
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
    // The stable failed result does not depend on provider cancel support.
  }
}

type BoundedRead =
  | { ok: true; bytes: Uint8Array; byteCost: number }
  | { ok: false; byteCost: number };

async function readBoundedResponse(response: Response, maxBytes: number): Promise<BoundedRead> {
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
    return { ok: true, bytes, byteCost: byteLength };
  } catch {
    return { ok: false, byteCost: maxBytes };
  }
}

// eslint-disable-next-line complexity, max-lines-per-function -- One exact request lifecycle keeps every rejection fail-closed and auditable.
async function fetchOne(
  record: RawCaptureAssetRecord,
  candidate: DeepSeekSignedAssetCandidate,
  input: AcquireDeepSeekAssetsInput,
  timestamp: string,
  maxAssetBytes: number
): Promise<{ record: RawCaptureAssetRecord; runtime?: RawCaptureAsset; byteCost: number }> {
  if (!isExactDeepSeekDownloadUrl(candidate.downloadUrl)) {
    return {
      record: failedRecord(record, timestamp, DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL),
      byteCost: 0,
    };
  }
  const controller = new AbortController();
  const timeoutMs = Math.min(120_000, Math.max(1_000, input.timeoutMs ?? DEFAULT_ASSET_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (input.fetcher ?? fetch)(candidate.downloadUrl, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok || response.status !== 200) {
      return {
        record: failedRecord(record, timestamp, DEEPSEEK_ASSET_HTTP_FAILED_DETAIL),
        byteCost: 0,
      };
    }
    if (response.url !== candidate.downloadUrl) {
      return {
        record: failedRecord(record, timestamp, DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: 0,
      };
    }
    const mediaType = normalizedMediaType(response);
    if (!mediaType) {
      return {
        record: failedRecord(record, timestamp, DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: 0,
      };
    }
    const read = await readBoundedResponse(response, maxAssetBytes);
    if (!read.ok) {
      return {
        record: failedRecord(record, timestamp, DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: read.byteCost,
      };
    }
    if (
      candidate.declaredByteLength !== null &&
      candidate.declaredByteLength !== read.bytes.byteLength
    ) {
      return {
        record: failedRecord(record, timestamp, DEEPSEEK_ASSET_SIZE_MISMATCH_DETAIL),
        byteCost: read.byteCost,
      };
    }
    const extension = binaryAssetExtension(mediaType);
    let sha256: string;
    try {
      sha256 = await (input.sha256 ?? sha256Hex)(read.bytes);
    } catch {
      return {
        record: failedRecord(record, timestamp, DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: read.byteCost,
      };
    }
    if (
      extension === undefined ||
      !isSafeStagedBinaryAssetId(record.id) ||
      !/^[a-f0-9]{64}$/.test(sha256)
    ) {
      return {
        record: failedRecord(record, timestamp, DEEPSEEK_ASSET_RESPONSE_REJECTED_DETAIL),
        byteCost: read.byteCost,
      };
    }
    const fetched: RawCaptureAssetRecord = {
      ...cloneRecord(record),
      state: 'fetched',
      attemptedAt: timestamp,
      relativePath: `assets/${sha256}.${extension}`,
      mediaType,
      byteLength: read.bytes.byteLength,
      sha256,
      detail: DEEPSEEK_ASSET_FETCHED_DETAIL,
    };
    return {
      record: fetched,
      runtime: { record: fetched, bytes: read.bytes },
      byteCost: read.byteCost,
    };
  } catch {
    return {
      record: failedRecord(
        record,
        timestamp,
        controller.signal.aborted
          ? DEEPSEEK_ASSET_TIMEOUT_DETAIL
          : DEEPSEEK_ASSET_FETCH_FAILED_DETAIL
      ),
      byteCost: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

function completeness(records: readonly RawCaptureAssetRecord[]): CaptureCompletenessState {
  if (records.every(record => record.state === 'not-attempted')) return 'not-attempted';
  return records.every(record => record.state !== 'not-attempted') ? 'complete' : 'partial';
}

/** Acquire each exact candidate once, sequentially, within fixed byte/attempt ceilings. */
export async function acquireDeepSeekSignedAssets(
  input: AcquireDeepSeekAssetsInput
): Promise<DeepSeekAssetAcquisition> {
  const records = input.assets.map(cloneRecord);
  const byId = new Map(records.map((record, index) => [record.id, index]));
  const runtimeAssets: RawCaptureAsset[] = [];
  const seen = new Set<string>();
  const maxTotalBytes = boundedValue(input.maxTotalBytes, MAX_DEEPSEEK_ASSET_BYTES_TOTAL);
  const maxAssetBytes = boundedValue(input.maxAssetBytes, MAX_STAGED_BINARY_ASSET_BYTES);
  let attempts = 0;
  let totalReadBytes = 0;

  for (const candidate of input.candidates) {
    if (attempts >= MAX_DEEPSEEK_ASSET_ATTEMPTS || seen.has(candidate.assetId)) continue;
    seen.add(candidate.assetId);
    const index = byId.get(candidate.assetId);
    if (index === undefined || records[index].state !== 'not-attempted') continue;
    const remaining = maxTotalBytes - totalReadBytes;
    const attemptLimit = Math.min(maxAssetBytes, remaining);
    if (attemptLimit <= 0) break;
    const timestamp = attemptedAt(input.now);
    if (!timestamp) continue;
    attempts += 1;
    const acquired = await fetchOne(records[index], candidate, input, timestamp, attemptLimit);
    totalReadBytes += acquired.byteCost;
    records[index] = acquired.record;
    if (acquired.runtime) runtimeAssets.push(acquired.runtime);
  }

  return { records, runtimeAssets, completeness: completeness(records) };
}
