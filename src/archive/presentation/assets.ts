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

/** Presentation only: this policy never grants acquisition permission. */
export function htmlAssetMediaPolicy(
  mimeType: unknown
): Readonly<{ extension: string; renderMode: HtmlAssetBinding['renderMode'] }> | undefined {
  if (typeof mimeType !== 'string' || !hasOwn(MIME_EXTENSIONS, mimeType)) return undefined;
  return Object.freeze({
    extension: MIME_EXTENSIONS[mimeType],
    renderMode: IMAGE_MIMES.has(mimeType) ? 'image' : 'download',
  });
}

function requireBindingPath(value: Record<string, unknown>): void {
  const { mimeType, path, sha256 } = value;
  const policy = htmlAssetMediaPolicy(mimeType);
  if (!policy || path !== `assets/${sha256}.${policy.extension}`) fail('html-bindings-invalid');
}

/** Descriptor-only capture closes validation-to-use races in caller Proxy records. */
function snapshotBindingData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail('html-bindings-invalid');
  const snapshot: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('html-bindings-invalid');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !hasOwn(descriptor, 'value')) fail('html-bindings-invalid');
    Object.defineProperty(snapshot, key, { value: descriptor.value, enumerable: true });
  }
  return snapshot;
}

function requireBinding(value: unknown): HtmlAssetBinding {
  const candidate = snapshotBindingData(value);
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
  if (renderMode !== htmlAssetMediaPolicy(mimeType)?.renderMode) fail('html-bindings-invalid');
  return candidate as unknown as HtmlAssetBinding;
}

function requireCanonicalMatch(binding: HtmlAssetBinding, archive: LiskaThreadArchive): void {
  if (!hasOwn(archive.assets, binding.assetId)) fail('html-binding-mismatch');
  const asset = archive.assets[binding.assetId];
  if (
    asset.acquisition.state !== 'fetched' ||
    asset.id !== binding.assetId ||
    asset.localArtifactRef !== binding.path ||
    asset.sha256 !== binding.sha256 ||
    asset.mimeType !== binding.mimeType ||
    asset.byteLength !== binding.byteLength
  )
    fail('html-binding-mismatch');
}

function bindingHeader(value: HtmlAssetBindingSet, maxBindings: number) {
  const input = snapshotBindingData(value);
  if (
    !isRecord(input) ||
    !exactKeys(input, ['bindings', 'sha256']) ||
    !Array.isArray(input.bindings)
  ) {
    fail('html-bindings-invalid');
  }
  const list = input.bindings;
  if (Object.getPrototypeOf(list) !== Array.prototype) fail('html-bindings-invalid');
  const length = Object.getOwnPropertyDescriptor(list, 'length')?.value as number;
  if (!Number.isSafeInteger(length) || length < 0) fail('html-bindings-invalid');
  if (length > maxBindings) fail('html-binding-count-limit');
  if (
    length === 0
      ? input.sha256 !== null
      : typeof input.sha256 !== 'string' || !LOWERCASE_SHA256.test(input.sha256)
  ) {
    fail('html-bindings-invalid');
  }
  if (Reflect.ownKeys(list).length !== length + 1) fail('html-bindings-invalid');
  return { list, length, sha256: input.sha256 as string | null };
}

function bindingAt(list: unknown[], index: number): HtmlAssetBinding {
  const descriptor = Object.getOwnPropertyDescriptor(list, String(index));
  if (!descriptor?.enumerable || !hasOwn(descriptor, 'value')) fail('html-bindings-invalid');
  return requireBinding(descriptor.value);
}

export function validateHtmlBindings(
  value: HtmlAssetBindingSet | undefined,
  archive: LiskaThreadArchive,
  maxBindings: number
): { bindings: Map<string, HtmlAssetBinding>; sha256: string | null } {
  const bindings = new Map<string, HtmlAssetBinding>();
  if (value === undefined) return { bindings, sha256: null };
  const { list, length, sha256 } = bindingHeader(value, maxBindings);
  const paths = new Map<string, HtmlAssetBinding>();
  for (let index = 0; index < length; index++) {
    const binding = bindingAt(list, index);
    if (bindings.has(binding.assetId)) fail('html-bindings-invalid');
    requireCanonicalMatch(binding, archive);
    const samePath = paths.get(binding.path);
    // Byte-identical aliases may share a file; conflicting receipts cannot.
    if (
      samePath &&
      (samePath.sha256 !== binding.sha256 ||
        samePath.mimeType !== binding.mimeType ||
        samePath.byteLength !== binding.byteLength)
    )
      fail('html-binding-mismatch');
    bindings.set(binding.assetId, binding);
    paths.set(binding.path, binding);
  }
  return { bindings, sha256 };
}
