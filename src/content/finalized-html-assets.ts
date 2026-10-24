/** Destination-confirmed metadata only; this module never acquires or retains asset bytes. */
import type { LiskaThreadArchive, RawCaptureAssetRecord } from '../archive';
import { htmlAssetMediaPolicy } from '../archive/presentation/assets';
import {
  HTML_PRESENTATION_LIMITS,
  type HtmlAssetBinding,
  type HtmlAssetBindingSet,
} from '../archive/presentation/contracts';
import { LOWERCASE_SHA256, preflightJson } from '../archive/presentation/safety';
import { sha256Hex } from '../lib/sha256';
import type { ChatGptDestinationArchiveReceipt } from '../lib/chatgpt-archive-receipt';
import type {
  ArchiveCompanionBundle,
  StructuredArchivePresentationContext,
  StructuredPresentationContext,
} from '../lib/types';
import {
  retainStructuredArchivePresentation,
  retainStructuredPresentation,
} from './structured-presentation';

export const LISKA_HTML_ASSET_BINDINGS_SCHEMA = 'liska-html-asset-bindings/1' as const;

export interface FinalizedFileArchivePresentationEvidence {
  readonly context: StructuredArchivePresentationContext;
  readonly assetBindings: HtmlAssetBindingSet;
}

export interface FinalizedFilePresentationEvidence extends FinalizedFileArchivePresentationEvidence {
  readonly context: StructuredPresentationContext;
}

const CONTEXT_KEYS = ['source', 'captureId', 'conversationKey', 'includeToolContent'] as const;
const ARTIFACT_KEYS = ['kind', 'relativePath', 'mediaType', 'byteLength', 'sha256'] as const;
const ASSET_KEYS = ['id', 'state', 'relativePath', 'mediaType', 'byteLength', 'sha256'] as const;
type ConfirmedAsset = Pick<RawCaptureAssetRecord, (typeof ASSET_KEYS)[number]>;

function invalid(): never {
  throw new Error('finalized-html-evidence-invalid');
}

/** Read only the used own data; subtype transport fields are never visited. */
function ownData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function denseArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maxLength ||
    Reflect.ownKeys(value).length !== length + 1
  )
    invalid();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    result.push(descriptor.value);
  }
  return result;
}

function exactOwnData(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const data = ownData(value, keys);
  const actual = Reflect.ownKeys(value as object);
  if (
    actual.length !== keys.length ||
    actual.some(key => typeof key !== 'string' || !keys.includes(key))
  )
    invalid();
  return data;
}

/** Snapshot descriptors/bindings exactly once; B3a still owns canonical byte/hash authorization. */
function detachedArchiveEvidence(
  value: FinalizedFileArchivePresentationEvidence
): FinalizedFileArchivePresentationEvidence {
  const evidence = exactOwnData(value, ['context', 'assetBindings']);
  const base = exactOwnData(evidence.context, [
    'source',
    'archive',
    'captureId',
    'conversationKey',
    'manifest',
    'canonical',
    'includeToolContent',
  ]);
  const context = Object.freeze({
    ...base,
    manifest: Object.freeze(exactOwnData(base.manifest, ARTIFACT_KEYS)),
    canonical: Object.freeze(exactOwnData(base.canonical, ARTIFACT_KEYS)),
  }) as unknown as StructuredArchivePresentationContext;
  const set = exactOwnData(evidence.assetBindings, ['bindings', 'sha256']);
  const bindings = Object.freeze(
    denseArray(set.bindings, HTML_PRESENTATION_LIMITS.maxAssetBindings).map(
      binding =>
        Object.freeze({
          ...exactOwnData(binding, [
            'assetId',
            'path',
            'sha256',
            'mimeType',
            'byteLength',
            'renderMode',
          ]),
        }) as unknown as HtmlAssetBinding
    )
  );
  return Object.freeze({
    context,
    assetBindings: Object.freeze({ bindings, sha256: set.sha256 as string | null }),
  });
}

/**
 * Reconcile the presentation capability with the already-snapshotted, accepted File receipt.
 * Attachment-finalized canonical metadata is compared only with that receipt, never the old
 * companion. Multiple canonical asset aliases may share one exact confirmed physical file.
 */
export function reconcileFinalizedFileArchivePresentationEvidence(
  value: FinalizedFileArchivePresentationEvidence,
  fileReceipt: ChatGptDestinationArchiveReceipt
): FinalizedFileArchivePresentationEvidence | undefined {
  try {
    const evidence = detachedArchiveEvidence(value);
    const { context, assetBindings } = evidence;
    if (
      fileReceipt.destination !== 'file' ||
      context.source !== 'chatgpt' ||
      context.captureId !== fileReceipt.captureId ||
      context.conversationKey !== fileReceipt.conversationKey ||
      context.manifest.sha256 !== fileReceipt.manifestSha256 ||
      context.manifest.byteLength !== fileReceipt.archiveByteLengths.manifest ||
      context.canonical.byteLength !== fileReceipt.archiveByteLengths.canonical
    )
      return undefined;
    const assets = new Map(fileReceipt.assets.map(asset => [asset.relativePath, asset]));
    const represented = new Set<string>();
    for (const binding of assetBindings.bindings) {
      const asset = assets.get(binding.path);
      if (
        !asset ||
        binding.sha256 !== asset.sha256 ||
        binding.mimeType !== asset.mediaType ||
        binding.byteLength !== asset.byteLength
      )
        return undefined;
      represented.add(binding.path);
    }
    if (
      fileReceipt.assets.some(
        asset => htmlAssetMediaPolicy(asset.mediaType) && !represented.has(asset.relativePath)
      )
    )
      return undefined;
    return evidence;
  } catch {
    return undefined;
  }
}

function companionMetadata(value: ArchiveCompanionBundle): ArchiveCompanionBundle {
  const data = ownData(value, ['captureId', 'conversationKey', 'artifacts']);
  const capturedAt = Object.getOwnPropertyDescriptor(value, 'capturedAt');
  if (capturedAt && (!('value' in capturedAt) || !capturedAt.enumerable)) invalid();
  const artifacts = denseArray(data.artifacts, 3).map(item => ({
    ...ownData(item, ARTIFACT_KEYS),
  }));
  // Retention consumes descriptor metadata only, not transport or raw payloads.
  return {
    captureId: data.captureId,
    conversationKey: data.conversationKey,
    ...(capturedAt ? { capturedAt: capturedAt.value } : {}),
    artifacts,
  } as unknown as ArchiveCompanionBundle;
}

function finalContextInput(
  initial: StructuredArchivePresentationContext,
  archive: LiskaThreadArchive,
  companion: ArchiveCompanionBundle
) {
  const data = ownData(initial, CONTEXT_KEYS);
  const metadata = companionMetadata(companion);
  if (metadata.captureId !== data.captureId || metadata.conversationKey !== data.conversationKey)
    invalid();
  return {
    source: data.source as StructuredArchivePresentationContext['source'],
    archive,
    archiveCompanion: metadata,
    includeToolContent: data.includeToolContent as boolean,
  };
}

function confirmedAsset(value: unknown): ConfirmedAsset {
  const data = ownData(value, ASSET_KEYS);
  if (
    typeof data.id !== 'string' ||
    data.id.length === 0 ||
    data.state !== 'fetched' ||
    typeof data.sha256 !== 'string' ||
    !LOWERCASE_SHA256.test(data.sha256) ||
    typeof data.relativePath !== 'string' ||
    !new RegExp(`^assets/${data.sha256}\\.[a-z0-9]{1,16}$`).test(data.relativePath) ||
    typeof data.mediaType !== 'string' ||
    !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(data.mediaType) ||
    typeof data.byteLength !== 'number' ||
    !Number.isSafeInteger(data.byteLength) ||
    data.byteLength < 0
  )
    invalid();
  return data as unknown as ConfirmedAsset;
}

function confirmedRecords(value: readonly RawCaptureAssetRecord[]): Map<string, ConfirmedAsset> {
  const records = new Map<string, ConfirmedAsset>();
  for (const item of denseArray(value, HTML_PRESENTATION_LIMITS.maxInputJsonNodes)) {
    const record = confirmedAsset(item);
    if (records.has(record.id)) invalid();
    records.set(record.id, record);
  }
  return records;
}

function sameBytes(left: ConfirmedAsset, right: ConfirmedAsset): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.mediaType === right.mediaType &&
    left.byteLength === right.byteLength
  );
}

function fetchedAsset(id: string, value: unknown): Record<string, unknown> | undefined {
  const asset = ownData(value, ['id', 'acquisition']);
  const { state } = ownData(asset.acquisition, ['state']);
  if (
    asset.id !== id ||
    !['fetched', 'not-attempted', 'unavailable', 'declined', 'expired', 'failed'].includes(
      state as string
    )
  )
    invalid();
  return state === 'fetched'
    ? ownData(value, ['localArtifactRef', 'mimeType', 'sha256', 'byteLength'])
    : undefined;
}

function normalizedBindings(
  archive: LiskaThreadArchive,
  records: Map<string, ConfirmedAsset>
): readonly HtmlAssetBinding[] {
  const bindings: HtmlAssetBinding[] = [];
  const paths = new Map<string, ConfirmedAsset>();
  const assets = ownData(archive, ['assets']).assets;
  ownData(assets, []);
  for (const [id, value] of Object.entries(assets as Record<string, unknown>)) {
    const asset = fetchedAsset(id, value);
    if (!asset) continue;
    const record = records.get(id);
    if (
      !record ||
      record.relativePath !== asset.localArtifactRef ||
      record.mediaType !== asset.mimeType ||
      record.sha256 !== asset.sha256 ||
      record.byteLength !== asset.byteLength
    )
      invalid();
    records.delete(id);
    const existing = paths.get(record.relativePath!);
    if (existing && !sameBytes(existing, record)) invalid();
    paths.set(record.relativePath!, record);
    const policy = htmlAssetMediaPolicy(record.mediaType);
    if (!policy) continue;
    if (record.relativePath !== `assets/${record.sha256}.${policy.extension}`) invalid();
    bindings.push(
      Object.freeze({
        assetId: id,
        path: record.relativePath,
        sha256: record.sha256!,
        mimeType: record.mediaType!,
        byteLength: record.byteLength!,
        renderMode: policy.renderMode,
      })
    );
    if (bindings.length > HTML_PRESENTATION_LIMITS.maxAssetBindings) invalid();
  }
  if (records.size !== 0) invalid();
  bindings.sort((left, right) =>
    left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0
  );
  return Object.freeze(bindings);
}

/** One whole-map reconciliation and one digest, independent of selected/all-branches views. */
async function finalizedBindings<T extends StructuredArchivePresentationContext>(
  context: T,
  confirmedAssetRecords: readonly RawCaptureAssetRecord[]
): Promise<{ readonly context: T; readonly assetBindings: HtmlAssetBindingSet }> {
  const bindings = normalizedBindings(context.archive, confirmedRecords(confirmedAssetRecords));
  const sha256 =
    bindings.length === 0
      ? null
      : await sha256Hex(
          new TextEncoder().encode(
            JSON.stringify({ schema: LISKA_HTML_ASSET_BINDINGS_SCHEMA, bindings }) + '\n'
          )
        );
  if (sha256 !== null && (typeof sha256 !== 'string' || !LOWERCASE_SHA256.test(sha256))) invalid();
  return Object.freeze({ context, assetBindings: Object.freeze({ bindings, sha256 }) });
}

/**
 * File-only capability: callers supply only records whose exact File writes were confirmed.
 * Obsidian observations cannot authorize this context. No acquisition or destination writes
 * occur here. The final normalized archive remains closure-private and must not mutate.
 */
export async function buildFinalizedFileArchivePresentationEvidence(
  initialContext: StructuredArchivePresentationContext,
  finalArchive: LiskaThreadArchive,
  finalCompanion: ArchiveCompanionBundle,
  confirmedAssetRecords: readonly RawCaptureAssetRecord[]
): Promise<FinalizedFileArchivePresentationEvidence | undefined> {
  try {
    preflightJson(finalArchive, { ...HTML_PRESENTATION_LIMITS });
    const context = retainStructuredArchivePresentation(
      finalContextInput(initialContext, finalArchive, finalCompanion)
    );
    if (!context) return undefined;
    return await finalizedBindings(context, confirmedAssetRecords);
  } catch {
    return undefined;
  }
}

/** Selected-view compatibility wrapper; uses the same base retention and binding work. */
export async function buildFinalizedFilePresentationEvidence(
  initialContext: StructuredPresentationContext,
  finalArchive: LiskaThreadArchive,
  finalCompanion: ArchiveCompanionBundle,
  confirmedAssetRecords: readonly RawCaptureAssetRecord[]
): Promise<FinalizedFilePresentationEvidence | undefined> {
  try {
    preflightJson(finalArchive, { ...HTML_PRESENTATION_LIMITS });
    const selected = ownData(initialContext, ['targetNodeId', 'selectedNodeIds']);
    const context = retainStructuredPresentation({
      ...finalContextInput(initialContext, finalArchive, finalCompanion),
      targetNodeId: selected.targetNodeId as string,
      selectedNodeIds: denseArray(
        selected.selectedNodeIds,
        HTML_PRESENTATION_LIMITS.maxSelectedNodes
      ) as string[],
    });
    if (!context) return undefined;
    return await finalizedBindings(context, confirmedAssetRecords);
  } catch {
    return undefined;
  }
}
