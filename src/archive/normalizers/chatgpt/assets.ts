import type { ArchiveAsset, JsonValue } from '../../types';
import {
  HASH_PATTERN,
  type AssetContext,
  type JsonRecord,
  type ProviderAssetIndex,
  type ProviderAssetRecord,
} from './contracts';
import {
  assertSafeIdentifier,
  fail,
  hasOwn,
  isFiniteSafeInteger,
  isPlainRecord,
  isSignedOrTemporaryUrl,
  looksLikeUrl,
  providerFields,
  recordPrivacyRedaction,
  sourceRef,
} from './privacy';

const ID_FIELDS = ['asset_id', 'assetId', 'file_id', 'fileId', 'id'];
const RAW_POINTER_PATTERN = /^(?:\/(?:[^~/]|~[01])*)+$/;

export function manifestAssetsById(manifestAssets: unknown): ProviderAssetIndex {
  if (!Array.isArray(manifestAssets))
    fail('invalid-manifest', 'Capture manifest assets must be an array.');
  const byId = new Map<string, ProviderAssetRecord>();
  const bySourceRef = new Map<string, ProviderAssetRecord>();
  const records: ProviderAssetRecord[] = [];
  for (const asset of manifestAssets) {
    const record = readManifestAsset(asset, byId);
    for (const sourceRef of record.sourceRefs) {
      const key = sourceRefKey(sourceRef.artifactId, sourceRef.rawPointer);
      if (bySourceRef.has(key)) {
        fail('invalid-manifest', 'Capture asset raw source references must be unique.');
      }
      bySourceRef.set(key, record);
    }
    byId.set(record.id, record);
    records.push(record);
  }
  return { byId, bySourceRef, records };
}

export function upsertAsset(
  attachment: JsonRecord,
  pointer: string,
  context: AssetContext
): string {
  const manifestAsset = matchingManifestAsset(attachment, pointer, context);
  const identity = manifestAsset
    ? `manifest:${manifestAsset.id}`
    : assetIdentity(attachment, pointer);
  const existingId = context.assetIdsByIdentity.get(identity);
  if (existingId) return mergeAsset(existingId, attachment, pointer, context);
  const assetId = manifestAsset?.id ?? nextAssetId(identity, context.assets);
  if (hasOwn(context.assets, assetId)) fail('asset-conflict', 'ChatGPT asset identity collided.');
  context.assetIdsByIdentity.set(identity, assetId);
  context.assets[assetId] = createAsset(assetId, attachment, pointer, context, manifestAsset);
  return assetId;
}

/** Preserve authoritative manifest asset evidence even if no raw part refers to it. */
export function reconcileManifestAssets(context: AssetContext): void {
  for (const record of context.manifestAssets.records) {
    const identity = `manifest:${record.id}`;
    if (context.assetIdsByIdentity.has(identity)) continue;
    const assetId = record.id;
    if (hasOwn(context.assets, assetId))
      fail('asset-conflict', 'ChatGPT manifest asset ID collided.');
    context.assetIdsByIdentity.set(identity, assetId);
    context.assets[assetId] = {
      id: assetId,
      filename: null,
      mimeType: record.mediaType,
      byteLength: record.byteLength,
      dimensions: null,
      sha256: record.sha256,
      localArtifactRef: record.relativePath,
      acquisition: assetAcquisition(record),
      sourceRefs: archiveSourceRefs(record, context),
      extensions: { openai: { manifestOnly: true } },
    };
  }
}

function readManifestAsset(
  value: unknown,
  records: Map<string, ProviderAssetRecord>
): ProviderAssetRecord {
  if (!isAssetRecord(value))
    fail('invalid-manifest', 'Capture asset records must be plain objects.');
  assertSafeIdentifier(value.id, 'manifest asset id');
  if (records.has(value.id)) fail('invalid-manifest', `Duplicate manifest asset ${value.id}.`);
  const state = readManifestState(value.state, value.id);
  const attemptedAt = nullableManifestTimestamp(value, 'attemptedAt', value.id);
  assertManifestAttemptState(state, attemptedAt, value.id);
  return {
    id: value.id,
    state,
    attemptedAt,
    relativePath: nullableField(value, 'relativePath', value.id),
    mediaType: nullableField(value, 'mediaType', value.id),
    byteLength: nullableManifestLength(value, value.id),
    sha256: nullableManifestHash(value, value.id),
    detail: nullableField(value, 'detail', value.id),
    sourceRefs: manifestSourceRefs(value, value.id),
  };
}

function createAsset(
  id: string,
  attachment: JsonRecord,
  pointer: string,
  context: AssetContext,
  manifestAsset: ProviderAssetRecord | undefined
): ArchiveAsset {
  const fields = resolvedAssetFields(attachment, manifestAsset);
  const sources = manifestAsset === undefined ? [] : archiveSourceRefs(manifestAsset, context);
  appendSourceRef(
    sources,
    sourceRef(context, 'attachment', attachmentSourceId(attachment), pointer)
  );
  return {
    id,
    ...fields,
    sourceRefs: sources,
    extensions: {
      openai: assetProviderFields(attachment, context, pointer),
    },
  };
}

function resolvedAssetFields(
  attachment: JsonRecord,
  manifestAsset: ProviderAssetRecord | undefined
): Omit<ArchiveAsset, 'id' | 'sourceRefs' | 'extensions'> {
  const rawFilename = assetString(attachment, ['filename', 'file_name', 'name']);
  const rawMimeType = assetString(attachment, ['mime_type', 'mimeType']);
  const rawByteLength = assetLength(attachment);
  const rawSha256 = assetHash(attachment);
  assertManifestCompatibility(rawMimeType, rawByteLength, rawSha256, manifestAsset);
  return {
    filename: rawFilename,
    mimeType: manifestAsset?.mediaType ?? rawMimeType,
    byteLength: manifestAsset?.byteLength ?? rawByteLength,
    dimensions: assetDimensions(attachment),
    sha256: manifestAsset?.sha256 ?? rawSha256,
    localArtifactRef: manifestAsset?.relativePath ?? null,
    acquisition: assetAcquisition(manifestAsset),
  };
}

function assertManifestCompatibility(
  mimeType: string | null,
  byteLength: number | null,
  sha256: string | null,
  manifestAsset: ProviderAssetRecord | undefined
): void {
  if (!manifestAsset) return;
  if (
    mimeType !== null &&
    manifestAsset.mediaType !== null &&
    mimeType !== manifestAsset.mediaType
  ) {
    fail(
      'asset-manifest-conflict',
      'Raw asset MIME type disagrees with capture manifest evidence.'
    );
  }
  if (
    byteLength !== null &&
    manifestAsset.byteLength !== null &&
    byteLength !== manifestAsset.byteLength
  ) {
    fail(
      'asset-manifest-conflict',
      'Raw asset byte length disagrees with capture manifest evidence.'
    );
  }
  if (sha256 !== null && manifestAsset.sha256 !== null && sha256 !== manifestAsset.sha256) {
    fail('asset-manifest-conflict', 'Raw asset SHA-256 disagrees with capture manifest evidence.');
  }
}

function assetAcquisition(asset: ProviderAssetRecord | undefined): ArchiveAsset['acquisition'] {
  if (!asset) {
    return {
      state: 'not-attempted',
      attemptedAt: null,
      detail: 'No acquisition attempt is recorded for this asset.',
    };
  }
  return { state: asset.state, attemptedAt: asset.attemptedAt, detail: asset.detail };
}

function mergeAsset(
  assetId: string,
  attachment: JsonRecord,
  pointer: string,
  context: AssetContext
): string {
  const asset = context.assets[assetId];
  const candidate = resolvedAssetFields(
    attachment,
    matchingManifestAsset(attachment, pointer, context)
  );
  mergeAssetValue(asset, 'filename', candidate.filename);
  mergeAssetValue(asset, 'mimeType', candidate.mimeType);
  mergeAssetValue(asset, 'byteLength', candidate.byteLength);
  mergeAssetValue(asset, 'sha256', candidate.sha256);
  mergeAssetValue(asset, 'localArtifactRef', candidate.localArtifactRef);
  if (candidate.dimensions !== null) {
    if (
      asset.dimensions !== null &&
      (asset.dimensions.width !== candidate.dimensions.width ||
        asset.dimensions.height !== candidate.dimensions.height)
    ) {
      fail('asset-conflict', 'Repeated ChatGPT asset records disagree about dimensions.');
    }
    asset.dimensions ??= candidate.dimensions;
  }
  if (JSON.stringify(asset.acquisition) !== JSON.stringify(candidate.acquisition)) {
    fail('asset-conflict', 'Repeated ChatGPT asset records disagree about acquisition state.');
  }
  mergeAssetProviderFields(asset, assetProviderFields(attachment, context, pointer));
  appendArchiveSourceRef(
    asset,
    sourceRef(context, 'attachment', attachmentSourceId(attachment), pointer)
  );
  return assetId;
}

function mergeAssetValue<
  T extends 'filename' | 'mimeType' | 'byteLength' | 'sha256' | 'localArtifactRef',
>(asset: ArchiveAsset, field: T, candidate: ArchiveAsset[T]): void {
  if (candidate === null) return;
  if (asset[field] !== null && asset[field] !== candidate) {
    fail('asset-conflict', `Repeated ChatGPT asset records disagree about ${field}.`);
  }
  asset[field] = candidate;
}

function mergeAssetProviderFields(asset: ArchiveAsset, candidate: unknown): void {
  if (!isPlainRecord(asset.extensions.openai) || !isPlainRecord(candidate)) {
    fail('asset-conflict', 'Repeated ChatGPT asset records have malformed provider metadata.');
  }
  const existing = asset.extensions.openai;
  for (const key of Object.keys(candidate)) {
    if (hasOwn(existing, key) && JSON.stringify(existing[key]) !== JSON.stringify(candidate[key])) {
      fail(
        'asset-conflict',
        `Repeated ChatGPT asset records disagree about provider field ${key}.`
      );
    }
    if (!hasOwn(existing, key)) existing[key] = candidate[key] as JsonValue;
  }
}

function assetProviderFields(
  attachment: JsonRecord,
  context: AssetContext,
  pointer: string
): ReturnType<typeof providerFields> {
  for (const field of [...ID_FIELDS, 'url', 'download_url', 'asset_pointer']) {
    const value = attachment[field];
    if (typeof value !== 'string') continue;
    if (field === 'asset_pointer' || looksLikeUrl(value) || isSignedOrTemporaryUrl(value)) {
      recordPrivacyRedaction(
        context.privacy,
        'privacy-redacted-sensitive-asset-transport',
        'A sensitive asset transport value was omitted from canonical data.',
        `${pointer}/${field}`
      );
    }
  }
  return providerFields(
    attachment,
    new Set([
      ...ID_FIELDS,
      'content_type',
      'filename',
      'file_name',
      'name',
      'mime_type',
      'mimeType',
      'byte_length',
      'size_bytes',
      'size',
      'width',
      'height',
      'sha256',
      'url',
      'download_url',
      'asset_pointer',
      'data',
      'base64',
      'bytes',
      'inline_data',
    ]),
    context.privacy,
    pointer
  );
}

function assetIdentity(attachment: JsonRecord, pointer: string): string {
  const direct = firstProviderId(attachment);
  if (direct) return `provider:${direct}`;
  if (typeof attachment.asset_pointer === 'string')
    return `pointer-value:${attachment.asset_pointer}`;
  return `pointer-location:${pointer}`;
}

function matchingManifestAsset(
  attachment: JsonRecord,
  pointer: string,
  context: AssetContext
): ProviderAssetRecord | undefined {
  const byPointer = context.manifestAssets.bySourceRef.get(
    sourceRefKey(context.artifactId, pointer)
  );
  if (byPointer) return byPointer;
  const identifier = firstProviderId(attachment);
  return identifier ? context.manifestAssets.byId.get(identifier) : undefined;
}

function firstProviderId(attachment: JsonRecord): string | null {
  for (const field of ID_FIELDS) {
    const value = attachment[field];
    if (typeof value === 'string' && !looksLikeUrl(value) && !isSignedOrTemporaryUrl(value))
      return value;
  }
  return null;
}

function attachmentSourceId(attachment: JsonRecord): string | null {
  const identifier = firstProviderId(attachment);
  if (identifier !== null) assertSafeIdentifier(identifier, 'attachment provider ID');
  return identifier;
}

function sourceRefKey(artifactId: string, rawPointer: string): string {
  return `${artifactId}\u0000${rawPointer}`;
}

function archiveSourceRefs(
  record: ProviderAssetRecord,
  context: AssetContext
): ArchiveAsset['sourceRefs'] {
  return record.sourceRefs.map(sourceRef =>
    sourceRefForManifestLocation(context, sourceRef.artifactId, sourceRef.rawPointer)
  );
}

function sourceRefForManifestLocation(
  context: AssetContext,
  artifactId: string,
  rawPointer: string
): ArchiveAsset['sourceRefs'][number] {
  return sourceRef({ artifactId, format: context.format }, 'attachment', null, rawPointer);
}

function appendArchiveSourceRef(
  asset: ArchiveAsset,
  source: ArchiveAsset['sourceRefs'][number]
): void {
  appendSourceRef(asset.sourceRefs, source);
}

function appendSourceRef(
  sourceRefs: ArchiveAsset['sourceRefs'],
  source: ArchiveAsset['sourceRefs'][number]
): void {
  const existing = sourceRefs.find(
    candidate =>
      candidate.artifactId === source.artifactId &&
      candidate.rawPointer === source.rawPointer &&
      candidate.kind === source.kind
  );
  if (!existing) {
    sourceRefs.push(source);
    return;
  }
  if (existing.id === null && source.id !== null) {
    existing.id = source.id;
    return;
  }
  if (source.id !== null && existing.id !== source.id) {
    fail('asset-conflict', 'Repeated ChatGPT asset source IDs disagree.');
  }
}

function nextAssetId(identity: string, assets: Record<string, ArchiveAsset>): string {
  const base = `chatgpt-asset-${fnv1a(identity)}`;
  let candidate = base;
  for (let suffix = 2; hasOwn(assets, candidate); suffix += 1) candidate = `${base}-${suffix}`;
  return candidate;
}

function assetString(attachment: JsonRecord, fields: string[]): string | null {
  for (const field of fields) {
    if (!hasOwn(attachment, field) || attachment[field] === null) continue;
    if (typeof attachment[field] !== 'string')
      fail('malformed-attachment', `${field} must be a string.`);
    return attachment[field];
  }
  return null;
}

function assetLength(attachment: JsonRecord): number | null {
  for (const field of ['byte_length', 'size_bytes', 'size']) {
    if (!hasOwn(attachment, field) || attachment[field] === null) continue;
    if (!isFiniteSafeInteger(attachment[field]) || attachment[field] < 0) {
      fail('malformed-attachment', `${field} must be a non-negative safe integer.`);
    }
    return attachment[field];
  }
  return null;
}

function assetDimensions(attachment: JsonRecord): { width: number; height: number } | null {
  if (attachment.width === undefined && attachment.height === undefined) return null;
  if (!isFiniteSafeInteger(attachment.width) || !isFiniteSafeInteger(attachment.height)) {
    fail('malformed-attachment', 'Asset dimensions must be safe integer width and height.');
  }
  if (attachment.width < 0 || attachment.height < 0) {
    fail('malformed-attachment', 'Asset dimensions must be non-negative.');
  }
  return { width: attachment.width, height: attachment.height };
}

function assetHash(attachment: JsonRecord): string | null {
  const value = assetString(attachment, ['sha256']);
  if (value !== null && !HASH_PATTERN.test(value))
    fail('invalid-asset-hash', 'Asset SHA-256 is invalid.');
  return value;
}

function readManifestState(value: unknown, id: string): ArchiveAsset['acquisition']['state'] {
  if (
    !['not-attempted', 'fetched', 'unavailable', 'declined', 'expired', 'failed'].includes(
      String(value)
    )
  ) {
    fail('invalid-manifest', `Capture asset ${id} has an invalid acquisition state.`);
  }
  return value as ArchiveAsset['acquisition']['state'];
}

function nullableField(record: JsonRecord, field: string, id: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string')
    fail('invalid-manifest', `Capture asset ${id} has invalid ${field}.`);
  return value;
}

function nullableManifestTimestamp(record: JsonRecord, field: string, id: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(new Date(value).getTime()) ||
    new Date(value).toISOString() !== value
  ) {
    fail('invalid-manifest', `Capture asset ${id} has invalid ${field}.`);
  }
  return value;
}

function assertManifestAttemptState(
  state: ArchiveAsset['acquisition']['state'],
  attemptedAt: string | null,
  id: string
): void {
  if (['fetched', 'expired', 'failed'].includes(state) && attemptedAt === null) {
    fail('invalid-manifest', `Capture asset ${id} requires attemptedAt evidence.`);
  }
  if (['not-attempted', 'declined'].includes(state) && attemptedAt !== null) {
    fail('invalid-manifest', `Capture asset ${id} must not claim attemptedAt evidence.`);
  }
}

function manifestSourceRefs(record: JsonRecord, id: string): ProviderAssetRecord['sourceRefs'] {
  const value = record.sourceRefs;
  if (!Array.isArray(value) || value.length === 0) {
    fail('invalid-manifest', `Capture asset ${id} requires raw source references.`);
  }
  const refs = value.map(sourceRef => {
    if (!isPlainRecord(sourceRef)) {
      fail('invalid-manifest', `Capture asset ${id} has malformed raw source references.`);
    }
    const artifactId = sourceRef.artifactId;
    const rawPointer = sourceRef.rawPointer;
    if (typeof artifactId !== 'string' || typeof rawPointer !== 'string') {
      fail('invalid-manifest', `Capture asset ${id} has malformed raw source references.`);
    }
    assertSafeIdentifier(artifactId, `Capture asset ${id} raw artifact ID`);
    if (!RAW_POINTER_PATTERN.test(rawPointer) || hasControlCharacters(rawPointer)) {
      fail('invalid-manifest', `Capture asset ${id} has malformed raw source references.`);
    }
    return { artifactId, rawPointer };
  });
  const keys = refs.map(sourceRef => sourceRefKey(sourceRef.artifactId, sourceRef.rawPointer));
  if (new Set(keys).size !== keys.length) {
    fail('invalid-manifest', `Capture asset ${id} repeats raw source references.`);
  }
  return refs;
}

function nullableManifestLength(record: JsonRecord, id: string): number | null {
  const value = record.byteLength;
  if (value === null) return null;
  if (!isFiniteSafeInteger(value) || value < 0) {
    fail('invalid-manifest', `Capture asset ${id} has invalid byteLength.`);
  }
  return value;
}

function nullableManifestHash(record: JsonRecord, id: string): string | null {
  const value = record.sha256;
  if (value === null) return null;
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    fail('invalid-manifest', `Capture asset ${id} has invalid SHA-256.`);
  }
  return value;
}

function isAssetRecord(value: unknown): value is JsonRecord {
  return isPlainRecord(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
