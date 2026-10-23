import { SCROLL_IDLE_TIMEOUT, SCROLL_MAX_TIMEOUT } from './constants';

/** Per-pass limits in milliseconds; the idle limit resets only on engine progress. */
export interface ScrollDeadlines {
  readonly idleTimeoutMs: number;
  readonly maxTimeoutMs: number;
}

export const DEFAULT_SCROLL_DEADLINES: Readonly<ScrollDeadlines> = Object.freeze({
  idleTimeoutMs: SCROLL_IDLE_TIMEOUT,
  maxTimeoutMs: SCROLL_MAX_TIMEOUT,
});

/** A stable DOM is an observation, not a claim of provider completeness. */
export type ScrollStopReason = 'stable' | 'skipped' | 'idle-timeout' | 'max-timeout';
export type ScrollTimeoutReason = Extract<ScrollStopReason, 'idle-timeout' | 'max-timeout'>;

/** Return the first expired deadline, including when a delayed timer crosses both. */
export function getScrollTimeoutReason(
  startTime: number,
  lastProgressTime: number,
  now: number,
  deadlines: Readonly<ScrollDeadlines> = DEFAULT_SCROLL_DEADLINES
): ScrollTimeoutReason | undefined {
  const idleExpiry = lastProgressTime + deadlines.idleTimeoutMs;
  const maxExpiry = startTime + deadlines.maxTimeoutMs;
  if (now < Math.min(idleExpiry, maxExpiry)) return undefined;
  return idleExpiry <= maxExpiry ? 'idle-timeout' : 'max-timeout';
}

export function isScrollTimeoutReason(reason: ScrollStopReason): reason is ScrollTimeoutReason {
  return reason === 'idle-timeout' || reason === 'max-timeout';
}

// Keep diagnostic numbers finite, non-negative, integral and bounded even if a
// suspended page resumes much later or a caller supplies malformed counters.
function diagnosticNumber(value: number): number {
  return Number.isFinite(value) ? Math.min(1_000_000_000, Math.max(0, Math.floor(value))) : 0;
}

/** The same content-free terminal diagnostic is used by both scrolling engines. */
export function logScrollStop(
  reason: ScrollStopReason,
  elapsedMs: number,
  deadlines: Readonly<ScrollDeadlines>,
  iterations: number,
  count: number
): void {
  const message = `[G2O] Auto-scroll stopped: ${reason}`;
  const diagnostics = {
    reason,
    elapsedMs: diagnosticNumber(elapsedMs),
    idleTimeoutMs: diagnosticNumber(deadlines.idleTimeoutMs),
    maxTimeoutMs: diagnosticNumber(deadlines.maxTimeoutMs),
    iterations: diagnosticNumber(iterations),
    count: diagnosticNumber(count),
  };
  if (isScrollTimeoutReason(reason)) console.warn(message, diagnostics);
  else console.info(message, diagnostics);
}

/** No warning for stable/skipped observations, and no inference from legacy flags. */
export function buildScrollTimeoutWarning(reason: ScrollTimeoutReason, count: number): string;
export function buildScrollTimeoutWarning(
  reason: ScrollStopReason,
  count: number
): string | undefined;
export function buildScrollTimeoutWarning(
  reason: ScrollStopReason,
  count: number
): string | undefined {
  if (!isScrollTimeoutReason(reason)) return undefined;
  const explanation =
    reason === 'idle-timeout' ? 'no loading progress' : 'safety time limit reached';
  return (
    `Auto-scroll timed out (${reason}: ${explanation}). ` +
    `Some earlier messages may be missing (${diagnosticNumber(count)} turns loaded). ` +
    'Load earlier messages and retry.'
  );
}
