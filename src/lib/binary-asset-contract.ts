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
import { binaryAssetExtension, isSafeStagedBinaryAssetId } from '../shared/binary-asset-descriptor';
export {
  binaryAssetExtension,
  isSafeStagedBinaryAssetId,
  isStagedBinaryAssetDescriptor,
} from '../shared/binary-asset-descriptor';

const STAGE_ID_PATTERN = /^stage-[A-Za-z0-9_-]{32,96}$/;

export function isSafeBinaryStageId(value: unknown): value is string {
  return typeof value === 'string' && STAGE_ID_PATTERN.test(value);
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
