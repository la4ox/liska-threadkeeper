import type { RawCaptureAssetRecord, RawCaptureManifest } from '../../capture';
import type { ArchiveAsset, ArchiveBlock, ArchiveDiagnostic, SourceReference } from '../../types';
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
  if (!Array.isArray(fragment.files)) {
    deepSeekFail(
      'asset-inventory-mismatch',
      'DeepSeek attachment inventory changed during normalization.'
    );
  }
  return fragment.files.map((value, fileIndex) =>
    deepSeekAttachmentBlock(
      value,
      messageId,
      startIndex + fileIndex,
      pointerAt(pointer, 'files', String(fileIndex)),
      context
    )
  );
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
    if (/^(?:id|file[_-]?id|provider[_-]?id|attachment[_-]?id|asset[_-]?id)$/i.test(key)) {
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
