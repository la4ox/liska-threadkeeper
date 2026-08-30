/**
 * Dormant content-side orchestrator for already verified fetched bytes.
 *
 * This intentionally does not acquire ChatGPT (or any provider) assets. A
 * future acquisition seam can hand it `RawCaptureAsset` values after its own
 * verification; this helper then stages one asset at a time and never builds
 * an asset-sized extension message.
 */

import type { RawCaptureAsset } from '../archive/capture';
import { BINARY_STAGE_CHUNK_BYTES } from '../lib/constants';
import {
  createStagedBinaryAssetDescriptor,
  isSafeStagedBinaryAssetId,
} from '../lib/binary-asset-contract';
import { bytesToBase64 } from '../lib/image-utils';
import { sendMessage } from '../lib/messaging';
import type {
  AIPlatform,
  MultiOutputResponse,
  OutputResult,
  PersistentOutputDestination,
  StagedBinaryAssetDescriptor,
  StagedBinaryAssetResult,
} from '../lib/types';

export interface VerifiedBinaryAssetRuntime {
  assetId: string;
  mediaType: string;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  /** Present only when the acquisition ledger already has a canonical path. */
  relativePath?: string;
}

export interface StagedBinaryPersistenceInput {
  source: AIPlatform;
  captureId: string;
  conversationKey: string;
  assets: readonly (RawCaptureAsset | VerifiedBinaryAssetRuntime)[];
  /** Clipboard is absent from this type and rejected again at runtime. */
  outputs: readonly PersistentOutputDestination[];
}

function runtimeFromAsset(
  asset: RawCaptureAsset | VerifiedBinaryAssetRuntime
): VerifiedBinaryAssetRuntime | undefined {
  if ('record' in asset) {
    const record = asset.record;
    if (
      record.state !== 'fetched' ||
      record.mediaType === null ||
      record.byteLength === null ||
      record.sha256 === null
    ) {
      return undefined;
    }
    return {
      assetId: record.id,
      mediaType: record.mediaType,
      bytes: asset.bytes,
      byteLength: record.byteLength,
      sha256: record.sha256,
      ...(record.relativePath !== null && { relativePath: record.relativePath }),
    };
  }
  return asset;
}

function safeStageId(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `stage-${bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_')}`;
}

function validOutputs(outputs: readonly PersistentOutputDestination[]): boolean {
  return (
    Array.isArray(outputs) &&
    outputs.length > 0 &&
    outputs.length <= 2 &&
    new Set(outputs).size === outputs.length &&
    outputs.every(output => output === 'file' || output === 'obsidian')
  );
}

function failureResult(
  assetId: string,
  descriptor: StagedBinaryAssetDescriptor | undefined,
  outputs: readonly PersistentOutputDestination[],
  error: string
): StagedBinaryAssetResult {
  return {
    assetId,
    ...(descriptor && { descriptor }),
    results: outputs.map(destination => ({ destination, success: false, error })),
    allSuccessful: false,
  };
}

function isSafeOutputResult(
  value: unknown,
  destination: PersistentOutputDestination
): value is OutputResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  const keys = Object.keys(result);
  return (
    keys.every(key => ['destination', 'success', 'error', 'warning'].includes(key)) &&
    result.destination === destination &&
    typeof result.success === 'boolean' &&
    (result.error === undefined ||
      (typeof result.error === 'string' && /^[a-z0-9-]{1,96}$/.test(result.error))) &&
    (result.warning === undefined || result.warning === 'binary-stage-cleanup-deferred')
  );
}

function isBinaryCommitResponse(
  value: unknown,
  outputs: readonly PersistentOutputDestination[]
): value is MultiOutputResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  const results = response.results;
  return (
    Array.isArray(results) &&
    results.length === outputs.length &&
    outputs.every((output, index) => isSafeOutputResult(results[index], output)) &&
    response.allSuccessful === results.every(result => (result as OutputResult).success) &&
    response.anySuccessful === results.some(result => (result as OutputResult).success)
  );
}

function isStageSuccess(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).success === true
  );
}

async function abortStage(source: AIPlatform, stageId: string): Promise<void> {
  try {
    await sendMessage({ action: 'abortStagedBinaryAsset', source, stageId });
  } catch {
    // The later exact stale-stage sweep cleans a worker-suspension residue.
  }
}

async function beginStage(
  source: AIPlatform,
  stageId: string,
  descriptor: StagedBinaryAssetDescriptor
): Promise<boolean> {
  return isStageSuccess(
    await sendMessage({ action: 'beginStagedBinaryAsset', source, stageId, descriptor })
  );
}

async function appendStageChunks(
  source: AIPlatform,
  stageId: string,
  bytes: Uint8Array
): Promise<boolean> {
  for (let offset = 0; offset < bytes.byteLength; offset += BINARY_STAGE_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BINARY_STAGE_CHUNK_BYTES);
    const response = await sendMessage({
      action: 'appendStagedBinaryAsset',
      source,
      stageId,
      offset,
      chunkBase64: bytesToBase64(chunk),
    });
    if (!isStageSuccess(response)) return false;
  }
  return true;
}

async function commitStage(
  input: StagedBinaryPersistenceInput,
  stageId: string,
  descriptor: StagedBinaryAssetDescriptor
): Promise<unknown> {
  return sendMessage({
    action: 'commitStagedBinaryAsset',
    stageId,
    captureId: input.captureId,
    conversationKey: input.conversationKey,
    source: input.source,
    descriptor,
    outputs: [...input.outputs],
  });
}

async function stageOneAsset(
  input: StagedBinaryPersistenceInput,
  asset: VerifiedBinaryAssetRuntime,
  descriptor: StagedBinaryAssetDescriptor
): Promise<StagedBinaryAssetResult> {
  let stageId: string | undefined;
  let committed = false;
  try {
    stageId = safeStageId();
    if (!(await beginStage(input.source, stageId, descriptor))) {
      return failureResult(asset.assetId, descriptor, input.outputs, 'binary-stage-begin-failed');
    }
    if (!(await appendStageChunks(input.source, stageId, asset.bytes))) {
      return failureResult(asset.assetId, descriptor, input.outputs, 'binary-stage-append-failed');
    }
    committed = true;
    const response = await commitStage(input, stageId, descriptor);
    if (!isBinaryCommitResponse(response, input.outputs)) {
      return failureResult(asset.assetId, descriptor, input.outputs, 'binary-stage-commit-failed');
    }
    return {
      assetId: asset.assetId,
      descriptor,
      results: response.results,
      allSuccessful: response.allSuccessful,
    };
  } catch {
    return failureResult(asset.assetId, descriptor, input.outputs, 'binary-stage-operation-failed');
  } finally {
    if (stageId && !committed) await abortStage(input.source, stageId);
  }
}

type PreparedAsset =
  | { ok: true; asset: VerifiedBinaryAssetRuntime; descriptor: StagedBinaryAssetDescriptor }
  | {
      ok: false;
      assetId: string;
      descriptor?: StagedBinaryAssetDescriptor;
      error: 'binary-asset-invalid' | 'binary-asset-integrity-failed';
    };

async function prepareAsset(
  assetValue: RawCaptureAsset | VerifiedBinaryAssetRuntime
): Promise<PreparedAsset> {
  const asset = runtimeFromAsset(assetValue);
  if (
    !asset ||
    !isSafeStagedBinaryAssetId(asset.assetId) ||
    !(asset.bytes instanceof Uint8Array) ||
    asset.byteLength !== asset.bytes.byteLength
  ) {
    return { ok: false, assetId: asset?.assetId ?? 'invalid-asset', error: 'binary-asset-invalid' };
  }
  let descriptor: StagedBinaryAssetDescriptor | undefined;
  try {
    descriptor = await createStagedBinaryAssetDescriptor(asset);
  } catch {
    descriptor = undefined;
  }
  if (
    !descriptor ||
    descriptor.sha256 !== asset.sha256 ||
    (asset.relativePath !== undefined && descriptor.relativePath !== asset.relativePath)
  ) {
    return {
      ok: false,
      assetId: asset.assetId,
      ...(descriptor && { descriptor }),
      error: 'binary-asset-integrity-failed',
    };
  }
  return { ok: true, asset, descriptor };
}

/**
 * Stage and persist each verified asset sequentially. A failed asset returns
 * destination-specific failures but never prevents the next asset from being
 * attempted. Clipboard remains impossible in TypeScript and fails closed if a
 * caller defeats that type at runtime.
 */
export async function persistVerifiedBinaryAssets(
  input: StagedBinaryPersistenceInput
): Promise<StagedBinaryAssetResult[]> {
  if (!validOutputs(input.outputs)) {
    return input.assets.map(asset => {
      const runtime = runtimeFromAsset(asset);
      return failureResult(
        runtime?.assetId ?? 'invalid-asset',
        undefined,
        input.outputs,
        'binary-output-invalid'
      );
    });
  }

  const results: StagedBinaryAssetResult[] = [];
  for (const assetValue of input.assets) {
    const prepared = await prepareAsset(assetValue);
    if (!prepared.ok) {
      results.push(
        failureResult(prepared.assetId, prepared.descriptor, input.outputs, prepared.error)
      );
      continue;
    }
    results.push(await stageOneAsset(input, prepared.asset, prepared.descriptor));
  }
  return results;
}
