import {
  SNAPSHOT_CATALOG_HARD_LIMITS,
  SnapshotCatalogError,
  type BuildSnapshotCatalogInput,
  type SnapshotCatalogCode,
  type SnapshotCatalogLimits,
} from './contracts';

const ownedErrors = new WeakMap<object, SnapshotCatalogCode>();
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedPrototype, 'byteLength')!.get!;
const typedOffset = Object.getOwnPropertyDescriptor(typedPrototype, 'byteOffset')!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedPrototype, 'buffer')!.get!;
const typedTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag)!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const bufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

export function fail(code: SnapshotCatalogCode): never {
  const error = new SnapshotCatalogError(code);
  ownedErrors.set(error, code);
  throw error;
}

export function errorCode(error: unknown, fallback: SnapshotCatalogCode): SnapshotCatalogCode {
  return error && typeof error === 'object' ? (ownedErrors.get(error) ?? fallback) : fallback;
}

/**
 * Plain own enumerable data only. Observably hostile traps fail closed; a fully
 * transparent object/array Proxy is not distinguishable in portable JavaScript.
 * Callers therefore supply UI-owned plain descriptors, not arbitrary objects.
 */
export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  code: SnapshotCatalogCode = 'invalid-request'
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const allowed = [...required, ...optional];
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) fail(code);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) {
      if (required.includes(key)) fail(code);
    } else {
      if (!('value' in descriptor) || !descriptor.enumerable) fail(code);
      result[key] = descriptor.value;
    }
  }
  return result;
}

export function arrayData(
  value: unknown,
  max: number,
  code: SnapshotCatalogCode = 'invalid-request'
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0) fail(code);
  if (length > max) fail('limit-exceeded');
  if (Reflect.ownKeys(value).length !== length + 1) fail(code);
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(code);
    result.push(descriptor.value);
  }
  return result;
}

export function resolveLimits(value: unknown): SnapshotCatalogLimits {
  const limits: SnapshotCatalogLimits = { ...SNAPSHOT_CATALOG_HARD_LIMITS };
  if (value === undefined) return limits;
  const input = fields(value, [], Object.keys(limits), 'invalid-limits');
  for (const [name, value] of Object.entries(input)) {
    const key = name as keyof SnapshotCatalogLimits;
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > limits[key])
      fail('invalid-limits');
    limits[key] = value as number;
  }
  return limits;
}

export function relativePath(value: unknown, limits: SnapshotCatalogLimits): string {
  if (typeof value !== 'string' || !value) fail('invalid-request');
  if (value.length > limits.maxRelativePathCodeUnits) fail('limit-exceeded');
  if (
    /[\\:*?"<>|]/u.test(value) ||
    [...value].some(
      character => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f
    )
  )
    fail('invalid-request');
  const segments = value.split('/');
  if (
    segments.some(
      part =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[.\s]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
    )
  )
    fail('invalid-request');
  return value;
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sum(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) fail('limit-exceeded');
  return result;
}

export function byteView(value: unknown, max: number): Uint8Array {
  if (!value || typeof value !== 'object' || typedTag.call(value) !== 'Uint8Array')
    fail('invalid-request');
  const length = typedLength.call(value) as number;
  if (length > max) fail('limit-exceeded');
  const buffer = typedBuffer.call(value) as ArrayBuffer;
  bufferLength.call(buffer); // Native slots reject shared buffers and proxy receivers.
  if (bufferResizable?.call(buffer) === true) fail('invalid-request');
  // Numeric typed-array slots cannot be accessors; reject every additional slot.
  if (Reflect.ownKeys(value).length !== length) fail('invalid-request');
  return new Uint8Array(buffer, typedOffset.call(value), length);
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  const length = typedLength.call(left) as number;
  if (length !== typedLength.call(right)) return false;
  for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

export interface OwnedMetadata {
  path: string;
  byteLength: number;
}
export interface OwnedManifest {
  path: string;
  root: string;
  bytes: Uint8Array;
}
export interface PreparedCatalog {
  files: OwnedMetadata[];
  manifests: OwnedManifest[];
  limits: SnapshotCatalogLimits;
  hash: (bytes: Uint8Array) => Promise<string>;
}

function hashCapability(
  sha256: BuildSnapshotCatalogInput['sha256'],
  limits: SnapshotCatalogLimits
) {
  let calls = 0;
  let bytesHashed = 0;
  const seen = new Map<string, Uint8Array>();
  return async (bytes: Uint8Array): Promise<string> => {
    calls += 1;
    bytesHashed = sum(bytesHashed, bytes.byteLength);
    if (calls > limits.maxHashCalls || bytesHashed > limits.maxHashBytes) fail('limit-exceeded');
    const isolated = new Uint8Array(bytes);
    let digest: unknown;
    try {
      digest = await sha256(isolated);
    } catch {
      fail('sha256-failed');
    }
    try {
      if (!equalBytes(bytes, byteView(isolated, limits.maxHashBytes))) fail('sha256-mutated');
    } catch {
      fail('sha256-mutated');
    }
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) fail('sha256-invalid');
    const previous = seen.get(digest);
    if (previous && !equalBytes(previous, bytes)) fail('sha256-collision');
    if (!previous) seen.set(digest, bytes);
    return digest;
  };
}

function selectedFiles(value: unknown, limits: SnapshotCatalogLimits): OwnedMetadata[] {
  const paths = new Set<string>();
  const files = arrayData(value, limits.maxSelectedFiles).map(value => {
    const file = fields(value, ['relativePath', 'byteLength']);
    const path = relativePath(file.relativePath, limits);
    const basename = path.slice(path.lastIndexOf('/') + 1);
    if (basename.toLowerCase() === 'manifest.json' && basename !== 'manifest.json')
      fail('invalid-request');
    if (!Number.isSafeInteger(file.byteLength) || (file.byteLength as number) < 0)
      fail('invalid-request');
    const alias = path.toLowerCase();
    if (paths.has(alias)) fail('invalid-request');
    paths.add(alias);
    return { path, byteLength: file.byteLength as number };
  });
  files.reduce((total, file) => sum(total, file.byteLength), 0);
  return files.sort((a, b) => compare(a.path, b.path));
}

/** Validate all admission budgets before allocation; copy before any hash await. */
export function prepareCatalog(value: BuildSnapshotCatalogInput): PreparedCatalog {
  try {
    const input = fields(value, ['files', 'manifests', 'sha256'], ['limits']);
    if (typeof input.sha256 !== 'function') fail('invalid-request');
    const limits = resolveLimits(input.limits);
    const files = selectedFiles(input.files, limits);
    const fileMap = new Map(files.map(file => [file.path, file]));
    const paths = new Set<string>();
    let total = 0;
    const pending = arrayData(input.manifests, limits.maxManifests).map(value => {
      const manifest = fields(value, ['relativePath', 'bytes']);
      const path = relativePath(manifest.relativePath, limits);
      if (path !== 'manifest.json' && !path.endsWith('/manifest.json')) fail('invalid-request');
      if (paths.has(path.toLowerCase())) fail('invalid-request');
      paths.add(path.toLowerCase());
      const bytes = byteView(manifest.bytes, limits.maxManifestBytes);
      if (fileMap.get(path)?.byteLength !== bytes.byteLength) fail('invalid-request');
      total = sum(total, bytes.byteLength);
      if (total > limits.maxTotalManifestBytes) fail('limit-exceeded');
      return { path, root: path.slice(0, -'manifest.json'.length), bytes };
    });
    if (
      files.some(
        file =>
          (file.path === 'manifest.json' || file.path.endsWith('/manifest.json')) &&
          !paths.has(file.path.toLowerCase())
      )
    )
      fail('invalid-request');
    return {
      files,
      manifests: pending
        .map(file => ({ ...file, bytes: new Uint8Array(file.bytes) }))
        .sort((a, b) => compare(a.path, b.path)),
      limits,
      hash: hashCapability(input.sha256 as BuildSnapshotCatalogInput['sha256'], limits),
    };
  } catch (error) {
    fail(errorCode(error, 'invalid-request'));
  }
}
