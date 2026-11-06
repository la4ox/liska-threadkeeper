import type { RawCaptureManifest } from '../capture';
import {
  CONVERSATION_KEY_VERSION,
  type BuildSnapshotCatalogInput,
  type CatalogFileAggregate,
  type SnapshotCatalog,
  type SnapshotCatalogCode,
  type SnapshotCatalogEntry,
} from './contracts';
import { encodeSnapshotCatalog } from './encode';
import { conversationKeyInput } from './conversation-key';
import { CATALOG_HEADER, entrySortKey } from './format';
import { requireCatalogManifest } from './manifest';
import {
  compare,
  errorCode,
  fail,
  prepareCatalog,
  sum,
  type OwnedManifest,
  type OwnedMetadata,
  type PreparedCatalog,
} from './safe-input';
import { parseCatalogJson, type CatalogJsonBudget } from './strict-json';
import type { CatalogRecordBudget } from './manifest';

const CANONICAL_PATH = 'canonical/liska-thread-1.json';

function fileAggregate(
  records: { relativePath: string; byteLength: number }[],
  files: ReadonlyMap<string, number>
): CatalogFileAggregate {
  const result: CatalogFileAggregate = {
    count: records.length,
    declaredBytes: 0,
    presentCount: 0,
    presentBytes: 0,
    sizeMatchCount: 0,
    missingCount: 0,
    sizeMismatchCount: 0,
  };
  for (const record of records) {
    result.declaredBytes = sum(result.declaredBytes, record.byteLength);
    const size = files.get(record.relativePath);
    if (size === undefined) result.missingCount += 1;
    else {
      result.presentCount += 1;
      result.presentBytes = sum(result.presentBytes, size);
      if (size === record.byteLength) result.sizeMatchCount += 1;
      else result.sizeMismatchCount += 1;
    }
  }
  return result;
}

interface ScopeNode {
  children: Map<string, ScopeNode>;
  root?: string;
}

function scopeRoot(trie: ScopeNode, path: string): string | undefined {
  let node = trie;
  let root = node.root;
  for (const segment of path.split('/').slice(0, -1)) {
    const child = node.children.get(segment);
    if (!child) break;
    node = child;
    root = node.root ?? root;
  }
  return root;
}

function scopedFiles(prepared: PreparedCatalog): Map<string, OwnedMetadata[]> {
  const byRoot = new Map(prepared.manifests.map(file => [file.root, [] as OwnedMetadata[]]));
  const trie: ScopeNode = { children: new Map() };
  for (const root of byRoot.keys()) {
    let node = trie;
    for (const segment of root.split('/').filter(Boolean)) {
      let child = node.children.get(segment);
      if (!child) {
        child = { children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.root = root;
  }
  // Nearest-root lookup takes linear path work, even for deeply nested selections.
  for (const file of prepared.files) {
    const root = scopeRoot(trie, file.path);
    if (root !== undefined)
      byRoot.get(root)!.push({ path: file.path.slice(root.length), byteLength: file.byteLength });
  }
  return byRoot;
}

function emptyEntry(
  manifest: OwnedManifest,
  digest: string,
  files: OwnedMetadata[]
): SnapshotCatalogEntry {
  const canonical = files.find(file => file.path === CANONICAL_PATH);
  return {
    manifestValidity: 'invalid',
    manifestSha256: digest,
    manifestByteLength: manifest.bytes.byteLength,
    provider: null,
    conversationId: null,
    conversationKey: null,
    captureId: null,
    capturedAt: null,
    method: null,
    declaredCompleteness: null,
    artifacts: null,
    assets: null,
    canonical: {
      presence: canonical ? 'present-unverified' : 'absent',
      byteLength: canonical?.byteLength ?? null,
      declaredFileRole: null,
    },
    associatedFileCount: files.length,
    extraFileCount: 0,
    extraFileBytes: 0,
    issueCodes: [],
    occurrenceCount: 1,
  };
}

function projectManifest(
  entry: SnapshotCatalogEntry,
  manifest: RawCaptureManifest,
  files: OwnedMetadata[]
): void {
  const metadata = new Map(files.map(file => [file.path, file.byteLength]));
  const fetched = manifest.assets.filter(
    (asset): asset is typeof asset & { relativePath: string; byteLength: number } =>
      asset.state === 'fetched' && asset.relativePath !== null && asset.byteLength !== null
  );
  Object.assign(entry, {
    manifestValidity: 'valid',
    provider: manifest.provider,
    conversationId: manifest.conversationId,
    captureId: manifest.captureId,
    capturedAt: manifest.capturedAt,
    method: manifest.method,
    declaredCompleteness: manifest.completeness,
    artifacts: fileAggregate(manifest.artifacts, metadata),
    assets: { ...fileAggregate(fetched, metadata), recordCount: manifest.assets.length },
  });
  entry.canonical.declaredFileRole = manifest.artifacts.some(
    file => file.relativePath === CANONICAL_PATH
  )
    ? 'artifact'
    : fetched.some(file => file.relativePath === CANONICAL_PATH)
      ? 'asset'
      : null;
  const declared = new Set([
    'manifest.json',
    CANONICAL_PATH,
    ...manifest.artifacts.map(file => file.relativePath),
    ...fetched.map(file => file.relativePath),
  ]);
  for (const file of files) {
    if (declared.has(file.path)) continue;
    entry.extraFileCount += 1;
    entry.extraFileBytes = sum(entry.extraFileBytes, file.byteLength);
  }
  if (entry.artifacts!.missingCount) entry.issueCodes.push('artifact-missing');
  if (entry.artifacts!.sizeMismatchCount) entry.issueCodes.push('artifact-size-mismatch');
  if (entry.assets!.missingCount) entry.issueCodes.push('asset-missing');
  if (entry.assets!.sizeMismatchCount) entry.issueCodes.push('asset-size-mismatch');
  if (entry.extraFileCount) entry.issueCodes.push('extra-files');
}

function markConflicts(entries: SnapshotCatalogEntry[]): void {
  const captures = new Map<string, SnapshotCatalogEntry[]>();
  for (const entry of entries) {
    if (entry.manifestValidity !== 'valid') continue;
    const key = JSON.stringify([entry.provider, entry.conversationId, entry.captureId]);
    const group = captures.get(key) ?? [];
    group.push(entry);
    captures.set(key, group);
  }
  for (const group of captures.values()) {
    if (new Set(group.map(entry => entry.manifestSha256)).size < 2) continue;
    for (const entry of group) entry.issueCodes.push('capture-identity-conflict');
  }
}

const entryFailureCodes: readonly SnapshotCatalogCode[] = [
  'invalid-json',
  'duplicate-json-key',
  'unsafe-json-key',
  'manifest-invalid',
  'manifest-unsupported',
];

function parseManifest(
  file: OwnedManifest,
  entry: SnapshotCatalogEntry,
  prepared: PreparedCatalog,
  jsonBudget: CatalogJsonBudget,
  recordBudget: CatalogRecordBudget
): RawCaptureManifest | undefined {
  try {
    return requireCatalogManifest(
      parseCatalogJson(file.bytes, prepared.limits, jsonBudget),
      prepared.limits,
      recordBudget
    );
  } catch (error) {
    const code = errorCode(error, 'manifest-invalid');
    if (!entryFailureCodes.includes(code)) fail(code);
    entry.manifestValidity = code === 'manifest-unsupported' ? 'unsupported' : 'invalid';
    entry.issueCodes.push(code);
  }
}

async function catalogEntries(
  prepared: PreparedCatalog,
  scopes: ReadonlyMap<string, OwnedMetadata[]>
): Promise<SnapshotCatalogEntry[]> {
  const jsonBudget = { values: 0, stringCodeUnits: 0, work: 0 };
  const recordBudget = { records: 0 };
  const keys = new Map<string, string>();
  const entries: SnapshotCatalogEntry[] = [];
  for (const file of prepared.manifests) {
    const digest = await prepared.hash(file.bytes);
    const files = scopes.get(file.root)!;
    const entry = emptyEntry(file, digest, files);
    const manifest = parseManifest(file, entry, prepared, jsonBudget, recordBudget);
    if (manifest) {
      projectManifest(entry, manifest, files);
      const keyInput = conversationKeyInput(manifest.provider, manifest.conversationId);
      const identity = new TextDecoder().decode(keyInput);
      let key = keys.get(identity);
      if (!key) {
        key = `${CONVERSATION_KEY_VERSION}:${await prepared.hash(keyInput)}`;
        keys.set(identity, key);
      }
      entry.conversationKey = key;
    }
    entries.push(entry);
  }
  return entries;
}

/** Pure index of synchronously owned selection metadata and exact manifest bytes. */
export async function buildSnapshotCatalog(
  input: BuildSnapshotCatalogInput
): Promise<SnapshotCatalog> {
  const prepared = prepareCatalog(input); // No await before every caller-owned value is snapshotted.
  const scopes = scopedFiles(prepared);
  const entries = await catalogEntries(prepared, scopes);
  markConflicts(entries);
  const collapsed = new Map<string, SnapshotCatalogEntry>();
  for (const entry of entries) {
    entry.issueCodes.sort(compare);
    const key = entrySortKey(entry);
    const existing = collapsed.get(key);
    if (existing) existing.occurrenceCount += 1;
    else collapsed.set(key, entry);
  }
  const result: SnapshotCatalog = {
    ...CATALOG_HEADER,
    selectedFileCount: prepared.files.length,
    selectedManifestCount: prepared.manifests.length,
    unassociatedFileCount:
      prepared.files.length - [...scopes.values()].reduce((n, files) => n + files.length, 0),
    entries: [...collapsed.values()].sort((a, b) => compare(entrySortKey(a), entrySortKey(b))),
  };
  encodeSnapshotCatalog(result, prepared.limits);
  return result;
}
