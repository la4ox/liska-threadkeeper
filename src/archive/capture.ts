/**
 * Provider-neutral metadata for an immutable raw conversation capture.
 *
 * Raw response bytes deliberately live outside the JSON manifest. The manifest
 * records enough evidence to verify those bytes without ever serialising
 * cookies, request headers, browser storage, or bearer tokens.
 */

export const LISKA_CAPTURE_SCHEMA = 'liska-capture/1' as const;

export type CaptureMethod = 'same-origin-api' | 'dom-derived' | 'official-export';
export type CaptureCompletenessState = 'complete' | 'partial' | 'unknown' | 'not-attempted';
export type CaptureAssetState = 'fetched' | 'unavailable' | 'declined' | 'expired' | 'failed';

export interface CaptureEndpoint {
  /** HTTP method, retained without request headers or body. */
  method: 'GET' | 'POST';
  /** Same-origin path pattern; conversation identifiers use `{conversationId}`. */
  pathPattern: string;
}

export interface RawCaptureArtifactRecord {
  id: string;
  relativePath: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  endpoint: CaptureEndpoint;
}

export interface RawCaptureAssetRecord {
  id: string;
  state: CaptureAssetState;
  relativePath: string | null;
  mediaType: string | null;
  byteLength: number | null;
  sha256: string | null;
  detail: string | null;
}

export interface CaptureCompleteness {
  graph: CaptureCompletenessState;
  messages: CaptureCompletenessState;
  branches: CaptureCompletenessState;
  assets: CaptureCompletenessState;
}

export interface RawCaptureManifest {
  schema: typeof LISKA_CAPTURE_SCHEMA;
  captureId: string;
  provider: string;
  conversationId: string;
  capturedAt: string;
  method: CaptureMethod;
  artifacts: RawCaptureArtifactRecord[];
  assets: RawCaptureAssetRecord[];
  completeness: CaptureCompleteness;
  warnings: string[];
  observedUnknownContentTypes: string[];
}

/** Runtime-only pairing of an artifact record with its exact response bytes. */
export interface RawCaptureArtifact {
  record: RawCaptureArtifactRecord;
  bytes: Uint8Array;
}

/** Runtime-only bundle. Its byte payloads are never embedded into manifest JSON. */
export interface RawCaptureBundle {
  manifest: RawCaptureManifest;
  artifacts: RawCaptureArtifact[];
}

export interface BuildCaptureManifestInput {
  captureId: string;
  provider: string;
  conversationId: string;
  capturedAt: string;
  method: CaptureMethod;
  artifacts: RawCaptureArtifactRecord[];
  assets?: RawCaptureAssetRecord[];
  completeness: CaptureCompleteness;
  warnings?: string[];
  observedUnknownContentTypes?: string[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_RELATIVE_PATH_PATTERN = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\0]+$/;
const PATH_PATTERN = /^\/(?!\/)(?!.*\\)[^\s?#]{0,1023}$/;
const CREDENTIAL_TEXT_PATTERN =
  /(?:authorization\s*:|cookie\s*:|\bbearer\s+[A-Za-z0-9._~+/=-]+|access[_-]?token|session[_-]?token|api[_-]?key)/i;

function requireSafeId(value: string, label: string): string {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a bounded portable identifier.`);
  }
  return value;
}

function requireTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    throw new Error('capturedAt must be an ISO 8601 timestamp.');
  }
  return value;
}

function requireRelativePath(value: string): string {
  if (!SAFE_RELATIVE_PATH_PATTERN.test(value) || hasControlCharacters(value)) {
    throw new Error('Capture artifact paths must stay inside their bundle.');
  }
  return value.replace(/\\/g, '/');
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function requireCredentialFreeText(value: string, label: string, maxLength: number): string {
  if (value.length > maxLength || CREDENTIAL_TEXT_PATTERN.test(value)) {
    throw new Error(`${label} must be bounded and credential-free.`);
  }
  return value;
}

function normalizeEndpoint(endpoint: CaptureEndpoint): CaptureEndpoint {
  if (endpoint.method !== 'GET' && endpoint.method !== 'POST') {
    throw new Error('Capture endpoint method must be GET or POST.');
  }
  if (!PATH_PATTERN.test(endpoint.pathPattern)) {
    throw new Error('Capture endpoint must be an origin-relative path pattern without a query.');
  }
  return {
    method: endpoint.method,
    pathPattern: requireCredentialFreeText(
      endpoint.pathPattern,
      'Capture endpoint path pattern',
      1_024
    ),
  };
}

export function normalizeCaptureArtifactRecord(
  record: RawCaptureArtifactRecord
): RawCaptureArtifactRecord {
  requireSafeId(record.id, 'artifact id');
  if (
    !record.mediaType.trim() ||
    record.mediaType.length > 255 ||
    hasControlCharacters(record.mediaType)
  ) {
    throw new Error('Capture artifact mediaType must be a bounded non-empty string.');
  }
  if (!Number.isSafeInteger(record.byteLength) || record.byteLength < 0) {
    throw new Error('Capture artifact byteLength must be a non-negative safe integer.');
  }
  if (!SHA256_PATTERN.test(record.sha256)) {
    throw new Error('Capture artifact sha256 must be lowercase hexadecimal.');
  }
  return {
    id: record.id,
    relativePath: requireRelativePath(record.relativePath),
    mediaType: requireCredentialFreeText(record.mediaType, 'Capture artifact mediaType', 255),
    byteLength: record.byteLength,
    sha256: record.sha256,
    endpoint: normalizeEndpoint(record.endpoint),
  };
}

function requireAssetState(state: CaptureAssetState): void {
  if (!['fetched', 'unavailable', 'declined', 'expired', 'failed'].includes(state)) {
    throw new Error('Capture asset state is invalid.');
  }
}

function requireAssetMeasurements(asset: RawCaptureAssetRecord): void {
  if (
    asset.byteLength !== null &&
    (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 0)
  ) {
    throw new Error('Capture asset byteLength must be null or a non-negative safe integer.');
  }
  if (asset.sha256 !== null && !SHA256_PATTERN.test(asset.sha256)) {
    throw new Error('Capture asset sha256 must be null or lowercase hexadecimal.');
  }
}

function requireAssetAcquisitionClaim(asset: RawCaptureAssetRecord): void {
  const hasFetchedEvidence =
    asset.relativePath !== null &&
    asset.mediaType !== null &&
    asset.byteLength !== null &&
    asset.sha256 !== null;
  if (asset.state === 'fetched' && !hasFetchedEvidence) {
    throw new Error('Fetched capture assets require path, media type, byte length, and SHA-256.');
  }
  const claimsUnfetchedFile =
    asset.relativePath !== null || asset.byteLength !== null || asset.sha256 !== null;
  if (asset.state !== 'fetched' && claimsUnfetchedFile) {
    throw new Error('Unfetched capture assets cannot claim a local file, byte length, or SHA-256.');
  }
}

function normalizeAsset(asset: RawCaptureAssetRecord): RawCaptureAssetRecord {
  requireSafeId(asset.id, 'asset id');
  requireAssetState(asset.state);
  if (asset.relativePath !== null) requireRelativePath(asset.relativePath);
  requireAssetMeasurements(asset);
  requireAssetAcquisitionClaim(asset);
  return {
    id: asset.id,
    state: asset.state,
    relativePath: asset.relativePath === null ? null : requireRelativePath(asset.relativePath),
    mediaType:
      asset.mediaType === null
        ? null
        : requireCredentialFreeText(asset.mediaType, 'Capture asset mediaType', 255),
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    detail:
      asset.detail === null
        ? null
        : requireCredentialFreeText(asset.detail, 'Capture asset detail', 2_000),
  };
}

function normalizeCompleteness(value: CaptureCompleteness): CaptureCompleteness {
  const allowed = ['complete', 'partial', 'unknown', 'not-attempted'];
  for (const state of [value.graph, value.messages, value.branches, value.assets]) {
    if (!allowed.includes(state)) throw new Error('Capture completeness state is invalid.');
  }
  return {
    graph: value.graph,
    messages: value.messages,
    branches: value.branches,
    assets: value.assets,
  };
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
}

function validateCaptureManifestIdentity(input: BuildCaptureManifestInput): void {
  requireSafeId(input.captureId, 'captureId');
  requireSafeId(input.provider, 'provider');
  requireSafeId(input.conversationId, 'conversationId');
  requireTimestamp(input.capturedAt);
  if (!['same-origin-api', 'dom-derived', 'official-export'].includes(input.method)) {
    throw new Error('Capture method is invalid.');
  }
}

function validateCaptureBundleUniqueness(
  artifacts: RawCaptureArtifactRecord[],
  assets: RawCaptureAssetRecord[]
): void {
  assertUnique(
    artifacts.map(artifact => artifact.id),
    'Capture artifact ids'
  );
  assertUnique(
    assets.map(asset => asset.id),
    'Capture asset ids'
  );
  assertUnique(
    [
      ...artifacts.map(artifact => artifact.relativePath),
      ...assets.flatMap(asset => (asset.relativePath === null ? [] : [asset.relativePath])),
    ],
    'Capture bundle paths'
  );
}

/** Build a deterministic, credential-free capture manifest. */
export function buildCaptureManifest(input: BuildCaptureManifestInput): RawCaptureManifest {
  validateCaptureManifestIdentity(input);
  const artifacts = input.artifacts.map(normalizeCaptureArtifactRecord);
  const assets = (input.assets ?? []).map(normalizeAsset);
  validateCaptureBundleUniqueness(artifacts, assets);

  return {
    schema: LISKA_CAPTURE_SCHEMA,
    captureId: input.captureId,
    provider: input.provider,
    conversationId: input.conversationId,
    capturedAt: input.capturedAt,
    method: input.method,
    artifacts,
    assets,
    completeness: normalizeCompleteness(input.completeness),
    warnings: (input.warnings ?? []).map(warning =>
      requireCredentialFreeText(String(warning), 'Capture warning', 2_000)
    ),
    observedUnknownContentTypes: [
      ...new Set(
        (input.observedUnknownContentTypes ?? []).map(value =>
          requireCredentialFreeText(String(value), 'Observed content type', 255)
        )
      ),
    ].sort(),
  };
}

/** Verify runtime artifact record identity and byte lengths without hashing. */
export function validateCaptureBundleShape(bundle: RawCaptureBundle): void {
  const records = new Map(bundle.manifest.artifacts.map(record => [record.id, record]));
  assertUnique(
    bundle.artifacts.map(artifact => artifact.record.id),
    'Runtime capture artifact ids'
  );
  if (bundle.artifacts.length !== records.size) {
    throw new Error('Runtime capture artifacts do not match the manifest.');
  }
  for (const artifact of bundle.artifacts) {
    const record = records.get(artifact.record.id);
    if (!record || JSON.stringify(record) !== JSON.stringify(artifact.record)) {
      throw new Error(`Runtime capture artifact ${artifact.record.id} is not the manifest record.`);
    }
    if (artifact.bytes.byteLength !== record.byteLength) {
      throw new Error(`Runtime capture artifact ${artifact.record.id} has the wrong byte length.`);
    }
  }
}

/**
 * Verify exact raw bytes with a caller-provided SHA-256 implementation.
 * Injection keeps the archive layer independent of Web Crypto and Node.
 */
export async function verifyCaptureBundleIntegrity(
  bundle: RawCaptureBundle,
  sha256: (bytes: Uint8Array) => Promise<string>
): Promise<void> {
  validateCaptureBundleShape(bundle);
  for (const artifact of bundle.artifacts) {
    const actual = await sha256(artifact.bytes);
    if (actual !== artifact.record.sha256) {
      throw new Error(
        `Runtime capture artifact ${artifact.record.id} failed SHA-256 verification.`
      );
    }
  }
}
