/** Bounded frontmatter tags, not a general-purpose template language. */
import { jsonUtf8ByteLength, utf8ByteLength } from './byte-size';
import type { AIPlatform } from './types';

export type TagTemplateKind = 'conversation' | 'deep-research';
const PLATFORM_TOKEN = '{platform}';
const MAX_ENTRIES = 50;
const MAX_ENTRY_LENGTH = 100;
const MAX_BYTES = 2048;
const LITERAL_TAG = /^[\p{L}\p{N}_/-]+$/u;
const NUMERIC_TAG = /^\p{N}+$/u;
const CONTROL_CHARACTERS = /\p{Cc}/u;

/** Each caller owns its defaults; no mutable default array escapes. */
export function defaultTagTemplates(kind: TagTemplateKind): string[] {
  return kind === 'deep-research'
    ? ['ai-research', 'deep-research', PLATFORM_TOKEN]
    : ['ai-conversation', PLATFORM_TOKEN];
}

function isCanonicalEntry(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_ENTRY_LENGTH &&
    (value === PLATFORM_TOKEN || (LITERAL_TAG.test(value) && !NUMERIC_TAG.test(value)))
  );
}

/** Stored/transport arrays must already be canonical, including spelling and uniqueness. */
export function isCanonicalTagTemplates(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ENTRIES) return false;
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isCanonicalEntry(entry) || seen.has(entry.toLowerCase())) return false;
    seen.add(entry.toLowerCase());
  }
  return jsonUtf8ByteLength(value) <= MAX_BYTES;
}

/** Invalid or empty stored lists reset independently, never salvaging partial input. */
export function normalizeTagTemplates(value: unknown, kind: TagTemplateKind): string[] {
  return isCanonicalTagTemplates(value) ? [...value] : defaultTagTemplates(kind);
}

export type TagTemplateParseResult = { ok: true; tags: string[] } | { ok: false };

/** Parse the popup's comma-separated field; errors deliberately contain no input. */
export function parseTagTemplates(raw: string, kind: TagTemplateKind): TagTemplateParseResult {
  if (utf8ByteLength(raw) > MAX_BYTES || CONTROL_CHARACTERS.test(raw)) return { ok: false };
  if (!raw.trim()) return { ok: true, tags: defaultTagTemplates(kind) };
  const entries = raw.split(',');
  if (entries.length > MAX_ENTRIES) return { ok: false };
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const trimmed = entry.trim();
    const tag =
      trimmed === PLATFORM_TOKEN ? trimmed : trimmed.replace(/^#+/, '').trim().replace(/\s+/g, '-');
    // Tokens are allowed only as standalone exact tokens, not hashtag shorthand.
    if (!isCanonicalEntry(tag) || (tag === PLATFORM_TOKEN && trimmed !== PLATFORM_TOKEN)) {
      return { ok: false };
    }
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      tags.push(tag);
      seen.add(key);
    }
  }
  return isCanonicalTagTemplates(tags) ? { ok: true, tags } : { ok: false };
}

/** Expand once, retaining the first spelling when a literal and provider coincide. */
export function resolveTagTemplates(
  value: unknown,
  kind: TagTemplateKind,
  platform: AIPlatform
): string[] {
  const seen = new Set<string>();
  return normalizeTagTemplates(value, kind)
    .map(tag => (tag === PLATFORM_TOKEN ? platform : tag))
    .filter(tag => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
