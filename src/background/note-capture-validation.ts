/** Descriptor-safe capture metadata checked before privileged JSON sizing. */
import { hasValidLiskaLossDiagnosticsField } from '../lib/loss-diagnostics';
import type { ObsidianNote } from '../lib/types';

const VALID_DOM_HISTORY_LOADS = ['complete', 'partial', 'unknown'] as const;

function validateDomHistoryLoad(note: ObsidianNote): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(note, 'domHistoryLoad');
  if (!descriptor) return !('domHistoryLoad' in note);
  if (!('value' in descriptor) || !descriptor.enumerable) return false;
  const value = descriptor.value;
  if (
    typeof value !== 'string' ||
    !VALID_DOM_HISTORY_LOADS.includes(value as (typeof VALID_DOM_HISTORY_LOADS)[number])
  ) {
    return false;
  }
  return (
    value !== 'partial' ||
    (Number.isSafeInteger(note.frontmatter.message_count) && note.frontmatter.message_count >= 0)
  );
}

/** Call only after the ordinary note/frontmatter guards have accepted the note. */
export function validateNoteCaptureMetadata(note: ObsidianNote): boolean {
  return validateDomHistoryLoad(note) && hasValidLiskaLossDiagnosticsField(note.frontmatter);
}
