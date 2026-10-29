import type { ObsidianApiClient, ObsidianServerVersions } from '../lib/obsidian-api';
import { canonicalBase64ByteLength } from '../lib/base64';
import {
  base64ToBytes,
  bytesToBase64,
  isAllowedImageMime,
  MAX_IMAGE_SIZE_BYTES,
  mimeToExtension,
} from '../lib/image-utils';
import {
  inspectTrustedTailImages,
  resolveImagesForObsidianTail,
  stripTailImagePlaceholders,
} from '../lib/image-output';
import { containsPathTraversal, resolvePathTemplate } from '../lib/path-utils';
import { sha256Hex } from '../lib/sha256';
import type { ExtensionSettings, ExtractedImage } from '../lib/types';
import { flattenLargeCallouts } from '../lib/callout-flatten';
import {
  finalizeAppendReadingMarkdown,
  type FinalMarkdownMarkerRange,
} from '../lib/final-markdown-gate';
import { MESSAGE_BOUNDARY_FORMAT_MARKER, MESSAGE_BOUNDARY_MARKER } from '../lib/message-counter';
import { AppendBoundaryError } from '../lib/append-utils';

const IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const FULL_SHA256 = /^[a-f0-9]{64}$/;
const APPEND_IMAGE_NAMESPACE = 'liska-v1';

export type AppendImageErrorCode =
  | 'append-image-reference-invalid'
  | 'append-image-data-invalid'
  | 'append-image-server-info-failed'
  | 'append-image-server-unsupported'
  | 'append-image-path-invalid'
  | 'append-image-read-failed'
  | 'append-image-collision'
  | 'append-image-write-unknown'
  | 'append-image-readback-failed'
  | 'append-note-changed-before-write'
  | 'append-note-write-unknown';

export class AppendImageError extends Error {
  constructor(readonly code: AppendImageErrorCode) {
    super(`Append image operation failed (${code}).`);
    this.name = 'AppendImageError';
  }
}

function fail(code: AppendImageErrorCode): never {
  throw new AppendImageError(code);
}

interface PlannedAsset {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface AppendImagePlan {
  readonly body: string;
  readonly assets: readonly PlannedAsset[];
  readonly occurrenceCount: number;
}

export interface AppendImagePersistence {
  readonly created: number;
  readonly reused: number;
}

export interface PreparedAppendTail {
  readonly body: string;
  readonly imagePlan?: AppendImagePlan;
}

type AppendImageClient = Pick<
  ObsidianApiClient,
  'getServerVersions' | 'getBinaryFileBounded' | 'putBinaryFileIfAbsent' | 'getFile' | 'putFile'
>;

interface AppendWriteInput {
  readonly diagnosticsOnly?: boolean;
  readonly content: string;
  readonly newMessages: string;
  readonly existingBody: string;
  readonly messagesAppended: number;
  readonly updatedFrontmatter: string;
}

function appendMarkerRanges(
  tail: string,
  appendFrom: number,
  expectedCount: number
): FinalMarkdownMarkerRange[] {
  const ranges: FinalMarkdownMarkerRange[] = [];
  let messageCount = 0;
  let formatCount = 0;
  let start = 0;
  while (start < tail.length) {
    const nextBreak = tail.indexOf('\n', start);
    const end = nextBreak < 0 ? tail.length : nextBreak;
    const line = tail.slice(start, end);
    if (line === MESSAGE_BOUNDARY_MARKER) {
      messageCount += 1;
      ranges.push({ start: appendFrom + start, end: appendFrom + end });
      if (messageCount > expectedCount) throw new AppendBoundaryError();
    } else if (line === MESSAGE_BOUNDARY_FORMAT_MARKER) {
      formatCount += 1;
      if (start !== 0 || formatCount > 1) throw new AppendBoundaryError();
      ranges.push({ start: appendFrom + start, end: appendFrom + end });
    }
    start = end + 1;
  }
  if (messageCount !== expectedCount) throw new AppendBoundaryError();
  return ranges;
}

/** Finalize only the trusted new tail before any binary side effect. */
export function prepareAppendTailWrite(
  appendResult: AppendWriteInput,
  settings: ExtensionSettings,
  newMessages = appendResult.newMessages
) {
  if (appendResult.diagnosticsOnly) return { ok: true as const, content: appendResult.content };
  const tail = settings.flattenLargeCallouts
    ? flattenLargeCallouts(newMessages, settings.maxCalloutLines)
    : newMessages;
  const prefix = `${appendResult.existingBody}\n\n`;
  const finalized = finalizeAppendReadingMarkdown(prefix + tail, {
    appendFrom: prefix.length,
    requiredMarkerRanges: appendMarkerRanges(tail, prefix.length, appendResult.messagesAppended),
  });
  return finalized.ok
    ? { ok: true as const, content: `${appendResult.updatedFrontmatter}\n${finalized.body}` }
    : finalized;
}

function normalizeMime(value: string): string {
  const normalized = value.split(';')[0]!.trim().toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function decodeImage(image: ExtractedImage): { bytes: Uint8Array; mediaType: string } {
  const mediaType = normalizeMime(image.mimeType);
  const expectedLength = canonicalBase64ByteLength(image.data);
  if (
    !isAllowedImageMime(mediaType) ||
    expectedLength === undefined ||
    expectedLength < 1 ||
    expectedLength > MAX_IMAGE_SIZE_BYTES
  ) {
    fail('append-image-data-invalid');
  }
  try {
    const bytes = base64ToBytes(image.data);
    if (bytes.byteLength !== expectedLength || bytesToBase64(bytes) !== image.data) {
      fail('append-image-data-invalid');
    }
    return { bytes, mediaType };
  } catch (error) {
    if (error instanceof AppendImageError) throw error;
    fail('append-image-data-invalid');
  }
}

function selectedTailImages(
  required: ReadonlySet<string>,
  images: readonly ExtractedImage[]
): ReadonlyMap<string, ExtractedImage> {
  for (const id of required) if (!IMAGE_ID.test(id)) fail('append-image-reference-invalid');
  const selected = new Map<string, ExtractedImage>();
  for (const image of images) {
    if (!required.has(image.id)) continue;
    if (!IMAGE_ID.test(image.id) || selected.has(image.id)) fail('append-image-reference-invalid');
    selected.set(image.id, image);
  }
  for (const id of required) if (!selected.has(id)) fail('append-image-reference-invalid');
  return selected;
}

async function planContentAddressedAssets(
  required: ReadonlySet<string>,
  selected: ReadonlyMap<string, ExtractedImage>
) {
  const assetsByFileName = new Map<string, PlannedAsset>();
  const assetsByDigest = new Map<string, PlannedAsset>();
  const names = new Map<string, string>();
  for (const id of required) {
    const image = selected.get(id)!;
    const { bytes, mediaType } = decodeImage(image);
    const digest = await sha256Hex(bytes);
    if (!FULL_SHA256.test(digest)) fail('append-image-data-invalid');
    const fileName = `sha256-${digest}.${mimeToExtension(mediaType)}`;
    const digestMatch = assetsByDigest.get(digest);
    if (digestMatch) {
      if (digestMatch.mediaType !== mediaType || !sameBytes(digestMatch.bytes, bytes)) {
        fail('append-image-data-invalid');
      }
      names.set(id, digestMatch.fileName);
      continue;
    }
    const existing = assetsByFileName.get(fileName);
    if (existing && (existing.mediaType !== mediaType || !sameBytes(existing.bytes, bytes))) {
      fail('append-image-data-invalid');
    }
    if (!existing) {
      const planned = { fileName, mediaType, bytes, sha256: digest };
      assetsByFileName.set(fileName, planned);
      assetsByDigest.set(digest, planned);
    }
    names.set(id, fileName);
  }
  return { assetsByFileName, names };
}

function validateResolvedAssetNames(
  resolved: ReturnType<typeof resolveImagesForObsidianTail>,
  assetsByFileName: ReadonlyMap<string, PlannedAsset>
): void {
  const resolvedNames = new Set(resolved.files.map(file => file.fileName));
  if (
    resolvedNames.size !== assetsByFileName.size ||
    [...resolvedNames].some(fileName => !assetsByFileName.has(fileName))
  ) {
    fail('append-image-reference-invalid');
  }
}

/** Freeze the exact active image occurrences from one already-verified new tail. */
export async function prepareAppendImagePlan(
  tail: string,
  images: readonly ExtractedImage[]
): Promise<AppendImagePlan> {
  const inspection = inspectTrustedTailImages(tail);
  if (inspection.parserFailed) fail('append-image-reference-invalid');
  const occurrences = inspection.ids;
  const required = new Set(occurrences);
  if (required.size === 0) {
    return Object.freeze({
      body: resolveImagesForObsidianTail(tail, [], new Map()).body,
      assets: Object.freeze([]),
      occurrenceCount: 0,
    });
  }
  const selected = selectedTailImages(required, images);
  const { assetsByFileName, names } = await planContentAddressedAssets(required, selected);
  const resolved = resolveImagesForObsidianTail(tail, [...selected.values()], names);
  validateResolvedAssetNames(resolved, assetsByFileName);
  return Object.freeze({
    body: resolved.body,
    assets: Object.freeze([...assetsByFileName.values()]),
    occurrenceCount: occurrences.length,
  });
}

/** Preserve legacy text-only behavior and avoid parsing image-free tails. */
export async function prepareAppendTail(
  tail: string,
  images: readonly ExtractedImage[],
  enableImageExport: boolean
): Promise<PreparedAppendTail> {
  if (!tail.includes('g2o-image://')) return { body: tail };
  if (!enableImageExport) return { body: stripTailImagePlaceholders(tail) };
  const imagePlan = await prepareAppendImagePlan(tail, images);
  return { body: imagePlan.body, imagePlan };
}

function supportedCreateOnlyServer(versions: ObsidianServerVersions): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(versions.self);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major > 5 || (major === 5 && minor >= 5);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function readAsset(
  client: AppendImageClient,
  path: string,
  expected: Uint8Array
): Promise<'missing' | 'identical' | 'different'> {
  let bytes: Uint8Array | null;
  try {
    bytes = await client.getBinaryFileBounded(path, MAX_IMAGE_SIZE_BYTES);
  } catch {
    fail('append-image-read-failed');
  }
  if (bytes === null) return 'missing';
  return sameBytes(bytes, expected) ? 'identical' : 'different';
}

function assetPath(
  settings: ExtensionSettings,
  templateVariables: Record<string, string>,
  fileName: string
): string {
  let imageRoot: string;
  try {
    imageRoot = resolvePathTemplate(settings.imageVaultPath, templateVariables);
  } catch {
    fail('append-image-path-invalid');
  }
  const path = [imageRoot, APPEND_IMAGE_NAMESPACE, fileName].filter(Boolean).join('/');
  if (!path || containsPathTraversal(path)) fail('append-image-path-invalid');
  return path;
}

/** Create/reuse every exact content-addressed asset before the note may change. */
export async function persistAppendImagePlan(
  client: AppendImageClient,
  settings: ExtensionSettings,
  templateVariables: Record<string, string>,
  plan: AppendImagePlan
): Promise<AppendImagePersistence> {
  if (plan.assets.length === 0) return Object.freeze({ created: 0, reused: 0 });

  let versions: ObsidianServerVersions;
  try {
    versions = await client.getServerVersions();
  } catch {
    fail('append-image-server-info-failed');
  }
  if (!supportedCreateOnlyServer(versions)) fail('append-image-server-unsupported');

  let created = 0;
  let reused = 0;
  for (const asset of plan.assets) {
    const path = assetPath(settings, templateVariables, asset.fileName);
    const existing = await readAsset(client, path, asset.bytes);
    if (existing === 'identical') {
      reused += 1;
      continue;
    }
    if (existing === 'different') fail('append-image-collision');

    try {
      await client.putBinaryFileIfAbsent(path, asset.bytes, asset.mediaType);
    } catch {
      let reconciled: Awaited<ReturnType<typeof readAsset>>;
      try {
        reconciled = await readAsset(client, path, asset.bytes);
      } catch {
        fail('append-image-write-unknown');
      }
      if (reconciled === 'identical') {
        reused += 1;
        continue;
      }
      fail('append-image-write-unknown');
    }

    let readBack: Awaited<ReturnType<typeof readAsset>>;
    try {
      readBack = await readAsset(client, path, asset.bytes);
    } catch {
      fail('append-image-readback-failed');
    }
    if (readBack !== 'identical') fail('append-image-readback-failed');
    created += 1;
  }
  return Object.freeze({ created, reused });
}

/**
 * Narrow an existing GET→PUT race without claiming external CAS. A failed PUT
 * is reconciled only when the exact expected note can be read back.
 */
export async function commitVerifiedAppendNote(
  client: AppendImageClient,
  path: string,
  verifiedBase: string,
  expectedContent: string
): Promise<void> {
  let current: string | null;
  try {
    current = await client.getFile(path);
  } catch {
    fail('append-note-changed-before-write');
  }
  if (current !== verifiedBase) fail('append-note-changed-before-write');

  try {
    await client.putFile(path, expectedContent);
  } catch {
    try {
      if ((await client.getFile(path)) === expectedContent) return;
    } catch {
      // Fixed unknown outcome below; never expose the underlying response.
    }
    fail('append-note-write-unknown');
  }

  try {
    if ((await client.getFile(path)) === expectedContent) return;
  } catch {
    // Fixed unknown outcome below.
  }
  fail('append-note-write-unknown');
}
