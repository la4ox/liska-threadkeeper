/**
 * Auto-scroll coordination for lazy-loaded content
 *
 * Scrolls a container to trigger loading of all elements (e.g., Gemini's
 * infinite-scroller) and waits until the DOM stabilizes.
 */

import {
  SCROLL_POLL_INTERVAL,
  SCROLL_IDLE_TIMEOUT,
  SCROLL_MAX_TIMEOUT,
  SCROLL_STABILITY_THRESHOLD,
  SCROLL_REARM_DELAY,
  SCROLL_ACCUMULATE_POLL_INTERVAL,
  SCROLL_ACCUMULATE_STEP_FACTOR,
  SCROLL_ACCUMULATE_MIN_STEP,
} from './constants';
import { createScrollAxis, type ScrollAxis } from './scroll-axis';

/**
 * Progress-aware accumulation deadline (issue #360, ADR-018).
 *
 * A scroll pass keeps running while it is still making progress: the pass is
 * live until either nothing has progressed for {@link SCROLL_IDLE_TIMEOUT}
 * (a stuck/broken scroll) or the absolute {@link SCROLL_MAX_TIMEOUT} safety cap
 * is reached. Callers reset `lastProgressTime` on every iteration that makes
 * progress, so a genuinely-long conversation is never cut off mid-scroll. What
 * counts as progress is engine-specific: newly-loaded elements for Gemini's
 * infinite-scroller, a new turn *or* upward scroll movement for the virtualized
 * engine (see {@link scrollUpUntilStable}).
 *
 * @param startTime When the pass began (`Date.now()`).
 * @param lastProgressTime When the pass last made progress (`Date.now()`).
 */
function withinDeadline(startTime: number, lastProgressTime: number): boolean {
  const now = Date.now();
  return now - lastProgressTime < SCROLL_IDLE_TIMEOUT && now - startTime < SCROLL_MAX_TIMEOUT;
}

/**
 * Result of the auto-scroll process
 */
export interface ScrollResult {
  /** Whether all messages loaded before timeout */
  fullyLoaded: boolean;
  /** Number of elements found after scrolling */
  elementCount: number;
  /** Total scroll-poll iterations performed */
  scrollIterations: number;
  /** Whether scrolling was unnecessary (already at top or no container) */
  skipped: boolean;
}

/**
 * Wait for a specified duration
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Count elements matching the given selector in the document
 */
function countElements(selector: string): number {
  return document.querySelectorAll(selector).length;
}

/**
 * Scroll to top of a container to trigger lazy loading of all elements.
 *
 * Gemini's infinite-scroller fires `onScrolledTopPastThreshold` (edge-triggered)
 * when scrollTop crosses **below** a threshold. To re-trigger on subsequent
 * iterations, we must first scroll **above** the threshold (re-arm) by jumping
 * to scrollHeight, then back to 0.
 *
 * Verified via getEventListeners() on live Gemini page (2026-02-21):
 *   - scroll, onInitialScroll, onScrolledTopPastThreshold
 *
 * @param container The scrollable container element
 * @param elementSelector CSS selector for the elements to count
 */
export async function ensureAllElementsLoaded(
  container: HTMLElement,
  elementSelector: string
): Promise<ScrollResult> {
  const initialCount = countElements(elementSelector);

  if (container.scrollTop === 0) {
    console.info(
      `[G2O] scrollTop=0, scrollHeight=${container.scrollHeight}, ` +
        `clientHeight=${container.clientHeight}, elements=${initialCount}`
    );
    return { fullyLoaded: true, elementCount: initialCount, scrollIterations: 0, skipped: true };
  }

  console.info(
    `[G2O] Partial load detected — scrollTop=${container.scrollTop}, ` +
      `elements=${initialCount}, auto-scrolling`
  );

  let previousCount = 0;
  let stableCount = 0;
  let iterations = 0;
  const startTime = Date.now();
  let lastProgressTime = startTime;

  while (withinDeadline(startTime, lastProgressTime)) {
    // Re-arm: if already at top, scroll to bottom first so the next
    // scroll-to-0 crosses the onScrolledTopPastThreshold edge trigger.
    if (container.scrollTop === 0) {
      container.scrollTop = container.scrollHeight;
      await delay(SCROLL_REARM_DELAY);
    }

    // Scroll to top — crosses the threshold, triggering content loading
    container.scrollTop = 0;
    await delay(SCROLL_POLL_INTERVAL);

    const currentCount = countElements(elementSelector);
    iterations++;

    console.debug(
      `[G2O] Scroll iteration ${iterations}: elements=${currentCount}, ` +
        `scrollTop=${container.scrollTop}, scrollHeight=${container.scrollHeight}`
    );

    if (currentCount === previousCount) {
      stableCount++;
      if (stableCount >= SCROLL_STABILITY_THRESHOLD) {
        console.info(
          `[G2O] DOM stabilized after ${iterations} iterations with ${currentCount} elements`
        );
        return {
          fullyLoaded: true,
          elementCount: currentCount,
          scrollIterations: iterations,
          skipped: false,
        };
      }
    } else {
      console.debug(`[G2O] Element count changed: ${previousCount} -> ${currentCount}`);
      stableCount = 0;
      previousCount = currentCount;
      lastProgressTime = Date.now(); // progress → reset the idle deadline
    }
  }

  const finalCount = countElements(elementSelector);
  console.warn(
    `[G2O] Auto-scroll timed out (no new elements for ${SCROLL_IDLE_TIMEOUT / 1000}s) ` +
      `with ${finalCount} elements`
  );
  return {
    fullyLoaded: false,
    elementCount: finalCount,
    scrollIterations: iterations,
    skipped: false,
  };
}

// ============================================================
// Accumulation engine for virtualized platforms (Claude, ChatGPT)
// ============================================================

/** One turn harvested from the currently-mounted window. */
export interface HarvestEntry<T> {
  /** Stable per-turn identity used for de-duplication across windows. */
  key: string;
  /** The extracted value (e.g. a ConversationMessage). */
  value: T;
  /**
   * Optional monotonic conversation-order index for this turn (Claude's
   * `data-index`, ChatGPT's `conversation-turn-N` ordinal). When *every*
   * harvested turn supplies one, accumulation orders the result by it; otherwise
   * the order established by {@link mergeWindow} stands. Both paths are expected
   * to agree — the index is a second, independent signal, not a repair for the
   * merge (issues #352, #353).
   */
  order?: number;
}

/** Platform-specific tuning for one virtualized accumulation pass. */
export interface AccumulateOptions {
  /** Re-resolve the same exact provider scroll-root policy during a pass. */
  readonly resolveContainer?: () => HTMLElement | null;
  /** Positive, finite rebind budget; required when resolveContainer is supplied. */
  readonly maxContainerRebinds?: number;
  /** Provider-owned synchronous first-step prime with an explicit per-root bound. */
  readonly primeWithRelativeTopNudge?: (container: HTMLElement, step: number) => void;
  /** Exact per-root prime attempt bound; 1..2 when a callback is supplied. */
  readonly maxRelativeTopNudgesPerRoot?: number;
  /** Provider proof that no older-history marker remains at the visible top. */
  readonly canCompleteAtTop?: (container: HTMLElement) => boolean;
  /** Fraction of the viewport per upward step (default 0.6). */
  readonly stepFactor?: number;
  /** Minimum upward step in pixels (default 400). */
  readonly minStep?: number;
  /** Rest after each scroll, including the initial bottom pin (default 400ms). */
  readonly pollIntervalMs?: number;
  /**
   * Required visible rest at the oldest/top edge before completion. Platforms
   * that load another page only after reaching the top use this to avoid a
   * premature stable result. Default zero preserves existing behavior.
   */
  readonly topSettleMs?: number;
}

/** Result of accumulating a virtualized conversation via scrolling. */
export interface AccumulateResult<T> {
  /** De-duplicated values in conversation order (first turn → last turn). */
  items: T[];
  /** Whether harvesting stabilized at the top before timing out. */
  fullyLoaded: boolean;
  /** Number of distinct turns captured. */
  itemCount: number;
  /** Upward scroll/harvest iterations performed. */
  iterations: number;
  /** Whether scrolling was unnecessary (already at the top). */
  skipped: boolean;
}

/**
 * Merge a newly-harvested window of keys into the accumulated ordering.
 *
 * A window's DOM order is always globally truthful — it is document order — so
 * every already-seen key in it is a valid **anchor**: each run of not-yet-seen
 * keys belongs immediately before the seen key that follows it. Merging by
 * anchor rather than by aligning the window's suffix against the accumulated
 * head is what makes this correct when the newest turns never evict: on both
 * Claude and ChatGPT the last few turns stay mounted in *every* window, so a
 * window harvested near the top looks like `[0…6, <persistent tail>]`. Its
 * suffix is that tail and can never match the accumulated (older) head, but the
 * anchor it needs — the first key it shares with the accumulation — is right
 * there in the window (issues #352, #353).
 *
 * A trailing run with no following anchor goes directly after the last anchor;
 * a window sharing nothing with the accumulation is prepended whole, since
 * windows are only ever harvested while scrolling **upward**. Keys are never
 * dropped and the result never contains duplicates.
 *
 * @param accumulated Keys gathered so far, in conversation order.
 * @param window Keys from the current window, in DOM (top→bottom) order.
 */
export function mergeWindow(accumulated: readonly string[], window: readonly string[]): string[] {
  if (accumulated.length === 0) return dedupeKeys(window);
  if (window.length === 0) return [...accumulated];

  const known = new Set(accumulated);
  const runBefore = new Map<string, string[]>(); // anchor key → run to insert ahead of it
  const staged = new Set<string>();
  let run: string[] = [];
  let lastAnchor: string | null = null;

  for (const key of window) {
    if (known.has(key)) {
      if (run.length > 0) {
        runBefore.set(key, [...(runBefore.get(key) ?? []), ...run]);
        run = [];
      }
      lastAnchor = key;
    } else if (!staged.has(key)) {
      staged.add(key);
      run.push(key);
    }
  }

  const lead = lastAnchor === null ? run : [];
  const trail = lastAnchor === null ? [] : run;

  const merged = [...lead];
  for (const key of accumulated) {
    merged.push(...(runBefore.get(key) ?? []), key);
    if (key === lastAnchor) merged.push(...trail);
  }
  return dedupeKeys(merged);
}

/**
 * Final key order for the accumulated turns.
 *
 * When *every* captured turn carries a monotonic order index, sort by it — the
 * platform's own statement of conversation order. Otherwise keep the order
 * {@link mergeWindow} established, which is authoritative on its own; the index
 * is a corroborating signal, not a repair (issues #352, #353).
 */
function resolveOrder(order: readonly string[], orderIndex: ReadonlyMap<string, number>): string[] {
  if (order.length > 0 && order.every(k => orderIndex.has(k))) {
    return [...order].sort((a, b) => (orderIndex.get(a) as number) - (orderIndex.get(b) as number));
  }
  return [...order];
}

/** Remove duplicate keys, keeping first occurrence. */
function dedupeKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Accumulate all turns of a virtualized conversation by scrolling upward.
 *
 * The container mounts only a small window of turns at a time (older turns are
 * evicted as you scroll away), so we cannot read the whole conversation in one
 * pass. Instead we harvest the current window, scroll up by a fraction of the
 * viewport (keeping windows overlapping), harvest again, and merge — repeating
 * until the top is reached and no new turns appear for
 * {@link SCROLL_STABILITY_THRESHOLD} consecutive iterations, or the
 * progress-aware deadline ({@link SCROLL_IDLE_TIMEOUT} / {@link SCROLL_MAX_TIMEOUT})
 * elapses.
 *
 * De-duplication is by {@link HarvestEntry.key}; the most recently harvested
 * value for a key wins, so a turn that was mid-stream on first sight is replaced
 * by its final content if re-harvested.
 *
 * @param container The scrollable, virtualized conversation container.
 * @param harvest Returns the currently-mounted window in DOM (top→bottom) order.
 */
export async function accumulateWhileScrolling<T>(
  container: HTMLElement,
  harvest: (container: HTMLElement) => HarvestEntry<T>[],
  options: AccumulateOptions = {}
): Promise<AccumulateResult<T>> {
  const tuning = accumulationTuning(options);
  const accumulation = createAccumulation(harvest);
  const active = createAccumulationContainer(container, options, tuning);
  const deadline = options.resolveContainer ? newAccumulationDeadline() : undefined;

  // Pin once per initial root, waiting again if the provider replaces it before
  // the first harvest. No detached seed window may enter the accumulated maps.
  if (!(await seedAccumulation(active, tuning.pollIntervalMs, deadline))) {
    return accumulationResult(accumulation, { fullyLoaded: false, iterations: 0 });
  }
  if (accumulation.ingest(active.container) && deadline) deadline.lastProgressTime = Date.now();

  const topSettleMs = options.topSettleMs ?? 0;
  if (
    active.axis.distanceFromTop() <= 0 &&
    topSettleMs <= 0 &&
    active.canCompleteAtTop === undefined
  ) {
    console.info('[G2O] No scroll range on open, conversation fits without scrolling');
    return accumulationResult(accumulation, { fullyLoaded: true, iterations: 0 }, true);
  }

  console.info(
    `[G2O] Virtualized conversation — scrollTop=${active.container.scrollTop}, ` +
      `${accumulation.count()} turns mounted, accumulating by scrolling up`
  );
  active.step = accumulationStep(active.container, tuning);
  const outcome = await scrollUpUntilStable(
    active,
    topSettleMs,
    tuning.pollIntervalMs,
    accumulation.ingest,
    deadline
  );
  logAccumulation(outcome.fullyLoaded, accumulation.count(), outcome.iterations);
  return accumulationResult(accumulation, outcome);
}

interface Accumulation<T> {
  ingest(container: HTMLElement): boolean;
  items(): T[];
  count(): number;
}

/** One pass owns these maps, independently of provider root replacements. */
function createAccumulation<T>(
  harvest: (container: HTMLElement) => HarvestEntry<T>[]
): Accumulation<T> {
  const content = new Map<string, T>();
  const orderIndex = new Map<string, number>();
  let order: string[] = [];

  const ingest = (container: HTMLElement): boolean => {
    const before = content.size;
    const window = harvest(container);
    for (const entry of window) {
      content.set(entry.key, entry.value); // last write wins → freshest content
      if (entry.order !== undefined) orderIndex.set(entry.key, entry.order);
    }
    order = mergeWindow(
      order,
      window.map(e => e.key)
    );
    return content.size > before;
  };

  return {
    ingest,
    items: () => resolveOrder(order, orderIndex).map(key => content.get(key) as T),
    count: () => content.size,
  };
}

function accumulationResult<T>(
  accumulation: Accumulation<T>,
  outcome: { fullyLoaded: boolean; iterations: number },
  skipped = false
): AccumulateResult<T> {
  return {
    items: accumulation.items(),
    fullyLoaded: outcome.fullyLoaded,
    itemCount: accumulation.count(),
    iterations: outcome.iterations,
    skipped,
  };
}

interface AccumulationTuning {
  readonly stepFactor: number;
  readonly minStep: number;
  readonly pollIntervalMs: number;
  readonly relativeTopNudgeAttempts: number;
}

/** Internal provider tuning only; reject unsafe values before touching the DOM. */
function accumulationTuning(options: AccumulateOptions): AccumulationTuning {
  const stepFactor = options.stepFactor ?? SCROLL_ACCUMULATE_STEP_FACTOR;
  const minStep = options.minStep ?? SCROLL_ACCUMULATE_MIN_STEP;
  const pollIntervalMs = options.pollIntervalMs ?? SCROLL_ACCUMULATE_POLL_INTERVAL;
  if (
    !Number.isFinite(stepFactor) ||
    stepFactor <= 0 ||
    stepFactor > 1 ||
    !Number.isSafeInteger(minStep) ||
    minStep <= 0 ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs <= 0 ||
    pollIntervalMs >= SCROLL_IDLE_TIMEOUT
  ) {
    throw new RangeError('Invalid internal accumulation tuning.');
  }
  validateContainerRebindLimit(options);
  return {
    stepFactor,
    minStep,
    pollIntervalMs,
    relativeTopNudgeAttempts: validateRelativeTopNudgeLimit(options),
  };
}

function validateContainerRebindLimit(options: AccumulateOptions): void {
  if (!options.resolveContainer) return;
  if (
    !Number.isSafeInteger(options.maxContainerRebinds) ||
    (options.maxContainerRebinds ?? 0) <= 0
  ) {
    throw new RangeError('Invalid internal container rebind limit.');
  }
}

function validateRelativeTopNudgeLimit(options: AccumulateOptions): number {
  const hasCallback = typeof options.primeWithRelativeTopNudge === 'function';
  const attempts = options.maxRelativeTopNudgesPerRoot ?? 0;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 0 ||
    attempts > 2 ||
    (hasCallback ? attempts === 0 : attempts !== 0)
  ) {
    throw new RangeError('Invalid internal relative top-nudge limit.');
  }
  return attempts;
}

function accumulationStep(container: HTMLElement, tuning: AccumulationTuning): number {
  return Math.max(tuning.minStep, Math.floor(container.clientHeight * tuning.stepFactor));
}

interface AccumulationContainer {
  container: HTMLElement;
  axis: ScrollAxis;
  step: number;
  revision: number;
  relativeTopNudgesRemaining: number;
  relativeTopNudgeLimit: number;
  relativeTopNudge?: (container: HTMLElement, step: number) => void;
  canCompleteAtTop?: (container: HTMLElement) => boolean;
  refresh(): boolean;
}

function createAccumulationContainer(
  container: HTMLElement,
  options: AccumulateOptions,
  tuning: AccumulationTuning
): AccumulationContainer {
  const active: AccumulationContainer = {
    container,
    axis: createScrollAxis(container),
    step: 0,
    revision: 0,
    relativeTopNudgesRemaining: tuning.relativeTopNudgeAttempts,
    relativeTopNudgeLimit: tuning.relativeTopNudgeAttempts,
    relativeTopNudge: options.primeWithRelativeTopNudge,
    canCompleteAtTop: options.canCompleteAtTop,
    refresh: () => {
      if (!options.resolveContainer) return true;
      const candidate = options.resolveContainer();
      if (!candidate?.isConnected) return false;
      if (candidate !== active.container) {
        if (active.revision >= (options.maxContainerRebinds as number)) return false;
        active.container = candidate;
        active.axis = createScrollAxis(candidate);
        active.step = accumulationStep(candidate, tuning);
        active.revision++;
        active.relativeTopNudgesRemaining = active.relativeTopNudgeLimit;
      }
      return true;
    },
  };
  return active;
}

interface AccumulationDeadline {
  startTime: number;
  lastProgressTime: number;
}

function newAccumulationDeadline(): AccumulationDeadline {
  const startTime = Date.now();
  return { startTime, lastProgressTime: startTime };
}

async function seedAccumulation(
  active: AccumulationContainer,
  pollIntervalMs: number,
  deadline?: AccumulationDeadline
): Promise<boolean> {
  while (!deadline || withinDeadline(deadline.startTime, deadline.lastProgressTime)) {
    if (!active.refresh()) return false;
    const revision = active.revision;
    active.axis.pinBottom();
    await delay(pollIntervalMs);
    if (!active.refresh()) return false;
    if (active.revision === revision) return true;
  }
  return false;
}

/** Log the outcome of an upward accumulation pass (stabilized vs timed out). */
function logAccumulation(fullyLoaded: boolean, turns: number, iterations: number): void {
  if (fullyLoaded) {
    console.info(`[G2O] Accumulated ${turns} turns after ${iterations} scroll iterations`);
  } else {
    console.warn(
      `[G2O] Auto-scroll accumulation timed out (no new turns for ` +
        `${SCROLL_IDLE_TIMEOUT / 1000}s) with ${turns} turns`
    );
  }
}

/**
 * Scroll a container upward one step per iteration until harvesting stops
 * yielding new turns while pinned at the top, or the progress-aware deadline
 * ({@link SCROLL_IDLE_TIMEOUT} / {@link SCROLL_MAX_TIMEOUT}) elapses.
 *
 * Stability is only counted once already at the top, so a mid-scroll window that
 * happens to mount nothing new doesn't end accumulation prematurely.
 *
 * **Progress is a new turn OR upward scroll movement** (issue #365). A turn
 * taller than the viewport mounts as a single row that stays mounted while the
 * engine crawls up through it, so by construction it surfaces no new key — and
 * a turn taller than `SCROLL_IDLE_TIMEOUT / poll × step` would abort the whole
 * pass if only new turns counted. Measured on live Claude (1440×900): step is
 * 511px and the idle window is 37 iterations, so the limit was 18,907px, while
 * a ~1000-line code block renders ~22,160px tall (14px font, 22.75px
 * line-height) — reliably fatal. Counting movement is safe because upward travel
 * is monotonically decreasing and therefore finite: once the top is reached (or
 * the scroller stops responding) movement ceases and the idle deadline resumes
 * its original job of detecting a genuinely stuck scroll.
 *
 * This widened definition is deliberately NOT shared with
 * {@link ensureAllElementsLoaded}: that engine re-arms by jumping to
 * `scrollHeight` and back to 0 every iteration, so "the position moved" is
 * always true there and would disable its idle deadline entirely (ADR-024).
 *
 * @param onWindow Ingest the freshly-mounted window; return true if it grew the
 *   accumulated set. Invoked once per iteration after each scroll settles.
 */
async function scrollUpUntilStable(
  active: AccumulationContainer,
  topSettleMs: number,
  pollIntervalMs: number,
  onWindow: (container: HTMLElement) => boolean,
  deadline = newAccumulationDeadline()
): Promise<{ iterations: number; fullyLoaded: boolean }> {
  let iterations = 0;
  const stability: TopStability = {
    stable: 0,
    since: null,
    scrollHeight: active.container.scrollHeight,
    clientHeight: active.container.clientHeight,
  };
  const resetVisibility = (): void => {
    stability.stable = 0;
    stability.since = null;
  };
  // Visibility may change twice between polls (or while background timers are
  // throttled). Such an interval must break continuous visible rest as well.
  document.addEventListener('visibilitychange', resetVisibility);
  try {
    while (withinDeadline(deadline.startTime, deadline.lastProgressTime)) {
      const sample = await pollAccumulationWindow(active, pollIntervalMs, onWindow);
      iterations++;
      if (!sample) return { iterations, fullyLoaded: false };

      console.debug(
        `[G2O] Accumulate iteration ${iterations}: distanceFromTop=${sample.after}, ` +
          `moved=${sample.moved}, newTurns=${sample.grew}`
      );
      if (sample.grew || sample.moved > 0) deadline.lastProgressTime = Date.now();
      if (updateTopStability(stability, sample, topSettleMs)) {
        return { iterations, fullyLoaded: true };
      }
    }
    return { iterations, fullyLoaded: false };
  } finally {
    document.removeEventListener('visibilitychange', resetVisibility);
  }
}

interface AccumulationSample {
  wasAtTop: boolean;
  after: number;
  moved: number;
  grew: boolean;
  rebound: boolean;
  scrollHeight: number;
  clientHeight: number;
  completionBlocked: boolean;
}

function completionBlockedAtTop(active: AccumulationContainer, after: number): boolean {
  if (after > 0 || document.visibilityState === 'hidden' || active.canCompleteAtTop === undefined) {
    return false;
  }
  try {
    return !active.canCompleteAtTop(active.container);
  } catch {
    return true;
  }
}

function primeOrScrollAbsolute(active: AccumulationContainer, before: number): boolean {
  const primed =
    active.relativeTopNudgesRemaining > 0 && before > 0 && document.visibilityState !== 'hidden';
  if (!primed) {
    active.axis.scrollToDistance(Math.max(0, before - active.step));
    return false;
  }
  active.relativeTopNudgesRemaining--;
  try {
    active.relativeTopNudge?.(active.container, active.step);
  } catch {
    // One attempt is consumed; measured movement remains the only progress.
  }
  return true;
}

async function pollAccumulationWindow(
  active: AccumulationContainer,
  pollIntervalMs: number,
  onWindow: (container: HTMLElement) => boolean
): Promise<AccumulationSample | null> {
  const previousRevision = active.revision;
  if (!active.refresh()) return null;
  const revision = active.revision;
  const before = active.axis.distanceFromTop();
  const beforeScrollTop = active.container.scrollTop;
  const beforeHeight = active.container.scrollHeight;
  const beforeViewport = active.container.clientHeight;
  const primed = primeOrScrollAbsolute(active, before);
  const commandedMovement = beforeScrollTop - active.container.scrollTop;
  await delay(pollIntervalMs);
  if (!active.refresh()) return null;
  const grew = onWindow(active.container);
  const scrollHeight = active.container.scrollHeight;
  const clientHeight = active.container.clientHeight;
  const geometryChanged = scrollHeight !== beforeHeight || clientHeight !== beforeViewport;
  const netMovement = beforeScrollTop - active.container.scrollTop;
  const after = active.axis.distanceFromTop();
  const moved =
    active.revision !== revision
      ? 0
      : geometryChanged
        ? Math.min(netMovement, Math.max(0, commandedMovement))
        : netMovement;
  if (primed && active.revision === revision && (moved > 0 || after <= 0)) {
    active.relativeTopNudgesRemaining = 0;
  }
  return {
    wasAtTop: before <= 0,
    after,
    // A geometry-induced clamp/anchor shift alone is not commanded travel.
    moved,
    grew,
    rebound: active.revision !== previousRevision,
    scrollHeight,
    clientHeight,
    completionBlocked: completionBlockedAtTop(active, after),
  };
}

interface TopStability {
  stable: number;
  since: number | null;
  scrollHeight: number;
  clientHeight: number;
}

function updateTopStability(
  state: TopStability,
  sample: AccumulationSample,
  topSettleMs: number
): boolean {
  const geometryChanged =
    sample.scrollHeight !== state.scrollHeight || sample.clientHeight !== state.clientHeight;
  state.scrollHeight = sample.scrollHeight;
  state.clientHeight = sample.clientHeight;
  if (
    sample.grew ||
    sample.rebound ||
    sample.completionBlocked ||
    sample.after > 0 ||
    document.visibilityState === 'hidden' ||
    geometryChanged
  ) {
    state.stable = 0;
    state.since = null;
    return false;
  }
  state.since ??= Date.now();
  if (sample.wasAtTop) state.stable++;
  return state.stable >= SCROLL_STABILITY_THRESHOLD && Date.now() - state.since >= topSettleMs;
}
