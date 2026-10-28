/**
 * Regex-based YAML frontmatter parser
 *
 * Parses and updates YAML frontmatter without external YAML libraries.
 * Handles key:value pairs, tag lists, and quoted values.
 */

import { escapeYamlValue } from './yaml-utils';

/** Line ending a file uses. Lone CR is legacy but costs nothing to support. */
export type LineEnding = '\r\n' | '\n' | '\r';

/**
 * Line ending this content uses, taken from its first occurrence.
 *
 * First-occurrence wins is deliberate: it is deterministic and cheap, and a
 * mixed-ending file ends up consistently on whichever style it opened with
 * rather than staying mixed.
 */
export function detectLineEnding(content: string): LineEnding {
  const match = /\r\n|\r|\n/.exec(content);
  return (match?.[0] as LineEnding | undefined) ?? '\n';
}

/** Rewrite every line ending in `content` to `eol`. */
export function applyLineEnding(content: string, eol: LineEnding): string {
  return eol === '\n' ? content : content.replace(/\n/g, eol);
}

/** Locate the first exact closing `---` line without normalizing source bytes. */
export function findFrontmatterClosingDelimiter(content: string): { end: number } | null {
  if (!content.startsWith('---')) return null;
  const pattern = /(?:\r\n|\r|\n)---(?=\r\n|\r|\n|$)/g;
  pattern.lastIndex = 3;
  const match = pattern.exec(content);
  return match ? { end: match.index + match[0].length } : null;
}

/**
 * Parsed frontmatter result
 */
interface ParsedFrontmatter {
  /** Raw frontmatter string including --- delimiters, normalised to LF */
  raw: string;
  /** Parsed key-value pairs (tags stored as string[]) */
  fields: Record<string, string | string[]>;
  /** Body content after frontmatter, normalised to LF */
  body: string;
  /**
   * Line ending the source content used, so a writer can restore it (#365).
   * `raw` and `body` are always LF; the caller re-applies this on the way out.
   */
  eol: LineEnding;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns null if no valid frontmatter found.
 *
 * Line endings are normalised to LF before anything is matched. A CR-terminated
 * line defeats the key-value pattern below outright: a wildcard matches every
 * character *except* line terminators, U+000D CR is one of them, and `$`
 * without the `m` flag only matches at the end of the input (MDN). A file
 * rewritten on Windows therefore parsed as a valid frontmatter block with zero
 * fields, so `fields.id` came back undefined and the save path forked a
 * duplicate note for a file that was its own (issue #365).
 */
export function parseFrontmatter(content: string): ParsedFrontmatter | null {
  // Must start with ---
  if (!content.startsWith('---')) return null;

  const eol = detectLineEnding(content);
  const closing = findFrontmatterClosingDelimiter(content);
  if (!closing) return null;
  const rawSource = content.substring(0, closing.end);
  const raw = rawSource.replace(/\r\n|\r/g, '\n');

  // Body is everything after closing --- (skip leading newline)
  let body = content.substring(closing.end).replace(/^(?:\r\n|\r|\n)/, '');
  body = body.replace(/\r\n|\r/g, '\n');

  // Parse fields from the inner YAML block
  const closingIndex = raw.lastIndexOf('\n---');
  const yamlBlock = raw.substring(4, closingIndex); // skip opening '---\n'
  const fields: Record<string, string | string[]> = {};
  let currentKey = '';

  for (const line of yamlBlock.split('\n')) {
    // List item: "  - value"
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      const existing = fields[currentKey];
      const value = stripQuotes(listMatch[1].trim());
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        fields[currentKey] = [value];
      }
      continue;
    }

    // Key-value pair: "key: value" or "key:"
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const rawValue = kvMatch[2].trim();
      if (rawValue === '') {
        // Could be a list header (e.g., "tags:")
        fields[currentKey] = [];
      } else {
        fields[currentKey] = stripQuotes(rawValue);
      }
    }
  }

  return { raw, fields, body, eol };
}

/**
 * Strip surrounding quotes from a YAML value
 */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.substring(1, value.length - 1);
  }
  return value;
}

/**
 * Update specific fields in raw frontmatter string.
 * Preserves all other fields and formatting.
 * Only modifies lines matching the update keys; does NOT add missing keys.
 */
export function updateFrontmatter(
  rawFrontmatter: string,
  updates: Record<string, string | number>
): string {
  const lines = rawFrontmatter.split('\n');
  const result: string[] = [];

  // Pre-compile one pattern per update key (instead of per line × key)
  const compiledUpdates = Object.entries(updates).map(([key, value]) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { key, value, pattern: new RegExp(`^${escapedKey}\\s*:`) };
  });

  for (const line of lines) {
    let replaced = false;
    for (const { key, value, pattern } of compiledUpdates) {
      if (pattern.test(line)) {
        // Use raw number for numeric values, escape strings
        const formattedValue =
          typeof value === 'number' ? String(value) : escapeYamlValue(String(value));
        result.push(`${key}: ${formattedValue}`);
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      result.push(line);
    }
  }

  return result.join('\n');
}
