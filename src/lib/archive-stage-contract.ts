/**
 * Narrow contracts for ephemeral OPFS stages that carry structured archive
 * responses. These are deliberately separate from binary asset staging:
 * archive stages hold only the raw and canonical JSON artifacts which are
 * later consumed by archive orchestration.
 */

import { canonicalBase64ByteLength } from './base64';

export const ARCHIVE_STAGE_MAX_BYTES = 64 * 1024 * 1024;
export const ARCHIVE_STAGE_CHUNK_BYTES = 512 * 1024;

/** Fixed, value-free begin diagnostics; never forward native error text. */
export const ARCHIVE_STAGE_BEGIN_OFFSCREEN_FAILURES = [
  'offscreen-sender-tab',
  'offscreen-sender-document',
  'offscreen-sender-url',
  'offscreen-worker-entry-unavailable',
  'offscreen-invalid-request',
  'opfs-unavailable',
  'opfs-denied',
  'opfs-quota',
  'opfs-not-found',
  'opfs-invalid-state',
  'opfs-type-error',
  'opfs-operation-failed',
] as const;

export const ARCHIVE_STAGE_RELATIVE_PATHS = {
  raw: 'responses/conversation.json',
  canonical: 'canonical/liska-thread-1.json',
} as const;

export type ArchiveStageKind = keyof typeof ARCHIVE_STAGE_RELATIVE_PATHS;

export interface ArchiveStageDescriptor {
  kind: ArchiveStageKind;
  mediaType: 'application/json';
  relativePath: string;
  byteLength: number;
  sha256: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
// Thirty-two base64url symbols encode at least 192 bits. The upper bound keeps
// OPFS entry names and extension messages bounded without making stage IDs
// semantically meaningful.
const ARCHIVE_STAGE_ID_PATTERN = /^archive-stage-[A-Za-z0-9_-]{32,96}$/;

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

export function isSafeArchiveStageId(value: unknown): value is string {
  return typeof value === 'string' && ARCHIVE_STAGE_ID_PATTERN.test(value);
}

export function isArchiveStageDescriptor(value: unknown): value is ArchiveStageDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    if (!hasExactOwnKeys(value, ['kind', 'mediaType', 'relativePath', 'byteLength', 'sha256'])) {
      return false;
    }
    const descriptor = value as Record<string, unknown>;
    if (descriptor.kind !== 'raw' && descriptor.kind !== 'canonical') return false;
    return (
      descriptor.mediaType === 'application/json' &&
      descriptor.relativePath === ARCHIVE_STAGE_RELATIVE_PATHS[descriptor.kind] &&
      Number.isSafeInteger(descriptor.byteLength) &&
      (descriptor.byteLength as number) >= 0 &&
      (descriptor.byteLength as number) <= ARCHIVE_STAGE_MAX_BYTES &&
      typeof descriptor.sha256 === 'string' &&
      SHA256_PATTERN.test(descriptor.sha256)
    );
  } catch {
    return false;
  }
}

export function equalArchiveStageDescriptor(
  left: ArchiveStageDescriptor,
  right: ArchiveStageDescriptor
): boolean {
  return (
    left.kind === right.kind &&
    left.mediaType === right.mediaType &&
    left.relativePath === right.relativePath &&
    left.byteLength === right.byteLength &&
    left.sha256 === right.sha256
  );
}

/**
 * Decode one independently canonical standard-base64 stage chunk. The decoder
 * rejects whitespace, URL-safe alphabets, alternate padding, and chunks above
 * the message-sized bound before they can enter OPFS.
 */
export function decodeCanonicalArchiveStageChunk(base64: string): Uint8Array | undefined {
  const expectedLength = canonicalBase64ByteLength(base64);
  if (expectedLength === undefined || expectedLength > ARCHIVE_STAGE_CHUNK_BYTES) {
    return undefined;
  }
  try {
    const binary = atob(base64);
    if (binary.length !== expectedLength || btoa(binary) !== base64) return undefined;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}
