/**
 * Resolve `g2o-image://{id}` body placeholders per output destination.
 *
 * The content script emits destination-agnostic placeholders (`![alt](g2o-image://id)`);
 * each output handler resolves them here:
 * - Obsidian:  wikilink embed `![[filename]]` + binary files to write to the vault
 * - File:      filename-only markdown `![alt](filename)` + files to download
 * - Clipboard: placeholders stripped entirely
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { mimeToExtension } from './image-utils';
import type { ExtractedImage } from './types';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
  hasTrustedMessageBoundaries,
  neutralizeMessageBoundaryMarkers,
} from './message-counter';

/** A resolved image ready to be written (vault) or downloaded (file). */
export interface ResolvedImageFile {
  readonly fileName: string;
  readonly mimeType: string;
  /** Base64-encoded image bytes (no `data:` prefix). */
  readonly data: string;
}

/** Result of resolving image placeholders for a destination. */
export interface ImageResolution {
  readonly body: string;
  readonly files: ResolvedImageFile[];
}

/**
 * Matches one complete placeholder, including its Markdown-safety-neutralized
 * opener. Neutralized placeholders are removal-only, never trusted embeds.
 *
 * `$` and physical line separators cannot occur in either field. The content
 * writer entity-encodes punctuation in alt text, while generated IDs are
 * single-line tokens. Besides tightening the private grammar, this prevents a
 * match from spanning adjacent `$…$` / `$$…$$` math nodes and deleting their
 * delimiters as though they belonged to an image ID.
 */
const PLACEHOLDER_PATTERN = /(!\[|&#33;&#91;)([^\]$\r\n]*)\]\(g2o-image:\/\/([^)$\r\n]*)\)/g;
const EXACT_LITERAL_PLACEHOLDER_PATTERN = /^!\[[^\]$\r\n]*\]\(g2o-image:\/\/[^)$\r\n]*\)$/u;
const NEUTRALIZED_PLACEHOLDER_OPEN = '&#33;&#91;';
const LINE_PLACEHOLDER_PREFIX = /^(?:[ \t]*(?:\\?>[ \t]?|(?:[-+*]|\d{1,9}[.)])[ \t]+))*[ \t]*$/u;
const LINE_PLACEHOLDER_SUFFIX = /^[ \t]*$/u;
const PROTECTED_PLACEHOLDER_NODE_TYPES = new Set([
  'code',
  'definition',
  'html',
  'image',
  'imageReference',
  'inlineCode',
  'link',
  'linkReference',
]);
const MAX_PLACEHOLDER_PARSE_NODES = 200_000;

interface MarkdownNode {
  readonly type: string;
  readonly url?: string;
  readonly position?: {
    readonly start?: { readonly offset?: number };
    readonly end?: { readonly offset?: number };
  };
  readonly children?: readonly MarkdownNode[];
}

interface MarkdownRange {
  readonly start: number;
  readonly end: number;
}

interface ProtectedPlaceholderContext {
  readonly ranges: readonly MarkdownRange[];
  readonly parserFailed: boolean;
}

function markdownRange(node: MarkdownNode, bodyLength: number): MarkdownRange | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === 'number' &&
    typeof end === 'number' &&
    start >= 0 &&
    end > start &&
    end <= bodyLength
    ? { start, end }
    : null;
}

function protectedNodeRange(node: MarkdownNode, body: string): MarkdownRange | null {
  if (!PROTECTED_PLACEHOLDER_NODE_TYPES.has(node.type)) return null;
  const range = markdownRange(node, body.length);
  if (!range) return null;
  const ownPlaceholderImage =
    node.type === 'image' &&
    typeof node.url === 'string' &&
    /^g2o-image:\/\/[^)$\r\n]*$/u.test(node.url) &&
    EXACT_LITERAL_PLACEHOLDER_PATTERN.test(body.slice(range.start, range.end));
  return ownPlaceholderImage ? null : range;
}

function scheduleChildren(
  pending: MarkdownNode[],
  node: MarkdownNode,
  scheduled: number
): number | null {
  const children = node.children;
  if (!children) return scheduled;
  if (children.length > MAX_PLACEHOLDER_PARSE_NODES - scheduled) return null;
  for (const child of children) pending.push(child);
  return scheduled + children.length;
}

function protectedPlaceholderContext(body: string): ProtectedPlaceholderContext {
  try {
    const pending: MarkdownNode[] = [fromMarkdown(body) as MarkdownNode];
    const ranges: MarkdownRange[] = [];
    let scheduled = 1;
    while (pending.length > 0) {
      const node = pending.pop()!;
      const range = protectedNodeRange(node, body);
      if (range) ranges.push(range);
      const nextScheduled = scheduleChildren(pending, node, scheduled);
      if (nextScheduled === null) {
        return { ranges: [{ start: 0, end: body.length }], parserFailed: true };
      }
      scheduled = nextScheduled;
    }
    return { ranges, parserFailed: false };
  } catch {
    return { ranges: [{ start: 0, end: body.length }], parserFailed: true };
  }
}

function protectedPlaceholderRanges(body: string): readonly MarkdownRange[] {
  return protectedPlaceholderContext(body).ranges;
}

function overlapsProtectedRange(
  offset: number,
  length: number,
  ranges: readonly MarkdownRange[]
): boolean {
  const end = offset + length;
  return ranges.some(range => offset < range.end && end > range.start);
}

/**
 * Extension-authored image markers are emitted as their own Markdown line
 * (optionally under one or more blockquotes). Only that exact shape may be
 * removed. An anomalous inline marker stays literal so deletion cannot expose
 * a fence, join tokens into a new image/HTML tag, or otherwise change parser
 * context after the safety pass.
 */
function unresolvedPlaceholder(
  match: string,
  opener: string,
  offset: number,
  source: string,
  globalOffset: number,
  protectedRanges: readonly MarkdownRange[]
): string {
  const removed = source.slice(0, offset) + source.slice(offset + match.length);
  if (neutralizeMessageBoundaryMarkers(removed) !== removed) return '';

  if (overlapsProtectedRange(globalOffset, match.length, protectedRanges)) {
    return opener === '![' ? `${NEUTRALIZED_PLACEHOLDER_OPEN}${match.slice(2)}` : match;
  }

  const prefix = source.slice(0, offset);
  const suffix = source.slice(offset + match.length);
  if (LINE_PLACEHOLDER_PREFIX.test(prefix) && LINE_PLACEHOLDER_SUFFIX.test(suffix)) return '';
  return opener === '![' ? `${NEUTRALIZED_PLACEHOLDER_OPEN}${match.slice(2)}` : match;
}

/** Collapse 3+ consecutive newlines left behind by removed placeholders. */
function collapseBlankLines(body: string): string {
  return body.replace(/\n{3,}/g, '\n\n');
}

/**
 * Run a line-local image rewrite without letting removed/replaced private
 * placeholders compose into trusted append sentinels. Existing exact
 * extension-owned marker lines are preserved only for a declared v1 body.
 */
function rewriteImageLines(
  body: string,
  rewrite: (line: string, lineStart: number, protectedRanges: readonly MarkdownRange[]) => string,
  preserveTailMarkers = false
): string {
  const preserveTrustedMarkers = preserveTailMarkers || hasTrustedMessageBoundaries(body);
  const protectedRanges = protectedPlaceholderRanges(body);
  const rewritten: string[] = [];
  let lineStart = 0;
  for (const line of body.split('\n')) {
    const output =
      preserveTrustedMarkers &&
      (line === MESSAGE_BOUNDARY_FORMAT_MARKER || line === MESSAGE_BOUNDARY_MARKER)
        ? line
        : neutralizeMessageBoundaryMarkers(rewrite(line, lineStart, protectedRanges));
    rewritten.push(output);
    lineStart += line.length + 1;
  }
  return collapseBlankLines(rewritten.join('\n'));
}

function trustedTailOccurrence(
  match: string,
  opener: string,
  offset: number,
  source: string,
  globalOffset: number,
  protectedRanges: readonly MarkdownRange[]
): boolean {
  if (opener !== '![' || overlapsProtectedRange(globalOffset, match.length, protectedRanges)) {
    return false;
  }
  return (
    LINE_PLACEHOLDER_PREFIX.test(source.slice(0, offset)) &&
    LINE_PLACEHOLDER_SUFFIX.test(source.slice(offset + match.length))
  );
}

/** Exact active image ids authored as standalone placeholders in one trusted append tail. */
export function trustedTailImageIds(body: string): readonly string[] {
  return inspectTrustedTailImages(body).ids;
}

export interface TrustedTailImageInspection {
  readonly ids: readonly string[];
  readonly parserFailed: boolean;
}

/** Fail-closed parser evidence plus exact active ids for one trusted append tail. */
export function inspectTrustedTailImages(body: string): TrustedTailImageInspection {
  const context = protectedPlaceholderContext(body);
  const protectedRanges = context.ranges;
  const ids: string[] = [];
  let lineStart = 0;
  for (const line of body.split('\n')) {
    const pattern = new RegExp(PLACEHOLDER_PATTERN.source, PLACEHOLDER_PATTERN.flags);
    for (const match of line.matchAll(pattern)) {
      const offset = match.index ?? -1;
      if (
        offset >= 0 &&
        trustedTailOccurrence(
          match[0],
          match[1] ?? '',
          offset,
          line,
          lineStart + offset,
          protectedRanges
        )
      ) {
        ids.push(match[3] ?? '');
      }
    }
    lineStart += line.length + 1;
  }
  return { ids, parserFailed: context.parserFailed };
}

/**
 * Deterministic image filename: `{noteBaseName}-img-{n}.{ext}` (n is 1-based).
 * Stable across re-saves so overwrites are idempotent.
 */
export function imageFileName(noteBaseName: string, image: ExtractedImage, index: number): string {
  const ext = mimeToExtension(image.mimeType);
  return `${noteBaseName}-img-${index + 1}.${ext}`;
}

/** Remove expected line-isolated placeholders; keep anomalous inline forms inert. */
export function stripImagePlaceholders(body: string): string {
  return rewriteImageLines(body, (line, lineStart, protectedRanges) =>
    line.replace(
      PLACEHOLDER_PATTERN,
      (match, opener: string, _alt, _id, offset: number, source: string) =>
        unresolvedPlaceholder(match, opener, offset, source, lineStart + offset, protectedRanges)
    )
  );
}

/** Remove placeholders from one trusted append tail while preserving its real message markers. */
export function stripTailImagePlaceholders(body: string): string {
  return rewriteImageLines(
    body,
    (line, lineStart, protectedRanges) =>
      line.replace(
        PLACEHOLDER_PATTERN,
        (match, opener: string, _alt, _id, offset: number, source: string) =>
          unresolvedPlaceholder(match, opener, offset, source, lineStart + offset, protectedRanges)
      ),
    true
  );
}

/**
 * Shared resolver: replace each placeholder using `render`, collecting the
 * file for every matched image. Missing and neutralized placeholders are
 * removed only in their extension-authored line-isolated shape; anomalous
 * inline forms stay literal instead of changing Markdown parser context.
 */
interface ImageResolveOptions {
  readonly trustedTail?: boolean;
  readonly fileNamesById?: ReadonlyMap<string, string>;
}

interface ImageResolveEntry {
  readonly image: ExtractedImage;
  readonly index: number;
}

interface ImageResolveContext {
  readonly byId: ReadonlyMap<string, ImageResolveEntry>;
  readonly files: ResolvedImageFile[];
  readonly emitted: Set<string>;
  readonly noteBaseName: string;
  readonly render: (fileName: string, alt: string) => string;
  readonly options: ImageResolveOptions;
}

function resolvePlaceholder(
  context: ImageResolveContext,
  protectedRanges: readonly MarkdownRange[],
  lineStart: number,
  match: string,
  opener: string,
  alt: string,
  id: string,
  offset: number,
  source: string
): string {
  const globalOffset = lineStart + offset;
  const fallback = () =>
    unresolvedPlaceholder(match, opener, offset, source, globalOffset, protectedRanges);
  if (
    opener !== '![' ||
    overlapsProtectedRange(globalOffset, match.length, protectedRanges) ||
    (context.options.trustedTail &&
      !trustedTailOccurrence(match, opener, offset, source, globalOffset, protectedRanges))
  ) {
    return fallback();
  }
  const entry = context.byId.get(id);
  if (!entry) return fallback();
  const fileName = context.options.fileNamesById
    ? context.options.fileNamesById.get(id)
    : imageFileName(context.noteBaseName, entry.image, entry.index);
  if (!fileName) return fallback();
  if (!context.emitted.has(id)) {
    context.emitted.add(id);
    context.files.push({ fileName, mimeType: entry.image.mimeType, data: entry.image.data });
  }
  return context.render(fileName, alt);
}

function resolve(
  body: string,
  images: readonly ExtractedImage[],
  noteBaseName: string,
  render: (fileName: string, alt: string) => string,
  options: ImageResolveOptions = {}
): ImageResolution {
  const byId = new Map(images.map((image, index) => [image.id, { image, index }]));
  const files: ResolvedImageFile[] = [];
  const emitted = new Set<string>();
  const context = { byId, files, emitted, noteBaseName, render, options };

  const resolvedBody = rewriteImageLines(
    body,
    (line, lineStart, protectedRanges) =>
      line.replace(
        PLACEHOLDER_PATTERN,
        (match, opener: string, alt: string, id: string, offset: number, source: string) =>
          resolvePlaceholder(
            context,
            protectedRanges,
            lineStart,
            match,
            opener,
            alt,
            id,
            offset,
            source
          )
      ),
    options.trustedTail
  );

  return { body: resolvedBody, files };
}

/**
 * Obsidian: replace placeholders with wikilink embeds `![[filename]]`.
 * Obsidian resolves attachments by name, so the link needs no folder path.
 */
export function resolveImagesForObsidian(
  body: string,
  images: readonly ExtractedImage[],
  noteBaseName: string
): ImageResolution {
  return resolve(body, images, noteBaseName, fileName => `![[${fileName}]]`);
}

/** Resolve only standalone active placeholders from one already-verified append tail. */
export function resolveImagesForObsidianTail(
  body: string,
  images: readonly ExtractedImage[],
  fileNamesById: ReadonlyMap<string, string>
): ImageResolution {
  return resolve(body, images, '', fileName => `![[${fileName}]]`, {
    trustedTail: true,
    fileNamesById,
  });
}

/**
 * File download: replace placeholders with filename-only markdown links.
 */
export function resolveImagesForFile(
  body: string,
  images: readonly ExtractedImage[],
  noteBaseName: string
): ImageResolution {
  return resolve(body, images, noteBaseName, (fileName, alt) => `![${alt}](${fileName})`);
}
