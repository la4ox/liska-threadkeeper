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
import type { ArchiveCompanionBundle, StructuredPresentationContext } from '../lib/types';
import { retainStructuredPresentation } from './structured-presentation';

export const LISKA_HTML_ASSET_BINDINGS_SCHEMA = 'liska-html-asset-bindings/1' as const;

export interface FinalizedFilePresentationEvidence {
  readonly context: StructuredPresentationContext;
  readonly assetBindings: HtmlAssetBindingSet;
}

const CONTEXT_KEYS = [
  'source',
  'captureId',
  'conversationKey',
  'targetNodeId',
  'selectedNodeIds',
  'includeToolContent',
] as const;
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
  if (value.length > maxLength || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
    result.push(descriptor.value);
  }
  return result;
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

function finalContext(
  initial: StructuredPresentationContext,
  archive: LiskaThreadArchive,
  companion: ArchiveCompanionBundle
): StructuredPresentationContext {
  const data = ownData(initial, CONTEXT_KEYS);
  const metadata = companionMetadata(companion);
  if (metadata.captureId !== data.captureId || metadata.conversationKey !== data.conversationKey)
    invalid();
  const selectedNodeIds = denseArray(
    data.selectedNodeIds,
    HTML_PRESENTATION_LIMITS.maxSelectedNodes
  );
  const retained = retainStructuredPresentation({
    source: data.source as StructuredPresentationContext['source'],
    archive,
    archiveCompanion: metadata,
    targetNodeId: data.targetNodeId as string,
    selectedNodeIds: selectedNodeIds as string[],
    includeToolContent: data.includeToolContent as boolean,
  });
  if (!retained) invalid();
  return retained;
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

/**
 * Rebind one selected view to destination-finalized canonical evidence. Inputs
 * remain closure-private extension objects and must not mutate while pending.
 * Malformed/mismatched evidence and crypto failures return only `undefined`.
 */
export async function buildFinalizedFilePresentationEvidence(
  initialContext: StructuredPresentationContext,
  finalArchive: LiskaThreadArchive,
  finalCompanion: ArchiveCompanionBundle,
  confirmedAssetRecords: readonly RawCaptureAssetRecord[]
): Promise<FinalizedFilePresentationEvidence | undefined> {
  try {
    preflightJson(finalArchive, { ...HTML_PRESENTATION_LIMITS });
    const context = finalContext(initialContext, finalArchive, finalCompanion);
    const bindings = normalizedBindings(finalArchive, confirmedRecords(confirmedAssetRecords));
    const sha256 =
      bindings.length === 0
        ? null
        : await sha256Hex(
            new TextEncoder().encode(
              JSON.stringify({ schema: LISKA_HTML_ASSET_BINDINGS_SCHEMA, bindings }) + '\n'
            )
          );
    if (sha256 !== null && (typeof sha256 !== 'string' || !LOWERCASE_SHA256.test(sha256)))
      invalid();
    return Object.freeze({ context, assetBindings: Object.freeze({ bindings, sha256 }) });
  } catch {
    return undefined;
  }
}
