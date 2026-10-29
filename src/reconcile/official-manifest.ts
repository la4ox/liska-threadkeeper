import { parseWebCanonicalJson } from '../archive/reconciliation/chatgpt-delivery/json';
import type { ChatGptReconciliationDeliveryErrorCode } from '../archive/reconciliation/chatgpt-delivery/contracts';

export const OFFICIAL_MANIFEST_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxDepth: 32,
  maxValues: 100_000,
  maxShards: 1_000,
});

const SHARD_NAME = /^conversations-([0-9]{3})\.json$/;

type ManifestErrorCode =
  | 'byte-limit'
  | 'bom-not-supported'
  | 'invalid-utf8'
  | 'invalid-json'
  | 'duplicate-json-key'
  | 'json-limit'
  | 'schema-invalid'
  | 'version-unsupported'
  | 'declaration-invalid'
  | 'declaration-duplicate'
  | 'selection-invalid'
  | 'selection-duplicate'
  | 'shards-missing'
  | 'shards-unexpected';

export class OfficialManifestAdmissionError extends Error {
  constructor(readonly code: ManifestErrorCode) {
    super(`Official manifest admission failed (${code}).`);
    this.name = 'OfficialManifestAdmissionError';
  }
}

function fail(code: ManifestErrorCode): never {
  throw new OfficialManifestAdmissionError(code);
}

function jsonFailure(code: ChatGptReconciliationDeliveryErrorCode): never {
  switch (code) {
    case 'web-bom-not-supported':
      return fail('bom-not-supported');
    case 'web-invalid-utf8':
      return fail('invalid-utf8');
    case 'web-duplicate-key':
      return fail('duplicate-json-key');
    case 'web-json-limit':
      return fail('json-limit');
    default:
      return fail('invalid-json');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
}

function shardNames(value: unknown, selected: boolean): Set<string> {
  const invalid = selected ? 'selection-invalid' : 'declaration-invalid';
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > OFFICIAL_MANIFEST_LIMITS.maxShards
  )
    fail(invalid);
  const names = new Set<string>();
  for (const name of value) {
    if (typeof name !== 'string' || SHARD_NAME.exec(name)?.[0] !== name) fail(invalid);
    if (names.has(name)) fail(selected ? 'selection-duplicate' : 'declaration-duplicate');
    names.add(name);
  }
  return names;
}

function declaredShards(value: unknown): Set<string> {
  if (!record(value)) fail('schema-invalid');
  if (own(value, 'version') !== 1) fail('version-unsupported');
  const logical = own(value, 'logical_files');
  if (own(value, 'manifest_file') !== 'export_manifest.json' || !record(logical))
    fail('schema-invalid');
  const entry = own(logical, 'conversations.json');
  if (!record(entry) || own(entry, 'sharded') !== true) fail('declaration-invalid');
  const count = own(entry, 'shard_count');
  const files = own(entry, 'files');
  const names = shardNames(files, false);
  if (!Number.isInteger(count) || count !== names.size) fail('declaration-invalid');
  return names;
}

/** Local name-set admission only; neither authenticity nor shard-content completeness. */
export function admitOfficialManifest(
  bytes: Uint8Array,
  selectedShardNames: readonly string[]
): Readonly<{ schemaVersion: 1; declaredShardCount: number; selectedShardCount: number }> {
  if (bytes.byteLength > OFFICIAL_MANIFEST_LIMITS.maxBytes) fail('byte-limit');
  const selected = shardNames(selectedShardNames, true);
  const parsed = parseWebCanonicalJson(
    bytes,
    OFFICIAL_MANIFEST_LIMITS.maxDepth,
    OFFICIAL_MANIFEST_LIMITS.maxValues,
    jsonFailure
  );
  const declared = declaredShards(parsed);
  for (const name of declared) if (!selected.has(name)) fail('shards-missing');
  for (const name of selected) if (!declared.has(name)) fail('shards-unexpected');
  return Object.freeze({
    schemaVersion: 1,
    declaredShardCount: declared.size,
    selectedShardCount: selected.size,
  });
}
