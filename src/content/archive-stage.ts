/** Content-side chunk bridge for sealed raw/canonical archive stages. */

import {
  ARCHIVE_STAGE_CHUNK_BYTES,
  ARCHIVE_STAGE_MAX_BYTES,
  ARCHIVE_STAGE_RELATIVE_PATHS,
  isArchiveStageDescriptor,
  isSafeArchiveStageId,
  type ArchiveStageDescriptor,
  type ArchiveStageKind,
} from '../lib/archive-stage-contract';
import { canonicalBase64ByteLength } from '../lib/base64';
import { bytesToBase64 } from '../lib/image-utils';
import { sendMessage } from '../lib/messaging';
import type {
  ArchiveStageReadResponse,
  ArchiveStageResponse,
  StagedArchiveCompanionArtifact,
  StructuredArchiveSource,
} from '../lib/types';
import { sha256Hex } from './capture/response';

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isStageSuccess(value: unknown): value is ArchiveStageResponse & { success: true } {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasExactKeys(value, ['success']) &&
    (value as Record<string, unknown>).success === true
  );
}

function isBeginSuccess(value: unknown): value is ArchiveStageResponse & {
  success: true;
  stageId: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    hasExactKeys(value, ['success', 'stageId']) &&
    (value as Record<string, unknown>).success === true &&
    isSafeArchiveStageId((value as Record<string, unknown>).stageId)
  );
}

function isReadSuccess(
  value: unknown,
  stageId: string,
  offset: number,
  byteLength: number
): value is Extract<ArchiveStageReadResponse, { success: true }> {
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as Record<string, unknown>).success !== true
  ) {
    return false;
  }
  const data = (value as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    hasExactKeys(value, ['success', 'data']) &&
    hasExactKeys(data, ['stageId', 'offset', 'byteLength', 'chunkBase64']) &&
    record.stageId === stageId &&
    record.offset === offset &&
    record.byteLength === byteLength &&
    typeof record.chunkBase64 === 'string' &&
    canonicalBase64ByteLength(record.chunkBase64) === byteLength
  );
}

function decodeCanonicalChunk(base64: string, expectedLength: number): Uint8Array | undefined {
  if (canonicalBase64ByteLength(base64) !== expectedLength) return undefined;
  try {
    const binary = atob(base64);
    if (binary.length !== expectedLength || btoa(binary) !== base64) return undefined;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

function descriptorFor(
  kind: ArchiveStageKind,
  bytes: Uint8Array,
  sha256: string
): ArchiveStageDescriptor {
  return {
    kind,
    mediaType: 'application/json',
    relativePath: ARCHIVE_STAGE_RELATIVE_PATHS[kind],
    byteLength: bytes.byteLength,
    sha256,
  };
}

export async function abortStagedArchiveArtifact(
  stageId: string,
  source: StructuredArchiveSource = 'chatgpt'
): Promise<void> {
  if (!isSafeArchiveStageId(stageId)) return;
  try {
    await sendMessage({ action: 'abortStagedArchiveArtifact', source, stageId });
  } catch {
    // A later bounded stale-stage sweep retains cleanup ownership.
  }
}

/** Stage one already materialized canonical artifact without one whole message. */
export async function stageArchiveArtifactBytes(
  kind: ArchiveStageKind,
  bytes: Uint8Array,
  source: StructuredArchiveSource = 'chatgpt'
): Promise<StagedArchiveCompanionArtifact> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > ARCHIVE_STAGE_MAX_BYTES) {
    throw new Error('archive-stage-payload-invalid');
  }
  const descriptor = descriptorFor(kind, bytes, await sha256Hex(bytes));
  if (!isArchiveStageDescriptor(descriptor)) throw new Error('archive-stage-descriptor-invalid');

  const begin = await sendMessage({
    action: 'beginStagedArchiveArtifact',
    source,
    descriptor,
  });
  if (!isBeginSuccess(begin)) throw new Error('archive-stage-begin-failed');
  const stageId = begin.stageId;
  let sealed = false;
  try {
    for (let offset = 0; offset < bytes.byteLength; offset += ARCHIVE_STAGE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + ARCHIVE_STAGE_CHUNK_BYTES);
      const appended = await sendMessage({
        action: 'appendStagedArchiveArtifact',
        source,
        stageId,
        offset,
        chunkBase64: bytesToBase64(chunk),
      });
      if (!isStageSuccess(appended)) throw new Error('archive-stage-append-failed');
    }
    const sealedResponse = await sendMessage({
      action: 'sealStagedArchiveArtifact',
      source,
      stageId,
      descriptor,
    });
    if (!isStageSuccess(sealedResponse)) throw new Error('archive-stage-seal-failed');
    sealed = true;
    return { transport: 'staged', stageId, ...descriptor };
  } finally {
    if (!sealed) await abortStagedArchiveArtifact(stageId, source);
  }
}

/** Read one sealed artifact in bounded messages, then independently verify it. */
export async function readStagedArchiveArtifactBytes(
  artifact: StagedArchiveCompanionArtifact,
  source: StructuredArchiveSource = 'chatgpt'
): Promise<Uint8Array> {
  const descriptor: ArchiveStageDescriptor = {
    kind: artifact.kind,
    mediaType: artifact.mediaType,
    relativePath: artifact.relativePath,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
  };
  if (
    !isSafeArchiveStageId(artifact.stageId) ||
    !isArchiveStageDescriptor(descriptor) ||
    artifact.byteLength > ARCHIVE_STAGE_MAX_BYTES
  ) {
    throw new Error('archive-stage-artifact-invalid');
  }

  const result = new Uint8Array(artifact.byteLength);
  for (let offset = 0; offset < artifact.byteLength; offset += ARCHIVE_STAGE_CHUNK_BYTES) {
    const byteLength = Math.min(ARCHIVE_STAGE_CHUNK_BYTES, artifact.byteLength - offset);
    const response = await sendMessage({
      action: 'readStagedArchiveArtifact',
      source,
      stageId: artifact.stageId,
      offset,
      byteLength,
    });
    if (!isReadSuccess(response, artifact.stageId, offset, byteLength)) {
      throw new Error('archive-stage-read-failed');
    }
    const bytes = decodeCanonicalChunk(response.data.chunkBase64, byteLength);
    if (!bytes) throw new Error('archive-stage-read-failed');
    result.set(bytes, offset);
  }
  if ((await sha256Hex(result)) !== artifact.sha256) {
    throw new Error('archive-stage-integrity-failed');
  }
  return result;
}
