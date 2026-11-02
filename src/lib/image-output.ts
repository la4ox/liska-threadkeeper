/**
 * Resolve `g2o-image://{id}` body placeholders per output destination.
 *
 * The content script emits destination-agnostic placeholders (`![alt](g2o-image://id)`);
 * callers supply explicit asset destinations rather than deriving filenames:
 * - Append: confirmed immutable-asset wikilinks `![[filename]]`
 * - Ordinary Obsidian/File: standard Markdown to confirmed vault/relative paths
 * - Clipboard: placeholders stripped entirely
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { ExtractedImage } from './types';
import {
  MARKDOWN_WORK_LIMITS,
  MarkdownChunks,
  MarkdownWorkBudget,
  markdownLines,
} from './markdown-work-budget';
import {
  MESSAGE_BOUNDARY_FORMAT_MARKER,
  MESSAGE_BOUNDARY_MARKER,
  neutralizeMessageBoundaryMarkers,
} from './message-counter';

/** A referenced image with an explicit destination supplied by its caller. */
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
const EXACT_LITERAL_PLACEHOLDER_PATTERN = /^!\[[^\]$\r\n]*\]\(g2o-image:\/\/[^)$\r\n]*\)$/u;
const NEUTRALIZED_PLACEHOLDER_OPEN = '&#33;&#91;';
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

function protectedNodeRange(
  node: MarkdownNode,
  body: string,
  budget: MarkdownWorkBudget
): MarkdownRange | null {
  if (!PROTECTED_PLACEHOLDER_NODE_TYPES.has(node.type)) return null;
  const range = markdownRange(node, body.length);
  if (!range) return null;
  budget.scan(range.end - range.start + (node.url?.length ?? 0));
  const ownPlaceholderImage =
    node.type === 'image' &&
    typeof node.url === 'string' &&
    /^g2o-image:\/\/[^)$\r\n]*$/u.test(node.url) &&
    EXACT_LITERAL_PLACEHOLDER_PATTERN.test(body.slice(range.start, range.end));
  return ownPlaceholderImage ? null : range;
}

function protectedPlaceholderContext(body: string): ProtectedPlaceholderContext {
  try {
    const budget = new MarkdownWorkBudget();
    budget.admitParse(body);
    const tree = fromMarkdown(body) as MarkdownNode;
    const ranges: MarkdownRange[] = [];
    for (const node of budget.walk(tree, node => node.children ?? [])) {
      const range = protectedNodeRange(node, body, budget);
      if (range) ranges.push(range);
    }
    return { ranges: mergeProtectedRanges(ranges), parserFailed: false };
  } catch {
    return { ranges: [{ start: 0, end: body.length }], parserFailed: true };
  }
}

function mergeProtectedRanges(ranges: readonly MarkdownRange[]): MarkdownRange[] {
  const ordered = [...ranges].sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const merged: MarkdownRange[] = [];
  for (const range of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, range.end) };
    } else merged.push(range);
  }
  return merged;
}

function overlapsProtectedRange(
  offset: number,
  length: number,
  ranges: readonly MarkdownRange[]
): boolean {
  const end = offset + length;
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ranges[middle].end <= offset) low = middle + 1;
    else high = middle;
  }
  return length > 0 && low < ranges.length && ranges[low].start < end;
}

interface PlaceholderOccurrence {
  readonly offset: number;
  readonly end: number;
  readonly match: string;
  readonly opener: string;
  readonly alt: string;
  readonly id: string;
}

interface PlaceholderSpan {
  readonly offset: number;
  readonly end: number;
  readonly opener: string;
  readonly altStart: number;
  readonly altEnd: number;
  readonly idStart: number;
}

interface PlaceholderScan {
  readonly count: number;
  readonly only: PlaceholderSpan | null;
  readonly inspections: number;
}

function materializePlaceholder(source: string, span: PlaceholderSpan): PlaceholderOccurrence {
  return {
    offset: span.offset,
    end: span.end,
    opener: span.opener,
    match: source.slice(span.offset, span.end),
    alt: source.slice(span.altStart, span.altEnd),
    id: source.slice(span.idStart, span.end - 1),
  };
}

/**
 * Forward-only private-grammar scanner. Failed alt candidates sharing the same
 * first `]` cannot succeed; failed ids sharing a barrier cannot succeed either.
 * Discard those runs, never restart at each nested `![` as a global regex does.
 */
function scanPlaceholders(
  source: string,
  visit?: (span: PlaceholderSpan) => void
): PlaceholderScan {
  let count = 0;
  let only: PlaceholderSpan | null = null;
  let inspections = 0;
  const characterAt = (index: number): string | undefined => {
    inspections += 1;
    return source[index];
  };
  const matchesAt = (token: string, index: number): boolean => {
    for (let part = 0; part < token.length; part += 1) {
      if (characterAt(index + part) !== token[part]) return false;
    }
    return true;
  };
  let cursor = 0;
  while (cursor < source.length) {
    const first = characterAt(cursor);
    const opener =
      first === '!' && matchesAt('![', cursor)
        ? '!['
        : first === '&' && matchesAt(NEUTRALIZED_PLACEHOLDER_OPEN, cursor)
          ? NEUTRALIZED_PLACEHOLDER_OPEN
          : null;
    if (!opener) {
      cursor += 1;
      continue;
    }
    const offset = cursor;
    const altStart = (cursor += opener.length);
    let character: string | undefined;
    while (cursor < source.length) {
      character = characterAt(cursor);
      if (character === ']' || character === '$' || character === '\r' || character === '\n') break;
      cursor += 1;
    }
    if (character !== ']' || !matchesAt('](g2o-image://', cursor)) {
      cursor += 1;
      continue;
    }
    const altEnd = cursor;
    const idStart = (cursor += '](g2o-image://'.length);
    while (cursor < source.length) {
      character = characterAt(cursor);
      if (character === ')' || character === '$' || character === '\r' || character === '\n') break;
      cursor += 1;
    }
    if (character === ')') {
      cursor += 1;
      const span: PlaceholderSpan = {
        offset,
        end: cursor,
        opener,
        altStart,
        altEnd,
        idStart,
      };
      count += 1;
      only = count === 1 ? span : null;
      visit?.(span);
    } else cursor += 1;
  }
  return { count, only, inspections };
}

/** Linear equivalent of the producer's whitespace/blockquote/list prefix grammar. */
function standalonePrefix(prefix: string): boolean {
  let cursor = 0;
  const whitespace = (character: string | undefined): boolean =>
    character === ' ' || character === '\t';
  while (cursor < prefix.length) {
    while (whitespace(prefix[cursor])) cursor += 1;
    if (cursor === prefix.length) return true;
    if (prefix[cursor] === '\\' && prefix[cursor + 1] === '>') cursor += 1;
    if (prefix[cursor] === '>') {
      cursor += 1;
      continue;
    }
    if ('-+*'.includes(prefix[cursor])) cursor += 1;
    else {
      const start = cursor;
      while (cursor - start < 9 && prefix[cursor] >= '0' && prefix[cursor] <= '9') cursor += 1;
      if (cursor === start || (prefix[cursor] !== '.' && prefix[cursor] !== ')')) return false;
      cursor += 1;
    }
    if (!whitespace(prefix[cursor])) return false;
  }
  return true;
}

interface PlaceholderLine {
  readonly source: string;
  readonly lineStart: number;
  readonly standalone: boolean;
  readonly firstBoundaryEnd: number;
  readonly lastBoundaryStart: number;
  readonly protectedRanges: readonly MarkdownRange[];
}

function placeholderLine(
  source: string,
  lineStart: number,
  scan: PlaceholderScan,
  protectedRanges: readonly MarkdownRange[]
): PlaceholderLine {
  const only = scan.only;
  let firstBoundaryEnd = Infinity;
  let lastBoundaryStart = -1;
  for (const marker of [MESSAGE_BOUNDARY_FORMAT_MARKER, MESSAGE_BOUNDARY_MARKER]) {
    const first = source.indexOf(marker);
    if (first >= 0) firstBoundaryEnd = Math.min(firstBoundaryEnd, first + marker.length);
    lastBoundaryStart = Math.max(lastBoundaryStart, source.lastIndexOf(marker));
  }
  return {
    source,
    lineStart,
    protectedRanges,
    standalone:
      only !== null &&
      standalonePrefix(source.slice(0, only.offset)) &&
      LINE_PLACEHOLDER_SUFFIX.test(source.slice(only.end)),
    firstBoundaryEnd,
    lastBoundaryStart,
  };
}

function removalRevealsBoundary(occurrence: PlaceholderOccurrence, line: PlaceholderLine): boolean {
  // Only an exact marker entirely OUTSIDE the removed span survives removal.
  // A marker inside a protected placeholder's alt must not authorize deletion
  // of that placeholder and expose an adjacent closing fence.
  if (line.firstBoundaryEnd <= occurrence.offset || line.lastBoundaryStart >= occurrence.end)
    return true;
  const radius = MESSAGE_BOUNDARY_FORMAT_MARKER.length;
  const seam =
    line.source.slice(Math.max(0, occurrence.offset - radius), occurrence.offset) +
    line.source.slice(occurrence.end, occurrence.end + radius);
  return seam.includes(MESSAGE_BOUNDARY_MARKER) || seam.includes(MESSAGE_BOUNDARY_FORMAT_MARKER);
}

/** @internal Narrow deterministic work/interval seam; not part of output contracts. */
export const imagePlaceholderInternals = {
  scan: (source: string): { occurrences: PlaceholderOccurrence[]; inspections: number } => {
    const occurrences: PlaceholderOccurrence[] = [];
    const scan = scanPlaceholders(source, span => {
      if (occurrences.length >= MARKDOWN_WORK_LIMITS.edits)
        throw new Error('Scanner test capture limit exceeded.');
      occurrences.push(materializePlaceholder(source, span));
    });
    return { occurrences, inspections: scan.inspections };
  },
  visit: scanPlaceholders,
  merge: mergeProtectedRanges,
  overlaps: overlapsProtectedRange,
};

function declaresTrustedMessageBoundaries(body: string): boolean {
  for (const { text } of markdownLines(body)) {
    if (text.trim() !== '') return text === MESSAGE_BOUNDARY_FORMAT_MARKER;
  }
  return false;
}

/**
 * Extension-authored image markers are emitted as their own Markdown line
 * (optionally under one or more blockquotes). Only that exact shape may be
 * removed. An anomalous inline marker stays literal so deletion cannot expose
 * a fence, join tokens into a new image/HTML tag, or otherwise change parser
 * context after the safety pass.
 */
function unresolvedPlaceholder(occurrence: PlaceholderOccurrence, line: PlaceholderLine): string {
  const { match, opener } = occurrence;
  if (removalRevealsBoundary(occurrence, line)) return '';

  if (
    overlapsProtectedRange(line.lineStart + occurrence.offset, match.length, line.protectedRanges)
  ) {
    return opener === '![' ? `${NEUTRALIZED_PLACEHOLDER_OPEN}${match.slice(2)}` : match;
  }

  if (line.standalone) return '';
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
  rewrite: (occurrence: PlaceholderOccurrence, line: PlaceholderLine) => string,
  preserveTailMarkers = false
): string {
  const preserveTrustedMarkers = preserveTailMarkers || declaresTrustedMessageBoundaries(body);
  const protectedRanges = protectedPlaceholderContext(body).ranges;
  const rewritten = new MarkdownChunks();
  for (const { text: line, start: lineStart } of markdownLines(body)) {
    let output = line;
    if (
      !(
        preserveTrustedMarkers &&
        (line === MESSAGE_BOUNDARY_FORMAT_MARKER || line === MESSAGE_BOUNDARY_MARKER)
      )
    ) {
      // Count first, then stream one occurrence at a time. Even parser-failed
      // 32 MiB lines never retain a full occurrence or substring array.
      const scan = scanPlaceholders(line);
      const context = placeholderLine(line, lineStart, scan, protectedRanges);
      const chunks = new MarkdownChunks();
      let cursor = 0;
      scanPlaceholders(line, span => {
        chunks.append(line.slice(cursor, span.offset));
        chunks.append(rewrite(materializePlaceholder(line, span), context));
        cursor = span.end;
      });
      chunks.append(line.slice(cursor));
      output = neutralizeMessageBoundaryMarkers(chunks.toString());
    }
    if (lineStart > 0) rewritten.append('\n');
    rewritten.append(output);
  }
  return collapseBlankLines(rewritten.toString());
}

function trustedTailOccurrence(occurrence: PlaceholderOccurrence, line: PlaceholderLine): boolean {
  return (
    occurrence.opener === '![' &&
    line.standalone &&
    !overlapsProtectedRange(
      line.lineStart + occurrence.offset,
      occurrence.match.length,
      line.protectedRanges
    )
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
  return inspectImagePlaceholders(body, true);
}

/** Active ordinary placeholders, using the same protected-Markdown parser as rewriting. */
export function inspectImagePlaceholders(
  body: string,
  trustedTail = false
): TrustedTailImageInspection {
  const context = protectedPlaceholderContext(body);
  if (context.parserFailed) return { ids: [], parserFailed: true };
  const protectedRanges = context.ranges;
  const ids: string[] = [];
  for (const { text: line, start: lineStart } of markdownLines(body)) {
    const scan = scanPlaceholders(line);
    const lineContext = placeholderLine(line, lineStart, scan, protectedRanges);
    scanPlaceholders(line, span => {
      const occurrence = materializePlaceholder(line, span);
      if (
        occurrence.opener === '![' &&
        !overlapsProtectedRange(
          lineStart + occurrence.offset,
          occurrence.match.length,
          protectedRanges
        ) &&
        (!trustedTail || trustedTailOccurrence(occurrence, lineContext))
      ) {
        ids.push(occurrence.id);
      }
    });
  }
  return { ids, parserFailed: context.parserFailed };
}

/** Remove expected line-isolated placeholders; keep anomalous inline forms inert. */
export function stripImagePlaceholders(body: string): string {
  return rewriteImageLines(body, unresolvedPlaceholder);
}

/** Remove placeholders from one trusted append tail while preserving its real message markers. */
export function stripTailImagePlaceholders(body: string): string {
  return rewriteImageLines(body, unresolvedPlaceholder, true);
}

/**
 * Shared resolver: replace each placeholder using `render`, collecting the
 * file for every matched image. Missing and neutralized placeholders are
 * removed only in their extension-authored line-isolated shape; anomalous
 * inline forms stay literal instead of changing Markdown parser context.
 */
interface ImageResolveOptions {
  readonly trustedTail?: boolean;
  readonly fileNamesById: ReadonlyMap<string, string>;
}

interface ImageResolveContext {
  readonly byId: ReadonlyMap<string, ExtractedImage>;
  readonly files: ResolvedImageFile[];
  readonly emitted: Set<string>;
  readonly render: (fileName: string, alt: string) => string;
  readonly options: ImageResolveOptions;
}

function resolvePlaceholder(
  context: ImageResolveContext,
  occurrence: PlaceholderOccurrence,
  line: PlaceholderLine
): string {
  const { opener, match, alt, id } = occurrence;
  const globalOffset = line.lineStart + occurrence.offset;
  const fallback = () => unresolvedPlaceholder(occurrence, line);
  if (
    opener !== '![' ||
    overlapsProtectedRange(globalOffset, match.length, line.protectedRanges) ||
    (context.options.trustedTail && !trustedTailOccurrence(occurrence, line))
  ) {
    return fallback();
  }
  const image = context.byId.get(id);
  if (!image) return fallback();
  const fileName = context.options.fileNamesById.get(id);
  if (!fileName) return fallback();
  if (!context.emitted.has(id)) {
    context.emitted.add(id);
    context.files.push({ fileName, mimeType: image.mimeType, data: image.data });
  }
  return context.render(fileName, alt);
}

function resolve(
  body: string,
  images: readonly ExtractedImage[],
  render: (fileName: string, alt: string) => string,
  options: ImageResolveOptions
): ImageResolution {
  const byId = new Map(images.map(image => [image.id, image]));
  const files: ResolvedImageFile[] = [];
  const emitted = new Set<string>();
  const context = { byId, files, emitted, render, options };

  const resolvedBody = rewriteImageLines(
    body,
    (occurrence, line) => resolvePlaceholder(context, occurrence, line),
    options.trustedTail
  );

  return { body: resolvedBody, files };
}

/** Resolve only standalone active placeholders from one already-verified append tail. */
export function resolveImagesForObsidianTail(
  body: string,
  images: readonly ExtractedImage[],
  fileNamesById: ReadonlyMap<string, string>
): ImageResolution {
  return resolve(body, images, fileName => `![[${fileName}]]`, {
    trustedTail: true,
    fileNamesById,
  });
}

/**
 * Render only confirmed destinations. Full Obsidian folder paths start at the
 * vault root; File paths are relative to the downloaded Markdown. Encode every
 * segment so folder punctuation cannot become a title, heading, alias or URL.
 */
export function resolveImagesToConfirmedPaths(
  body: string,
  images: readonly ExtractedImage[],
  pathsById: ReadonlyMap<string, string>
): ImageResolution {
  return resolve(
    body,
    images,
    (path, alt) => {
      const destination = path
        .split('/')
        .map(segment =>
          encodeURIComponent(segment).replace(
            /[!'()*]/g,
            char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
          )
        )
        .join('/');
      return `![${alt}](<${destination}>)`;
    },
    { fileNamesById: pathsById }
  );
}
