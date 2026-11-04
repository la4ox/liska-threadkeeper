import type { JournalAttempt, ResumabilityJournal } from './contracts';
import { fail } from './safe-data';

function interruption(attempt: JournalAttempt | undefined): 'pause' | 'cancel' | undefined {
  if (attempt?.state !== 'settled' || attempt.outcome.kind !== 'unknown') return undefined;
  if (attempt.outcome.reason === 'interrupted-by-cancel') return 'cancel';
  if (['interrupted-by-pause', 'interrupted-by-restart'].includes(attempt.outcome.reason))
    return 'pause';
  return undefined;
}

function history(journal: ResumabilityJournal) {
  let transitions = 0;
  let pauses = 0;
  let cancellations = 0;
  let terminalPause = false;
  for (const item of journal.items) {
    for (const attempt of item.attempts) {
      transitions += 1 + attempt.revision;
      if (interruption(attempt) === 'pause') pauses += 1;
      if (interruption(attempt) === 'cancel') cancellations += 1;
    }
    if (interruption(item.attempts[item.attempts.length - 1]) === 'pause') terminalPause = true;
  }
  return { transitions, pauses, cancellations, terminalPause };
}

/**
 * Minimum over histories compatible with the retained evidence, not a provenance
 * claim. Begin and settlement each cost one revision; interruption settlement
 * already includes its pause/cancel. Each interrupted execution phase requires
 * reactivation before further work. Item histories have no cross-item ordering,
 * so one last-in-item pause may be the final attempt, saving that reactivation.
 */
function minimumRevision(journal: ResumabilityJournal): number {
  const { transitions, pauses, cancellations, terminalPause } = history(journal);
  const cancelled =
    journal.control === 'cancelled' || journal.items.some(item => item.state === 'cancelled');
  if (cancelled) {
    // A global cancel leaves no eligible item. Recovery cannot resurrect work.
    if (
      cancellations > 1 ||
      journal.items.some(item => !['recorded', 'cancelled'].includes(item.state))
    )
      fail('invalid-journal');
    const activations =
      Number(transitions > 0) + pauses - Number(cancellations === 0 && terminalPause);
    const cancellation = Number(cancellations === 0);
    const afterCancel = journal.control === 'cancelled' ? 0 : journal.control === 'paused' ? 1 : 2;
    return transitions + activations + cancellation + afterCancel;
  }
  if (journal.control === 'active') return transitions + 1 + pauses;
  if (journal.control === 'paused')
    return transitions === 0 ? 0 : transitions + 1 + pauses + (terminalPause ? -1 : 1);
  // Completion is a distinct transition; an earlier pause cannot replace it.
  return transitions + Number(transitions > 0) + pauses + 1;
}

export function validateMinimumRevision(journal: ResumabilityJournal): void {
  if (journal.revision < minimumRevision(journal)) fail('invalid-journal');
}
