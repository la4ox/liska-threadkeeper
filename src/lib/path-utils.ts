/**
 * Path security utilities
 * Prevents path traversal attacks
 */

/**
 * Detect path traversal attacks
 *
 * Note: A naive path.includes('..') would produce false positives for
 * legitimate filenames like foo..bar, so a more precise regex is used.
 */
export function containsPathTraversal(path: string): boolean {
  // Detect null bytes (filesystem string terminator attack)
  if (path.includes('\0')) return true;
  // Detect ../ or ..\ only when combined with path separators:
  // ^..   : leading ..
  // /.. or \.. : .. after path separator
  // ../ or ..\ : .. before path separator
  // ..$   : trailing ..
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path)) return true;
  // Detect absolute paths, including Windows rooted (\foo) and UNC (\\server) forms
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) return true;
  // Detect URL-encoded .. combined with path separators
  if (/(?:^|%2f|%5c)%2e%2e(?:%2f|%5c|$)/i.test(path)) return true;
  return false;
}

/**
 * Resolve template variables in a vault path.
 * Supported variables: {platform}, {YYYY}, {YY}, {MM}, {DD}
 * Unknown variables are preserved as-is (safe fallback).
 *
 * Date variables ({YYYY}, {YY}, {MM}, {DD}) are typically supplied via
 * {@link getDateVariables} at save time, in the user's local time zone.
 *
 * @example
 * resolvePathTemplate('AI/{platform}', { platform: 'gemini' })
 * // → 'AI/gemini'
 *
 * @example
 * resolvePathTemplate('AI/{platform}/{YYYY}/{MM}', {
 *   platform: 'gemini', YYYY: '2026', MM: '05',
 * })
 * // → 'AI/gemini/2026/05'
 */
export function resolvePathTemplate(path: string, variables: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (match, key: string) => {
    return key in variables ? variables[key] : match;
  });
}

/**
 * Date-template tokens recognised by {@link resolvePathTemplate}.
 * Used by {@link getSearchBasePath} to detect the date-templated portion of a path.
 */
const DATE_TOKEN_PATTERN = /\{(YYYY|YY|MM|DD)\}/;
const TEMPLATE_TOKEN_PATTERN = /\{(\w+)\}/g;
const DATE_SCOPE_PATTERNS: Readonly<Record<string, string>> = {
  YYYY: '\\d{4}',
  YY: '\\d{2}',
  MM: '\\d{2}',
  DD: '\\d{2}',
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Test whether a resolved vault folder belongs to one exact configured path
 * template. Date tokens remain variable so a memoized append path can survive
 * calendar rollover, including tokens embedded inside a path segment.
 */
export function matchesVaultPathTemplate(
  path: string,
  template: string,
  variables: Record<string, string>
): boolean {
  if (path.includes('\\') || containsPathTraversal(path)) return false;

  let pattern = '^';
  let offset = 0;
  for (const match of template.matchAll(TEMPLATE_TOKEN_PATTERN)) {
    const index = match.index;
    const token = match[0];
    const key = match[1];
    pattern += escapeRegExp(template.slice(offset, index));
    pattern += DATE_SCOPE_PATTERNS[key] ?? escapeRegExp(variables[key] ?? token);
    offset = index + token.length;
  }
  pattern += `${escapeRegExp(template.slice(offset))}$`;
  return new RegExp(pattern).test(path);
}

/**
 * Build the date variables object for the given date in local time.
 * Months and days are zero-padded to 2 digits; years are 4 digits ({YYYY}) and 2 digits ({YY}).
 *
 * Local time zone is intentional: it matches how users mentally bucket "today's notes".
 *
 * @example
 * getDateVariables(new Date(2026, 0, 3)) // → { YYYY: '2026', YY: '26', MM: '01', DD: '03' }
 */
export function getDateVariables(date: Date): Record<string, string> {
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  return {
    YYYY: yyyy,
    YY: yyyy.slice(-2),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    DD: String(date.getDate()).padStart(2, '0'),
  };
}

/**
 * Resolve a vault-path template up to (but not including) the first date token.
 *
 * Used by append-mode to scope its recursive lookup: if the template uses
 * date variables, the existing-file scan starts from this base path so that
 * cross-month edits still find the original file.
 *
 * Returns the fully resolved path when no date tokens are present.
 *
 * @example
 * getSearchBasePath('AI/{platform}/{YYYY}/{MM}', { platform: 'gemini' })
 * // → 'AI/gemini'
 *
 * @example
 * getSearchBasePath('AI/{platform}', { platform: 'gemini' })
 * // → 'AI/gemini'
 */
export function getSearchBasePath(template: string, variables: Record<string, string>): string {
  const match = DATE_TOKEN_PATTERN.exec(template);
  // The prefix ends before the first date token, so it can only contain
  // non-date variables ({platform} etc.) — no filtering needed.
  const prefix = match ? template.slice(0, match.index) : template;
  const resolved = resolvePathTemplate(prefix, variables);
  return resolved.replace(/\/+$/, '');
}
