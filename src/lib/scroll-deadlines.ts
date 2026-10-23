import {
  SCROLL_IDLE_TIMEOUT,
  SCROLL_MAX_TIMEOUT,
  DEFAULT_SCROLL_IDLE_TIMEOUT_SEC,
  DEFAULT_SCROLL_MAX_TIMEOUT_SEC,
  MIN_SCROLL_IDLE_TIMEOUT_SEC,
  MIN_SCROLL_MAX_TIMEOUT_SEC,
  MAX_SCROLL_TIMEOUT_SEC,
} from './constants';
import type { SyncSettings } from './types';

/** Per-pass limits in milliseconds; the idle limit resets only on engine progress. */
export interface ScrollDeadlines {
  readonly idleTimeoutMs: number;
  readonly maxTimeoutMs: number;
}

export const DEFAULT_SCROLL_DEADLINES: Readonly<ScrollDeadlines> = Object.freeze({
  idleTimeoutMs: SCROLL_IDLE_TIMEOUT,
  maxTimeoutMs: SCROLL_MAX_TIMEOUT,
});

type ScrollBudget = 'idle' | 'max';

/** Strict popup/worker validation; unlike stored normalization, never repairs input. */
export function isValidScrollTimeoutSeconds(value: unknown, budget: ScrollBudget): value is number {
  const minimum = budget === 'idle' ? MIN_SCROLL_IDLE_TIMEOUT_SEC : MIN_SCROLL_MAX_TIMEOUT_SEC;
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= MAX_SCROLL_TIMEOUT_SEC
  );
}

/** Stale/corrupt storage defaults invalid values and clamps positive whole seconds. */
export function normalizeScrollTimeoutSeconds(value: unknown, budget: ScrollBudget): number {
  const fallback =
    budget === 'idle' ? DEFAULT_SCROLL_IDLE_TIMEOUT_SEC : DEFAULT_SCROLL_MAX_TIMEOUT_SEC;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return fallback;
  const minimum = budget === 'idle' ? MIN_SCROLL_IDLE_TIMEOUT_SEC : MIN_SCROLL_MAX_TIMEOUT_SEC;
  return Math.min(MAX_SCROLL_TIMEOUT_SEC, Math.max(minimum, value));
}

/** The sole settings-seconds → runtime-milliseconds conversion and defensive boundary. */
export function resolveScrollDeadlines(
  settings?: Partial<Pick<SyncSettings, 'scrollIdleTimeoutSec' | 'scrollMaxTimeoutSec'>> | null
): Readonly<ScrollDeadlines> {
  return {
    idleTimeoutMs: Math.min(
      SCROLL_MAX_TIMEOUT,
      normalizeScrollTimeoutSeconds(settings?.scrollIdleTimeoutSec, 'idle') * 1000
    ),
    maxTimeoutMs: Math.min(
      SCROLL_MAX_TIMEOUT,
      normalizeScrollTimeoutSeconds(settings?.scrollMaxTimeoutSec, 'max') * 1000
    ),
  };
}

/** Direct engine callers may bypass settings; keep even their limits finite and capped. */
function boundedRuntimeTimeout(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(SCROLL_MAX_TIMEOUT, value)
    : fallback;
}

type RuntimeScrollDeadlineInput = Readonly<Partial<ScrollDeadlines>> | null | undefined;

/** Use the same effective runtime limits for timeout decisions and their diagnostics. */
function normalizeRuntimeScrollDeadlines(
  deadlines: RuntimeScrollDeadlineInput
): Readonly<ScrollDeadlines> {
  return {
    idleTimeoutMs: boundedRuntimeTimeout(deadlines?.idleTimeoutMs, SCROLL_IDLE_TIMEOUT),
    maxTimeoutMs: boundedRuntimeTimeout(deadlines?.maxTimeoutMs, SCROLL_MAX_TIMEOUT),
  };
}

/** A stable DOM is an observation, not a claim of provider completeness. */
export type ScrollStopReason = 'stable' | 'skipped' | 'idle-timeout' | 'max-timeout';
export type ScrollTimeoutReason = Extract<ScrollStopReason, 'idle-timeout' | 'max-timeout'>;

/** Return the first expired deadline, including when a delayed timer crosses both. */
export function getScrollTimeoutReason(
  startTime: number,
  lastProgressTime: number,
  now: number,
  deadlines: RuntimeScrollDeadlineInput = DEFAULT_SCROLL_DEADLINES
): ScrollTimeoutReason | undefined {
  const effectiveDeadlines = normalizeRuntimeScrollDeadlines(deadlines);
  const idleExpiry = lastProgressTime + effectiveDeadlines.idleTimeoutMs;
  const maxExpiry = startTime + effectiveDeadlines.maxTimeoutMs;
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
  deadlines: RuntimeScrollDeadlineInput,
  iterations: number,
  count: number
): void {
  const effectiveDeadlines = normalizeRuntimeScrollDeadlines(deadlines);
  const message = `[G2O] Auto-scroll stopped: ${reason}`;
  const diagnostics = {
    reason,
    elapsedMs: diagnosticNumber(elapsedMs),
    idleTimeoutMs: effectiveDeadlines.idleTimeoutMs,
    maxTimeoutMs: effectiveDeadlines.maxTimeoutMs,
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
