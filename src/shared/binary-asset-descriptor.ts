/** No-I/O binary descriptor rules shared by archive normalization and staged transport. */

/** One binary asset's bounded OPFS, Blob, readback and SHA-256 working set. */
export const MAX_STAGED_BINARY_ASSET_BYTES = 64 * 1024 * 1024;

/**
 * Provider-neutral description of one verified binary archive asset.
 * The opaque asset ID correlates with inventory; the path is content-addressed.
 */
export interface StagedBinaryAssetDescriptor {
  assetId: string;
  byteLength: number;
  sha256: string;
  mediaType: string;
  relativePath: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
// Reuse the capture ledger's hashed correlation form. This rejects raw
// provider IDs, URL-ish values, and signed transport tokens at the first
// persistence boundary while allowing provider-neutral prefixes.
const ASSET_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}-asset-[a-f0-9]{64}$/;

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
  const key = mediaType.toLowerCase();
  return Object.prototype.hasOwnProperty.call(BINARY_MIME_TO_EXTENSION, key)
    ? BINARY_MIME_TO_EXTENSION[key]
    : undefined;
}

export function isSafeStagedBinaryAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
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
