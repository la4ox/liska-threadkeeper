/**
 * Structural safety policy for provider-authored Markdown.
 *
 * Raw and canonical archives retain the exact provider payload. Only the
 * derived reading export is neutralized before it can be rendered by Obsidian.
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Definition, Image, ImageReference, Link, Root, RootContent, Text } from 'mdast';
import type { Node } from 'unist';

const LITERAL_OPEN_BRACKET = '&#91;';
const LITERAL_IMAGE_OPEN = '&#33;&#91;';
const TRUSTED_CHATGPT_ARCHIVE_TARGET =
  /^_liska-archive\/[a-f0-9]{64}\/capture-chatgpt-[A-Za-z0-9_-]{1,240}\/assets\/[a-f0-9]{64}\.[a-z0-9]{1,16}$/u;

interface SourceEdit {
  readonly start: number;
  readonly deleteCount: 1 | 2;
  readonly replacement: string;
}

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
  return TRUSTED_CHATGPT_ARCHIVE_TARGET.test(destination) && trustedDestinations.has(destination);
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
}

function neutralizeUnsafeLink(
  source: string,
  node: Link | Definition,
  trustedDestinations: ReadonlySet<string>,
  edits: Map<number, SourceEdit>
): void {
  if (safeLinkDestination(node.url, trustedDestinations)) return;
  const position = nodeOffsets(node);
  if (!position || source[position.start] !== '[') return;
  addEdit(edits, {
    start: position.start,
    deleteCount: 1,
    replacement: LITERAL_OPEN_BRACKET,
  });
}

function wikiEdits(source: string, node: Text, edits: Map<number, SourceEdit>): void {
  const position = nodeOffsets(node);
  if (!position) return;
  let slashParity = 0;
  for (let cursor = position.start; cursor < position.end; cursor += 1) {
    const character = source[cursor];
    if (character === '\\') {
      slashParity ^= 1;
      continue;
    }
    const escaped = slashParity === 1;
    slashParity = 0;
    if (!escaped && source.startsWith('![[', cursor)) {
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
  trustedDestinations: ReadonlySet<string>
): Map<number, SourceEdit> {
  const edits = new Map<number, SourceEdit>();
  const pending: MarkdownNode[] = [tree];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.type === 'image' || node.type === 'imageReference') {
      neutralizeImage(source, node, trustedDestinations, edits);
    } else if (node.type === 'link' || node.type === 'definition') {
      neutralizeUnsafeLink(source, node, trustedDestinations, edits);
    } else if (node.type === 'text') {
      wikiEdits(source, node, edits);
    }
    for (const child of childNodes(node)) pending.push(child);
  }
  return edits;
}

function applyEdits(source: string, edits: ReadonlyMap<number, SourceEdit>): string {
  const ordered = [...edits.values()].sort((left, right) => left.start - right.start);
  const chunks: string[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor) continue;
    chunks.push(source.slice(cursor, edit.start), edit.replacement);
    cursor = edit.start + edit.deleteCount;
  }
  chunks.push(source.slice(cursor));
  return chunks.join('');
}

/** Parser failure disables all bracket syntax instead of preserving an active sink. */
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
    chunks.push(character === '[' && !escaped ? LITERAL_OPEN_BRACKET : character);
  }
  return chunks.join('');
}

/**
 * Preserve valid CommonMark structure and code, but make automatic resources,
 * Obsidian wikilinks/embeds, and unsupported/private destinations literal.
 */
export function neutralizeActiveProviderMarkdown(
  source: string,
  trustedDestinations: readonly string[] = []
): string {
  if (!source.includes('[')) return source;
  try {
    const trusted = new Set(trustedDestinations);
    return applyEdits(source, collectEdits(source, fromMarkdown(source), trusted));
  } catch {
    return failClosedMarkdown(source);
  }
}
