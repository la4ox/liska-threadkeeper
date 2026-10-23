import { isAppendEligibleConversation, type NoteProbe } from './note-identity';

export const TRUNCATED_OVERWRITE_ERROR =
  'Refused to replace a more complete note with a truncated capture. Load earlier messages and retry.';
export const TRUNCATION_PROTECTION_UNAVAILABLE_WARNING =
  'Truncation protection unavailable: the existing note has no valid message count.';

type TruncationDecision = { allowed: true; warning?: string } | { allowed: false; error: string };

/** Protect only a proven mutable same-conversation target from detected DOM truncation. */
export function guardTruncatedOverwrite(
  truncated: boolean | undefined,
  incomingCount: number,
  prior: NoteProbe
): TruncationDecision {
  if (truncated !== true || !isAppendEligibleConversation(prior)) return { allowed: true };
  if (prior.messageCount === undefined) {
    return { allowed: true, warning: TRUNCATION_PROTECTION_UNAVAILABLE_WARNING };
  }
  return incomingCount < prior.messageCount
    ? { allowed: false, error: TRUNCATED_OVERWRITE_ERROR }
    : { allowed: true };
}
