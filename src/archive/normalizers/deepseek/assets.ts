import type { RawCaptureAssetRecord, RawCaptureManifest } from '../../capture';
import type { ArchiveAsset, ArchiveBlock, ArchiveDiagnostic, SourceReference } from '../../types';
import { deepSeekFail } from './contracts';
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
  if (
    manifest.completeness.assets !== inventory.completeness ||
    JSON.stringify(manifest.assets) !== JSON.stringify(inventory.assets)
  ) {
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
    sourceRefs: [
      sourceRef(context.artifactId, 'attachment', file.providerId, pointer, context.format),
    ],
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

function upsertAttachmentAsset(
  manifestAsset: RawCaptureAssetRecord,
  file: ReturnType<typeof readDeepSeekRawFileRecord>,
  pointer: string,
  context: DeepSeekAttachmentContext
): void {
  const existing = context.assets[manifestAsset.id];
  if (existing) {
    if (
      existing.filename !== sanitizedAttachmentFilename(file, pointer, context) ||
      existing.byteLength !== file.byteLength ||
      existing.mimeType !== null ||
      existing.sha256 !== null ||
      existing.localArtifactRef !== null ||
      existing.acquisition.state !== 'not-attempted'
    ) {
      deepSeekFail('asset-inventory-mismatch', 'Repeated DeepSeek attachment metadata disagrees.');
    }
    return;
  }
  context.assets[manifestAsset.id] = {
    id: manifestAsset.id,
    filename: sanitizedAttachmentFilename(file, pointer, context),
    mimeType: null,
    byteLength: file.byteLength,
    dimensions: null,
    sha256: null,
    localArtifactRef: null,
    acquisition: {
      state: 'not-attempted',
      attemptedAt: null,
      detail: 'Binary acquisition was not attempted for this provider attachment.',
    },
    sourceRefs: manifestAsset.sourceRefs.map(ref =>
      sourceRef(context.artifactId, 'attachment', file.providerId, ref.rawPointer, context.format)
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
