/** Exact-byte content addressing shared by append and ordinary image exports. */
import { canonicalBase64ByteLength } from './base64';
import {
  base64ToBytes,
  bytesToBase64,
  isAllowedImageMime,
  MAX_IMAGE_SIZE_BYTES,
  mimeToExtension,
} from './image-utils';
import { sha256Hex } from './sha256';
import type { ExtractedImage } from './types';

const IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const FULL_SHA256 = /^[a-f0-9]{64}$/;
export const IMMUTABLE_IMAGE_NAMESPACE = 'liska-v1';

/** Local REST API versions with the create-only PUT contract. */
export function supportsImmutableImageWrites(version: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major > 5 || (major === 5 && minor >= 5);
}

export class ImmutableImageError extends Error {
  constructor(readonly code: 'reference-invalid' | 'data-invalid') {
    super(`Image planning failed (${code}).`);
    this.name = 'ImmutableImageError';
  }
}

export interface ImmutableImageAsset {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export function sameImageBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function decodeImage(image: ExtractedImage): { bytes: Uint8Array; mediaType: string } {
  const normalized = image.mimeType.split(';')[0]!.trim().toLowerCase();
  const mediaType = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  const expectedLength = canonicalBase64ByteLength(image.data);
  if (
    !isAllowedImageMime(mediaType) ||
    expectedLength === undefined ||
    expectedLength < 1 ||
    expectedLength > MAX_IMAGE_SIZE_BYTES
  ) {
    throw new ImmutableImageError('data-invalid');
  }
  try {
    const bytes = base64ToBytes(image.data);
    if (bytes.byteLength !== expectedLength || bytesToBase64(bytes) !== image.data) {
      throw new ImmutableImageError('data-invalid');
    }
    return { bytes, mediaType };
  } catch {
    throw new ImmutableImageError('data-invalid');
  }
}

function selectImages(required: ReadonlySet<string>, images: readonly ExtractedImage[]) {
  for (const id of required)
    if (!IMAGE_ID.test(id)) throw new ImmutableImageError('reference-invalid');
  const selected = new Map<string, ExtractedImage>();
  for (const image of images) {
    if (!required.has(image.id)) continue;
    if (!IMAGE_ID.test(image.id) || selected.has(image.id)) {
      throw new ImmutableImageError('reference-invalid');
    }
    selected.set(image.id, image);
  }
  for (const id of required) {
    if (!selected.has(id)) throw new ImmutableImageError('reference-invalid');
  }
  return selected;
}

/** Strict selection, decoding and full-digest deduplication; no persistence side effects. */
export async function planImmutableImageAssets(
  required: ReadonlySet<string>,
  images: readonly ExtractedImage[]
) {
  const selected = selectImages(required, images);
  const assetsByFileName = new Map<string, ImmutableImageAsset>();
  const assetsByDigest = new Map<string, ImmutableImageAsset>();
  const names = new Map<string, string>();
  for (const id of required) {
    const { bytes, mediaType } = decodeImage(selected.get(id)!);
    const digest = await sha256Hex(bytes);
    if (!FULL_SHA256.test(digest)) throw new ImmutableImageError('data-invalid');
    const fileName = `sha256-${digest}.${mimeToExtension(mediaType)}`;
    const digestMatch = assetsByDigest.get(digest);
    if (digestMatch) {
      if (digestMatch.mediaType !== mediaType || !sameImageBytes(digestMatch.bytes, bytes)) {
        throw new ImmutableImageError('data-invalid');
      }
      names.set(id, digestMatch.fileName);
      continue;
    }
    const existing = assetsByFileName.get(fileName);
    if (existing && (existing.mediaType !== mediaType || !sameImageBytes(existing.bytes, bytes))) {
      throw new ImmutableImageError('data-invalid');
    }
    if (!existing) {
      const planned = { fileName, mediaType, bytes, sha256: digest };
      assetsByFileName.set(fileName, planned);
      assetsByDigest.set(digest, planned);
    }
    names.set(id, fileName);
  }
  return { assetsByFileName, names, selected };
}
