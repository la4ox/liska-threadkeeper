import {
  buildCaptureManifest,
  validateCaptureBundleShape,
  verifyCaptureBundleIntegrity,
  type RawCaptureBundle,
  type RawCaptureManifest,
} from '../capture';
import { normalizeChatGptCapture } from '../normalizers/chatgpt';
import type { JsonValue, LiskaThreadArchive } from '../types';
import { validateLiskaThreadArchive } from '../validate';
import type {
  SnapshotAnalysisCode,
  SnapshotAnalysisEntry,
  SnapshotAnalysisLimits,
  SnapshotPreservationReason,
} from './contracts';
import {
  graphProjection,
  inventoryProjection,
  projectionBytes,
  semanticProjection,
  writerBytes,
} from './fingerprint';
import { equalBytes, errorCode, fail, type OwnedFile, type PreparedAnalysis } from './safe-input';
import { parseSnapshotJson, type SnapshotJsonBudget } from './strict-json';

const MANIFEST_PATH = 'manifest.json';
const RAW_PATH = 'responses/conversation.json';
const CANONICAL_PATH = 'canonical/liska-thread-1.json';

export interface VerifiedSnapshot {
  entry: SnapshotAnalysisEntry;
  files: OwnedFile[];
  reasons: Set<SnapshotPreservationReason>;
  identity?: string;
  observedAt?: string;
  raw?: OwnedFile;
  semantic?: { text: string; sha256: string };
  graph?: { text: string; sha256: string };
}

export interface VerificationBudget {
  json: SnapshotJsonBudget;
  projectionBytes: number;
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('manifest-invalid');
  return value;
}

function requireManifest(
  file: OwnedFile,
  prepared: PreparedAnalysis,
  budget: VerificationBudget
): RawCaptureManifest {
  const candidate = record(parseSnapshotJson(file.bytes, prepared.limits, budget.json));
  if (candidate.schema !== 'liska-capture/1') fail('manifest-invalid');
  if (
    !Array.isArray(candidate.artifacts) ||
    candidate.artifacts.length !== 1 ||
    !Array.isArray(candidate.assets)
  )
    fail('manifest-invalid');
  if (candidate.assets.length > prepared.limits.maxAssets) fail('limit-exceeded');
  const manifest = buildCaptureManifest(candidate as unknown as RawCaptureManifest);
  if (!equalBytes(file.bytes, writerBytes(manifest))) fail('writer-encoding-invalid');
  return manifest;
}

function requireSupportedManifest(manifest: RawCaptureManifest): void {
  const artifact = manifest.artifacts[0];
  if (
    manifest.provider !== 'chatgpt' ||
    manifest.method !== 'same-origin-api' ||
    !/^capture-chatgpt-[A-Za-z0-9_-]{1,240}$/u.test(manifest.captureId) ||
    artifact.relativePath !== RAW_PATH ||
    !('endpoint' in artifact) ||
    artifact.endpoint?.method !== 'GET' ||
    artifact.endpoint.pathPattern !== '/backend-api/conversation/{conversationId}'
  )
    fail('unsupported-snapshot-format');
}

function fileFor(files: readonly OwnedFile[], path: string): OwnedFile {
  const file = files.find(candidate => candidate.path === path);
  if (!file) fail('missing-evidence');
  return file;
}

function rawPreflight(value: JsonValue, limits: SnapshotAnalysisLimits): void {
  const root = record(value);
  const conversation = root.mapping ? root : record(root.conversation);
  const mapping = record(conversation.mapping);
  if (Object.keys(mapping).length > limits.maxCanonicalNodes) fail('limit-exceeded');
}

function canonicalPreflight(value: JsonValue, limits: SnapshotAnalysisLimits): LiskaThreadArchive {
  const candidate = record(value);
  if (
    candidate.schema !== 'liska-thread/1' ||
    !Array.isArray(candidate.inputs) ||
    candidate.inputs.length !== 1
  )
    fail('canonical-provenance-failed');
  const input = record(candidate.inputs[0]);
  if (input.normalizer !== 'chatgpt-web/1') fail('unsupported-normalizer');
  const graph = record(candidate.graph);
  const nodes = Object.values(record(graph.nodes));
  const assets = record(candidate.assets);
  const diagnostics = record(candidate.diagnostics).entries;
  if (!Array.isArray(diagnostics)) fail('canonical-provenance-failed');
  let blocks = 0;
  for (const node of nodes) {
    const message = record(node).message;
    if (message !== undefined && message !== null) {
      const content = record(message).blocks;
      if (!Array.isArray(content)) fail('canonical-provenance-failed');
      blocks += content.length;
    }
  }
  if (
    nodes.length > limits.maxCanonicalNodes ||
    blocks > limits.maxCanonicalBlocks ||
    Object.keys(assets).length > limits.maxAssets ||
    diagnostics.length > limits.maxDiagnostics
  )
    fail('limit-exceeded');
  return candidate as unknown as LiskaThreadArchive;
}

function bundleFor(manifest: RawCaptureManifest, files: readonly OwnedFile[]): RawCaptureBundle {
  return {
    manifest,
    artifacts: manifest.artifacts.map(artifact => ({
      record: artifact,
      bytes: fileFor(files, artifact.relativePath).bytes,
    })),
    assets: manifest.assets
      .filter(asset => asset.state === 'fetched')
      .map(asset => ({ record: asset, bytes: fileFor(files, asset.relativePath!).bytes })),
  };
}

function expectedPaths(manifest: RawCaptureManifest, canonical: boolean): Set<string> {
  return new Set([
    MANIFEST_PATH,
    ...manifest.artifacts.map(artifact => artifact.relativePath),
    ...manifest.assets.filter(asset => asset.state === 'fetched').map(asset => asset.relativePath!),
    ...(canonical ? [CANONICAL_PATH] : []),
  ]);
}

function recordOpaqueFiles(snapshot: VerifiedSnapshot, expected: ReadonlySet<string>): boolean {
  const extra = snapshot.files.filter(file => !expected.has(file.path));
  if (extra.length === 0) return false;
  snapshot.reasons.add('opaque-files');
  if (extra.some(file => /(?:\.md|\.html|\.receipt\.json)$/iu.test(file.path)))
    snapshot.reasons.add('presentation-reference');
  return true;
}

async function verifyBundle(
  bundle: RawCaptureBundle,
  hash: PreparedAnalysis['hash']
): Promise<void> {
  try {
    validateCaptureBundleShape(bundle);
    await verifyCaptureBundleIntegrity(bundle, hash);
  } catch (error) {
    fail(errorCode(error, 'artifact-integrity-failed'));
  }
}

async function replayCanonical(
  bundle: RawCaptureBundle,
  manifestFile: OwnedFile,
  canonical: OwnedFile,
  prepared: PreparedAnalysis,
  budget: VerificationBudget
): Promise<LiskaThreadArchive> {
  const supplied = canonicalPreflight(
    parseSnapshotJson(canonical.bytes, prepared.limits, budget.json),
    prepared.limits
  );
  const input = supplied.inputs[0];
  if (
    input.captureId !== bundle.manifest.captureId ||
    input.manifestSha256 !== manifestFile.sha256 ||
    input.capturedAt !== bundle.manifest.capturedAt ||
    supplied.conversation.provider !== 'chatgpt' ||
    supplied.conversation.id !== bundle.manifest.conversationId
  )
    fail('canonical-provenance-failed');
  let archive: LiskaThreadArchive;
  try {
    archive = (
      await normalizeChatGptCapture({
        bundle,
        artifactId: bundle.manifest.artifacts[0].id,
        manifestSha256: manifestFile.sha256,
        sha256: prepared.hash,
      })
    ).archive;
  } catch (error) {
    prepared.assertHashHealthy();
    fail(errorCode(error, 'canonical-replay-failed'));
  }
  canonicalPreflight(archive as unknown as JsonValue, prepared.limits);
  // Replay constructs the schema-valid graph; never run collect-all validation on
  // an unrelated hostile canonical graph merely because it claims the schema.
  if (
    !equalBytes(canonical.bytes, writerBytes(archive)) ||
    !validateLiskaThreadArchive(archive).valid
  )
    fail('canonical-replay-failed');
  return archive;
}

async function fingerprints(
  snapshot: VerifiedSnapshot,
  archive: LiskaThreadArchive,
  manifest: RawCaptureManifest,
  prepared: PreparedAnalysis,
  budget: VerificationBudget
): Promise<void> {
  const semantic = projectionBytes(semanticProjection(archive, manifest), prepared.limits, budget);
  const graph = projectionBytes(graphProjection(archive), prepared.limits, budget);
  snapshot.semantic = { text: semantic.text, sha256: await prepared.hash(semantic.bytes) };
  snapshot.graph = { text: graph.text, sha256: await prepared.hash(graph.bytes) };
}

function preserveFailure(snapshot: VerifiedSnapshot, code: SnapshotAnalysisCode): void {
  snapshot.entry.verification = 'unverifiable';
  snapshot.entry.code = code;
  snapshot.reasons.add(
    code === 'unsupported-normalizer' || code === 'unsupported-snapshot-format'
      ? 'unsupported-version'
      : 'integrity-unverified'
  );
}

async function verifyEvidence(
  snapshot: VerifiedSnapshot,
  prepared: PreparedAnalysis,
  budget: VerificationBudget
): Promise<void> {
  const manifestFile = fileFor(snapshot.files, MANIFEST_PATH);
  let manifest: RawCaptureManifest;
  try {
    manifest = requireManifest(manifestFile, prepared, budget);
  } catch (error) {
    fail(errorCode(error, 'manifest-invalid'));
  }
  requireSupportedManifest(manifest);
  snapshot.identity = manifest.conversationId;
  snapshot.observedAt = manifest.capturedAt;
  if (Object.values(manifest.completeness).some(state => state !== 'complete'))
    snapshot.reasons.add('partial-capture');
  const raw = fileFor(snapshot.files, RAW_PATH);
  const bundle = bundleFor(manifest, snapshot.files);
  await verifyBundle(bundle, prepared.hash);
  rawPreflight(parseSnapshotJson(raw.bytes, prepared.limits, budget.json), prepared.limits);
  snapshot.raw = raw;
  const canonical = snapshot.files.find(file => file.path === CANONICAL_PATH);
  const opaque = recordOpaqueFiles(snapshot, expectedPaths(manifest, canonical !== undefined));
  if (!canonical) {
    snapshot.reasons.add('raw-only');
    snapshot.entry.verification = 'partial';
    return;
  }
  const archive = await replayCanonical(bundle, manifestFile, canonical, prepared, budget);
  await fingerprints(snapshot, archive, manifest, prepared, budget);
  snapshot.entry.verification = opaque ? 'partial' : 'verified';
}

/** Every supplied byte inventory is measured before content verification starts. */
export async function measureInventories(prepared: PreparedAnalysis): Promise<VerifiedSnapshot[]> {
  const measured: VerifiedSnapshot[] = [];
  for (const [ordinal, inventory] of prepared.inventories.entries()) {
    for (const file of inventory.files) file.sha256 = await prepared.hash(file.bytes);
    measured.push({
      files: inventory.files,
      reasons: new Set(['external-references-unassessed']),
      entry: {
        ordinal,
        verification: 'unverifiable',
        code: null,
        measuredByteLength: inventory.measuredByteLength,
        fileCount: inventory.files.length,
        inventorySha256: await prepared.hash(inventoryProjection(inventory.files)),
        preserveReasons: [],
      },
    });
  }
  return measured;
}

export async function verifyInventories(
  snapshots: VerifiedSnapshot[],
  prepared: PreparedAnalysis
): Promise<void> {
  const budget: VerificationBudget = {
    json: { values: 0, stringCodeUnits: 0, work: 0 },
    projectionBytes: 0,
  };
  for (const snapshot of snapshots) {
    try {
      await verifyEvidence(snapshot, prepared, budget);
    } catch (error) {
      const code = errorCode(error, 'manifest-invalid');
      if (code.startsWith('sha256-') || code === 'limit-exceeded') fail(code);
      preserveFailure(snapshot, code);
    }
  }
}
