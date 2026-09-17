/**
 * Shared, transient-only identity rules for sandbox links rendered in ChatGPT
 * assistant text. The identity is never persisted: callers hash it before
 * publishing an asset record.
 */

const CHATGPT_ASSET_ID_DOMAIN = 'liska-chatgpt-asset/1\u0000';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MARKDOWN_SANDBOX_LINK = /\[([^\]\r\n]*)\]\((sandbox:[^\s()<>{}]+)\)/gu;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const SANDBOX_PATH_PREFIX = '/mnt/data/';

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

export type ChatGptAssetIdentityDigest = (bytes: Uint8Array) => Promise<string>;

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
function markdownCodeRanges(source: string): MarkdownCodeRange[] {
  const ranges: MarkdownCodeRange[] = [];
  let fenceStart: number | undefined;
  let fenceCharacter = '';
  let fenceLength = 0;
  let inlineStart: number | undefined;
  let inlineLength = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const atLineStart = cursor === 0 || source[cursor - 1] === '\n';
    if (atLineStart && inlineStart === undefined) {
      const indentedEnd =
        fenceStart === undefined ? indentedCodeLineEnd(source, cursor) : undefined;
      if (indentedEnd !== undefined) {
        ranges.push({ start: cursor, end: indentedEnd });
        cursor = indentedEnd;
        continue;
      }
      let markerStart = cursor;
      while (markerStart - cursor < 4 && source[markerStart] === ' ') markerStart += 1;
      const marker = source[markerStart] ?? '';
      const markerLength =
        marker === '`' || marker === '~' ? repeatedCharacterLength(source, markerStart, marker) : 0;
      if (markerLength >= 3) {
        if (fenceStart === undefined) {
          fenceStart = cursor;
          fenceCharacter = marker;
          fenceLength = markerLength;
        } else if (
          marker === fenceCharacter &&
          markerLength >= fenceLength &&
          source.slice(markerStart + markerLength, lineEnd(source, markerStart)).trim() === ''
        ) {
          const end = lineEnd(source, markerStart);
          ranges.push({ start: fenceStart, end });
          fenceStart = undefined;
          fenceCharacter = '';
          fenceLength = 0;
        }
        cursor = lineEnd(source, markerStart);
        continue;
      }
    }
    if (fenceStart !== undefined) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === '`' && !isEscaped(source, cursor)) {
      const runLength = repeatedCharacterLength(source, cursor, '`');
      if (inlineStart === undefined) {
        inlineStart = cursor;
        inlineLength = runLength;
      } else if (runLength === inlineLength) {
        ranges.push({ start: inlineStart, end: cursor + runLength });
        inlineStart = undefined;
        inlineLength = 0;
      }
      cursor += runLength;
      continue;
    }
    cursor += 1;
  }
  if (fenceStart !== undefined) ranges.push({ start: fenceStart, end: source.length });
  if (inlineStart !== undefined) ranges.push({ start: inlineStart, end: source.length });
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
  MARKDOWN_SANDBOX_LINK.lastIndex = 0;
  for (
    let match = MARKDOWN_SANDBOX_LINK.exec(part);
    match;
    match = MARKDOWN_SANDBOX_LINK.exec(part)
  ) {
    const start = match.index;
    if (
      isEscaped(part, start) ||
      part[start - 1] === '!' ||
      codeRanges.some(range => start >= range.start && start < range.end)
    ) {
      continue;
    }
    const sandboxPath = decodedSandboxPath(match[2] ?? '');
    const identity = chatGptSandboxLinkIdentity(messageId, sandboxPath);
    if (!identity || !sandboxPath) continue;
    identities.set(identity, { messageId, sandboxPath, identity });
  }
  return [...identities.values()].sort((left, right) =>
    left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0
  );
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
