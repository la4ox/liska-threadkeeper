/** Pure transport/provenance contracts for the canonical-derived text view. */
import { canonicalBase64ByteLength } from './base64';
import { base64ToBytes, bytesToBase64 } from './image-utils';

export const DERIVED_TEXT_SCHEMA = 'liska-derived-text/1' as const;
export const DERIVED_TEXT_OUTPUT_RECEIPT_SCHEMA = 'liska-derived-text-output-receipt/1' as const;
export const DERIVED_TEXT_RENDERER_VERSION = 'liska-text/1' as const;
export const DERIVED_TEXT_RELATIVE_PATH = 'index.txt' as const;
export const DERIVED_TEXT_RECEIPT_RELATIVE_PATH = 'presentation/liska-text-1.receipt.json' as const;
export const DERIVED_TEXT_MAX_BYTES = 32 * 1024 * 1024;

const MAX_BASE64_LENGTH = 4 * Math.ceil(DERIVED_TEXT_MAX_BYTES / 3);
const SHA256 = /^[a-f0-9]{64}$/;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export type DerivedTextSha256 = (bytes: Uint8Array) => Promise<string>;
export type DerivedTextOutputSource = 'chatgpt' | 'deepseek';

export interface DerivedTextProvenance {
  sourceCanonicalSha256: string;
}

export interface DerivedTextDescriptor {
  kind: 'text';
  relativePath: typeof DERIVED_TEXT_RELATIVE_PATH;
  mediaType: 'text/plain';
  byteLength: number;
  sha256: string;
  rendererVersion: typeof DERIVED_TEXT_RENDERER_VERSION;
}

export interface DerivedTextArtifact extends DerivedTextDescriptor, DerivedTextProvenance {
  schema: typeof DERIVED_TEXT_SCHEMA;
  transport: 'inline';
  bodyBase64: string;
}

export interface DerivedTextOutputIdentity {
  source: DerivedTextOutputSource;
  captureId: string;
  conversationKey: string;
}

export interface DerivedTextOutputReceipt extends DerivedTextOutputIdentity, DerivedTextProvenance {
  schema: typeof DERIVED_TEXT_OUTPUT_RECEIPT_SCHEMA;
  artifact: DerivedTextDescriptor;
}

export type DerivedTextContractErrorCode =
  | 'derived-text-invalid-input'
  | 'derived-text-too-large'
  | 'derived-text-encoding-failed'
  | 'derived-text-hash-failed'
  | 'derived-text-invalid-hash'
  | 'derived-text-receipt-invalid-input'
  | 'derived-text-receipt-encoding-failed';

export class DerivedTextContractError extends Error {
  constructor(readonly code: DerivedTextContractErrorCode) {
    super(code);
    this.name = 'DerivedTextContractError';
  }
}

const DESCRIPTOR_KEYS = [
  'kind',
  'relativePath',
  'mediaType',
  'byteLength',
  'sha256',
  'rendererVersion',
] as const;
const ARTIFACT_KEYS = [
  'schema',
  'transport',
  ...DESCRIPTOR_KEYS,
  'sourceCanonicalSha256',
  'bodyBase64',
] as const;
const IDENTITY_KEYS = ['source', 'captureId', 'conversationKey'] as const;
const RECEIPT_KEYS = ['schema', ...IDENTITY_KEYS, 'sourceCanonicalSha256', 'artifact'] as const;

function ownPlainData(
  value: unknown,
  expected: readonly string[]
): Record<string, unknown> | undefined {
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
    if (!descriptor?.enumerable || !('value' in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

function snapshotDescriptor(data: Record<string, unknown>): DerivedTextDescriptor | undefined {
  if (
    data.kind !== 'text' ||
    data.relativePath !== DERIVED_TEXT_RELATIVE_PATH ||
    data.mediaType !== 'text/plain' ||
    !Number.isSafeInteger(data.byteLength) ||
    (data.byteLength as number) < 0 ||
    (data.byteLength as number) > DERIVED_TEXT_MAX_BYTES ||
    !isSha256(data.sha256) ||
    data.rendererVersion !== DERIVED_TEXT_RENDERER_VERSION
  )
    return undefined;
  return {
    kind: 'text',
    relativePath: DERIVED_TEXT_RELATIVE_PATH,
    mediaType: 'text/plain',
    byteLength: data.byteLength as number,
    sha256: data.sha256,
    rendererVersion: DERIVED_TEXT_RENDERER_VERSION,
  };
}

function hasCanonicalBody(value: unknown, byteLength: number): value is string {
  if (typeof value !== 'string' || value.length > MAX_BASE64_LENGTH) return false;
  if (canonicalBase64ByteLength(value) !== byteLength) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (padding === 0) return true;
  const finalSextet = BASE64_ALPHABET.indexOf(value[value.length - padding - 1]);
  return finalSextet >= 0 && (finalSextet & (padding === 2 ? 15 : 3)) === 0;
}

export function snapshotDerivedTextArtifact(value: unknown): DerivedTextArtifact | undefined {
  try {
    const data = ownPlainData(value, ARTIFACT_KEYS);
    if (
      !data ||
      data.schema !== DERIVED_TEXT_SCHEMA ||
      data.transport !== 'inline' ||
      !isSha256(data.sourceCanonicalSha256)
    )
      return undefined;
    const descriptor = snapshotDescriptor(data);
    if (!descriptor || !hasCanonicalBody(data.bodyBase64, descriptor.byteLength)) return undefined;
    return {
      schema: DERIVED_TEXT_SCHEMA,
      transport: 'inline',
      ...descriptor,
      sourceCanonicalSha256: data.sourceCanonicalSha256,
      bodyBase64: data.bodyBase64,
    };
  } catch {
    return undefined;
  }
}

export function isDerivedTextArtifact(value: unknown): value is DerivedTextArtifact {
  return snapshotDerivedTextArtifact(value) !== undefined;
}

function boundedUtf8Length(value: string): number | undefined {
  if (value.length > DERIVED_TEXT_MAX_BYTES) return undefined;
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
    if (size > DERIVED_TEXT_MAX_BYTES) return undefined;
  }
  return size;
}

async function hashBytes(bytes: Uint8Array, sha256: DerivedTextSha256): Promise<string> {
  let hash: unknown;
  try {
    hash = await sha256(bytes.slice());
  } catch {
    throw new DerivedTextContractError('derived-text-hash-failed');
  }
  if (!isSha256(hash)) throw new DerivedTextContractError('derived-text-invalid-hash');
  return hash;
}

export async function buildDerivedTextArtifact(
  text: string,
  provenance: DerivedTextProvenance,
  sha256: DerivedTextSha256
): Promise<DerivedTextArtifact> {
  let provenanceData: Record<string, unknown> | undefined;
  try {
    provenanceData = ownPlainData(provenance, ['sourceCanonicalSha256']);
  } catch {
    throw new DerivedTextContractError('derived-text-invalid-input');
  }
  if (
    typeof text !== 'string' ||
    !provenanceData ||
    !isSha256(provenanceData.sourceCanonicalSha256) ||
    typeof sha256 !== 'function'
  )
    throw new DerivedTextContractError('derived-text-invalid-input');
  const byteLength = boundedUtf8Length(text);
  if (byteLength === undefined) throw new DerivedTextContractError('derived-text-too-large');
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(text);
    if (bytes.byteLength !== byteLength) throw new Error();
  } catch {
    throw new DerivedTextContractError('derived-text-encoding-failed');
  }
  const digest = await hashBytes(bytes, sha256);
  try {
    return {
      schema: DERIVED_TEXT_SCHEMA,
      transport: 'inline',
      kind: 'text',
      relativePath: DERIVED_TEXT_RELATIVE_PATH,
      mediaType: 'text/plain',
      byteLength,
      sha256: digest,
      rendererVersion: DERIVED_TEXT_RENDERER_VERSION,
      sourceCanonicalSha256: provenanceData.sourceCanonicalSha256,
      bodyBase64: bytesToBase64(bytes),
    };
  } catch {
    throw new DerivedTextContractError('derived-text-encoding-failed');
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export async function verifyDerivedTextArtifact(
  value: unknown,
  sha256: DerivedTextSha256
): Promise<{ artifact: DerivedTextArtifact; bytes: Uint8Array } | undefined> {
  const artifact = snapshotDerivedTextArtifact(value);
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

function snapshotIdentity(data: Record<string, unknown>): DerivedTextOutputIdentity | undefined {
  if (data.source !== 'chatgpt' && data.source !== 'deepseek') return undefined;
  const pattern =
    data.source === 'chatgpt'
      ? /^capture-chatgpt-[A-Za-z0-9][A-Za-z0-9_-]{0,239}$/
      : /^capture-deepseek-[A-Za-z0-9][A-Za-z0-9_-]{0,235}$/;
  if (typeof data.captureId !== 'string' || !pattern.test(data.captureId)) return undefined;
  if (!isSha256(data.conversationKey)) return undefined;
  return { source: data.source, captureId: data.captureId, conversationKey: data.conversationKey };
}

export function snapshotDerivedTextOutputReceipt(
  value: unknown
): DerivedTextOutputReceipt | undefined {
  try {
    const data = ownPlainData(value, RECEIPT_KEYS);
    if (
      !data ||
      data.schema !== DERIVED_TEXT_OUTPUT_RECEIPT_SCHEMA ||
      !isSha256(data.sourceCanonicalSha256)
    )
      return undefined;
    const identity = snapshotIdentity(data);
    const descriptorData = ownPlainData(data.artifact, DESCRIPTOR_KEYS);
    const artifact = descriptorData && snapshotDescriptor(descriptorData);
    if (!identity || !artifact) return undefined;
    return {
      schema: DERIVED_TEXT_OUTPUT_RECEIPT_SCHEMA,
      ...identity,
      sourceCanonicalSha256: data.sourceCanonicalSha256,
      artifact,
    };
  } catch {
    return undefined;
  }
}

export function buildDerivedTextOutputReceipt(
  identity: DerivedTextOutputIdentity,
  artifact: DerivedTextArtifact
): DerivedTextOutputReceipt {
  try {
    const identityData = ownPlainData(identity, IDENTITY_KEYS);
    const source = identityData && snapshotIdentity(identityData);
    const text = snapshotDerivedTextArtifact(artifact);
    if (source && text) {
      const { kind, relativePath, mediaType, byteLength, sha256, rendererVersion } = text;
      return {
        schema: DERIVED_TEXT_OUTPUT_RECEIPT_SCHEMA,
        ...source,
        sourceCanonicalSha256: text.sourceCanonicalSha256,
        artifact: { kind, relativePath, mediaType, byteLength, sha256, rendererVersion },
      };
    }
  } catch {
    // Caller-owned traps never cross this value-free boundary.
  }
  throw new DerivedTextContractError('derived-text-receipt-invalid-input');
}

/** Stable insertion order and LF termination. */
export function buildDerivedTextOutputReceiptBytes(value: unknown): Uint8Array {
  const receipt = snapshotDerivedTextOutputReceipt(value);
  if (!receipt) throw new DerivedTextContractError('derived-text-receipt-invalid-input');
  try {
    return new TextEncoder().encode(`${JSON.stringify(receipt)}\n`);
  } catch {
    throw new DerivedTextContractError('derived-text-receipt-encoding-failed');
  }
}
