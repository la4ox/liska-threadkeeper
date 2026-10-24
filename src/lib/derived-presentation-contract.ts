/** Pure transport/provenance contracts; derived output never changes archive companions. */
import { canonicalBase64ByteLength } from './base64';
import { base64ToBytes, bytesToBase64 } from './image-utils';

export const DERIVED_HTML_SCHEMA = 'liska-derived-html/1';
export const DERIVED_OUTPUT_RECEIPT_SCHEMA = 'liska-derived-output-receipt/1';
export const DERIVED_HTML_RENDERER_VERSION = 'liska-html/1';
export const DERIVED_HTML_RELATIVE_PATH = 'index.html';
export const DERIVED_HTML_RECEIPT_RELATIVE_PATH = 'presentation/liska-html-1.receipt.json';
export const DERIVED_HTML_MAX_BYTES = 32 * 1024 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(DERIVED_HTML_MAX_BYTES / 3);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type DerivedPresentationSha256 = (bytes: Uint8Array) => Promise<string>;
export type DerivedOutputSource = 'chatgpt' | 'deepseek';

export interface DerivedHtmlProvenance {
  sourceCanonicalSha256: string;
  /** Null means the rendering has no local asset bindings, not unknown bindings. */
  assetBindingSha256: string | null;
}

export interface DerivedHtmlDescriptor {
  kind: 'html';
  relativePath: typeof DERIVED_HTML_RELATIVE_PATH;
  mediaType: 'text/html';
  byteLength: number;
  sha256: string;
  rendererVersion: typeof DERIVED_HTML_RENDERER_VERSION;
}

export interface DerivedHtmlArtifact extends DerivedHtmlDescriptor, DerivedHtmlProvenance {
  schema: typeof DERIVED_HTML_SCHEMA;
  transport: 'inline';
  bodyBase64: string;
}

export interface DerivedOutputIdentity {
  source: DerivedOutputSource;
  captureId: string;
  conversationKey: string;
}

export interface DerivedOutputReceipt extends DerivedOutputIdentity, DerivedHtmlProvenance {
  schema: typeof DERIVED_OUTPUT_RECEIPT_SCHEMA;
  artifact: DerivedHtmlDescriptor;
}

export type DerivedPresentationErrorCode =
  | 'derived-html-invalid-input'
  | 'derived-html-too-large'
  | 'derived-html-encoding-failed'
  | 'derived-html-hash-failed'
  | 'derived-html-invalid-hash'
  | 'derived-receipt-invalid-input'
  | 'derived-receipt-encoding-failed';

/** Never interpolate input, renderer content, or native exception messages. */
export class DerivedPresentationError extends Error {
  constructor(readonly code: DerivedPresentationErrorCode) {
    super(code);
    this.name = 'DerivedPresentationError';
  }
}

const PROVENANCE_KEYS = ['sourceCanonicalSha256', 'assetBindingSha256'];
const IDENTITY_KEYS = ['source', 'captureId', 'conversationKey'];
const DESCRIPTOR_KEYS = [
  'kind',
  'relativePath',
  'mediaType',
  'byteLength',
  'sha256',
  'rendererVersion',
];
const ARTIFACT_KEYS = ['schema', 'transport', ...DESCRIPTOR_KEYS, ...PROVENANCE_KEYS, 'bodyBase64'];
const RECEIPT_KEYS = ['schema', ...IDENTITY_KEYS, ...PROVENANCE_KEYS, 'artifact'];

/** Descriptor reads avoid getters; accepted objects are reconstructed, never retained. */
function ownPlainData(value: unknown, expected: readonly string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some(key => typeof key !== 'string' || !expected.includes(key))
  )
    return undefined;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && SHA256_PATTERN.test(value);
}

function snapshotProvenance(data: Record<string, unknown>): DerivedHtmlProvenance | undefined {
  if (
    !isSha256(data.sourceCanonicalSha256) ||
    (data.assetBindingSha256 !== null && !isSha256(data.assetBindingSha256))
  )
    return undefined;
  return {
    sourceCanonicalSha256: data.sourceCanonicalSha256,
    assetBindingSha256: data.assetBindingSha256,
  };
}

function snapshotDescriptor(data: Record<string, unknown>): DerivedHtmlDescriptor | undefined {
  if (
    data.kind !== 'html' ||
    data.relativePath !== DERIVED_HTML_RELATIVE_PATH ||
    data.mediaType !== 'text/html' ||
    typeof data.byteLength !== 'number' ||
    !Number.isSafeInteger(data.byteLength) ||
    data.byteLength < 0 ||
    data.byteLength > DERIVED_HTML_MAX_BYTES ||
    !isSha256(data.sha256) ||
    data.rendererVersion !== DERIVED_HTML_RENDERER_VERSION
  )
    return undefined;
  return {
    kind: 'html',
    relativePath: DERIVED_HTML_RELATIVE_PATH,
    mediaType: 'text/html',
    byteLength: data.byteLength,
    sha256: data.sha256,
    rendererVersion: DERIVED_HTML_RENDERER_VERSION,
  };
}

/** Check unused padding bits too: syntax/length alone admits alternate encodings. */
function hasCanonicalBody(value: unknown, byteLength: number): value is string {
  if (typeof value !== 'string' || value.length > MAX_BASE64_LENGTH) return false;
  if (canonicalBase64ByteLength(value) !== byteLength) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (padding === 0) return true;
  const finalSextet = BASE64_ALPHABET.indexOf(value[value.length - padding - 1]);
  return finalSextet >= 0 && (finalSextet & (padding === 2 ? 15 : 3)) === 0;
}

/** Shape validation does not decode/allocate the potentially 32 MiB body. */
export function snapshotDerivedHtmlArtifact(value: unknown): DerivedHtmlArtifact | undefined {
  try {
    const data = ownPlainData(value, ARTIFACT_KEYS);
    if (!data || data.schema !== DERIVED_HTML_SCHEMA || data.transport !== 'inline') return;
    const descriptor = snapshotDescriptor(data);
    const provenance = snapshotProvenance(data);
    if (!descriptor || !provenance || !hasCanonicalBody(data.bodyBase64, descriptor.byteLength))
      return;
    return {
      schema: DERIVED_HTML_SCHEMA,
      transport: 'inline',
      ...descriptor,
      ...provenance,
      bodyBase64: data.bodyBase64,
    };
  } catch {
    return undefined;
  }
}

export function isDerivedHtmlArtifact(value: unknown): value is DerivedHtmlArtifact {
  return snapshotDerivedHtmlArtifact(value) !== undefined;
}

/** Count TextEncoder's UTF-8 replacement semantics before allocating the buffer. */
function boundedUtf8Length(value: string): number | undefined {
  if (value.length > DERIVED_HTML_MAX_BYTES) return undefined;
  let size = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) size += 1;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        size += 4;
        index += 1;
      } else size += 3;
    } else size += 3;
    if (size > DERIVED_HTML_MAX_BYTES) return undefined;
  }
  return size;
}

async function hashBytes(bytes: Uint8Array, sha256: DerivedPresentationSha256): Promise<string> {
  let hash: unknown;
  try {
    // A supplied implementation must not be able to mutate the bytes being delivered.
    hash = await sha256(bytes.slice());
  } catch {
    throw new DerivedPresentationError('derived-html-hash-failed');
  }
  if (!isSha256(hash)) throw new DerivedPresentationError('derived-html-invalid-hash');
  return hash;
}

export async function buildDerivedHtmlArtifact(
  html: string,
  provenance: DerivedHtmlProvenance,
  sha256: DerivedPresentationSha256
): Promise<DerivedHtmlArtifact> {
  let source: DerivedHtmlProvenance | undefined;
  try {
    const data = ownPlainData(provenance, PROVENANCE_KEYS);
    source = data && snapshotProvenance(data);
  } catch {
    // The same value-free error covers hostile object traps.
  }
  if (typeof html !== 'string' || !source || typeof sha256 !== 'function')
    throw new DerivedPresentationError('derived-html-invalid-input');
  const byteLength = boundedUtf8Length(html);
  if (byteLength === undefined) throw new DerivedPresentationError('derived-html-too-large');
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(html);
    if (bytes.byteLength !== byteLength) throw new Error();
  } catch {
    throw new DerivedPresentationError('derived-html-encoding-failed');
  }
  const sha = await hashBytes(bytes, sha256);
  let bodyBase64: string;
  try {
    bodyBase64 = bytesToBase64(bytes);
  } catch {
    throw new DerivedPresentationError('derived-html-encoding-failed');
  }
  return {
    schema: DERIVED_HTML_SCHEMA,
    transport: 'inline',
    kind: 'html',
    relativePath: DERIVED_HTML_RELATIVE_PATH,
    mediaType: 'text/html',
    byteLength,
    sha256: sha,
    rendererVersion: DERIVED_HTML_RENDERER_VERSION,
    ...source,
    bodyBase64,
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** Integrity is separate from shape: exact bytes, fatal UTF-8, and recomputed SHA-256. */
export async function verifyDerivedHtmlArtifact(
  value: unknown,
  sha256: DerivedPresentationSha256
): Promise<{ artifact: DerivedHtmlArtifact; bytes: Uint8Array } | undefined> {
  const artifact = snapshotDerivedHtmlArtifact(value);
  if (!artifact || typeof sha256 !== 'function') return undefined;
  try {
    const bytes = base64ToBytes(artifact.bodyBase64);
    if (bytes.byteLength !== artifact.byteLength) return undefined;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!equalBytes(bytes, new TextEncoder().encode(text))) return undefined;
    if ((await hashBytes(bytes, sha256)) !== artifact.sha256) return undefined;
    return { artifact, bytes };
  } catch {
    return undefined;
  }
}

function snapshotIdentity(data: Record<string, unknown>): DerivedOutputIdentity | undefined {
  if (data.source !== 'chatgpt' && data.source !== 'deepseek') return undefined;
  const pattern =
    data.source === 'chatgpt'
      ? /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/
      : /^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/;
  if (typeof data.captureId !== 'string' || !pattern.test(data.captureId)) return undefined;
  if (!isSha256(data.conversationKey)) return undefined;
  return { source: data.source, captureId: data.captureId, conversationKey: data.conversationKey };
}

/** No destination, provider IDs, labels, timestamps, URLs, or body enter the sidecar. */
export function snapshotDerivedOutputReceipt(value: unknown): DerivedOutputReceipt | undefined {
  try {
    const data = ownPlainData(value, RECEIPT_KEYS);
    if (!data || data.schema !== DERIVED_OUTPUT_RECEIPT_SCHEMA) return undefined;
    const identity = snapshotIdentity(data);
    const provenance = snapshotProvenance(data);
    const descriptorData = ownPlainData(data.artifact, DESCRIPTOR_KEYS);
    const artifact = descriptorData && snapshotDescriptor(descriptorData);
    if (!identity || !provenance || !artifact) return undefined;
    return { schema: DERIVED_OUTPUT_RECEIPT_SCHEMA, ...identity, ...provenance, artifact };
  } catch {
    return undefined;
  }
}

export function isDerivedOutputReceipt(value: unknown): value is DerivedOutputReceipt {
  return snapshotDerivedOutputReceipt(value) !== undefined;
}

export function buildDerivedOutputReceipt(
  identity: DerivedOutputIdentity,
  artifact: DerivedHtmlArtifact
): DerivedOutputReceipt {
  try {
    const identityData = ownPlainData(identity, IDENTITY_KEYS);
    const source = identityData && snapshotIdentity(identityData);
    const html = snapshotDerivedHtmlArtifact(artifact);
    if (source && html) {
      const { kind, relativePath, mediaType, byteLength, sha256, rendererVersion } = html;
      return {
        schema: DERIVED_OUTPUT_RECEIPT_SCHEMA,
        ...source,
        sourceCanonicalSha256: html.sourceCanonicalSha256,
        assetBindingSha256: html.assetBindingSha256,
        artifact: { kind, relativePath, mediaType, byteLength, sha256, rendererVersion },
      };
    }
  } catch {
    // Do not let caller-owned traps escape with private values.
  }
  throw new DerivedPresentationError('derived-receipt-invalid-input');
}

/** Stable key order and LF termination, independent of caller insertion order. */
export function buildDerivedOutputReceiptBytes(value: unknown): Uint8Array {
  const receipt = snapshotDerivedOutputReceipt(value);
  if (!receipt) throw new DerivedPresentationError('derived-receipt-invalid-input');
  try {
    return new TextEncoder().encode(`${JSON.stringify(receipt)}\n`);
  } catch {
    throw new DerivedPresentationError('derived-receipt-encoding-failed');
  }
}
