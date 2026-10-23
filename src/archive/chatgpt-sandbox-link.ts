/**
 * Shared, transient-only identity rules for sandbox links rendered in ChatGPT
 * assistant text. The identity is never persisted: callers hash it before
 * publishing an asset record.
 */

import { markdownBlockquotePrefix } from './markdown-syntax';

const CHATGPT_ASSET_ID_DOMAIN = 'liska-chatgpt-asset/1\u0000';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MARKDOWN_SANDBOX_LINK = /\[([^\u005b\u005d\r\n]*)\]\((sandbox:[^\s()<>{}]+)\)/gu;
const PRESENTATION_LIST_FENCE = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+(?:`{3,}|~{3,})[^\r\n]*$/mu;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const SANDBOX_PATH_PREFIX = '/mnt/data/';
export const CHATGPT_SANDBOX_CODE_RANGE_LIMIT = 8_192;
export const CHATGPT_SANDBOX_LINK_IDENTITY_LIMIT = 4_096;

export function isChatGptInterpreterMessageId(value: unknown): value is string {
  return typeof value === 'string' && MESSAGE_ID_PATTERN.test(value);
}

/** Retain raw Unicode query values, but reject controls, separators, and traversal. */
export function isChatGptInterpreterSandboxPath(value: unknown): value is string {
  const hasUnsafeCharacter =
    typeof value === 'string' &&
    Array.from(value).some(character => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code <= 0x1f ||
        (code >= 0x7f && code <= 0x9f) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        character === '\\'
      );
    });
  if (
    typeof value !== 'string' ||
    !value.startsWith(SANDBOX_PATH_PREFIX) ||
    value.length <= SANDBOX_PATH_PREFIX.length ||
    value.length > 4 * 1024 ||
    hasUnsafeCharacter
  ) {
    return false;
  }
  return value
    .slice(SANDBOX_PATH_PREFIX.length)
    .split('/')
    .every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

export interface ChatGptSandboxLinkIdentity {
  messageId: string;
  sandboxPath: string;
  identity: string;
}

/** Exact presentation spans in the original text part; all offsets are UTF-16. */
export interface ChatGptSandboxLinkOccurrence extends Readonly<ChatGptSandboxLinkIdentity> {
  readonly linkStart: number;
  readonly linkEnd: number;
  readonly destinationStart: number;
  readonly destinationEnd: number;
  readonly destination: string;
}

export type ChatGptAssetIdentityDigest = (bytes: Uint8Array) => Promise<string>;

function retainSandboxLinkIdentity(
  identities: Map<string, ChatGptSandboxLinkIdentity>,
  value: ChatGptSandboxLinkIdentity
): void {
  if (!identities.has(value.identity) && identities.size >= CHATGPT_SANDBOX_LINK_IDENTITY_LIMIT) {
    throw new RangeError('ChatGPT sandbox-link identity limit exceeded.');
  }
  identities.set(value.identity, value);
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

interface MarkdownCodeRange {
  start: number;
  end: number;
  kind: 'inline' | 'fenced' | 'indented';
}

function pushCodeRange(ranges: MarkdownCodeRange[], range: MarkdownCodeRange): void {
  if (ranges.length >= CHATGPT_SANDBOX_CODE_RANGE_LIMIT) {
    throw new RangeError('ChatGPT sandbox-link code-range limit exceeded.');
  }
  ranges.push(range);
}

function repeatedCharacterLength(source: string, index: number, character: string): number {
  let end = index;
  while (source[end] === character) end += 1;
  return end - index;
}

function lineEnd(source: string, index: number): number {
  const newline = source.indexOf('\n', index);
  return newline === -1 ? source.length : newline + 1;
}

function indentedCodeLineEnd(source: string, index: number): number | undefined {
  let columns = 0;
  let cursor = index;
  while (cursor < source.length) {
    if (source[cursor] === ' ') columns += 1;
    else if (source[cursor] === '\t') columns += 4 - (columns % 4);
    else break;
    cursor += 1;
  }
  return columns >= 4 ? lineEnd(source, index) : undefined;
}

/** Minimal CommonMark code masking so link-like examples are never acquired. */
// eslint-disable-next-line complexity, max-lines-per-function -- Keep the bounded rendered-link trust boundary linear and self-contained.
function markdownCodeRanges(source: string, strictPresentation = false): MarkdownCodeRange[] {
  const ranges: MarkdownCodeRange[] = [];
  let fenceStart: number | undefined;
  let fenceCharacter = '';
  let fenceLength = 0;
  let fenceBlockquoteDepth = 0;
  let inlineStart: number | undefined;
  let inlineLength = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const atLineStart = cursor === 0 || source[cursor - 1] === '\n';
    if (atLineStart && inlineStart === undefined) {
      const currentLineEnd = lineEnd(source, cursor);
      const line = source.slice(cursor, currentLineEnd);
      const blockquote = markdownBlockquotePrefix(line);
      const contentStart = cursor + blockquote.length;
      if (fenceStart !== undefined && blockquote.depth < fenceBlockquoteDepth) {
        pushCodeRange(ranges, { start: fenceStart, end: cursor, kind: 'fenced' });
        fenceStart = undefined;
        fenceCharacter = '';
        fenceLength = 0;
        fenceBlockquoteDepth = 0;
      }
      const indentedEnd =
        fenceStart === undefined ? indentedCodeLineEnd(source, contentStart) : undefined;
      if (indentedEnd !== undefined) {
        pushCodeRange(ranges, { start: cursor, end: indentedEnd, kind: 'indented' });
        cursor = indentedEnd;
        continue;
      }
      let markerStart = contentStart;
      while (markerStart - contentStart < 4 && source[markerStart] === ' ') markerStart += 1;
      const marker = source[markerStart] ?? '';
      const markerLength =
        marker === '`' || marker === '~' ? repeatedCharacterLength(source, markerStart, marker) : 0;
      const invalidOpeningFence =
        strictPresentation &&
        fenceStart === undefined &&
        marker === '`' &&
        source.slice(markerStart + markerLength, currentLineEnd).includes('`');
      if (markerLength >= 3 && !invalidOpeningFence) {
        if (fenceStart === undefined) {
          fenceStart = cursor;
          fenceCharacter = marker;
          fenceLength = markerLength;
          fenceBlockquoteDepth = blockquote.depth;
        } else if (
          marker === fenceCharacter &&
          markerLength >= fenceLength &&
          blockquote.depth === fenceBlockquoteDepth &&
          source.slice(markerStart + markerLength, lineEnd(source, markerStart)).trim() === ''
        ) {
          const end = lineEnd(source, markerStart);
          pushCodeRange(ranges, { start: fenceStart, end, kind: 'fenced' });
          fenceStart = undefined;
          fenceCharacter = '';
          fenceLength = 0;
          fenceBlockquoteDepth = 0;
        }
        cursor = lineEnd(source, markerStart);
        continue;
      }
    }
    if (fenceStart !== undefined) {
      cursor += 1;
      continue;
    }
    if (
      source[cursor] === '`' &&
      ((strictPresentation && inlineStart !== undefined) || !isEscaped(source, cursor))
    ) {
      const runLength = repeatedCharacterLength(source, cursor, '`');
      if (inlineStart === undefined) {
        inlineStart = cursor;
        inlineLength = runLength;
      } else if (runLength === inlineLength) {
        pushCodeRange(ranges, { start: inlineStart, end: cursor + runLength, kind: 'inline' });
        inlineStart = undefined;
        inlineLength = 0;
      }
      cursor += runLength;
      continue;
    }
    cursor += 1;
  }
  if (fenceStart !== undefined) {
    pushCodeRange(ranges, { start: fenceStart, end: source.length, kind: 'fenced' });
  }
  if (inlineStart !== undefined) {
    pushCodeRange(ranges, { start: inlineStart, end: source.length, kind: 'inline' });
  }
  return ranges;
}

function decodedSandboxPath(destination: string): string | undefined {
  if (!destination.startsWith('sandbox:')) return undefined;
  const encodedPath = destination.slice('sandbox:'.length);
  if (/%(?:2f|5c)/iu.test(encodedPath)) return undefined;
  try {
    const sandboxPath = decodeURIComponent(encodedPath);
    if (/%[0-9a-f]{2}/iu.test(sandboxPath)) return undefined;
    return isChatGptInterpreterSandboxPath(sandboxPath) ? sandboxPath : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build an unpersisted identity from the same message node that owns the
 * rendered link. NUL remains unambiguous because both validated components
 * reject controls.
 */
export function chatGptSandboxLinkIdentity(
  messageId: unknown,
  sandboxPath: unknown
): string | undefined {
  if (!isChatGptInterpreterMessageId(messageId) || !isChatGptInterpreterSandboxPath(sandboxPath)) {
    return undefined;
  }
  return `sandbox-link:${messageId}\u0000${sandboxPath}`;
}

/**
 * Parse only ordinary inline Markdown links in a single assistant text part.
 * It deliberately does not scan arbitrary strings, nested data, or code/tool
 * payloads. Decoding happens once before the sandbox path is validated.
 */
export function chatGptSandboxLinksFromAssistantTextPart(
  messageId: unknown,
  part: unknown
): ChatGptSandboxLinkIdentity[] {
  if (!isChatGptInterpreterMessageId(messageId) || typeof part !== 'string') return [];
  const identities = new Map<string, ChatGptSandboxLinkIdentity>();
  const codeRanges = markdownCodeRanges(part);
  let codeRangeIndex = 0;
  MARKDOWN_SANDBOX_LINK.lastIndex = 0;
  for (
    let match = MARKDOWN_SANDBOX_LINK.exec(part);
    match;
    match = MARKDOWN_SANDBOX_LINK.exec(part)
  ) {
    const start = match.index;
    while (codeRangeIndex < codeRanges.length && codeRanges[codeRangeIndex].end <= start) {
      codeRangeIndex += 1;
    }
    const codeRange = codeRanges[codeRangeIndex];
    if (
      isEscaped(part, start) ||
      part[start - 1] === '!' ||
      (codeRange !== undefined && start >= codeRange.start && start < codeRange.end)
    ) {
      continue;
    }
    const sandboxPath = decodedSandboxPath(match[2] ?? '');
    const identity = chatGptSandboxLinkIdentity(messageId, sandboxPath);
    if (!identity || !sandboxPath) continue;
    retainSandboxLinkIdentity(identities, { messageId, sandboxPath, identity });
  }
  return [...identities.values()].sort((left, right) =>
    left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0
  );
}

function canMaskAngleBrackets(source: string, range: MarkdownCodeRange): boolean {
  // Indented code can instead be a paragraph continuation. Do not use that
  // ambiguous mask to hide possible HTML, even at the cost of false negatives.
  return (
    (range.kind === 'inline' && !/[\r\n]/u.test(source.slice(range.start, range.end))) ||
    (range.kind === 'fenced' &&
      markdownBlockquotePrefix(source.slice(range.start, lineEnd(source, range.start))).depth === 0)
  );
}

function hasNonCodeAngleBracket(source: string, codeRanges: readonly MarkdownCodeRange[]): boolean {
  let codeRangeIndex = 0;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    while (codeRangeIndex < codeRanges.length && codeRanges[codeRangeIndex].end <= cursor) {
      codeRangeIndex += 1;
    }
    const codeRange = codeRanges[codeRangeIndex];
    if (
      codeRange !== undefined &&
      cursor === codeRange.start &&
      canMaskAngleBrackets(source, codeRange)
    ) {
      cursor = codeRange.end - 1;
      codeRangeIndex += 1;
    } else if (source[cursor] === '<' || source[cursor] === '>') {
      return true;
    }
  }
  return false;
}

function hasMultilineInlineRange(
  source: string,
  codeRanges: readonly MarkdownCodeRange[]
): boolean {
  return codeRanges.some(
    range => range.kind === 'inline' && /[\r\n]/u.test(source.slice(range.start, range.end))
  );
}

/** CommonMark link labels are bounded at 999 characters and may cross a line ending. */
function hasPresentationReferenceDefinition(source: string): boolean {
  let latestOpener: number | undefined;
  let logicalPosition = 0;
  for (let cursor = 0; cursor < source.length; logicalPosition += 1) {
    if (latestOpener !== undefined && logicalPosition - latestOpener - 1 > 999) {
      latestOpener = undefined;
    }
    if (source[cursor] === '[') latestOpener = logicalPosition;
    else if (source[cursor] === ']' && source[cursor + 1] === ':' && latestOpener !== undefined) {
      return true;
    }
    if (source[cursor] === '\r' && source[cursor + 1] === '\n') cursor += 2;
    else {
      const codePoint = source.codePointAt(cursor);
      cursor += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    }
  }
  return false;
}

/** Consume unsupported nesting too, so an inner link cannot become a rewrite target. */
function delimitedMarkdownEnd(
  source: string,
  start: number,
  opener: string,
  closer: string
): number | undefined {
  let depth = 1;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') cursor += 1;
    else if (source[cursor] === opener) depth += 1;
    else if (source[cursor] === closer && --depth === 0) return cursor + 1;
  }
  return undefined;
}

function markdownLinkCandidateEnd(source: string, start: number): number {
  const labelEnd = delimitedMarkdownEnd(source, start, '[', ']');
  if (labelEnd === undefined) return source.length;
  return source[labelEnd] === '('
    ? (delimitedMarkdownEnd(source, labelEnd, '(', ')') ?? source.length)
    : labelEnd;
}

function isPlainMarkdownLinkContext(
  source: string,
  start: number,
  end: number,
  codeRange: MarkdownCodeRange | undefined
): boolean {
  return (
    !isEscaped(source, start) &&
    source[start - 1] !== '!' &&
    (codeRange === undefined || codeRange.start >= end)
  );
}

function sandboxLinkOccurrence(
  messageId: string,
  source: string,
  match: RegExpExecArray,
  end: number,
  previousEnd: number
): ChatGptSandboxLinkOccurrence | undefined {
  const linkStart = match.index;
  const destination = match[2] ?? '';
  const destinationStart = linkStart + (match[1]?.length ?? 0) + 3;
  const destinationEnd = end - 1;
  if (
    match[0].length !== end - linkStart ||
    linkStart < previousEnd ||
    destinationStart < linkStart ||
    destinationEnd < destinationStart ||
    end > source.length ||
    source.slice(destinationStart, destinationEnd) !== destination ||
    (match[1] ?? '').includes('\\')
  ) {
    return undefined;
  }
  const sandboxPath = decodedSandboxPath(destination);
  const identity = chatGptSandboxLinkIdentity(messageId, sandboxPath);
  return identity && sandboxPath
    ? {
        messageId,
        sandboxPath,
        identity,
        linkStart,
        linkEnd: end,
        destinationStart,
        destinationEnd,
        destination,
      }
    : undefined;
}

function presentationScanInput(
  messageId: unknown,
  part: unknown
): { messageId: string; part: string; codeRanges: MarkdownCodeRange[] } | undefined {
  if (!isChatGptInterpreterMessageId(messageId) || typeof part !== 'string') return undefined;
  if (
    /\r(?!\n)/u.test(part) ||
    hasPresentationReferenceDefinition(part) ||
    PRESENTATION_LIST_FENCE.test(part)
  ) {
    return undefined;
  }
  const codeRanges = markdownCodeRanges(part, true);
  return hasMultilineInlineRange(part, codeRanges) || hasNonCodeAngleBracket(part, codeRanges)
    ? undefined
    : { messageId, part, codeRanges };
}

/**
 * Presentation-only candidates, never acquisition authority. Unlike the identity
 * parser, this rejects HTML/comment/raw-block ambiguity and blockquote markers
 * anywhere outside code. Unsupported/unclosed delimiters may hide later links;
 * false negatives are preferable to rewriting an ambiguous substring.
 */
export function chatGptSandboxLinkOccurrencesFromAssistantTextPart(
  messageId: unknown,
  part: unknown
): readonly ChatGptSandboxLinkOccurrence[] {
  const input = presentationScanInput(messageId, part);
  if (!input) return [];
  const { messageId: ownerMessageId, part: source, codeRanges } = input;
  const pattern = new RegExp(MARKDOWN_SANDBOX_LINK.source, 'uy');
  const occurrences: ChatGptSandboxLinkOccurrence[] = [];
  let codeRangeIndex = 0;
  let cursor = 0;
  let previousEnd = 0;
  while (cursor < source.length) {
    while (codeRangeIndex < codeRanges.length && codeRanges[codeRangeIndex].end <= cursor) {
      codeRangeIndex += 1;
    }
    const codeRange = codeRanges[codeRangeIndex];
    if (codeRange !== undefined && cursor >= codeRange.start) {
      cursor = codeRange.end;
    } else if (source[cursor] !== '[') {
      cursor += 1;
    } else {
      const end = markdownLinkCandidateEnd(source, cursor);
      pattern.lastIndex = cursor;
      const match = pattern.exec(source);
      const occurrence =
        match && isPlainMarkdownLinkContext(source, cursor, end, codeRange)
          ? sandboxLinkOccurrence(ownerMessageId, source, match, end, previousEnd)
          : undefined;
      if (occurrence) {
        if (occurrences.length >= CHATGPT_SANDBOX_LINK_IDENTITY_LIMIT) {
          throw new RangeError('ChatGPT sandbox-link occurrence limit exceeded.');
        }
        occurrences.push(occurrence);
        previousEnd = occurrence.linkEnd;
      }
      cursor = end;
    }
  }
  return occurrences;
}

/**
 * Centralized opaque asset-ID derivation. The preimage is intentionally shared
 * by raw inventory and its resolver-plan verifier, so a ledger ID cannot drift
 * from the exact link identity that created it.
 */
export async function chatGptAssetIdForIdentity(
  identity: string,
  sha256: ChatGptAssetIdentityDigest
): Promise<string | undefined> {
  if (typeof identity !== 'string' || identity.length === 0 || typeof sha256 !== 'function') {
    return undefined;
  }
  try {
    const digest = await sha256(new TextEncoder().encode(`${CHATGPT_ASSET_ID_DOMAIN}${identity}`));
    return SHA256_PATTERN.test(digest) ? `chatgpt-asset-${digest}` : undefined;
  } catch {
    return undefined;
  }
}
