import { normalizeCaptureArtifactRecord } from '../../archive/capture';
import type {
  CaptureEndpoint,
  RawCaptureArtifact,
  RawCaptureArtifactRecord,
  RawCaptureManifest,
} from '../../archive/capture';

const DEFAULT_JSON_MEDIA_TYPE = 'application/json';

export interface CaptureResponseOptions {
  artifactId: string;
  relativePath: string;
  endpoint: CaptureEndpoint;
  maxBytes: number;
  mediaType?: string;
}

function requireByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Capture response byte limit must be a positive safe integer.');
  }
}

function concatenate(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Read exact response bytes while enforcing the limit during streaming. */
export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  requireByteLimit(maxBytes);
  const declaredLengthText = response.headers.get('content-length');
  const declaredLength = declaredLengthText === null ? null : Number(declaredLengthText);
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await response.body?.cancel('capture response exceeded declared byte limit');
    } catch {
      // Preserve the stable size error even if the transport cannot be cancelled.
    }
    throw new Error(`Capture response exceeds the ${maxBytes}-byte safety limit.`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Capture response exceeds the ${maxBytes}-byte safety limit.`);
    }
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel('capture response exceeded byte limit');
      throw new Error(`Capture response exceeds the ${maxBytes}-byte safety limit.`);
    }
    chunks.push(chunk.value);
  }
  return concatenate(chunks, totalBytes);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** SHA-256 for raw evidence and deterministic manifest provenance. */
export async function sha256Hex(
  bytes: Uint8Array,
  cryptoApi: Pick<Crypto, 'subtle'> = globalThis.crypto
): Promise<string> {
  if (!cryptoApi?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');
  const digest = await cryptoApi.subtle.digest('SHA-256', exactArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Decode a JSON artifact without replacing malformed UTF-8. */
export function parseJsonArtifact(bytes: Uint8Array): unknown {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

/** Pair an exact same-origin response with its credential-free manifest record. */
export async function captureResponseArtifact(
  response: Response,
  options: CaptureResponseOptions
): Promise<RawCaptureArtifact> {
  if (!response.ok) throw new Error(`Capture endpoint returned HTTP ${response.status}.`);
  const bytes = await readBoundedResponseBytes(response, options.maxBytes);
  const mediaType =
    options.mediaType ?? response.headers.get('content-type') ?? DEFAULT_JSON_MEDIA_TYPE;
  const record: RawCaptureArtifactRecord = normalizeCaptureArtifactRecord({
    id: options.artifactId,
    relativePath: options.relativePath,
    mediaType,
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    endpoint: options.endpoint,
  });
  return { record, bytes };
}

/** Hash the exact UTF-8 representation used when manifest.json is downloaded. */
export async function hashCaptureManifest(manifest: RawCaptureManifest): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
}
