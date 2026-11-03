import type { ObsidianApiClient, ObsidianServerVersions } from '../lib/obsidian-api';
import { MAX_IMAGE_SIZE_BYTES } from '../lib/image-utils';
import {
  IMMUTABLE_IMAGE_NAMESPACE,
  ImmutableImageError,
  planImmutableImageAssets,
  sameImageBytes,
  supportsImmutableImageWrites,
  type ImmutableImageAsset,
} from '../lib/immutable-image-assets';
import {
  inspectTrustedTailImages,
  resolveImagesForObsidianTail,
  stripTailImagePlaceholders,
} from '../lib/image-output';
import { containsPathTraversal, resolvePathTemplate } from '../lib/path-utils';
import type { ExtensionSettings, ExtractedImage } from '../lib/types';
import { flattenLargeCallouts } from '../lib/callout-flatten';
import {
  finalizeAppendReadingMarkdown,
  type FinalMarkdownMarkerRange,
} from '../lib/final-markdown-gate';
import { MESSAGE_BOUNDARY_FORMAT_MARKER, MESSAGE_BOUNDARY_MARKER } from '../lib/message-counter';
import { AppendBoundaryError } from '../lib/append-utils';
import {
  assertNoTaggedCodeBlocksBeforeOffset,
  InertCodeBlocksError,
  makeTaggedCodeBlocksInert,
} from '../lib/inert-code-blocks';

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

export interface AppendImagePlan {
  readonly body: string;
  readonly assets: readonly ImmutableImageAsset[];
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
  try {
    if (appendResult.diagnosticsOnly) {
      if (settings.enableInertCodeBlocks) {
        assertNoTaggedCodeBlocksBeforeOffset(
          appendResult.existingBody,
          appendResult.existingBody.length
        );
      }
      return { ok: true as const, content: appendResult.content };
    }
    const transformedTail = settings.flattenLargeCallouts
      ? flattenLargeCallouts(newMessages, settings.maxCalloutLines)
      : newMessages;
    const prefix = `${appendResult.existingBody}\n\n`;
    if (settings.enableInertCodeBlocks) {
      assertNoTaggedCodeBlocksBeforeOffset(prefix + transformedTail, prefix.length);
    }
    const tail = settings.enableInertCodeBlocks
      ? makeTaggedCodeBlocksInert(transformedTail)
      : transformedTail;
    const finalized = finalizeAppendReadingMarkdown(prefix + tail, {
      appendFrom: prefix.length,
      requiredMarkerRanges: appendMarkerRanges(tail, prefix.length, appendResult.messagesAppended),
    });
    return finalized.ok
      ? { ok: true as const, content: `${appendResult.updatedFrontmatter}\n${finalized.body}` }
      : finalized;
  } catch (error) {
    if (error instanceof InertCodeBlocksError) return { ok: false as const, code: error.code };
    throw error;
  }
}

function validateResolvedAssetNames(
  resolved: ReturnType<typeof resolveImagesForObsidianTail>,
  assetsByFileName: ReadonlyMap<string, ImmutableImageAsset>
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
  let planned: Awaited<ReturnType<typeof planImmutableImageAssets>>;
  try {
    planned = await planImmutableImageAssets(required, images);
  } catch (error) {
    if (error instanceof ImmutableImageError) fail(`append-image-${error.code}`);
    throw error;
  }
  const { assetsByFileName, names, selected } = planned;
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
  return sameImageBytes(bytes, expected) ? 'identical' : 'different';
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
  const path = [imageRoot, IMMUTABLE_IMAGE_NAMESPACE, fileName].filter(Boolean).join('/');
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
  if (!supportsImmutableImageWrites(versions.self)) fail('append-image-server-unsupported');

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
