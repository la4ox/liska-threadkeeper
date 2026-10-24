/**
 * Structural safety policy for provider-authored Markdown.
 *
 * Raw and canonical archives retain the exact provider payload. Only the
 * derived reading export is neutralized before it can be rendered by Obsidian.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Definition, Html, Image, ImageReference, Link, Root, RootContent, Text } from 'mdast';
import type { Node } from 'unist';
import { MESSAGE_BOUNDARY_FORMAT_MARKER, MESSAGE_BOUNDARY_MARKER } from '../lib/message-counter';

const LITERAL_OPEN_BRACKET = '&#91;';
const LITERAL_IMAGE_OPEN = '&#33;&#91;';
const LITERAL_OPEN_ANGLE = '&lt;';
const LITERAL_CLOSE_ANGLE = '&gt;';
const TRUSTED_GENERATED_HTML = [MESSAGE_BOUNDARY_FORMAT_MARKER, MESSAGE_BOUNDARY_MARKER] as const;
const TRUSTED_CHATGPT_ARCHIVE_TARGET =
  /^_liska-archive\/[a-f0-9]{64}\/capture-chatgpt-[A-Za-z0-9_-]{1,240}\/assets\/[a-f0-9]{64}\.[a-z0-9]{1,16}$/u;
const TRUSTED_IMAGE_PLACEHOLDER = /^g2o-image:\/\/[^)$\r\n]{1,256}$/u;

interface SourceEdit {
  readonly start: number;
  readonly deleteCount: 1 | 2;
  readonly replacement: string;
}

interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export type TrustedHtmlRange = SourceRange;

type MarkdownNode = Root | RootContent;

function nodeOffsets(node: Node): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === 'number' && typeof end === 'number' && end >= start
    ? { start, end }
    : null;
}

function childNodes(node: MarkdownNode): readonly MarkdownNode[] {
  const children = (node as { children?: unknown }).children;
  return Array.isArray(children) ? (children as MarkdownNode[]) : [];
}

function codeRanges(tree: Root): SourceRange[] {
  const ranges: SourceRange[] = [];
  const pending: MarkdownNode[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === 'code' || node.type === 'inlineCode') {
      const position = nodeOffsets(node);
      if (position) ranges.push(position);
    }
    for (const child of childNodes(node)) pending.push(child);
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function containingRange(ranges: readonly SourceRange[], index: number): SourceRange | null {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (ranges[middle].end <= index) low = middle + 1;
    else high = middle;
  }
  const candidate = ranges[low];
  return candidate && candidate.start <= index ? candidate : null;
}

/** Obsidian math is opaque to CommonMark; protect only complete delimiters outside code. */
function mathRanges(source: string, tree: Root): SourceRange[] {
  const protectedCode = codeRanges(tree);
  const ranges: SourceRange[] = [];
  let state: { start: number; length: 1 | 2 } | null = null;
  let slashParity = 0;
  for (let cursor = 0; cursor < source.length; ) {
    const code = containingRange(protectedCode, cursor);
    if (code) {
      state = null;
      slashParity = 0;
      cursor = code.end;
      continue;
    }
    const character = source[cursor];
    if (character === '\\') {
      slashParity ^= 1;
      cursor += 1;
      continue;
    }
    const escaped = slashParity === 1;
    slashParity = 0;
    if (state?.length === 1 && (character === '\r' || character === '\n')) state = null;
    if (character !== '$' || escaped) {
      cursor += 1;
      continue;
    }
    const length: 1 | 2 = source[cursor + 1] === '$' ? 2 : 1;
    if (!state) {
      state = { start: cursor, length };
    } else if (state.length === length) {
      ranges.push({ start: state.start, end: cursor + length });
      state = null;
    }
    cursor += length;
  }
  return ranges;
}

function ipv4Octets(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/u.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every(value => value >= 0 && value <= 255) ? octets : null;
}

const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff],
  [0x0a000000, 0x0affffff],
  [0x64400000, 0x647fffff],
  [0x7f000000, 0x7fffffff],
  [0xa9fe0000, 0xa9feffff],
  [0xac100000, 0xac1fffff],
  [0xc0000000, 0xc00000ff],
  [0xc0a80000, 0xc0a8ffff],
  [0xc6120000, 0xc613ffff],
  [0xe0000000, 0xffffffff],
];

function isPrivateIpv4(octets: readonly number[]): boolean {
  const value = octets.reduce((total, octet) => total * 256 + octet, 0);
  return PRIVATE_IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
}

function ipv6Bytes(hostname: string): number[] | null {
  const host = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (!host.includes(':') || host.includes('%')) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const values: number[] = [];
    for (const group of half.split(':')) {
      const ipv4 = ipv4Octets(group);
      if (ipv4) {
        values.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else if (/^[a-f0-9]{1,4}$/u.test(group)) {
        values.push(Number.parseInt(group, 16));
      } else {
        return null;
      }
    }
    return values;
  };

  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  return groups.length === 8 ? groups.flatMap(group => [group >> 8, group & 0xff]) : null;
}

// eslint-disable-next-line complexity -- Explicit byte-range checks keep host classification auditable.
function isPrivateIpv6(ipv6: readonly number[]): boolean {
  const allZero = ipv6.every(value => value === 0);
  const loopback = ipv6.slice(0, 15).every(value => value === 0) && ipv6[15] === 1;
  const uniqueLocal = (ipv6[0] & 0xfe) === 0xfc;
  const linkLocal = ipv6[0] === 0xfe && (ipv6[1] & 0xc0) === 0x80;
  const multicast = ipv6[0] === 0xff;
  const documentation =
    ipv6[0] === 0x20 && ipv6[1] === 0x01 && ipv6[2] === 0x0d && ipv6[3] === 0xb8;
  const mappedIpv4 =
    ipv6.slice(0, 10).every(value => value === 0) && ipv6[10] === 0xff && ipv6[11] === 0xff
      ? ipv6.slice(12)
      : null;
  return (
    allZero ||
    loopback ||
    uniqueLocal ||
    linkLocal ||
    multicast ||
    documentation ||
    (mappedIpv4 !== null && isPrivateIpv4(mappedIpv4))
  );
}

const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'] as const;

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  if (host === 'localhost' || LOCAL_HOST_SUFFIXES.some(suffix => host.endsWith(suffix)))
    return true;
  const ipv4 = ipv4Octets(host);
  if (ipv4) return isPrivateIpv4(ipv4);
  const ipv6 = ipv6Bytes(host);
  return ipv6 !== null && isPrivateIpv6(ipv6);
}

function hasUnsafeDestinationCharacter(destination: string): boolean {
  for (const character of destination) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f || character === '\\') return true;
  }
  return false;
}

function trustedLocalDestination(
  destination: string,
  trustedDestinations: ReadonlySet<string>
): boolean {
  return (
    trustedDestinations.has(destination) &&
    (TRUSTED_CHATGPT_ARCHIVE_TARGET.test(destination) ||
      TRUSTED_IMAGE_PLACEHOLDER.test(destination))
  );
}

/** URLs supplied by mdast are already CommonMark entity/backslash decoded. */
function safeLinkDestination(
  destination: string,
  trustedDestinations: ReadonlySet<string>
): boolean {
  if (destination === '' || destination.startsWith('#')) return true;
  if (trustedLocalDestination(destination, trustedDestinations)) return true;
  if (hasUnsafeDestinationCharacter(destination)) return false;
  try {
    const parsed = new URL(destination);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.username === '' &&
      parsed.password === '' &&
      !isPrivateHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function addEdit(edits: Map<number, SourceEdit>, edit: SourceEdit): void {
  const existing = edits.get(edit.start);
  if (!existing || existing.deleteCount < edit.deleteCount) edits.set(edit.start, edit);
}

function trustedHtmlAuthority(
  source: string,
  ranges: readonly TrustedHtmlRange[]
): ReadonlyMap<number, number> {
  const authority = new Map<number, number>();
  let priorEnd = -1;
  for (const range of ranges) {
    const { start, end } = range;
    const marker = source.slice(start, end);
    const startsOnLine = start === 0 || source[start - 1] === '\n' || source[start - 1] === '\r';
    const endsOnLine = end === source.length || source[end] === '\n' || source[end] === '\r';
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > source.length ||
      start < priorEnd ||
      !startsOnLine ||
      !endsOnLine ||
      !TRUSTED_GENERATED_HTML.includes(marker as (typeof TRUSTED_GENERATED_HTML)[number])
    ) {
      throw new Error('Invalid trusted HTML range.');
    }
    authority.set(start, end);
    priorEnd = end;
  }
  return authority;
}

function neutralizeHtml(
  source: string,
  node: Html,
  edits: Map<number, SourceEdit>,
  trustedHtml: ReadonlyMap<number, number>
): void {
  const position = nodeOffsets(node);
  if (!position) return;
  // Markdown inside a raw HTML node is opaque in the original parse. Keep it
  // literal when the surrounding HTML becomes text; otherwise an image, link,
  // definition, or wikilink could become active only because of this edit.
  neutralizeBracketsInRange(source, position.start, position.end, edits);
  for (let cursor = position.start; cursor < position.end; cursor += 1) {
    // These exact full-line comments are emitted by conversationToNote after
    // provider copies have already been made inert by
    // neutralizeMessageBoundaryMarkers. Preserve them even when malformed
    // provider HTML made the parser include a later marker in one larger node.
    const trustedEnd = trustedHtml.get(cursor);
    if (trustedEnd !== undefined && trustedEnd <= position.end) {
      cursor = trustedEnd - 1;
      continue;
    }
    const character = source[cursor];
    if (character === '<' || character === '>') {
      addEdit(edits, {
        start: cursor,
        deleteCount: 1,
        replacement: character === '<' ? LITERAL_OPEN_ANGLE : LITERAL_CLOSE_ANGLE,
      });
    }
  }
}

function neutralizeBracketsInRange(
  source: string,
  start: number,
  end: number,
  edits: Map<number, SourceEdit>
): void {
  let slashParity = 0;
  for (let cursor = start; cursor < end; cursor += 1) {
    const character = source[cursor];
    if (character === '\\') {
      slashParity ^= 1;
      continue;
    }
    const escaped = slashParity === 1;
    slashParity = 0;
    if (character === '[' && !escaped) {
      addEdit(edits, { start: cursor, deleteCount: 1, replacement: LITERAL_OPEN_BRACKET });
    }
  }
}

function mergeShiftedEdits(
  target: Map<number, SourceEdit>,
  nested: ReadonlyMap<number, SourceEdit>,
  offset: number
): void {
  for (const edit of nested.values()) {
    addEdit(target, { ...edit, start: edit.start + offset });
  }
}

function footnoteBodyStart(source: string, position: SourceRange): number | null {
  const delimiter = source.indexOf(']:', position.start + 2);
  if (delimiter < 0 || delimiter >= position.end) return null;
  let start = delimiter + 2;
  while (start < position.end && (source[start] === ' ' || source[start] === '\t')) start += 1;
  return start;
}

function neutralizeImage(
  source: string,
  node: Image | ImageReference,
  trustedDestinations: ReadonlySet<string>,
  edits: Map<number, SourceEdit>
): void {
  const position = nodeOffsets(node);
  if (!position || !source.startsWith('![', position.start)) return;
  if (node.type === 'image' && trustedLocalDestination(node.url, trustedDestinations)) return;
  addEdit(edits, {
    start: position.start,
    deleteCount: 2,
    replacement: LITERAL_IMAGE_OPEN,
  });
  // Image descriptions are stored as one alt string rather than child nodes.
  // Once the outer opener becomes literal, nested image/link syntax inside the
  // description would otherwise become independently active on the next parse.
  neutralizeBracketsInRange(source, position.start + 2, position.end, edits);
}

function neutralizeUnsafeLink(
  source: string,
  node: Link | Definition,
  trustedDestinations: ReadonlySet<string>,
  edits: Map<number, SourceEdit>,
  preserveFootnotes: boolean
): void {
  const position = nodeOffsets(node);
  if (!position || source[position.start] !== '[') return;
  // Obsidian footnotes use `[^id]: body`; CommonMark can misclassify a
  // single-token body as a link destination. Preserve the footnote marker.
  // Active syntax inside ordinary multi-token bodies remains separate mdast
  // nodes and is neutralized normally.
  if (preserveFootnotes && node.type === 'definition' && source.startsWith('[^', position.start)) {
    const bodyStart = footnoteBodyStart(source, position);
    if (bodyStart !== null && bodyStart < position.end) {
      const body = source.slice(bodyStart, position.end);
      if (body.includes('[')) {
        mergeShiftedEdits(
          edits,
          collectEdits(body, fromMarkdown(body), trustedDestinations, false, new Map()),
          bodyStart
        );
      }
    }
    return;
  }
  if (safeLinkDestination(node.url, trustedDestinations)) return;
  addEdit(edits, {
    start: position.start,
    deleteCount: 1,
    replacement: LITERAL_OPEN_BRACKET,
  });
  neutralizeBracketsInRange(source, position.start + 1, position.end, edits);
}

function wikiEdits(
  source: string,
  node: Text,
  edits: Map<number, SourceEdit>,
  protectedMath: readonly SourceRange[]
): void {
  const position = nodeOffsets(node);
  if (!position) return;
  let slashParity = 0;
  for (let cursor = position.start; cursor < position.end; cursor += 1) {
    const math = containingRange(protectedMath, cursor);
    if (math) {
      slashParity = 0;
      cursor = math.end - 1;
      continue;
    }
    const character = source[cursor];
    if (character === '\\') {
      slashParity ^= 1;
      continue;
    }
    const escaped = slashParity === 1;
    slashParity = 0;
    if (!escaped && source.startsWith('![', cursor)) {
      addEdit(edits, { start: cursor, deleteCount: 2, replacement: LITERAL_IMAGE_OPEN });
      cursor += 1;
    } else if (!escaped && source.startsWith('[[', cursor)) {
      addEdit(edits, { start: cursor, deleteCount: 1, replacement: LITERAL_OPEN_BRACKET });
    }
  }
}

function collectEdits(
  source: string,
  tree: Root,
  trustedDestinations: ReadonlySet<string>,
  preserveFootnotes = true,
  trustedHtml: ReadonlyMap<number, number> = new Map()
): Map<number, SourceEdit> {
  const edits = new Map<number, SourceEdit>();
  const protectedMath = mathRanges(source, tree);
  const pending: MarkdownNode[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop()!;
    const position = nodeOffsets(node);
    const startsInMath =
      position !== null && containingRange(protectedMath, position.start) !== null;
    if (node.type === 'image' || node.type === 'imageReference') {
      if (!startsInMath) neutralizeImage(source, node, trustedDestinations, edits);
    } else if (node.type === 'link' || node.type === 'definition') {
      if (!startsInMath)
        neutralizeUnsafeLink(source, node, trustedDestinations, edits, preserveFootnotes);
    } else if (node.type === 'text') {
      wikiEdits(source, node, edits, protectedMath);
    } else if (node.type === 'html') {
      neutralizeHtml(source, node, edits, trustedHtml);
    }
    for (const child of childNodes(node)) pending.push(child);
  }
  return edits;
}

function applicableEdits(edits: ReadonlyMap<number, SourceEdit>): SourceEdit[] {
  const ordered = [...edits.values()].sort((left, right) => left.start - right.start);
  const applicable: SourceEdit[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor) continue;
    applicable.push(edit);
    cursor = edit.start + edit.deleteCount;
  }
  return applicable;
}

function applyEdits(source: string, edits: ReadonlyMap<number, SourceEdit>): string {
  const chunks: string[] = [];
  let cursor = 0;
  for (const edit of applicableEdits(edits)) {
    chunks.push(source.slice(cursor, edit.start), edit.replacement);
    cursor = edit.start + edit.deleteCount;
  }
  chunks.push(source.slice(cursor));
  return chunks.join('');
}

function shiftTrustedHtmlRanges(
  ranges: readonly TrustedHtmlRange[],
  edits: ReadonlyMap<number, SourceEdit>
): TrustedHtmlRange[] {
  const orderedEdits = applicableEdits(edits);
  const shifted: TrustedHtmlRange[] = [];
  let editIndex = 0;
  let delta = 0;
  for (const range of ranges) {
    while (editIndex < orderedEdits.length && orderedEdits[editIndex].start < range.start) {
      const edit = orderedEdits[editIndex];
      if (edit.start + edit.deleteCount > range.start) {
        throw new Error('Trusted HTML range overlaps a source edit.');
      }
      delta += edit.replacement.length - edit.deleteCount;
      editIndex += 1;
    }
    if (editIndex < orderedEdits.length && orderedEdits[editIndex].start < range.end) {
      throw new Error('Trusted HTML range contains a source edit.');
    }
    shifted.push({ start: range.start + delta, end: range.end + delta });
  }
  return shifted;
}

/** Parser failure disables bracket and raw-HTML syntax instead of preserving an active sink. */
function failClosedMarkdown(source: string): string {
  const chunks: string[] = [];
  let slashParity = 0;
  for (const character of source) {
    if (character === '\\') {
      chunks.push(character);
      slashParity ^= 1;
      continue;
    }
    const escaped = slashParity === 1;
    slashParity = 0;
    if (!escaped && character === '[') chunks.push(LITERAL_OPEN_BRACKET);
    else if (!escaped && character === '<') chunks.push(LITERAL_OPEN_ANGLE);
    else if (!escaped && character === '>') chunks.push(LITERAL_CLOSE_ANGLE);
    else chunks.push(character);
  }
  return chunks.join('');
}

/**
 * Preserve valid CommonMark structure and code, but make automatic resources,
 * Obsidian wikilinks/embeds, and unsupported/private destinations literal.
 */
export function neutralizeActiveProviderMarkdown(
  source: string,
  trustedDestinations: readonly string[] = [],
  trustedHtmlRanges: readonly TrustedHtmlRange[] = []
): string {
  if (!source.includes('[') && !source.includes('<')) return source;
  let output = source;
  try {
    const trusted = new Set(trustedDestinations);
    let trustedRanges = [...trustedHtmlRanges];
    let trustedHtml = trustedHtmlAuthority(source, trustedRanges);
    const initialEdits = collectEdits(source, fromMarkdown(source), trusted, true, trustedHtml);
    trustedRanges = shiftTrustedHtmlRanges(trustedRanges, initialEdits);
    output = applyEdits(source, initialEdits);
    if (initialEdits.size === 0) return output;

    // Neutralizing an unsafe outer construct may expose syntax that was opaque
    // in the first parse. Reparse once through the complete active-resource
    // policy, then prove that no further edit remains.
    trustedHtml = trustedHtmlAuthority(output, trustedRanges);
    const residual = collectEdits(output, fromMarkdown(output), trusted, true, trustedHtml);
    if (residual.size === 0) return output;
    trustedRanges = shiftTrustedHtmlRanges(trustedRanges, residual);
    output = applyEdits(output, residual);
    trustedHtml = trustedHtmlAuthority(output, trustedRanges);
    return collectEdits(output, fromMarkdown(output), trusted, true, trustedHtml).size === 0
      ? output
      : failClosedMarkdown(output);
  } catch {
    return failClosedMarkdown(output);
  }
}
