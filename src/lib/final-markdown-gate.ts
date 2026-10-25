/**
 * Refusal-only CommonMark context gate for a joined append body.
 *
 * This is not the provider Markdown policy: existing user HTML/links are left
 * alone, and successful output is the exact input string. Callers normalize
 * line endings and finish all tail transforms before calculating UTF-16 ranges.
 * Renderer-specific footnotes are not CommonMark reference bindings and are
 * deliberately outside this gate's reference-isolation claim.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Node } from 'unist';
import { utf8ByteLength } from './byte-size';
import { MAX_CONTENT_SIZE } from './constants';
import { MESSAGE_BOUNDARY_FORMAT_MARKER, MESSAGE_BOUNDARY_MARKER } from './message-counter';

/** Bounds tree traversal/work after the parser's separately byte-bounded input. */
export const FINAL_MARKDOWN_GATE_MAX_NODES = 200_000;

export interface FinalMarkdownMarkerRange {
  readonly start: number;
  readonly end: number;
}

export interface FinalAppendMarkdownOptions {
  /** UTF-16 offset into this exact LF-normalized body, not a UTF-8 byte offset. */
  readonly appendFrom: number;
  /** Composer-owned exact full-line sentinels in the appended region only. */
  readonly requiredMarkerRanges: readonly FinalMarkdownMarkerRange[];
}

export type FinalMarkdownFailureCode =
  | 'markdown-context-crosses-append-boundary'
  | 'markdown-boundary-marker-hidden'
  | 'markdown-reference-crosses-append-boundary'
  | 'markdown-finalization-failed';

export type FinalAppendMarkdownResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly code: FinalMarkdownFailureCode };

interface TreeNode extends Node {
  readonly value?: string;
  readonly identifier?: string;
  readonly children?: readonly TreeNode[];
}

interface PositionedNode {
  readonly node: TreeNode;
  readonly start: number;
  readonly end: number;
}

interface ScanResult {
  readonly markers: Set<number>;
  readonly definitions: Map<string, PositionedNode>;
  readonly references: PositionedNode[];
  contextCrosses: boolean;
  unexpectedHtml: boolean;
}

const MARKERS = [MESSAGE_BOUNDARY_MARKER, MESSAGE_BOUNDARY_FORMAT_MARKER] as const;

function failure(code: FinalMarkdownFailureCode = 'markdown-finalization-failed') {
  return { ok: false, code } as const;
}

function offsets(node: TreeNode, length: number): FinalMarkdownMarkerRange | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    typeof start === 'number' &&
    typeof end === 'number' &&
    start >= 0 &&
    end >= start &&
    end <= length
    ? { start, end }
    : null;
}

function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error();
  return descriptor.value;
}

function exactMarkerLine(body: string, range: FinalMarkdownMarkerRange): boolean {
  return (
    (range.start === 0 || body[range.start - 1] === '\n') &&
    (range.end === body.length || body[range.end] === '\n') &&
    MARKERS.includes(body.slice(range.start, range.end) as (typeof MARKERS)[number])
  );
}

function ownedRange(
  value: unknown,
  length: number,
  minStart: number
): FinalMarkdownMarkerRange | null {
  if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== 2) return null;
  const start = ownValue(value, 'start');
  const end = ownValue(value, 'end');
  return typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= minStart &&
    end > start &&
    end <= length
    ? { start, end }
    : null;
}

function markerRanges(
  body: string,
  appendFrom: number,
  ranges: readonly FinalMarkdownMarkerRange[]
): ReadonlyMap<number, number> | null {
  if (!Array.isArray(ranges)) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(ranges, 'length');
  const length: unknown = lengthDescriptor?.value;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > FINAL_MARKDOWN_GATE_MAX_NODES
  )
    return null;
  const result = new Map<number, number>();
  let priorEnd = appendFrom;
  // Do not execute an overridden iterator or indexed accessor while admitting
  // authority. Native array length and each index must be own data properties.
  for (let index = 0; index < length; index += 1) {
    const range = ownedRange(ownValue(ranges, String(index)), body.length, priorEnd);
    if (!range || !exactMarkerLine(body, range)) return null;
    result.set(range.start, range.end);
    priorEnd = range.end;
  }
  return result;
}

function opaque(node: TreeNode): boolean {
  return node.type === 'html' || node.type === 'code' || node.type === 'inlineCode';
}

function referenceIdentifier(node: TreeNode): string | null {
  // fromMarkdown already applies CommonMark whitespace and case normalization.
  // Its vanilla parser can mistake an Obsidian [^label] for a link definition;
  // do not claim that such nodes model the renderer's footnote semantics.
  if (typeof node.identifier !== 'string' || node.identifier.length === 0) throw new Error();
  return node.identifier.startsWith('^') ? null : node.identifier;
}

function recordReference(scan: ScanResult, positioned: PositionedNode): void {
  const { node, start } = positioned;
  if (node.type === 'definition') {
    const id = referenceIdentifier(node);
    const prior = id === null ? undefined : scan.definitions.get(id);
    if (id !== null && (!prior || start < prior.start)) scan.definitions.set(id, positioned);
  } else if (node.type === 'linkReference' || node.type === 'imageReference') {
    if (referenceIdentifier(node) !== null) scan.references.push(positioned);
  }
}

function inspectNode(
  body: string,
  appendFrom: number,
  required: ReadonlyMap<number, number>,
  scan: ScanResult,
  positioned: PositionedNode
): void {
  const { node, start, end } = positioned;
  if (opaque(node) && start < appendFrom && end > appendFrom) scan.contextCrosses = true;
  if (node.type === 'html' && start >= appendFrom) {
    if (required.get(start) === end && node.value === body.slice(start, end))
      scan.markers.add(start);
    else scan.unexpectedHtml = true;
  }
  recordReference(scan, positioned);
}

function scanTree(
  body: string,
  appendFrom: number,
  required: ReadonlyMap<number, number>
): ScanResult | null {
  const root = fromMarkdown(body) as TreeNode;
  if (root.type !== 'root') return null;
  const rootPosition = offsets(root, body.length);
  if (rootPosition?.start !== 0 || rootPosition.end !== body.length) return null;
  const pending: TreeNode[] = [root];
  const visited = new Set<TreeNode>();
  const scan: ScanResult = {
    markers: new Set(),
    definitions: new Map(),
    references: [],
    contextCrosses: false,
    unexpectedHtml: false,
  };
  let scheduled = 1;

  while (pending.length > 0) {
    const node = pending.pop()!;
    if (!node || typeof node !== 'object' || visited.has(node)) return null;
    visited.add(node);
    const position = offsets(node, body.length);
    if (!position) return null;
    inspectNode(body, appendFrom, required, scan, { node, ...position });
    const children = node.children;
    if (children !== undefined && !Array.isArray(children)) return null;
    if (children) {
      if (children.length > FINAL_MARKDOWN_GATE_MAX_NODES - scheduled) return null;
      scheduled += children.length;
      for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
    }
  }
  return scan;
}

function side(position: FinalMarkdownMarkerRange, seam: number): 'old' | 'new' | 'crossing' {
  if (position.end <= seam) return 'old';
  return position.start >= seam ? 'new' : 'crossing';
}

function referencesCross(scan: ScanResult, appendFrom: number): boolean {
  for (const reference of scan.references) {
    const definition = scan.definitions.get(reference.node.identifier!);
    // A resolved reference without its effective definition is invalid evidence.
    if (!definition) throw new Error();
    const referenceSide = side(reference, appendFrom);
    const definitionSide = side(definition, appendFrom);
    if (referenceSide === 'crossing' || referenceSide !== definitionSide) return true;
  }
  return false;
}

function validBody(body: string): boolean {
  return (
    typeof body === 'string' &&
    body.length <= MAX_CONTENT_SIZE &&
    !body.includes('\r') &&
    utf8ByteLength(body) <= MAX_CONTENT_SIZE
  );
}

function utf16Boundary(body: string, offset: number): boolean {
  const prior = body.charCodeAt(offset - 1);
  const next = body.charCodeAt(offset);
  return !(prior >= 0xd800 && prior <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}

function appendOffset(body: string, options: FinalAppendMarkdownOptions): number | null {
  if (!options || typeof options !== 'object') return null;
  const value = ownValue(options, 'appendFrom');
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= body.length &&
    utf16Boundary(body, value)
    ? value
    : null;
}

/**
 * Accept unchanged LF Markdown only when old opaque contexts cannot reinterpret
 * the new region, required sentinels remain structural, and CommonMark reference
 * bindings do not cross the seam. Unexpected new raw HTML is refused, not fixed.
 *
 * MAX_CONTENT_SIZE bounds parser input/work here; it is not a new promise about
 * final serialized note size. The node ceiling limits traversal, not the initial
 * parser allocation. Neither this function nor its failure result contains prose.
 */
export function finalizeAppendReadingMarkdown(
  body: string,
  options: FinalAppendMarkdownOptions
): FinalAppendMarkdownResult {
  try {
    if (!validBody(body)) return failure();
    const appendFrom = appendOffset(body, options);
    if (appendFrom === null) return failure();
    const required = markerRanges(
      body,
      appendFrom,
      ownValue(options, 'requiredMarkerRanges') as readonly FinalMarkdownMarkerRange[]
    );
    if (!required) return failure();
    const scan = scanTree(body, appendFrom, required);
    if (!scan) return failure();
    if (scan.contextCrosses) return failure('markdown-context-crosses-append-boundary');
    if (scan.markers.size !== required.size) return failure('markdown-boundary-marker-hidden');
    if (referencesCross(scan, appendFrom))
      return failure('markdown-reference-crosses-append-boundary');
    return scan.unexpectedHtml ? failure() : { ok: true, body };
  } catch {
    return failure();
  }
}
