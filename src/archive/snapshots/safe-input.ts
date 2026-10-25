import {
  SNAPSHOT_ANALYSIS_HARD_LIMITS,
  SnapshotAnalysisError,
  type AnalyzeSnapshotsInput,
  type SnapshotAnalysisCode,
  type SnapshotAnalysisLimits,
} from './contracts';

const ownedErrors = new WeakMap<object, SnapshotAnalysisCode>();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!;
const typedOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const typedTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)!.get!;
const arrayBufferLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength'
)!.get!;
const arrayBufferResizable = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'resizable'
)?.get;

export interface OwnedFile {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface OwnedInventory {
  files: OwnedFile[];
  measuredByteLength: number;
}

export interface PreparedAnalysis {
  inventories: OwnedInventory[];
  limits: SnapshotAnalysisLimits;
  hash: (bytes: Uint8Array) => Promise<string>;
  /** Normalizers sanitize errors; retain the trusted capability's terminal state. */
  assertHashHealthy: () => void;
}

export function fail(code: SnapshotAnalysisCode): never {
  const error = new SnapshotAnalysisError(code);
  ownedErrors.set(error, code);
  throw error;
}

export function errorCode(value: unknown, fallback: SnapshotAnalysisCode): SnapshotAnalysisCode {
  return typeof value === 'object' && value !== null
    ? (ownedErrors.get(value) ?? fallback)
    : fallback;
}

/** Plain own data only. Transparent Proxies cannot be detected portably. */
export function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  code: SnapshotAnalysisCode = 'invalid-request'
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const keys = Reflect.ownKeys(value);
  const allowed = [...required, ...optional];
  if (
    keys.length > allowed.length ||
    keys.some(key => typeof key !== 'string' || !allowed.includes(key))
  )
    fail(code);
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
  code: SnapshotAnalysisCode = 'invalid-request'
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > max) fail('limit-exceeded');
  if (Reflect.ownKeys(value).length !== length + 1) fail(code);
  const values: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(code);
    values.push(descriptor.value);
  }
  return values;
}

export function resolveLimits(input: unknown): SnapshotAnalysisLimits {
  const limits: SnapshotAnalysisLimits = { ...SNAPSHOT_ANALYSIS_HARD_LIMITS };
  if (input === undefined) return limits;
  const options = fields(input, [], Object.keys(limits), 'invalid-limits');
  for (const [name, value] of Object.entries(options)) {
    const key = name as keyof SnapshotAnalysisLimits;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > limits[key]
    )
      fail('invalid-limits');
    limits[key] = value;
  }
  return limits;
}

function relativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512)
    fail('invalid-request');
  const segments = value.split('/');
  if (
    segments.some(
      segment => !segment || segment === '.' || segment === '..' || /[.\s]$/u.test(segment)
    )
  )
    fail('invalid-request');
  if (
    /[\\:]/u.test(value) ||
    [...value].some(
      character => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f
    )
  )
    fail('invalid-request');
  return value;
}

function byteView(value: unknown, max: number): { view: Uint8Array; length: number } {
  if (!value || typeof value !== 'object' || typedTag.call(value) !== 'Uint8Array')
    fail('invalid-request');
  // Native slots avoid invoking shadowed buffer/length properties or Proxy reads.
  const length = typedLength.call(value) as number;
  const offset = typedOffset.call(value) as number;
  const buffer = typedBuffer.call(value) as ArrayBuffer;
  arrayBufferLength.call(buffer); // Rejects SharedArrayBuffer and incompatible receivers.
  if (arrayBufferResizable?.call(buffer) === true || Object.getOwnPropertySymbols(value).length > 0)
    fail('invalid-request');
  if (length > max) fail('limit-exceeded');
  return { view: new Uint8Array(buffer, offset, length), length };
}

function inventoryViews(
  value: unknown,
  limits: SnapshotAnalysisLimits,
  totals: { bytes: number; files: number }
) {
  const input = fields(value, ['files']);
  const list = arrayData(input.files, limits.maxFilesPerSnapshot);
  if (list.length === 0) fail('invalid-request');
  totals.files += list.length;
  if (totals.files > limits.maxTotalFiles) fail('limit-exceeded');
  const paths = new Set<string>();
  const pending = list.map(file => {
    const descriptor = fields(file, ['relativePath', 'bytes']);
    const path = relativePath(descriptor.relativePath);
    const alias = path.toLowerCase();
    if (paths.has(alias)) fail('invalid-request');
    paths.add(alias);
    const bytes = byteView(descriptor.bytes, limits.maxFileBytes);
    totals.bytes += bytes.length;
    if (totals.bytes > limits.maxTotalBytes) fail('limit-exceeded');
    return { path, ...bytes };
  });
  return pending;
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1)
    if (left[index] !== right[index]) return false;
  return true;
}

function hashCapability(sha256: AnalyzeSnapshotsInput['sha256'], limits: SnapshotAnalysisLimits) {
  let hashBytes = 0;
  let hashCalls = 0;
  let terminal: SnapshotAnalysisCode | null = null;
  const reject: (code: SnapshotAnalysisCode) => never = code => {
    terminal = code;
    fail(code);
  };
  const hash = async (bytes: Uint8Array): Promise<string> => {
    hashBytes += bytes.byteLength;
    hashCalls += 1;
    if (hashBytes > limits.maxHashBytes || hashCalls > limits.maxHashCalls)
      reject('limit-exceeded');
    const isolated = new Uint8Array(bytes);
    let result: unknown;
    try {
      result = await sha256(isolated);
    } catch {
      reject('sha256-failed');
    }
    if (!equalBytes(bytes, isolated)) reject('sha256-mutated');
    if (typeof result !== 'string' || !/^[a-f0-9]{64}$/u.test(result)) reject('sha256-invalid');
    return result;
  };
  return {
    hash,
    assertHashHealthy: () => {
      if (terminal) fail(terminal);
    },
  };
}

/** All selected byte views detach synchronously before the first hash await. */
export function prepareAnalysis(value: AnalyzeSnapshotsInput): PreparedAnalysis {
  try {
    const input = fields(value, ['snapshots', 'sha256'], ['limits']);
    if (typeof input.sha256 !== 'function') fail('invalid-request');
    const limits = resolveLimits(input.limits);
    const snapshots = arrayData(input.snapshots, limits.maxSnapshots);
    if (snapshots.length < 2) fail('invalid-request');
    const totals = { bytes: 0, files: 0 };
    // Global byte/file admission finishes before any payload allocation.
    const pending = snapshots.map(snapshot => inventoryViews(snapshot, limits, totals));
    const hashing = hashCapability(input.sha256 as AnalyzeSnapshotsInput['sha256'], limits);
    return {
      inventories: pending.map(files => ({
        files: files
          .map(file => ({ path: file.path, bytes: new Uint8Array(file.view), sha256: '' }))
          .sort((a, b) => compare(a.path, b.path)),
        measuredByteLength: files.reduce((total, file) => total + file.length, 0),
      })),
      limits,
      ...hashing,
    };
  } catch (error) {
    fail(errorCode(error, 'invalid-request'));
  }
}
