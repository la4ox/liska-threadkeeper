import type { RawCaptureAssetRecord, RawCaptureManifest } from '../../capture';
import type {
  ArchiveAsset,
  ArchiveBlock,
  ArchiveDiagnostic,
  JsonValue,
  SourceReference,
} from '../../types';
import { deepSeekFail, type DeepSeekJsonRecord } from './contracts';
import {
  DEEPSEEK_ATTACHMENT_INVENTORY_WARNING,
  readDeepSeekRawFileRecord,
  type DeepSeekAssetInventory,
} from './inventory';
import {
  isPlainRecord,
  pointerAt,
  sanitizeJson,
  sourceRef,
  type DeepSeekPrivacyTracker,
} from './privacy';

export const DEEPSEEK_FILE_METADATA_PROVIDER_TYPE = 'FILE:metadata';
const FILE_FRAGMENT_MAPPED_FIELDS = new Set(['type', 'files']);
const FILE_PROVIDER_ID_SCAN_MAX_COUNT = 64;
const FILE_PROVIDER_ID_SCAN_MAX_CHARS = 4_096;
const FILE_PROVIDER_METADATA_MAX_DEPTH = 16;
const FILE_PROVIDER_METADATA_MAX_ENTRIES = 512;
const FILE_PROVIDER_METADATA_MAX_INSPECTED_CHARS = 64 * 1_024;
const FILE_PROVIDER_METADATA_MARKER_KEY = '_liskaRedactedProviderMetadata';
const PROVIDER_IDENTIFIER_FIELD =
  /^(?:id|file[_-]?id|provider[_-]?id|attachment[_-]?id|asset[_-]?id)$/i;

interface ProviderMetadataScrubState {
  entries: number;
  inspectedChars: number;
  redacted: boolean;
  exhausted: boolean;
}

export interface DeepSeekAttachmentContext {
  artifactId: string;
  format: string;
  privacy: DeepSeekPrivacyTracker;
  manifestAssetsBySourceRef: Map<string, RawCaptureAssetRecord>;
  assets: Record<string, ArchiveAsset>;
}

/** Rebuild the ledger from exact bytes before trusting any manifest asset pointer or ID. */
export function verifyDeepSeekAssetInventory(
  manifest: RawCaptureManifest,
  inventory: DeepSeekAssetInventory
): void {
  const manifestAssets = new Map(manifest.assets.map(asset => [asset.id, asset]));
  const sourceInventoryMatches =
    manifestAssets.size === manifest.assets.length &&
    manifest.assets.length === inventory.assets.length &&
    inventory.assets.every(expected => {
      const actual = manifestAssets.get(expected.id);
      return actual && JSON.stringify(actual.sourceRefs) === JSON.stringify(expected.sourceRefs);
    });
  const completenessMatches =
    inventory.completeness === 'unknown'
      ? manifest.completeness.assets === 'unknown'
      : manifest.completeness.assets !== 'unknown';
  if (!sourceInventoryMatches || !completenessMatches) {
    deepSeekFail(
      'asset-inventory-mismatch',
      'DeepSeek attachment inventory does not match the verified raw artifact.'
    );
  }
  if (
    inventory.completeness === 'unknown' &&
    !manifest.warnings.includes(DEEPSEEK_ATTACHMENT_INVENTORY_WARNING)
  ) {
    deepSeekFail(
      'asset-inventory-mismatch',
      'DeepSeek attachment inventory warning does not match the verified raw artifact.'
    );
  }
}

export function deepSeekManifestAssetsBySourceRef(
  assets: RawCaptureAssetRecord[]
): Map<string, RawCaptureAssetRecord> {
  const bySourceRef = new Map<string, RawCaptureAssetRecord>();
  for (const asset of assets) {
    for (const ref of asset.sourceRefs) {
      const key = assetSourceRefKey(ref.artifactId, ref.rawPointer);
      if (bySourceRef.has(key)) {
        deepSeekFail('asset-inventory-mismatch', 'DeepSeek attachment pointers are ambiguous.');
      }
      bySourceRef.set(key, asset);
    }
  }
  return bySourceRef;
}

export function deepSeekAttachmentBlock(
  value: unknown,
  messageId: string,
  index: number,
  pointer: string,
  context: DeepSeekAttachmentContext
): ArchiveBlock {
  let file: ReturnType<typeof readDeepSeekRawFileRecord>;
  try {
    file = readDeepSeekRawFileRecord(value);
  } catch {
    deepSeekFail(
      'asset-inventory-mismatch',
      'DeepSeek attachment inventory changed during normalization.'
    );
  }
  const manifestAsset = context.manifestAssetsBySourceRef.get(
    assetSourceRefKey(context.artifactId, pointer)
  );
  if (!manifestAsset) {
    deepSeekFail(
      'asset-inventory-mismatch',
      'DeepSeek attachment pointer is absent from the manifest.'
    );
  }
  upsertAttachmentAsset(manifestAsset, file, pointer, context);
  return {
    id: `${messageId}:block:${index}`,
    type: 'attachment',
    assetId: manifestAsset.id,
    sourceRefs: [sourceRef(context.artifactId, 'attachment', null, pointer, context.format)],
    extensions: {},
  };
}

export function degradedDeepSeekFilesExtension(
  value: unknown,
  providerIds: readonly string[]
): unknown {
  return omitProviderIds(value, 0, new Set(providerIds));
}

export function deepSeekAssetInventoryDiagnostics(
  inventory: DeepSeekAssetInventory,
  conversationSource: SourceReference
): ArchiveDiagnostic[] {
  if (inventory.completeness !== 'unknown') return [];
  return [
    {
      severity: 'warning',
      code: DEEPSEEK_ATTACHMENT_INVENTORY_WARNING,
      message:
        'DeepSeek attachment metadata inventory was unavailable; raw files remain only in sanitized message extensions.',
      path: null,
      sourceRefs: [conversationSource],
      extensions: {},
    },
  ];
}

/** Map the current provider FILE fragment without retaining its transport fields. */
export function deepSeekFileFragmentBlocks(
  fragment: DeepSeekJsonRecord,
  messageId: string,
  startIndex: number,
  pointer: string,
  context: DeepSeekAttachmentContext,
  inventory: DeepSeekAssetInventory
): ArchiveBlock[] {
  if (inventory.completeness === 'unknown') {
    return [
      {
        id: `${messageId}:block:${startIndex}`,
        type: 'unknown',
        providerType: 'FILE',
        raw: sanitizeJson(
          degradedDeepSeekFilesExtension(fragment, inventory.providerIds),
          context.privacy,
          pointer
        ),
        sourceRefs: [
          sourceRef(context.artifactId, 'content-part', messageId, pointer, context.format),
        ],
        extensions: {},
      },
    ];
  }
  return successfulFileFragmentBlocks(fragment, messageId, startIndex, pointer, context, inventory);
}

function successfulFileFragmentBlocks(
  fragment: DeepSeekJsonRecord,
  messageId: string,
  startIndex: number,
  pointer: string,
  context: DeepSeekAttachmentContext,
  inventory: DeepSeekAssetInventory
): ArchiveBlock[] {
  if (!Array.isArray(fragment.files)) {
    deepSeekFail(
      'asset-inventory-mismatch',
      'DeepSeek attachment inventory changed during normalization.'
    );
  }
  const blocks: ArchiveBlock[] = [];
  if (hasDeepSeekFileFragmentMetadata(fragment)) {
    blocks.push(
      fileFragmentMetadataBlock(fragment, messageId, startIndex, pointer, context, inventory)
    );
  }
  fragment.files.forEach((value, fileIndex) => {
    blocks.push(
      deepSeekAttachmentBlock(
        value,
        messageId,
        startIndex + blocks.length,
        pointerAt(pointer, 'files', String(fileIndex)),
        context
      )
    );
  });
  return blocks;
}

export function hasDeepSeekFileFragmentMetadata(fragment: DeepSeekJsonRecord): boolean {
  return (
    (Array.isArray(fragment.files) && fragment.files.length === 0) ||
    Object.keys(fragment).some(key => !FILE_FRAGMENT_MAPPED_FIELDS.has(key))
  );
}

function fileFragmentMetadataBlock(
  fragment: DeepSeekJsonRecord,
  messageId: string,
  index: number,
  pointer: string,
  context: DeepSeekAttachmentContext,
  inventory: DeepSeekAssetInventory
): ArchiveBlock {
  const residual: DeepSeekJsonRecord = {};
  for (const key of Object.keys(fragment)) {
    if (FILE_FRAGMENT_MAPPED_FIELDS.has(key)) continue;
    Object.defineProperty(residual, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: fragment[key],
    });
  }
  return {
    id: `${messageId}:block:${index}`,
    type: 'unknown',
    providerType: DEEPSEEK_FILE_METADATA_PROVIDER_TYPE,
    raw: successfulFileFragmentMetadata(residual, inventory, context, pointer),
    sourceRefs: [sourceRef(context.artifactId, 'content-part', messageId, pointer, context.format)],
    extensions: {},
  };
}

function successfulFileFragmentMetadata(
  residual: DeepSeekJsonRecord,
  inventory: DeepSeekAssetInventory,
  context: DeepSeekAttachmentContext,
  pointer: string
): JsonValue {
  if (inventory.providerIds.length > FILE_PROVIDER_ID_SCAN_MAX_COUNT) {
    return providerMetadataMarker();
  }
  const totalIdChars = inventory.providerIds.reduce((total, id) => total + id.length, 0);
  if (totalIdChars > FILE_PROVIDER_ID_SCAN_MAX_CHARS) return providerMetadataMarker();
  const matcher = providerIdMatcher(inventory.providerIds);
  const state: ProviderMetadataScrubState = {
    entries: 0,
    inspectedChars: 0,
    redacted: false,
    exhausted: false,
  };
  const scrubbed = scrubProviderMetadata(residual as JsonValue, matcher, state, 0, true);
  const marked = providerMetadataResult(scrubbed, state.redacted);
  return sanitizeJson(marked, context.privacy, pointer);
}

function providerMetadataResult(value: JsonValue, redacted: boolean): JsonValue {
  if (!redacted) return value;
  if (!isPlainRecord(value)) return providerMetadataMarker();
  value[FILE_PROVIDER_METADATA_MARKER_KEY] = true;
  return value as JsonValue;
}

function providerIdMatcher(providerIds: readonly string[]): RegExp | null {
  if (providerIds.length === 0) return null;
  const alternatives = [...providerIds]
    .sort((left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0))
    .map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(alternatives.join('|'));
}

function scrubProviderMetadata(
  value: JsonValue,
  matcher: RegExp | null,
  state: ProviderMetadataScrubState,
  depth: number,
  root: boolean
): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (!inspectProviderMetadataChars(value.length, state) || matcher?.test(value)) {
      state.redacted = true;
      return providerMetadataMarker();
    }
    return value;
  }
  if (depth >= FILE_PROVIDER_METADATA_MAX_DEPTH) {
    state.redacted = true;
    return providerMetadataMarker();
  }
  if (Array.isArray(value)) return scrubProviderMetadataArray(value, matcher, state, depth);
  return scrubProviderMetadataRecord(value, matcher, state, depth, root);
}

function scrubProviderMetadataArray(
  value: JsonValue[],
  matcher: RegExp | null,
  state: ProviderMetadataScrubState,
  depth: number
): JsonValue[] {
  const result: JsonValue[] = [];
  for (const entry of value) {
    if (!inspectProviderMetadataEntry(state)) {
      result.push(providerMetadataMarker());
      break;
    }
    result.push(scrubProviderMetadata(entry, matcher, state, depth + 1, false));
    if (state.exhausted) break;
  }
  return result;
}

function scrubProviderMetadataRecord(
  value: DeepSeekJsonRecord,
  matcher: RegExp | null,
  state: ProviderMetadataScrubState,
  depth: number,
  root: boolean
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    if (!inspectProviderMetadataKey(key, state)) {
      result[FILE_PROVIDER_METADATA_MARKER_KEY] = true;
      break;
    }
    if (unsafeProviderMetadataKey(key, matcher, root)) {
      state.redacted = true;
      continue;
    }
    const entry = value[key] as JsonValue;
    if (root && key === 'id' && typeof entry === 'string') {
      if (!inspectProviderMetadataChars(entry.length, state) || matcher?.test(entry)) {
        state.redacted = true;
        continue;
      }
      result[key] = entry;
      continue;
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: scrubProviderMetadata(entry, matcher, state, depth + 1, false),
    });
    if (state.exhausted) break;
  }
  return result;
}

function inspectProviderMetadataKey(key: string, state: ProviderMetadataScrubState): boolean {
  return inspectProviderMetadataEntry(state) && inspectProviderMetadataChars(key.length, state);
}

function unsafeProviderMetadataKey(key: string, matcher: RegExp | null, root: boolean): boolean {
  if (matcher?.test(key)) return true;
  return PROVIDER_IDENTIFIER_FIELD.test(key) && !(root && key === 'id');
}

function inspectProviderMetadataEntry(state: ProviderMetadataScrubState): boolean {
  if (state.entries >= FILE_PROVIDER_METADATA_MAX_ENTRIES) {
    state.redacted = true;
    state.exhausted = true;
    return false;
  }
  state.entries += 1;
  return true;
}

function inspectProviderMetadataChars(count: number, state: ProviderMetadataScrubState): boolean {
  if (count > FILE_PROVIDER_METADATA_MAX_INSPECTED_CHARS - state.inspectedChars) {
    state.redacted = true;
    state.exhausted = true;
    return false;
  }
  state.inspectedChars += count;
  return true;
}

function providerMetadataMarker(): Record<string, JsonValue> {
  return { [FILE_PROVIDER_METADATA_MARKER_KEY]: true };
}

function upsertAttachmentAsset(
  manifestAsset: RawCaptureAssetRecord,
  file: ReturnType<typeof readDeepSeekRawFileRecord>,
  pointer: string,
  context: DeepSeekAttachmentContext
): void {
  const candidate = attachmentAsset(manifestAsset, file, pointer, context);
  const existing = context.assets[manifestAsset.id];
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
      deepSeekFail('asset-inventory-mismatch', 'Repeated DeepSeek attachment metadata disagrees.');
    }
    return;
  }
  context.assets[manifestAsset.id] = candidate;
}

function attachmentAsset(
  manifestAsset: RawCaptureAssetRecord,
  file: ReturnType<typeof readDeepSeekRawFileRecord>,
  pointer: string,
  context: DeepSeekAttachmentContext
): ArchiveAsset {
  return {
    id: manifestAsset.id,
    filename: sanitizedAttachmentFilename(file, pointer, context),
    mimeType: manifestAsset.mediaType,
    byteLength: manifestAsset.state === 'fetched' ? manifestAsset.byteLength : file.byteLength,
    dimensions: null,
    sha256: manifestAsset.sha256,
    localArtifactRef: manifestAsset.relativePath,
    acquisition: {
      state: manifestAsset.state,
      attemptedAt: manifestAsset.attemptedAt,
      detail: manifestAsset.detail,
    },
    sourceRefs: manifestAsset.sourceRefs.map(ref =>
      sourceRef(context.artifactId, 'attachment', null, ref.rawPointer, context.format)
    ),
    extensions: {
      deepseek: sanitizeJson(file.extensionMetadata, context.privacy, pointer),
    },
  };
}

function sanitizedAttachmentFilename(
  file: ReturnType<typeof readDeepSeekRawFileRecord>,
  pointer: string,
  context: DeepSeekAttachmentContext
): string | null {
  if (file.filename === null) return null;
  const value = sanitizeJson(file.filename, context.privacy, pointerAt(pointer, 'file_name'));
  if (typeof value !== 'string') {
    deepSeekFail('asset-inventory-mismatch', 'DeepSeek attachment filename is malformed.');
  }
  return value;
}

function omitProviderIds(value: unknown, depth: number, providerIds: ReadonlySet<string>): unknown {
  if (depth >= 16) return '[truncated-provider-file-metadata]';
  if (typeof value === 'string' && providerIds.has(value)) return '[redacted-provider-id]';
  if (Array.isArray(value)) {
    return value.map(entry => omitProviderIds(entry, depth + 1, providerIds));
  }
  if (!isPlainRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (PROVIDER_IDENTIFIER_FIELD.test(key)) {
      continue;
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: omitProviderIds(value[key], depth + 1, providerIds),
    });
  }
  return result;
}

function assetSourceRefKey(artifactId: string, rawPointer: string): string {
  return `${artifactId}\u0000${rawPointer}`;
}
