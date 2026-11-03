/**
 * Reading-view transform for provider-originated fenced code blocks.
 *
 * CommonMark fenced code nodes with a non-empty info string are wrapped in a
 * collision-safe, unlabelled outer fence. A second, deliberately conservative
 * physical-source invariant then refuses any language-tagged fence-shaped run
 * that remains outside source-justified literal fenced-code ranges.
 * Raw/canonical archives and canonical-derived HTML do not call this helper.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Node } from 'unist';
import { utf8ByteLength } from './byte-size';
import { MAX_CONTENT_SIZE } from './constants';
import { MarkdownChunks, MarkdownWorkBudget } from './markdown-work-budget';

export const INERT_CODE_BLOCKS_FAILURE_CODE = 'inert-code-block-finalization-failed' as const;

export class InertCodeBlocksError extends Error {
  readonly code = INERT_CODE_BLOCKS_FAILURE_CODE;

  constructor() {
    super(INERT_CODE_BLOCKS_FAILURE_CODE);
    this.name = 'InertCodeBlocksError';
  }
}

interface MarkdownNode extends Node {
  readonly lang?: string | null;
  readonly children?: readonly MarkdownNode[];
}

interface SourceRange {
  readonly start: number;
  readonly end: number;
}

interface Edit extends SourceRange {
  readonly replacement: string;
}

interface MarkdownAnalysis {
  readonly tagged: readonly SourceRange[];
  readonly protected: readonly SourceRange[];
}

/** @internal Dependency seam for deterministic parser/output failure tests. */
export interface InertCodeBlocksOptions {
  readonly parse?: typeof fromMarkdown;
  readonly maxOutputBytes?: number;
}

function fail(): never {
  throw new InertCodeBlocksError();
}

function utf16Boundary(source: string, offset: number): boolean {
  const prior = source.charCodeAt(offset - 1);
  const next = source.charCodeAt(offset);
  return !(prior >= 0xd800 && prior <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}

function positionedRange(node: MarkdownNode, source: string): SourceRange {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > source.length ||
    !utf16Boundary(source, start) ||
    !utf16Boundary(source, end)
  ) {
    fail();
  }
  return { start, end };
}

function childrenOf(node: MarkdownNode): readonly MarkdownNode[] {
  if (node.children === undefined) return [];
  if (!Array.isArray(node.children)) fail();
  return node.children;
}

function parseMarkdown(
  source: string,
  budget: MarkdownWorkBudget,
  parse: typeof fromMarkdown
): MarkdownNode {
  budget.admitParse(source);
  const tree = parse(source) as MarkdownNode;
  if (!tree || typeof tree !== 'object' || tree.type !== 'root') fail();
  const root = positionedRange(tree, source);
  if (root.start !== 0 || root.end !== source.length) fail();
  return tree;
}

function fenceRunLength(source: string, start: number): number {
  const marker = source.charCodeAt(start);
  if (marker !== 96 && marker !== 126) return 0;
  let end = start + 1;
  while (source.charCodeAt(end) === marker) end += 1;
  return end - start;
}

/** Only a source-visible fence, not an indented code node, is literal authority. */
function fencedCodeRange(source: string, range: SourceRange): boolean {
  return fenceRunLength(source, range.start) >= 3;
}

function analyzeMarkdown(
  source: string,
  budget: MarkdownWorkBudget,
  parse: typeof fromMarkdown
): MarkdownAnalysis {
  const root = parseMarkdown(source, budget, parse);
  const tagged: SourceRange[] = [];
  const protectedRanges: SourceRange[] = [];
  for (const node of budget.walk(root, childrenOf)) {
    const range = positionedRange(node, source);
    if (node.type === 'code' && typeof node.lang === 'string' && node.lang.length > 0) {
      tagged.push(range);
    }
    if (node.type === 'code' && fencedCodeRange(source, range)) {
      protectedRanges.push(range);
    }
  }
  return {
    tagged,
    protected: protectedRanges.sort((left, right) => left.start - right.start),
  };
}

function protectedOffset(ranges: readonly SourceRange[], offset: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (offset < range.start) high = middle - 1;
    else if (offset >= range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function physicalLineEnd(source: string, start: number): number {
  let end = start;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code === 10 || code === 13) break;
    end += 1;
  }
  return end;
}

function lastNonWhitespace(source: string, start: number, end: number): number {
  for (let index = end - 1; index >= start; index -= 1) {
    if (source[index].trim() !== '') return index;
  }
  return -1;
}

/**
 * Find physical tagged-fence candidates at any column. Runs and suffixes are
 * examined once; CR, LF, and CRLF all terminate the same physical line.
 */
function residualTaggedFenceCandidates(
  source: string,
  protectedRanges: readonly SourceRange[],
  budget: MarkdownWorkBudget
): SourceRange[] {
  budget.scan(source.length);
  const candidates: SourceRange[] = [];
  let lineStart = 0;
  while (lineStart < source.length) {
    const lineEnd = physicalLineEnd(source, lineStart);
    const lastContent = lastNonWhitespace(source, lineStart, lineEnd);
    let index = lineStart;
    while (index < lineEnd) {
      const run = fenceRunLength(source, index);
      if (run < 3) {
        index += Math.max(1, run);
        continue;
      }
      const suffixStart = index + run;
      if (!protectedOffset(protectedRanges, index) && lastContent >= suffixStart) {
        candidates.push({ start: index, end: lineEnd });
      }
      index = suffixStart;
    }
    lineStart = lineEnd;
    if (source.charCodeAt(lineStart) === 13) lineStart += 1;
    if (source.charCodeAt(lineStart) === 10) lineStart += 1;
  }
  return candidates;
}

function lineStart(source: string, offset: number): number {
  for (let index = offset - 1; index >= 0; index -= 1) {
    const code = source.charCodeAt(index);
    if (code === 10 || code === 13) return index + 1;
  }
  return 0;
}

/** Turn list markers into indentation while retaining blockquote containers. */
function continuationPrefix(source: string, start: number): string {
  const prefix = source.slice(lineStart(source, start), start);
  let result = '';
  for (let index = 0; index < prefix.length; index += 1) {
    const char = prefix[index];
    result += char === '>' || char === ' ' || char === '\t' ? char : ' ';
  }
  return result;
}

function openingLineEnding(source: string, start: number, end: number): string {
  for (let index = start; index < end; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 10) return '\n';
    if (code === 13) return source.charCodeAt(index + 1) === 10 ? '\r\n' : '\r';
  }
  return '\n';
}

function longestRun(source: string, start: number, end: number, target: number): number {
  let longest = 0;
  let current = 0;
  for (let index = start; index < end; index += 1) {
    if (source.charCodeAt(index) === target) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

function collisionSafeFence(
  source: string,
  range: SourceRange,
  budget: MarkdownWorkBudget
): string {
  budget.scan(range.end - range.start);
  const backticks = Math.max(3, longestRun(source, range.start, range.end, 96) + 1);
  const tildes = Math.max(3, longestRun(source, range.start, range.end, 126) + 1);
  return backticks <= tildes ? '`'.repeat(backticks) : '~'.repeat(tildes);
}

function editForTaggedCode(source: string, range: SourceRange, budget: MarkdownWorkBudget): Edit {
  if (fenceRunLength(source, range.start) < 3) fail();
  const prefix = continuationPrefix(source, range.start);
  const eol = openingLineEnding(source, range.start, range.end);
  const original = source.slice(range.start, range.end);
  const fence = collisionSafeFence(source, range, budget);
  const needsClosingLineBreak = !original.endsWith('\n') && !original.endsWith('\r');
  budget.newEdit();
  return {
    ...range,
    replacement: `${fence}${eol}${prefix}${original}${needsClosingLineBreak ? eol : ''}${prefix}${fence}`,
  };
}

function applyEdits(source: string, edits: readonly Edit[]): string {
  const chunks = new MarkdownChunks();
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start < cursor || edit.end < edit.start) fail();
    chunks.append(source.slice(cursor, edit.start));
    chunks.append(edit.replacement);
    cursor = edit.end;
  }
  chunks.append(source.slice(cursor));
  return chunks.toString();
}

function admittedOutputLimit(options: InertCodeBlocksOptions): number {
  const value = options.maxOutputBytes ?? MAX_CONTENT_SIZE;
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_CONTENT_SIZE ? value : fail();
}

function admitSource(source: string, maxOutputBytes: number): void {
  if (
    typeof source !== 'string' ||
    source.length > MAX_CONTENT_SIZE ||
    utf8ByteLength(source) > maxOutputBytes
  ) {
    fail();
  }
}

/**
 * Wrap CommonMark tagged fences, then admit only output with no physical
 * language-tagged fence candidate outside literal fenced-code ranges.
 */
export function makeTaggedCodeBlocksInert(
  source: string,
  options: InertCodeBlocksOptions = {}
): string {
  try {
    const maxOutputBytes = admittedOutputLimit(options);
    admitSource(source, maxOutputBytes);
    const parse = options.parse ?? fromMarkdown;
    const budget = new MarkdownWorkBudget();
    if (residualTaggedFenceCandidates(source, [], budget).length === 0) return source;
    const analysis = analyzeMarkdown(source, budget, parse);
    const edits = analysis.tagged
      .map(range => editForTaggedCode(source, range, budget))
      .sort((left, right) => left.start - right.start);
    const output = applyEdits(source, edits);
    if (utf8ByteLength(output) > maxOutputBytes) fail();
    const outputAnalysis = analyzeMarkdown(output, budget, parse);
    if (
      outputAnalysis.tagged.length !== 0 ||
      residualTaggedFenceCandidates(output, outputAnalysis.protected, budget).length !== 0
    ) {
      fail();
    }
    return output;
  } catch (error) {
    if (error instanceof InertCodeBlocksError) throw error;
    fail();
  }
}

/** Refuse any old tagged node or residual physical candidate before the seam. */
export function assertNoTaggedCodeBlocksBeforeOffset(
  source: string,
  offset: number,
  options: InertCodeBlocksOptions = {}
): void {
  try {
    const maxOutputBytes = admittedOutputLimit(options);
    admitSource(source, maxOutputBytes);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > source.length ||
      !utf16Boundary(source, offset)
    ) {
      fail();
    }
    const budget = new MarkdownWorkBudget();
    if (
      !residualTaggedFenceCandidates(source, [], budget).some(candidate => candidate.start < offset)
    ) {
      return;
    }
    const parse = options.parse ?? fromMarkdown;
    const analysis = analyzeMarkdown(source, budget, parse);
    if (analysis.tagged.some(range => range.start < offset)) fail();
    if (
      residualTaggedFenceCandidates(source, analysis.protected, budget).some(
        candidate => candidate.start < offset
      )
    ) {
      fail();
    }
  } catch (error) {
    if (error instanceof InertCodeBlocksError) throw error;
    fail();
  }
}
