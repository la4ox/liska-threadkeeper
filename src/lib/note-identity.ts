/**
 * Shared "is this file our conversation?" probe (issue #365).
 *
 * The append-mode lookup and the filename-collision probe both answered that
 * question with the same one-liner — `parseFrontmatter(c)?.fields.id === id` —
 * and both collapsed every possible negative into a single silent "not ours".
 * When a duplicate note appeared in the wild there was therefore no way to tell
 * which negative had occurred: a note holding a genuinely different
 * conversation, a note with no `id` at all, an unreadable file, or an empty
 * body. Naming the outcomes is what makes a field report actionable.
 *
 * This module only *classifies*. Identity callers still treat every state other
 * than `same-conversation` as "do not touch"; append additionally excludes
 * immutable archive/presentation notes even when their conversation id matches.
 */

import { parseFrontmatter } from './frontmatter-parser';

/**
 * What a read of a candidate file revealed.
 *
 * - `absent` — the file does not exist (the API answered 404).
 * - `empty` — the file exists but its body is empty. The Local REST API
 *   documents only 200 and 404 for `GET /vault/{filename}`, so a 0-byte note is
 *   a legitimate 200 with an empty body — distinct from "missing", and not
 *   evidence of another conversation.
 * - `unparseable` — content is present but no YAML frontmatter block closes.
 * - `no-id` — frontmatter parses but carries no `id` (e.g. a note written with
 *   the "Include ID" template option turned off, or a hand-written note).
 * - `different-id` — frontmatter carries another conversation's id.
 * - `same-conversation` — this is our note.
 */
export type ProbeState =
  | 'absent'
  | 'empty'
  | 'unparseable'
  | 'no-id'
  | 'different-id'
  | 'same-conversation';

/** Outcome of {@link classifyNoteProbe}. */
export interface NoteProbe {
  state: ProbeState;
  /** The id actually read from the file, when it had a scalar one. */
  foundId?: string;
  /** Archive-bound and branch presentations are immutable append targets. */
  immutableArchivePresentation?: true;
}

const IMMUTABLE_ARCHIVE_FIELDS = [
  'archive_capture_id',
  'archive_manifest_sha256',
  'presentation_mode',
] as const;
const IMMUTABLE_ARCHIVE_KEY_LINE =
  /^(?:(?:archive_capture_id|archive_manifest_sha256|presentation_mode)|"(?:archive_capture_id|archive_manifest_sha256|presentation_mode)"|'(?:archive_capture_id|archive_manifest_sha256|presentation_mode)')\s*:/m;

/** Detect immutable generated fields in parsed data and simple quoted YAML keys. */
export function hasImmutableArchivePresentationFields(
  fields: object,
  rawFrontmatter?: string
): boolean {
  return (
    IMMUTABLE_ARCHIVE_FIELDS.some(field => Object.prototype.hasOwnProperty.call(fields, field)) ||
    (typeof rawFrontmatter === 'string' && IMMUTABLE_ARCHIVE_KEY_LINE.test(rawFrontmatter))
  );
}

/**
 * Classify a candidate file against the conversation we are saving.
 *
 * @param content File content, or null when the file does not exist.
 * @param expectedId The `id` of the conversation being saved.
 */
export function classifyNoteProbe(content: string | null, expectedId: string): NoteProbe {
  if (content === null) return { state: 'absent' };
  if (content === '') return { state: 'empty' };

  const parsed = parseFrontmatter(content);
  if (!parsed) return { state: 'unparseable' };

  const id = parsed.fields.id;
  if (typeof id !== 'string' || id === '') return { state: 'no-id' };

  if (id !== expectedId) return { state: 'different-id', foundId: id };
  const immutableArchivePresentation = hasImmutableArchivePresentationFields(
    parsed.fields,
    parsed.raw
  );
  return {
    state: 'same-conversation',
    foundId: id,
    ...(immutableArchivePresentation && { immutableArchivePresentation: true }),
  };
}

/** True when the probe proves the file holds the conversation being saved. */
export function isSameConversation(probe: NoteProbe): boolean {
  return probe.state === 'same-conversation';
}

/** Append may reuse only an ordinary mutable conversation note. */
export function isAppendEligibleConversation(probe: NoteProbe): boolean {
  return isSameConversation(probe) && probe.immutableArchivePresentation !== true;
}
