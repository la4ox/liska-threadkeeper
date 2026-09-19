/** Runtime-only binding from verified DeepSeek file records to signed binary URLs. */

import type { RawCaptureBundle } from '../../archive/capture';
import {
  deepSeekAttachmentIdForProviderId,
  readDeepSeekRawFileRecord,
} from '../../archive/normalizers/deepseek/inventory';
import { sha256Hex } from './response';

const FILE_SERVICE_ORIGIN = 'https://files.deepseeksvc.com';
const FILE_SERVICE_PATH = '/api/file';
const MAX_SIGNED_PATH_LENGTH = 8_192;
const MAX_OPAQUE_STATE_LENGTH = 4_096;
const MAX_RESOURCE_TIMING_ENTRIES = 512;
const SAFE_FILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export interface DeepSeekSignedAssetCandidate {
  assetId: string;
  /** Runtime-only. It must never enter a manifest, canonical archive, or log. */
  downloadUrl: string;
  declaredByteLength: number | null;
}

function boundedOpaqueValue(value: string, maximum: number): boolean {
  return (
    value.length > 0 &&
    value.length <= maximum &&
    !Array.from(value).some(character => (character.codePointAt(0) ?? 0) <= 0x1f)
  );
}

function normalizedProviderFileId(providerId: string): string {
  return providerId.startsWith('file-') ? providerId.slice('file-'.length) : providerId;
}

/**
 * Admit only the observed relative `/file` grammar and construct the one
 * credential-free service URL Liska is allowed to request.
 */
// eslint-disable-next-line complexity -- Every URL component and query-cardinality rejection remains visible at this security boundary.
export function deepSeekDownloadUrl(providerId: string, signedPath: unknown): string | undefined {
  if (
    typeof providerId !== 'string' ||
    typeof signedPath !== 'string' ||
    signedPath.length === 0 ||
    signedPath.length > MAX_SIGNED_PATH_LENGTH ||
    !signedPath.startsWith('/file?') ||
    signedPath.startsWith('//') ||
    /[\r\n\0]/.test(signedPath)
  ) {
    return undefined;
  }

  try {
    const parsed = new URL(signedPath, FILE_SERVICE_ORIGIN);
    if (
      parsed.origin !== FILE_SERVICE_ORIGIN ||
      parsed.pathname !== '/file' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.hash !== ''
    ) {
      return undefined;
    }
    const entries = [...parsed.searchParams.entries()];
    if (
      entries.length !== 2 ||
      parsed.searchParams.getAll('file_id').length !== 1 ||
      parsed.searchParams.getAll('state').length !== 1 ||
      entries.some(([key]) => key !== 'file_id' && key !== 'state')
    ) {
      return undefined;
    }
    const fileId = parsed.searchParams.get('file_id') ?? '';
    const state = parsed.searchParams.get('state') ?? '';
    if (
      !SAFE_FILE_ID_PATTERN.test(fileId) ||
      normalizedProviderFileId(providerId) !== fileId ||
      !boundedOpaqueValue(state, MAX_OPAQUE_STATE_LENGTH)
    ) {
      return undefined;
    }

    const result = new URL(FILE_SERVICE_PATH, FILE_SERVICE_ORIGIN);
    result.searchParams.set('file_id', fileId);
    result.searchParams.set('state', state);
    result.searchParams.set('ty', 'r');
    return result.href;
  } catch {
    return undefined;
  }
}

/** Recheck the exact constructed URL at the acquisition boundary. */
// eslint-disable-next-line complexity -- Acquisition revalidates the complete fixed URL grammar independently.
export function isExactDeepSeekDownloadUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const entries = [...parsed.searchParams.entries()];
    return (
      parsed.origin === FILE_SERVICE_ORIGIN &&
      parsed.pathname === FILE_SERVICE_PATH &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hash === '' &&
      entries.length === 3 &&
      parsed.searchParams.getAll('file_id').length === 1 &&
      parsed.searchParams.getAll('state').length === 1 &&
      parsed.searchParams.getAll('ty').length === 1 &&
      parsed.searchParams.get('ty') === 'r' &&
      entries.every(([key]) => key === 'file_id' || key === 'state' || key === 'ty') &&
      SAFE_FILE_ID_PATTERN.test(parsed.searchParams.get('file_id') ?? '') &&
      boundedOpaqueValue(parsed.searchParams.get('state') ?? '', MAX_OPAQUE_STATE_LENGTH)
    );
  } catch {
    return false;
  }
}

function decodePointerSegment(value: string): string | undefined {
  if (/~(?![01])/u.test(value)) return undefined;
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function valueAtPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/') || pointer.length > 4_096) return undefined;
  let value = root;
  for (const encoded of pointer.slice(1).split('/')) {
    const segment = decodePointerSegment(encoded);
    if (segment === undefined || typeof value !== 'object' || value === null) return undefined;
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return undefined;
      value = value[Number(segment)];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function recordSignedPath(value: unknown): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).signed_path
    : undefined;
}

function recordStatus(value: unknown): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).status
    : undefined;
}

interface DeepSeekRawAssetBinding {
  assetId: string;
  fileId: string;
  declaredByteLength: number | null;
  files: Array<ReturnType<typeof readDeepSeekRawFileRecord> & { signedPath: unknown }>;
}

function parseRawArtifact(bundle: RawCaptureBundle, artifactId: string): unknown | undefined {
  const artifact = bundle.artifacts.find(value => value.record.id === artifactId);
  if (!artifact || bundle.artifacts.length !== 1) return undefined;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifact.bytes)) as unknown;
  } catch {
    return undefined;
  }
}

async function rawAssetBinding(
  raw: unknown,
  asset: RawCaptureBundle['manifest']['assets'][number],
  artifactId: string,
  sha256: (bytes: Uint8Array) => Promise<string>
): Promise<DeepSeekRawAssetBinding | undefined> {
  let binding: DeepSeekRawAssetBinding | undefined;
  for (const sourceRef of asset.sourceRefs) {
    if (sourceRef.artifactId !== artifactId) return undefined;
    const value = valueAtPointer(raw, sourceRef.rawPointer);
    if (recordStatus(value) !== 'SUCCESS') return undefined;
    let file: ReturnType<typeof readDeepSeekRawFileRecord>;
    try {
      file = readDeepSeekRawFileRecord(value);
    } catch {
      return undefined;
    }
    const expectedAssetId = await deepSeekAttachmentIdForProviderId(file.providerId, sha256);
    const fileId = normalizedProviderFileId(file.providerId);
    if (expectedAssetId !== asset.id) return undefined;
    if (binding && (binding.fileId !== fileId || binding.declaredByteLength !== file.byteLength)) {
      return undefined;
    }
    binding ??= {
      assetId: asset.id,
      fileId,
      declaredByteLength: file.byteLength,
      files: [],
    };
    binding.files.push({ ...file, signedPath: recordSignedPath(value) });
  }
  return binding;
}

async function rawAssetBindings(
  bundle: RawCaptureBundle,
  artifactId: string,
  sha256: (bytes: Uint8Array) => Promise<string>
): Promise<DeepSeekRawAssetBinding[]> {
  const raw = parseRawArtifact(bundle, artifactId);
  if (raw === undefined) return [];
  const bindings: DeepSeekRawAssetBinding[] = [];
  for (const asset of bundle.manifest.assets) {
    const binding = await rawAssetBinding(raw, asset, artifactId, sha256);
    if (binding) bindings.push(binding);
  }
  return bindings;
}

/**
 * Derive candidates only from exact manifest source refs into the exact raw
 * artifact. Missing, stale, non-success, or malformed records remain honestly
 * not-attempted and produce no request.
 */
export async function deriveDeepSeekSignedAssetCandidates(
  bundle: RawCaptureBundle,
  artifactId = 'conversation',
  sha256: (bytes: Uint8Array) => Promise<string> = sha256Hex
): Promise<DeepSeekSignedAssetCandidate[]> {
  const candidates: DeepSeekSignedAssetCandidate[] = [];
  for (const binding of await rawAssetBindings(bundle, artifactId, sha256)) {
    let downloadUrl: string | undefined;
    for (const file of binding.files) {
      const next = deepSeekDownloadUrl(file.providerId, file.signedPath);
      if (next === undefined || (downloadUrl !== undefined && downloadUrl !== next)) {
        downloadUrl = undefined;
        break;
      }
      downloadUrl = next;
    }
    if (downloadUrl) {
      candidates.push({
        assetId: binding.assetId,
        downloadUrl,
        declaredByteLength: binding.declaredByteLength,
      });
    }
  }
  return sortCandidates(candidates);
}

function sortCandidates(
  candidates: DeepSeekSignedAssetCandidate[]
): DeepSeekSignedAssetCandidate[] {
  return candidates.sort((left, right) =>
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  );
}

function defaultResourceEntries(): readonly unknown[] {
  try {
    const entries = globalThis.performance?.getEntriesByType('resource');
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function exactResourceUrl(value: unknown): string | undefined {
  try {
    if (typeof value !== 'object' || value === null) return undefined;
    const entry = value as Record<string, unknown>;
    if (entry.initiatorType !== 'fetch' || typeof entry.name !== 'string') return undefined;
    return isExactDeepSeekDownloadUrl(entry.name) ? entry.name : undefined;
  } catch {
    return undefined;
  }
}

function exactDownloadFileId(downloadUrl: string): string | undefined {
  try {
    const fileId = new URL(downloadUrl).searchParams.get('file_id') ?? '';
    return SAFE_FILE_ID_PATTERN.test(fileId) ? fileId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read only already-observed current-document resource timings. The newest
 * exact entry wins for one uniquely raw-bound asset; unrelated SPA history is
 * ignored because its file_id cannot bind the current verified manifest.
 */
export async function deriveDeepSeekPageOwnedAssetCandidates(
  bundle: RawCaptureBundle,
  artifactId = 'conversation',
  sha256: (bytes: Uint8Array) => Promise<string> = sha256Hex,
  readResourceEntries: () => readonly unknown[] = defaultResourceEntries
): Promise<DeepSeekSignedAssetCandidate[]> {
  const bindings = await rawAssetBindings(bundle, artifactId, sha256);
  const byFileId = new Map<string, DeepSeekRawAssetBinding[]>();
  for (const binding of bindings) {
    const existing = byFileId.get(binding.fileId) ?? [];
    existing.push(binding);
    byFileId.set(binding.fileId, existing);
  }
  let entries: readonly unknown[];
  try {
    const observed = readResourceEntries();
    entries = Array.isArray(observed)
      ? observed.slice(Math.max(0, observed.length - MAX_RESOURCE_TIMING_ENTRIES))
      : [];
  } catch {
    return [];
  }
  const candidates = new Map<string, DeepSeekSignedAssetCandidate>();
  for (const entry of entries) {
    const downloadUrl = exactResourceUrl(entry);
    if (!downloadUrl) continue;
    const fileId = exactDownloadFileId(downloadUrl);
    const matching = fileId ? byFileId.get(fileId) : undefined;
    if (!matching || matching.length !== 1) continue;
    const binding = matching[0];
    candidates.set(binding.assetId, {
      assetId: binding.assetId,
      downloadUrl,
      declaredByteLength: binding.declaredByteLength,
    });
  }
  return sortCandidates([...candidates.values()]);
}

/** Merge page-owned observations behind in-band signed paths. */
export async function deriveDeepSeekAssetCandidates(
  bundle: RawCaptureBundle,
  artifactId = 'conversation',
  sha256: (bytes: Uint8Array) => Promise<string> = sha256Hex,
  readResourceEntries: () => readonly unknown[] = defaultResourceEntries
): Promise<DeepSeekSignedAssetCandidate[]> {
  const pageOwned = await deriveDeepSeekPageOwnedAssetCandidates(
    bundle,
    artifactId,
    sha256,
    readResourceEntries
  );
  const inBand = await deriveDeepSeekSignedAssetCandidates(bundle, artifactId, sha256);
  const merged = new Map(pageOwned.map(candidate => [candidate.assetId, candidate]));
  for (const candidate of inBand) merged.set(candidate.assetId, candidate);
  return sortCandidates([...merged.values()]);
}
