import { buildCaptureManifest, type RawCaptureManifest } from '../capture';
import type { JsonValue } from '../types';
import type { SnapshotCatalogLimits } from './contracts';
import { errorCode, fail, relativePath, sum } from './safe-input';

type JsonRecord = Record<string, JsonValue>;

function record(value: JsonValue | undefined): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('manifest-invalid');
  return value;
}

function strings(value: JsonRecord, names: string[]): void {
  if (names.some(name => typeof value[name] !== 'string')) fail('manifest-invalid');
}

function list(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) fail('manifest-invalid');
  return value;
}

function requireArtifact(value: JsonValue): void {
  const artifact = record(value);
  strings(artifact, ['id', 'relativePath', 'mediaType', 'sha256']);
  if (typeof artifact.byteLength !== 'number') fail('manifest-invalid');
  if (artifact.endpoint !== undefined)
    strings(record(artifact.endpoint), ['method', 'pathPattern']);
  if (artifact.source !== undefined) {
    const source = record(artifact.source);
    strings(source, ['kind', 'fileRole']);
    if (
      ['conversationIndex', 'byteStart', 'sourceByteLength'].some(
        k => typeof source[k] !== 'number'
      )
    )
      fail('manifest-invalid');
  }
}

function requireAsset(value: JsonValue): void {
  const asset = record(value);
  strings(asset, ['id', 'state']);
  for (const key of ['attemptedAt', 'relativePath', 'mediaType', 'sha256', 'detail'])
    if (asset[key] !== null && typeof asset[key] !== 'string') fail('manifest-invalid');
  if (asset.byteLength !== null && typeof asset.byteLength !== 'number') fail('manifest-invalid');
  for (const reference of list(asset.sourceRefs))
    strings(record(reference), ['artifactId', 'rawPointer']);
}

function declaredPath(value: JsonValue | undefined, limits: SnapshotCatalogLimits): string {
  try {
    return relativePath(value, limits);
  } catch (error) {
    if (errorCode(error, 'manifest-invalid') === 'limit-exceeded') fail('limit-exceeded');
    fail('manifest-invalid');
  }
}

export interface CatalogRecordBudget {
  records: number;
}

/** Shape/provenance validation, not current-writer byte-format validation. */
export function requireCatalogManifest(
  value: JsonValue,
  limits: SnapshotCatalogLimits,
  budget: CatalogRecordBudget
): RawCaptureManifest {
  const root = record(value);
  if (typeof root.schema !== 'string') fail('manifest-invalid');
  if (root.schema !== 'liska-capture/1') fail('manifest-unsupported');
  strings(root, ['provider', 'conversationId', 'captureId', 'capturedAt', 'method']);
  const artifacts = list(root.artifacts);
  const assets = root.assets === undefined ? [] : list(root.assets);
  const count = sum(artifacts.length, assets.length);
  if (count > limits.maxRecordsPerManifest) fail('limit-exceeded');
  budget.records = sum(budget.records, count);
  if (budget.records > limits.maxTotalRecords) fail('limit-exceeded');
  artifacts.forEach(requireArtifact);
  assets.forEach(requireAsset);
  // Inspect the exact declared spelling before the writer normalizer can alter it.
  for (const item of [...artifacts, ...assets]) {
    const path = record(item).relativePath;
    if (path !== null) declaredPath(path, limits);
  }
  strings(record(root.completeness), ['graph', 'messages', 'branches', 'assets']);
  for (const key of ['warnings', 'observedUnknownContentTypes']) {
    if (root[key] !== undefined && list(root[key]).some(item => typeof item !== 'string'))
      fail('manifest-invalid');
  }
  const manifest = buildCaptureManifest(root as unknown as RawCaptureManifest);
  const paths = new Set<string>(['manifest.json']);
  for (const item of [...manifest.artifacts, ...manifest.assets]) {
    if (item.relativePath === null) continue;
    const path = declaredPath(item.relativePath, limits);
    if (paths.has(path.toLowerCase())) fail('manifest-invalid');
    paths.add(path.toLowerCase());
  }
  return manifest;
}
