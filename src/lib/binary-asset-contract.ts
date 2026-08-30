/**
 * Provider-neutral contracts for the dormant staged binary persistence route.
 *
 * This module deliberately contains no acquisition or destination code. It
 * turns already verified runtime bytes into a safe content-addressed
 * descriptor and validates the small JSON messages that carry that descriptor.
 */

import { MAX_STAGED_BINARY_ASSET_BYTES } from './constants';
import { canonicalBase64ByteLength } from './base64';
import type { StagedBinaryAssetDescriptor } from './types';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
// Reuse the capture ledger's hashed correlation form. This rejects raw
// provider IDs, URL-ish values, and signed transport tokens at the first
// persistence boundary while allowing provider-neutral prefixes.
const ASSET_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}-asset-[a-f0-9]{64}$/;
const STAGE_ID_PATTERN = /^stage-[A-Za-z0-9_-]{32,96}$/;

/**
 * MIME types that are safe to retain as passive archive bytes. Active SVG,
 * HTML, script, macro-enabled Office formats, executables, and unknown types
 * are intentionally absent. Octet-stream has an explicit inert `.bin` route.
 */
const BINARY_MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  'application/json': 'json',
  'application/octet-stream': 'bin',
  'application/pdf': 'pdf',
  'application/rtf': 'rtf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

export function binaryAssetExtension(mediaType: string): string | undefined {
  if (typeof mediaType !== 'string' || mediaType !== mediaType.trim()) return undefined;
  return BINARY_MIME_TO_EXTENSION[mediaType.toLowerCase()];
}

export function isSafeStagedBinaryAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

export function isSafeBinaryStageId(value: unknown): value is string {
  return typeof value === 'string' && STAGE_ID_PATTERN.test(value);
}

export function isStagedBinaryAssetDescriptor(
  value: unknown
): value is StagedBinaryAssetDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    if (!hasExactOwnKeys(value, ['assetId', 'byteLength', 'sha256', 'mediaType', 'relativePath'])) {
      return false;
    }
    const descriptor = value as Record<string, unknown>;
    if (!isSafeStagedBinaryAssetId(descriptor.assetId)) return false;
    if (
      !Number.isSafeInteger(descriptor.byteLength) ||
      (descriptor.byteLength as number) < 0 ||
      (descriptor.byteLength as number) > MAX_STAGED_BINARY_ASSET_BYTES
    ) {
      return false;
    }
    if (typeof descriptor.sha256 !== 'string' || !SHA256_PATTERN.test(descriptor.sha256))
      return false;
    if (typeof descriptor.mediaType !== 'string') return false;
    const extension = binaryAssetExtension(descriptor.mediaType);
    return (
      extension !== undefined &&
      descriptor.mediaType === descriptor.mediaType.toLowerCase() &&
      descriptor.relativePath === `assets/${descriptor.sha256}.${extension}`
    );
  } catch {
    return false;
  }
}

export function equalStagedBinaryAssetDescriptor(
  left: StagedBinaryAssetDescriptor,
  right: StagedBinaryAssetDescriptor
): boolean {
  return (
    left.assetId === right.assetId &&
    left.byteLength === right.byteLength &&
    left.sha256 === right.sha256 &&
    left.mediaType === right.mediaType &&
    left.relativePath === right.relativePath
  );
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const exact = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', exact);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createStagedBinaryAssetDescriptor(input: {
  assetId: string;
  mediaType: string;
  bytes: Uint8Array;
}): Promise<StagedBinaryAssetDescriptor | undefined> {
  if (!isSafeStagedBinaryAssetId(input.assetId)) return undefined;
  if (
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength > MAX_STAGED_BINARY_ASSET_BYTES
  ) {
    return undefined;
  }
  const mediaType = input.mediaType.toLowerCase();
  const extension = binaryAssetExtension(mediaType);
  if (extension === undefined) return undefined;
  const sha256 = await sha256Hex(input.bytes);
  return {
    assetId: input.assetId,
    byteLength: input.bytes.byteLength,
    sha256,
    mediaType,
    relativePath: `assets/${sha256}.${extension}`,
  };
}

/** Decode only exact canonical standard base64; malformed chunks never reach OPFS. */
export function decodeCanonicalBinaryChunk(base64: string): Uint8Array | undefined {
  const expectedLength = canonicalBase64ByteLength(base64);
  if (expectedLength === undefined || expectedLength > MAX_STAGED_BINARY_ASSET_BYTES)
    return undefined;
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
