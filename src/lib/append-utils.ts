/**
 * Append mode utilities
 *
 * Core logic for looking up existing files and building appended content.
 * Combines frontmatter-parser, message-counter, and obsidian-api.
 */

import type { ObsidianApiClient } from './obsidian-api';
import type { ObsidianNote, ExtensionSettings, FilenameScheme } from './types';
import { SCAN_MAX_REQUESTS } from './constants';
import { parseFrontmatter, updateFrontmatter, type LineEnding } from './frontmatter-parser';
import { classifyNoteProbe, isAppendEligibleConversation, type NoteProbe } from './note-identity';
import {
  countExistingMessages,
  extractTailMessages,
  hasTrustedMessageBoundaries,
  MESSAGE_BOUNDARY_MARKER,
} from './message-counter';
import { formatDateWithTimezone } from './date-utils';
import { containsPathTraversal, matchesVaultPathTemplate } from './path-utils';

/**
 * Why a lookup failed to find the conversation's existing note (issue #365).
 *
 * A miss makes the save path fork a new file, so when a duplicate turns up in
 * the wild this is the single most useful thing to know. Reported, never acted
 * on — the lookup's behaviour is unchanged.
 *
 * - `no-candidate-suffix` — a `title-id` file name with no id suffix, so no
 *   directory scan is possible at all.
 * - `empty-directory` — the listing returned nothing. `listEntries()` maps a
 *   404 to `[]`, and the Local REST API documents both "directory does not
 *   exist" (404) and that empty directories are not returned, so a missing
 *   folder, an empty one and a swallowed error all look identical here.
 * - `no-candidate-file` — the folder had files, none carrying our id suffix.
 * - `candidate-id-mismatch` — same-suffix files existed but none were ours.
 * - `budget-exhausted` — the scan hit {@link SCAN_MAX_REQUESTS} first, so the
 *   note may well exist beyond the point the scan stopped.
 */
export type LookupMissReason =
  | 'no-candidate-suffix'
  | 'empty-directory'
  | 'no-candidate-file'
  | 'candidate-id-mismatch'
  | 'budget-exhausted';

/**
 * Result of file lookup for append mode
 */
interface FileLookupResult {
  found: boolean;
  path: string;
  content: string;
  matchType: 'direct' | 'memo' | 'id-scan' | 'none';
  /** Only on a miss: which negative occurred (issue #365). */
  missReason?: LookupMissReason;
  /** What the direct-path GET saw. Absent when a memo hit short-circuited it. */
  directProbe?: NoteProbe;
}

/**
 * Result of building appended content
 */
interface AppendResult {
  /**
   * Rebuilt file content (frontmatter + existing body + new messages),
   * **LF-normalised**.
   *
   * The file's own ending is NOT restored here: the caller may still transform
   * the body (callout flattening), and those transforms are written against LF
   * per ADR-026. Restoring early left them matching against a trailing `\r` —
   * see {@link eol}.
   */
  content: string;
  /** Updated LF frontmatter; the caller serializes it only after body acceptance. */
  updatedFrontmatter: string;
  /** Existing LF body. Tail transforms must never rewrite this prefix. */
  existingBody: string;
  /** Newly extracted LF messages, before destination-specific tail transforms. */
  newMessages: string;
  /** Number of new messages appended */
  messagesAppended: number;
  /**
   * The line ending the existing file used. The caller must apply this as the
   * LAST step before writing, after any body transform (ADR-026).
   */
  eol: LineEnding;
}

/** Fixed failure code for an existing note whose append boundary cannot be trusted. */
export const APPEND_BOUNDARY_UNTRUSTED = 'append-message-boundaries-untrusted';

/** Stops append without falling through to a destructive full-note rewrite. */
export class AppendBoundaryError extends Error {
  readonly code = APPEND_BOUNDARY_UNTRUSTED;

  constructor() {
    super(APPEND_BOUNDARY_UNTRUSTED);
    this.name = 'AppendBoundaryError';
  }
}

function frontmatterMessageCount(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : null;
}

function trustedExistingMessageCount(
  body: string,
  fields: Record<string, string | string[]>
): number | null {
  const renderedCount = countExistingMessages(body);
  const storedCount = frontmatterMessageCount(fields.message_count);

  if (hasTrustedMessageBoundaries(body)) {
    if (
      Object.prototype.hasOwnProperty.call(fields, 'message_count') &&
      storedCount !== renderedCount
    )
      return null;
    return renderedCount;
  }

  // Legacy notes have no provenance-bearing message sentinels. Their
  // extension-generated frontmatter count is authoritative; visible labels
  // may include attacker-controlled lookalikes, but cannot safely be fewer
  // than the declared number of messages.
  if (storedCount === null || renderedCount < storedCount) return null;
  return storedCount;
}

/** Strict append-compatible count; null means existing history cannot be trusted. */
export function getTrustedExistingMessageCount(content: string): number | null {
  const parsed = parseFrontmatter(content);
  return parsed ? trustedExistingMessageCount(parsed.body, parsed.fields) : null;
}

/**
 * Extract ID suffix from filename.
 * Extracts the portion after the last hyphen, excluding ".md" extension.
 *
 * @example extractIdSuffix("my-chat-abc12345.md") → "abc12345"
 * @example extractIdSuffix("conversation.md") → ""
 */
export function extractIdSuffix(fileName: string): string {
  const base = fileName.replace(/\.md$/, '');
  const parts = base.split('-');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/** Maximum depth for the recursive ID-scan to bound API calls. */
const RECURSIVE_SCAN_MAX_DEPTH = 6;

/**
 * Options for {@link lookupExistingFile}.
 */
export interface LookupOptions {
  /**
   * When provided AND different from resolvedPath, triggers the recursive scan.
   * Defaults to resolvedPath (preserves the flat-scan behaviour for templates
   * without date variables).
   */
  searchBasePath?: string;
  /**
   * Path where this conversation's file was previously found (caller-memoized).
   * Tried after the current direct path so a cache entry cannot override the
   * destination the current settings resolve explicitly.
   */
  hintPath?: string;
  /**
   * Current destination scope for the hint. A hint without an explicit scope is
   * ignored: conversation identity alone does not authorize a previous path.
   */
  hintScope?: {
    /** Exact configured folder template; date tokens remain rollover variables. */
    folderTemplate: string;
    /** Non-date variables used by the template, including the active provider. */
    variables: Record<string, string>;
  };
  /**
   * File-naming scheme in effect. Decides how scan candidates are pre-filtered;
   * see {@link createCandidateMatcher}. Defaults to `'title-id'`.
   */
  filenameScheme?: FilenameScheme;
}

/** Bounded request allowance shared by a single lookup's directory scan. */
interface ScanBudget {
  /** Consume one request. Returns false once the allowance is exhausted. */
  spend(): boolean;
  /** True once the allowance is used up; lets callers stop iterating early. */
  readonly exhausted: boolean;
}

function createScanBudget(max: number): ScanBudget {
  let used = 0;
  return {
    spend(): boolean {
      if (used >= max) return false;
      used++;
      return true;
    },
    get exhausted(): boolean {
      return used >= max;
    },
  };
}

/** Uniform "no existing file" result. */
function notFound(
  fullPath: string,
  missReason: LookupMissReason,
  directProbe?: NoteProbe
): FileLookupResult {
  return { found: false, path: fullPath, content: '', matchType: 'none', missReason, directProbe };
}

/**
 * What a directory scan saw, so the caller can name the miss.
 *
 * `entries`/`candidates` are counts, not data: they separate "the folder was
 * empty or unreadable" from "the folder had files but none carried our id
 * suffix" from "same-suffix files existed but none were ours".
 */
interface ScanResult {
  hit: FileLookupResult | null;
  entries: number;
  candidates: number;
}

/** No scan was possible (no directory to list). */
const NO_SCAN: ScanResult = { hit: null, entries: 0, candidates: 0 };

/** Name the negative a completed scan represents. */
function scanMissReason(scan: ScanResult, budget: ScanBudget): LookupMissReason {
  if (budget.exhausted) return 'budget-exhausted';
  if (scan.entries === 0) return 'empty-directory';
  if (scan.candidates === 0) return 'no-candidate-file';
  return 'candidate-id-mismatch';
}

/**
 * Build the file-name pre-filter used to pick scan candidates.
 *
 * `title-id` names end in `-{idPrefix}.md`, so the suffix narrows the candidate
 * set to (usually) a single file. `title-date` names end in the SAVE date and
 * carry no conversation identity at all — a note written on the 3rd and
 * re-saved on the 10th shares no file-name component beyond the title slug — so
 * every markdown file must be considered. In both cases the frontmatter id
 * comparison performed by the scan is what actually decides a match; this
 * predicate only avoids reading files that cannot possibly match.
 *
 * Returns null when no scan is possible (a `title-id` name with no suffix).
 */
function createCandidateMatcher(
  fileName: string,
  scheme: FilenameScheme
): ((entry: string) => boolean) | null {
  if (scheme === 'title-date') {
    return entry => entry.endsWith('.md');
  }
  const idSuffix = extractIdSuffix(fileName);
  if (!idSuffix) return null;
  return entry => entry.endsWith(`-${idSuffix}.md`);
}

/**
 * Read a candidate file and return a match result when its frontmatter id is
 * the one we are looking for. Returns null on a budget miss, a missing file, or
 * a different conversation.
 */
async function readCandidate(
  client: ObsidianApiClient,
  candidatePath: string,
  expectedId: string,
  budget: ScanBudget
): Promise<FileLookupResult | null> {
  if (!budget.spend()) return null;
  const content = await client.getFile(candidatePath);
  if (!isAppendEligibleConversation(classifyNoteProbe(content, expectedId))) return null;
  return { found: true, path: candidatePath, content: content as string, matchType: 'id-scan' };
}

/**
 * Try a caller-memoized path only when it remains inside the current configured
 * destination scope. The id is re-verified because the memo may still be stale.
 */
function isHintInsideScope(
  hintPath: string,
  scope: NonNullable<LookupOptions['hintScope']>
): boolean {
  if (hintPath.includes('\\') || containsPathTraversal(hintPath)) {
    return false;
  }
  const separator = hintPath.lastIndexOf('/');
  const folder = separator === -1 ? '' : hintPath.slice(0, separator);
  return matchesVaultPathTemplate(folder, scope.folderTemplate, scope.variables);
}

async function tryHintPath(
  client: ObsidianApiClient,
  hintPath: string | undefined,
  hintScope: LookupOptions['hintScope'],
  fullPath: string,
  expectedId: string
): Promise<FileLookupResult | null> {
  if (!hintPath || !hintScope || hintPath === fullPath || !isHintInsideScope(hintPath, hintScope)) {
    return null;
  }
  const content = await client.getFile(hintPath);
  if (!isAppendEligibleConversation(classifyNoteProbe(content, expectedId))) return null;
  return { found: true, path: hintPath, content: content as string, matchType: 'memo' };
}

/**
 * Look up an existing file for a conversation.
 *
 * Strategy (ordered by authority, then cost):
 * 1. Direct path: GET fullPath → verify frontmatter ID
 * 2. Scoped memo hint: GET the previously found path → verify frontmatter ID
 * 3a. ID scan (flat): listFiles(resolvedPath) → filter by ID suffix → verify frontmatter ID
 * 3b. ID scan (recursive): when {@link searchBasePath} differs from resolvedPath
 *     (i.e. the vault-path template contains date variables), walk subdirectories
 *     from searchBasePath looking for `-{idSuffix}.md` matches. This lets append-mode
 *     find a previous-month file even when the current resolved path points at a
 *     not-yet-existing folder.
 * 4. Not found
 *
 * @param searchBasePath - Optional. When provided AND different from resolvedPath,
 *   triggers the recursive scan. Defaults to resolvedPath (preserves the legacy
 *   flat-scan behaviour for templates without date variables).
 * @param hintPath - Optional. Path where this conversation's file was previously
 *   found (caller-memoized). Tried after the current direct path and only inside
 *   {@link LookupOptions.hintScope}.
 */
export async function lookupExistingFile(
  client: ObsidianApiClient,
  fullPath: string,
  resolvedPath: string,
  note: ObsidianNote,
  options: LookupOptions = {}
): Promise<FileLookupResult> {
  const {
    searchBasePath = resolvedPath,
    hintPath,
    hintScope,
    filenameScheme = 'title-id',
  } = options;
  const expectedId = note.frontmatter.id;

  // Step 1: Direct path match
  const directContent = await client.getFile(fullPath);
  const directProbe = classifyNoteProbe(directContent, expectedId);
  if (isAppendEligibleConversation(directProbe)) {
    return {
      found: true,
      path: fullPath,
      content: directContent as string,
      matchType: 'direct',
      directProbe,
    };
  }

  // Step 2: A scoped hint is an optimization, never authority over the current path.
  const memoHit = await tryHintPath(client, hintPath, hintScope, fullPath, expectedId);
  if (memoHit) return { ...memoHit, directProbe };

  // Step 3: Directory scan, bounded by a shared request budget
  const matches = createCandidateMatcher(note.fileName, filenameScheme);
  if (!matches) return notFound(fullPath, 'no-candidate-suffix', directProbe);

  const budget = createScanBudget(SCAN_MAX_REQUESTS);
  const useRecursive = searchBasePath !== resolvedPath && searchBasePath !== '';

  const scan = useRecursive
    ? await recursiveIdScan(client, searchBasePath, matches, expectedId, fullPath, budget)
    : resolvedPath
      ? await flatIdScan(client, resolvedPath, matches, expectedId, fullPath, budget)
      : NO_SCAN;
  if (scan.hit) return { ...scan.hit, directProbe };

  // Step 4: Not found
  return notFound(fullPath, scanMissReason(scan, budget), directProbe);
}

/**
 * Scan a single directory for a candidate `.md` file (per {@link matches})
 * whose frontmatter id equals expectedId. Returns the first match, or null.
 *
 * Non-recursive sibling of {@link recursiveIdScan}, used when the vault path
 * template has no date variables (legacy flat-scan behaviour).
 */
async function flatIdScan(
  client: ObsidianApiClient,
  dir: string,
  matches: (entry: string) => boolean,
  expectedId: string,
  skipPath: string,
  budget: ScanBudget
): Promise<ScanResult> {
  if (!budget.spend()) return NO_SCAN;
  const files = await client.listFiles(dir);
  let candidates = 0;

  for (const file of files) {
    if (budget.exhausted) break;
    if (!matches(file)) continue;
    const candidatePath = `${dir}/${file}`;
    if (candidatePath === skipPath) continue; // Already checked as direct match
    candidates++;
    const hit = await readCandidate(client, candidatePath, expectedId, budget);
    if (hit) return { hit, entries: files.length, candidates };
  }

  return { hit: null, entries: files.length, candidates };
}

/**
 * Walk subdirectories from baseDir up to {@link RECURSIVE_SCAN_MAX_DEPTH},
 * looking for a candidate `.md` file (per {@link matches}) whose frontmatter id
 * equals expectedId. Returns the first match, or null when exhausted.
 *
 * Depth is bounded by RECURSIVE_SCAN_MAX_DEPTH; total request count is bounded
 * by the shared {@link ScanBudget}, since breadth is not otherwise limited.
 */
async function recursiveIdScan(
  client: ObsidianApiClient,
  baseDir: string,
  matches: (entry: string) => boolean,
  expectedId: string,
  skipPath: string,
  budget: ScanBudget
): Promise<ScanResult> {
  type Frame = { dir: string; depth: number };
  const queue: Frame[] = [{ dir: baseDir, depth: 0 }];
  let seen = 0;
  let candidates = 0;

  while (queue.length > 0) {
    const { dir, depth } = queue.shift() as Frame;
    if (!budget.spend()) return { hit: null, entries: seen, candidates };
    const entries = await client.listEntries(dir);
    seen += entries.length;
    for (const entry of entries) {
      if (entry.endsWith('/')) {
        if (depth + 1 <= RECURSIVE_SCAN_MAX_DEPTH) {
          const subdir = entry.slice(0, -1);
          queue.push({ dir: `${dir}/${subdir}`, depth: depth + 1 });
        }
        continue;
      }
      if (!matches(entry)) continue;
      const candidatePath = `${dir}/${entry}`;
      if (candidatePath === skipPath) continue;
      candidates++;
      const hit = await readCandidate(client, candidatePath, expectedId, budget);
      if (hit) return { hit, entries: seen, candidates };
    }
  }

  return { hit: null, entries: seen, candidates };
}

/**
 * Build appended file content.
 * Returns null only if there are no new messages. Untrusted input throws.
 */
export function buildAppendContent(
  existingContent: string,
  note: ObsidianNote,
  settings: ExtensionSettings
): AppendResult | null {
  // 1. Parse existing frontmatter
  const parsed = parseFrontmatter(existingContent);
  if (!parsed) throw new AppendBoundaryError();

  // 2. Resolve existing message identity from v1 sentinels or trusted legacy
  // frontmatter. Never derive authority solely from ambiguous visible labels.
  const existingCount = trustedExistingMessageCount(parsed.body, parsed.fields);
  if (existingCount === null) throw new AppendBoundaryError();

  // 3. Compare counts
  const newTotal = note.frontmatter.message_count;
  if (newTotal <= existingCount) return null; // No new messages

  // 4. The freshly generated body must carry exact extension-owned message
  // sentinels. This makes its tail offset independent of provider Markdown.
  if (!hasTrustedMessageBoundaries(note.body) || countExistingMessages(note.body) !== newTotal) {
    throw new AppendBoundaryError();
  }

  // 5. Extract tail messages from the new formatted body
  // (note.body is exactly what generateNoteContent would embed after the frontmatter)
  let newMessages = extractTailMessages(note.body, existingCount);
  if (!newMessages) throw new AppendBoundaryError();

  // `extractTailMessages(..., 0)` intentionally returns the complete freshly
  // generated body, including its format declaration. Keep that declaration
  // only when the existing body is empty/whitespace, where it becomes the
  // first non-empty line and upgrades a legacy zero-message note. A trusted
  // empty note already owns the declaration; a non-empty legacy note must stay
  // legacy rather than gaining a declaration halfway through its body.
  if (existingCount === 0 && hasTrustedMessageBoundaries(note.body) && parsed.body.trim() !== '') {
    const firstMessage = newMessages.indexOf(MESSAGE_BOUNDARY_MARKER);
    if (firstMessage < 0) throw new AppendBoundaryError();
    newMessages = newMessages.slice(firstMessage);
  }

  // 6. Update frontmatter fields
  const timezone = settings.templateOptions.timezone ?? 'UTC';
  const updatedRaw = updateFrontmatter(parsed.raw, {
    modified: formatDateWithTimezone(new Date(), timezone),
    message_count: newTotal,
  });

  // 7. Rebuild: updated frontmatter + existing body + separator + new messages
  //
  // Everything above works on the LF-normalised forms parseFrontmatter returns,
  // and the result stays LF here. The file's own ending is restored by the
  // caller as the last step before the write, so that any body transform it
  // still applies also sees LF (ADR-026). An append must add to the file, not
  // rewrite every line of it (#365).
  const content = updatedRaw + '\n' + parsed.body + '\n\n' + newMessages;

  return {
    content,
    updatedFrontmatter: updatedRaw,
    existingBody: parsed.body,
    newMessages,
    messagesAppended: newTotal - existingCount,
    eol: parsed.eol,
  };
}
