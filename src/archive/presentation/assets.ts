import type { LiskaThreadArchive } from '../types';
import type { HtmlAssetBinding, HtmlAssetBindingSet } from './contracts';
import { exactKeys, fail, hasOwn, isRecord, LOWERCASE_SHA256 } from './safety';

/** Matches the passive binary archive contract, without importing runtime crypto/storage code. */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
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

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function requireBindingPath(value: Record<string, unknown>): void {
  const { mimeType, path, sha256 } = value;
  if (
    typeof mimeType !== 'string' ||
    !hasOwn(MIME_EXTENSIONS, mimeType) ||
    path !== `assets/${sha256}.${MIME_EXTENSIONS[mimeType]}`
  )
    fail('html-bindings-invalid');
}

function requireBinding(candidate: unknown): HtmlAssetBinding {
  if (
    !isRecord(candidate) ||
    !exactKeys(candidate, ['assetId', 'path', 'sha256', 'mimeType', 'byteLength', 'renderMode'])
  )
    fail('html-bindings-invalid');
  const { assetId, sha256, mimeType, byteLength, renderMode } = candidate;
  if (
    typeof assetId !== 'string' ||
    assetId.length === 0 ||
    typeof sha256 !== 'string' ||
    !LOWERCASE_SHA256.test(sha256)
  )
    fail('html-bindings-invalid');
  requireBindingPath(candidate);
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 0)
    fail('html-bindings-invalid');
  if (
    (renderMode !== 'image' && renderMode !== 'download') ||
    (renderMode === 'image' && !IMAGE_MIMES.has(mimeType as string))
  )
    fail('html-bindings-invalid');
  return candidate as unknown as HtmlAssetBinding;
}

function requireCanonicalMatch(binding: HtmlAssetBinding, archive: LiskaThreadArchive): void {
  if (!hasOwn(archive.assets, binding.assetId)) fail('html-binding-mismatch');
  const asset = archive.assets[binding.assetId];
  if (
    asset.acquisition.state !== 'fetched' ||
    asset.sha256 !== binding.sha256 ||
    asset.mimeType !== binding.mimeType ||
    asset.byteLength !== binding.byteLength
  )
    fail('html-binding-mismatch');
}

export function validateHtmlBindings(
  input: HtmlAssetBindingSet | undefined,
  archive: LiskaThreadArchive,
  maxBindings: number
): Map<string, HtmlAssetBinding> {
  const bindings = new Map<string, HtmlAssetBinding>();
  if (input === undefined) return bindings;
  if (
    !isRecord(input) ||
    !exactKeys(input, ['bindings', 'sha256']) ||
    !Array.isArray(input.bindings)
  ) {
    fail('html-bindings-invalid');
  }
  if (input.bindings.length > maxBindings) fail('html-binding-count-limit');
  if (
    input.bindings.length === 0
      ? input.sha256 !== null
      : typeof input.sha256 !== 'string' || !LOWERCASE_SHA256.test(input.sha256)
  ) {
    fail('html-bindings-invalid');
  }
  const paths = new Map<string, HtmlAssetBinding>();
  for (const candidate of input.bindings) {
    const binding = requireBinding(candidate);
    if (bindings.has(binding.assetId)) fail('html-bindings-invalid');
    requireCanonicalMatch(binding, archive);
    const samePath = paths.get(binding.path);
    // Byte-identical aliases may share a file; conflicting receipts cannot.
    if (
      samePath &&
      (samePath.mimeType !== binding.mimeType || samePath.byteLength !== binding.byteLength)
    )
      fail('html-binding-mismatch');
    bindings.set(binding.assetId, binding);
    paths.set(binding.path, binding);
  }
  return bindings;
}
