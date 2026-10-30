/**
 * Tests for the auto-scroll accumulation engine (ADR-017).
 *
 * Claude and ChatGPT virtualize the conversation: only a small moving window
 * of turns is ever mounted, and off-screen turns are evicted. The engine must
 * scroll upward, harvest each window, and accumulate/dedupe turns by a stable
 * key so the full history is captured despite never holding it all at once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mergeWindow,
  accumulateWhileScrolling,
  type AccumulateOptions,
} from '../../src/lib/scroll-manager';
import { SCROLL_IDLE_TIMEOUT, SCROLL_MAX_TIMEOUT } from '../../src/lib/constants';

describe('mergeWindow', () => {
  it('returns the window verbatim when nothing is accumulated yet', () => {
    expect(mergeWindow([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('leaves the accumulation unchanged when the window is fully contained', () => {
    // We scrolled up but the same window re-mounted (no new turns).
    expect(mergeWindow(['c', 'd', 'e'], ['c', 'd'])).toEqual(['c', 'd', 'e']);
  });

  it('prepends the non-overlapping prefix, aligning on the shared suffix', () => {
    // Scrolling up: new window [a,b,c,d] overlaps accumulated head [c,d].
    expect(mergeWindow(['c', 'd'], ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('aligns on a single-element overlap', () => {
    expect(mergeWindow(['c', 'd', 'e'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('falls back to prepending de-duplicated keys when there is no overlap', () => {
    expect(mergeWindow(['d', 'e'], ['a', 'b'])).toEqual(['a', 'b', 'd', 'e']);
  });

  it('never emits duplicate keys', () => {
    expect(mergeWindow(['b', 'c'], ['a', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('splices new keys in at their anchor when the window ends with a persistent tail (issue #353)', () => {
    // The decisive step of the live ChatGPT trace (see TURN_WINDOWS below):
    // turns 14-16 have evicted, but the newest turns 17-21 stay mounted, so the
    // window is [1..13, 17..21] while the accumulation already holds [2..21].
    // The window's *suffix* is the persistent tail and never matches the
    // accumulated head — but the window still contains the anchor (2), which is
    // where the unseen turn 1 belongs.
    expect(mergeWindow(turns(2, 21), [...turns(1, 13), ...turns(17, 21)])).toEqual(turns(1, 21));
  });

  it('appends a trailing run of new keys after its preceding anchor', () => {
    // New keys sitting *below* an already-seen key must not be prepended.
    expect(mergeWindow(['a', 'b'], ['a', 'c'])).toEqual(['a', 'c', 'b']);
  });
});

/** Connected test root; ordinary callers above deliberately also cover detached roots. */
function connectedScroller({
  maxScroll = 1000,
  stuck = false,
  reversed = false,
  height = () => maxScroll + 500,
  viewport = () => 500,
  position,
}: {
  maxScroll?: number;
  stuck?: boolean;
  reversed?: boolean;
  height?: () => number;
  viewport?: () => number;
  position?: () => number;
} = {}) {
  const container = document.createElement('div');
  if (reversed) container.style.flexDirection = 'column-reverse';
  let scrollTop = reversed ? 0 : maxScroll;
  const writes: number[] = [];
  Object.defineProperty(container, 'scrollTop', {
    get: () => position?.() ?? scrollTop,
    set: (value: number) => {
      writes.push(value);
      if (!stuck) {
        scrollTop = reversed
          ? Math.max(-maxScroll, Math.min(0, value))
          : Math.max(0, Math.min(maxScroll, value));
      }
    },
    configurable: true,
  });
  Object.defineProperty(container, 'scrollHeight', { get: height, configurable: true });
  Object.defineProperty(container, 'clientHeight', { get: viewport, configurable: true });
  const nudges = vi.fn((options: ScrollToOptions) => {
    container.scrollTop += options.top ?? 0;
  });
  Object.defineProperty(container, 'scrollBy', { value: nudges, configurable: true });
  document.body.append(container);
  return { container, writes, nudges };
}

describe('accumulation active-root lifecycle', () => {
  const tuning = { stepFactor: 0.2, minStep: 64, pollIntervalMs: 100 };
  const window = [{ key: 'same', value: 'same' }];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it.each([undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an unsafe resolver rebind budget before any writes (%s)',
    async limit => {
      const { container, writes } = connectedScroller();
      const resolver = vi.fn(() => container);
      await expect(
        accumulateWhileScrolling(container, () => window, {
          resolveContainer: resolver,
          maxContainerRebinds: limit,
        })
      ).rejects.toThrow('Invalid internal container rebind limit.');
      expect(writes).toEqual([]);
      expect(resolver).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, 0, 3, 1.5, NaN, Infinity])(
    'rejects an invalid prime-attempt bound before any writes (%s)',
    async attempts => {
      const { container, writes } = connectedScroller();
      await expect(
        accumulateWhileScrolling(container, () => window, {
          ...tuning,
          primeWithRelativeTopNudge: () => {},
          maxRelativeTopNudgesPerRoot: attempts,
        })
      ).rejects.toThrow('Invalid internal relative top-nudge limit.');
      expect(writes).toHaveLength(0);
    }
  );

  it('rejects a prime-attempt bound without a provider callback', async () => {
    const { container, writes } = connectedScroller();
    await expect(
      accumulateWhileScrolling(container, () => window, {
        ...tuning,
        maxRelativeTopNudgesPerRoot: 1,
      })
    ).rejects.toThrow('Invalid internal relative top-nudge limit.');
    expect(writes).toHaveLength(0);
  });

  it('re-pins a replacement once before the first harvest and never reads the detached seed', async () => {
    const old = connectedScroller();
    const next = createVirtualList({
      total: 12,
      windowSize: 3,
      clientHeight: 500,
      maxScroll: 1000,
    });
    let current = old.container;
    const harvested: HTMLElement[] = [];
    setTimeout(() => {
      old.container.replaceWith(next.container);
      current = next.container;
    }, 50);
    const started = Date.now();
    const promise = accumulateWhileScrolling(
      old.container,
      active => {
        harvested.push(active);
        expect(active.isConnected).toBe(true);
        return active === next.container ? next.harvest() : [{ key: 'stale', value: 'stale' }];
      },
      { ...tuning, resolveContainer: () => current, maxContainerRebinds: 4 }
    );
    await vi.advanceTimersByTimeAsync(199);
    expect(harvested).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(harvested).toEqual([next.container]);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.fullyLoaded).toBe(true);
    expect(result.items).toEqual(Array.from({ length: 12 }, (_, index) => `v${index}`));
    expect(old.writes).toEqual([1500]);
    expect(Date.now() - started).toBeGreaterThan(200);
  });

  it('keeps order across a mid-walk replacement without re-pinning or harvesting detached rows', async () => {
    const old = createVirtualList({ total: 12, windowSize: 3, clientHeight: 500, maxScroll: 1000 });
    const next = createVirtualList({
      total: 12,
      windowSize: 3,
      clientHeight: 500,
      maxScroll: 1000,
      startFraction: 0.6,
    });
    document.body.append(old.container);
    let current = old.container;
    const nextWrites: number[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(next.container, 'scrollTop')!;
    Object.defineProperty(next.container, 'scrollTop', {
      ...descriptor,
      set: (value: number) => {
        nextWrites.push(value);
        descriptor.set!.call(next.container, value);
      },
    });
    setTimeout(() => {
      old.container.replaceWith(next.container);
      current = next.container;
    }, 450);
    const promise = accumulateWhileScrolling(
      old.container,
      active => {
        expect(active.isConnected).toBe(true);
        return active === old.container ? old.harvest() : next.harvest();
      },
      { ...tuning, resolveContainer: () => current, maxContainerRebinds: 4 }
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.fullyLoaded).toBe(true);
    expect(result.items).toEqual(Array.from({ length: 12 }, (_, index) => `v${index}`));
    expect(nextWrites).not.toContain(1500);
  });

  it('finishes partial on the fifth replacement instead of looping', async () => {
    let current = connectedScroller({ stuck: true }).container;
    const first = current;
    const harvested = new Set<HTMLElement>();
    for (let replacement = 1; replacement <= 5; replacement++) {
      setTimeout(() => {
        const next = connectedScroller({ stuck: true }).container;
        current.replaceWith(next);
        current = next;
      }, replacement * 500);
    }
    const started = Date.now();
    const promise = accumulateWhileScrolling(
      first,
      active => {
        harvested.add(active);
        return window;
      },
      { ...tuning, resolveContainer: () => current, maxContainerRebinds: 4 }
    );
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.fullyLoaded).toBe(false);
    expect(result.items).toEqual(['same']);
    expect(harvested.size).toBe(5);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it.each(['null', 'disconnected'] as const)('finishes partial for a %s exact root', async mode => {
    const { container } = connectedScroller({ stuck: true });
    let current: HTMLElement | null = container;
    setTimeout(() => {
      container.remove();
      if (mode === 'null') current = null;
    }, 500);
    const harvest = vi.fn((active: HTMLElement) => {
      expect(active.isConnected).toBe(true);
      return window;
    });
    const promise = accumulateWhileScrolling(container, harvest, {
      ...tuning,
      resolveContainer: () => current,
      maxContainerRebinds: 4,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(harvest).toHaveBeenCalledTimes(4);
  });

  it('does not renew the idle deadline for rebinds without new keys or movement', async () => {
    let current = connectedScroller({ stuck: true }).container;
    const first = current;
    for (const at of [2000, 5000, 8000, 11000]) {
      setTimeout(() => {
        const next = connectedScroller({ stuck: true }).container;
        current.replaceWith(next);
        current = next;
      }, at);
    }
    const started = Date.now();
    const promise = accumulateWhileScrolling(first, () => window, {
      ...tuning,
      resolveContainer: () => current,
      maxContainerRebinds: 4,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(Date.now() - started).toBeLessThanOrEqual(SCROLL_IDLE_TIMEOUT + 200);
  });

  it('leaves relative scrolling disabled for default callers', async () => {
    const { container, nudges } = connectedScroller();
    const promise = accumulateWhileScrolling(container, () => window);
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(nudges).not.toHaveBeenCalled();
  });

  it('stops after the first prime when measured movement is positive', async () => {
    const { container } = connectedScroller();
    const prime = vi.fn((active: HTMLElement, step: number) => {
      active.scrollTop -= step;
    });
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      primeWithRelativeTopNudge: prime,
      maxRelativeTopNudgesPerRoot: 2,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(prime).toHaveBeenCalledTimes(1);
  });

  it('uses the second prime on the next poll after a zero-movement first attempt', async () => {
    const { container } = connectedScroller();
    const prime = vi.fn((active: HTMLElement, step: number) => {
      if (prime.mock.calls.length === 2) active.scrollTop -= step;
    });
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      primeWithRelativeTopNudge: prime,
      maxRelativeTopNudgesPerRoot: 2,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(prime).toHaveBeenCalledTimes(2);
  });

  it('primes each active replacement revision exactly once', async () => {
    const first = connectedScroller();
    const next = connectedScroller();
    let current = first.container;
    setTimeout(() => {
      first.container.replaceWith(next.container);
      current = next.container;
    }, 450);
    const promise = accumulateWhileScrolling(first.container, () => window, {
      ...tuning,
      resolveContainer: () => current,
      maxContainerRebinds: 4,
      primeWithRelativeTopNudge: (active, step) => {
        active.scrollBy({ top: -step, left: 0, behavior: 'instant' });
      },
      maxRelativeTopNudgesPerRoot: 1,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(first.nudges).toHaveBeenCalledExactlyOnceWith({
      top: -100,
      left: 0,
      behavior: 'instant',
    });
    expect(next.nudges).toHaveBeenCalledExactlyOnceWith({
      top: -100,
      left: 0,
      behavior: 'instant',
    });
    expect(next.writes).not.toContain(1500);
  });

  it('does not grant progress after both bounded relative primes fail', async () => {
    const { container, nudges } = connectedScroller({ stuck: true });
    const started = Date.now();
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      primeWithRelativeTopNudge: (active, step) => {
        active.scrollBy({ top: -step, left: 0, behavior: 'instant' });
      },
      maxRelativeTopNudgesPerRoot: 2,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(nudges).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeLessThanOrEqual(SCROLL_IDLE_TIMEOUT + 200);
  });

  it('bounds two primes on each of five active root revisions', async () => {
    let current = connectedScroller({ stuck: true }).container;
    const first = current;
    const prime = vi.fn();
    for (const at of [350, 700, 1050, 1400]) {
      setTimeout(() => {
        const next = connectedScroller({ stuck: true }).container;
        current.replaceWith(next);
        current = next;
      }, at);
    }
    const promise = accumulateWhileScrolling(first, () => window, {
      ...tuning,
      resolveContainer: () => current,
      maxContainerRebinds: 4,
      primeWithRelativeTopNudge: prime,
      maxRelativeTopNudgesPerRoot: 2,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(prime).toHaveBeenCalledTimes(10);
  });

  it('does not spend prime attempts while hidden or already at the top', async () => {
    const hidden = connectedScroller();
    const hiddenPrime = vi.fn();
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    const hiddenPromise = accumulateWhileScrolling(hidden.container, () => window, {
      ...tuning,
      primeWithRelativeTopNudge: hiddenPrime,
      maxRelativeTopNudgesPerRoot: 2,
    });
    await vi.runAllTimersAsync();
    expect((await hiddenPromise).fullyLoaded).toBe(false);
    expect(hiddenPrime).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    const top = connectedScroller({ maxScroll: 0 });
    const topPrime = vi.fn();
    const topPromise = accumulateWhileScrolling(top.container, () => window, {
      ...tuning,
      primeWithRelativeTopNudge: topPrime,
      maxRelativeTopNudgesPerRoot: 2,
    });
    await vi.runAllTimersAsync();
    const topResult = await topPromise;
    expect(topResult.skipped).toBe(true);
    expect(topPrime).not.toHaveBeenCalled();
  });

  it('preserves the absolute deadline while real movement continues across rebinds', async () => {
    let current = connectedScroller({ maxScroll: 1_000_000_000 }).container;
    const first = current;
    for (const at of [60_000, 120_000, 180_000, 240_000]) {
      setTimeout(() => {
        const next = connectedScroller({ maxScroll: 1_000_000_000 }).container;
        current.replaceWith(next);
        current = next;
      }, at);
    }
    const started = Date.now();
    const promise = accumulateWhileScrolling(first, () => window, {
      ...tuning,
      resolveContainer: () => current,
      maxContainerRebinds: 4,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(SCROLL_MAX_TIMEOUT);
    expect(Date.now() - started).toBeLessThanOrEqual(SCROLL_MAX_TIMEOUT + 100);
  });

  it('restarts full top settle after each geometry growth', async () => {
    let geometry = 1000;
    const { container } = connectedScroller({
      maxScroll: 0,
      height: () => geometry,
      viewport: () => geometry,
    });
    setTimeout(() => {
      geometry = 1200;
    }, 800);
    setTimeout(() => {
      geometry = 1400;
    }, 1500);
    const started = Date.now();
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      topSettleMs: 2000,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3500);
    expect(Date.now() - started).toBeLessThanOrEqual(3700);
  });

  it('restarts the full visible top settle when the active root changes with identical geometry', async () => {
    let current = connectedScroller({ maxScroll: 0 }).container;
    const first = current;
    setTimeout(() => {
      const next = connectedScroller({ maxScroll: 0 }).container;
      current.replaceWith(next);
      current = next;
    }, 1000);
    const started = Date.now();
    const promise = accumulateWhileScrolling(first, () => window, {
      ...tuning,
      topSettleMs: 2000,
      resolveContainer: () => current,
      maxContainerRebinds: 4,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3000);
    expect(Date.now() - started).toBeLessThanOrEqual(3200);
  });

  it('waits a full settle after a pending-history marker disappears', async () => {
    const { container } = connectedScroller({ maxScroll: 0 });
    let pending = true;
    setTimeout(() => {
      pending = false;
    }, 2300);
    const started = Date.now();
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      topSettleMs: 5000,
      canCompleteAtTop: () => !pending,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(7300);
    expect(Date.now() - started).toBeLessThanOrEqual(7600);
  });

  it('restarts settle when pending history disappears and reappears', async () => {
    const { container } = connectedScroller({ maxScroll: 0 });
    let pending = true;
    for (const [at, value] of [
      [2300, false],
      [4000, true],
      [6000, false],
    ] as const) {
      setTimeout(() => {
        pending = value;
      }, at);
    }
    const started = Date.now();
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      topSettleMs: 5000,
      canCompleteAtTop: () => !pending,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(11_000);
    expect(Date.now() - started).toBeLessThanOrEqual(11_300);
  });

  it.each(['pending', 'throwing'] as const)(
    'keeps a %s completion proof bounded by the idle deadline',
    async mode => {
      const { container } = connectedScroller({ maxScroll: 0 });
      const started = Date.now();
      const promise = accumulateWhileScrolling(container, () => window, {
        ...tuning,
        topSettleMs: 5000,
        canCompleteAtTop: () => {
          if (mode === 'throwing') throw new Error('provider proof failure');
          return false;
        },
      });
      await vi.runAllTimersAsync();
      expect((await promise).fullyLoaded).toBe(false);
      expect(Date.now() - started).toBeLessThanOrEqual(SCROLL_IDLE_TIMEOUT + 200);
    }
  );

  it('consults provider completion after polling without changing default skip behavior', async () => {
    const provider = connectedScroller({ maxScroll: 0 });
    const proof = vi.fn(() => true);
    const providerPromise = accumulateWhileScrolling(provider.container, () => window, {
      ...tuning,
      canCompleteAtTop: proof,
    });
    await vi.runAllTimersAsync();
    const providerResult = await providerPromise;
    expect(providerResult.fullyLoaded).toBe(true);
    expect(providerResult.skipped).toBe(false);
    expect(proof).toHaveBeenCalledTimes(3);

    const ordinary = connectedScroller({ maxScroll: 0 });
    const ordinaryPromise = accumulateWhileScrolling(ordinary.container, () => window, tuning);
    await vi.runAllTimersAsync();
    expect((await ordinaryPromise).skipped).toBe(true);
  });

  it('does not consult provider completion while the document is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const { container } = connectedScroller({ maxScroll: 0 });
    const proof = vi.fn(() => true);
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      topSettleMs: 5000,
      canCompleteAtTop: proof,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(proof).not.toHaveBeenCalled();
  });

  it('does not renew idle time for geometry-only growth at the top', async () => {
    const started = Date.now();
    const geometry = () => 1000 + Math.floor((Date.now() - started) / 500);
    const { container } = connectedScroller({ maxScroll: 0, height: geometry, viewport: geometry });
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      topSettleMs: 2000,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(Date.now() - started).toBeLessThanOrEqual(SCROLL_IDLE_TIMEOUT + 200);
  });

  it('does not mistake a changing reversed range for real upward movement', async () => {
    const started = Date.now();
    const { container } = connectedScroller({
      reversed: true,
      stuck: true,
      position: () => -1000,
      height: () => 10_000 - Math.floor((Date.now() - started) / 100),
    });
    const promise = accumulateWhileScrolling(container, () => window, tuning);
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(Date.now() - started).toBeLessThanOrEqual(SCROLL_IDLE_TIMEOUT + 200);
  });

  it('does not renew idle time for a geometry-only scrollTop clamp', async () => {
    const started = Date.now();
    const reduction = () => Math.floor((Date.now() - started) / 100);
    const { container } = connectedScroller({
      stuck: true,
      position: () => 1000 - reduction(),
      height: () => 1500 - reduction(),
    });
    const promise = accumulateWhileScrolling(container, () => window, tuning);
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(false);
    expect(Date.now() - started).toBeLessThanOrEqual(SCROLL_IDLE_TIMEOUT + 200);
  });

  it('restarts top stability after a hidden interval', async () => {
    const { container } = connectedScroller({ maxScroll: 0 });
    const started = Date.now();
    setTimeout(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    }, 300);
    setTimeout(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }, 500);
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      topSettleMs: 1,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
  });

  it('resets continuous visible rest even when a hidden interval falls between polls', async () => {
    const { container } = connectedScroller({ maxScroll: 0 });
    const started = Date.now();
    for (const [at, visibility] of [
      [250, 'hidden'],
      [275, 'visible'],
    ] as const) {
      setTimeout(() => {
        Object.defineProperty(document, 'visibilityState', {
          value: visibility,
          configurable: true,
        });
        document.dispatchEvent(new Event('visibilitychange'));
      }, at);
    }
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      topSettleMs: 2000,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2275);
    const listener = added.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
    expect(listener).toBeTypeOf('function');
    expect(removed).toHaveBeenCalledWith('visibilitychange', listener);
    added.mockRestore();
    removed.mockRestore();
  });

  it('restarts the full settle after leaving the top', async () => {
    const started = Date.now();
    const { container } = connectedScroller({
      maxScroll: 0,
      stuck: true,
      position: () => (Date.now() - started >= 700 && Date.now() - started < 1000 ? 1 : 0),
    });
    const promise = accumulateWhileScrolling(container, () => window, {
      ...tuning,
      topSettleMs: 2000,
    });
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(3000);
  });
});

/** Turn keys `t{from}`..`t{to}`, mirroring ChatGPT's conversation-turn numbering. */
function turns(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `t${from + i}`);
}

/**
 * Build a fake virtualized scroll container: a full list of `total` items, of
 * which only `windowSize` are ever "mounted" (returned by harvest), positioned
 * by the current scrollTop. scrollTop starts at the bottom, mirroring how
 * Claude/ChatGPT open a conversation.
 */
function createVirtualList(opts: {
  total: number;
  windowSize: number;
  clientHeight?: number;
  startAtTop?: boolean;
  /**
   * Initial scrollTop as a fraction of maxScroll (1 = bottom, default). Use a
   * value < 1 to model Sync starting with the view scrolled up, so the newest
   * turn is below the fold and not in the initially-mounted window.
   */
  startFraction?: number;
  /**
   * Total scroll range in px (default 10_000). A larger range means more scroll
   * iterations are needed to reach the top, modelling a very long conversation
   * whose accumulation exceeds the old fixed wall-clock timeout.
   */
  maxScroll?: number;
}): {
  container: HTMLElement;
  harvest: () => Array<{ key: string; value: string }>;
} {
  const { total, windowSize } = opts;
  const clientHeight = opts.clientHeight ?? 900;
  // A conversation that fits entirely in one window has no scroll range.
  const fits = total <= windowSize;
  const maxScroll = fits ? 0 : (opts.maxScroll ?? 10_000);
  const items = Array.from({ length: total }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));

  const container = document.createElement('div');
  const startFraction = opts.startAtTop ? 0 : (opts.startFraction ?? 1);
  let scrollTop = Math.round(maxScroll * startFraction);
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(maxScroll, v));
    },
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight, configurable: true });
  Object.defineProperty(container, 'scrollHeight', {
    get: () => maxScroll + clientHeight,
    configurable: true,
  });

  const maxStart = Math.max(0, total - windowSize);
  const harvest = () => {
    const frac = maxScroll === 0 ? 0 : scrollTop / maxScroll; // 1 at bottom, 0 at top
    const start = Math.round(frac * maxStart);
    return items.slice(start, start + windowSize);
  };

  return { container, harvest };
}

/**
 * Build a list whose bottom `tail` turns NEVER evict (they stay mounted in every
 * window), while the middle evicts as you scroll up — the real Claude behavior
 * behind the #352 ordering scramble. When scrolled near the top the harvested
 * DOM window is `[0..W-1, <persistent tail>]`, so mergeWindow's overlap check
 * fails (window tail ≠ accumulated head) and it wedges the tail into the middle.
 * Each turn carries a monotonic `order` (its data-index) so the engine can sort.
 */
function createPersistentTailList(opts: {
  total: number;
  movingWindow: number;
  tail: number;
  clientHeight?: number;
}): {
  container: HTMLElement;
  harvest: () => Array<{ key: string; value: string; order: number }>;
} {
  const { total, movingWindow: W, tail: P } = opts;
  const clientHeight = opts.clientHeight ?? 900;
  const maxScroll = 10_000;
  let scrollTop = maxScroll; // opens at the bottom

  const container = document.createElement('div');
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(maxScroll, v));
    },
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight, configurable: true });
  Object.defineProperty(container, 'scrollHeight', {
    get: () => maxScroll + clientHeight,
    configurable: true,
  });

  const maxStart = Math.max(0, total - W);
  const harvest = () => {
    const start = Math.round((scrollTop / maxScroll) * maxStart);
    const idxs = new Set<number>();
    for (let i = start; i < start + W && i < total; i++) idxs.add(i);
    for (let i = total - P; i < total; i++) idxs.add(i); // persistent, never-evicting tail
    return [...idxs]
      .sort((a, b) => a - b)
      .map(i => ({ key: `idx-${i}`, value: `v${i}`, order: i }));
  };

  return { container, harvest };
}

/**
 * The mounted-turn windows captured from a real, logged-in desktop ChatGPT
 * conversation of 21 turns (2026-07-29, issue #353). Each row is one harvest,
 * scrolling upward from the bottom; the numbers are the `conversation-turn-N`
 * ordinals of the turns mounted at that moment.
 *
 * Note rows 6-7: turns 14-16 (then 13) have been evicted from the middle while
 * the newest turns 17-21 stay mounted — the shape that makes suffix/prefix
 * overlap stitching fail.
 */
const TURN_WINDOWS: readonly (readonly number[])[] = [
  [17, 18, 19, 20, 21], // seed (bottom)
  [17, 18, 19, 20, 21],
  [13, 14, 15, 16, 17, 18, 19, 20, 21],
  [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17, 18, 19, 20, 21],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20, 21], // top
];

/**
 * Replay a recorded sequence of mounted windows: harvest N returns the Nth
 * recorded window (the last one repeats once the script is exhausted, as it
 * does on the real page once scrolling is pinned at the top).
 *
 * The scroll range is sized so the engine reaches scrollTop 0 exactly as the
 * script runs out, letting the normal stability check end accumulation.
 *
 * @param withOrder Emit a monotonic `order` per turn (Claude's `data-index`
 *   layer). Omitted for the ChatGPT-equivalent case, where ordering must come
 *   from the merge itself.
 */
function createRecordedWindowList(
  windows: readonly (readonly number[])[],
  withOrder = false
): {
  container: HTMLElement;
  harvest: () => Array<{ key: string; value: string; order?: number }>;
} {
  const clientHeight = 900;
  const step = Math.max(400, Math.floor(clientHeight * 0.6));
  const maxScroll = step * (windows.length - 1);
  let scrollTop = maxScroll;
  let harvests = 0;

  const container = document.createElement('div');
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(maxScroll, v));
    },
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight, configurable: true });
  Object.defineProperty(container, 'scrollHeight', {
    get: () => maxScroll + clientHeight,
    configurable: true,
  });

  const harvest = () => {
    const window = windows[Math.min(harvests, windows.length - 1)];
    harvests++;
    return window.map(n => ({
      key: `t${n}`,
      value: `v${n}`,
      ...(withOrder ? { order: n } : {}),
    }));
  };

  return { container, harvest };
}

/**
 * Build a virtualized list from explicit per-turn pixel heights.
 *
 * Unlike {@link createVirtualList} (which maps scroll *fraction* to a window of
 * fixed size), this models the real thing: each turn occupies a real span of the
 * scroll range, and the mounted window is whichever turns intersect the
 * viewport. That is what makes a single very tall turn expressible — while it
 * fills the viewport it is the *only* mounted turn, so every harvest returns the
 * same key no matter how far the engine scrolls (issue #365).
 *
 * @param heights Per-turn heights in px, first turn → last turn.
 */
function createVirtualListByHeights(
  heights: readonly number[],
  clientHeight: number
): {
  container: HTMLElement;
  harvest: () => Array<{ key: string; value: string; order: number }>;
} {
  const offsets: number[] = [];
  let acc = 0;
  for (const h of heights) {
    offsets.push(acc);
    acc += h;
  }
  const maxScroll = Math.max(0, acc - clientHeight);
  let scrollTop = maxScroll; // opens at the bottom

  const container = document.createElement('div');
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, Math.min(maxScroll, v));
    },
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', { get: () => clientHeight, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { get: () => acc, configurable: true });

  const harvest = () =>
    heights
      .map((h, i) => ({ i, top: offsets[i], bottom: offsets[i] + h }))
      .filter(t => t.bottom > scrollTop && t.top < scrollTop + clientHeight)
      .map(t => ({ key: `idx-${t.i}`, value: `v${t.i}`, order: t.i }));

  return { container, harvest };
}

describe('accumulateWhileScrolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    { clientHeight: 900, step: 540 },
    { clientHeight: 100, step: 400 },
  ])('preserves default step and 400ms polling ($clientHeight px viewport)', async opts => {
    const { container, harvest } = createVirtualList({ total: 12, windowSize: 4, ...opts });
    const writes: number[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(container, 'scrollTop')!;
    Object.defineProperty(container, 'scrollTop', {
      ...descriptor,
      set: (value: number) => {
        writes.push(value);
        descriptor.set!.call(container, value);
      },
    });
    const observe = vi.fn(harvest);
    const promise = accumulateWhileScrolling(container, observe);

    expect(writes).toEqual([container.scrollHeight]);
    await vi.advanceTimersByTimeAsync(399);
    expect(observe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(writes[1]).toBe(10_000 - opts.step);
    await vi.advanceTimersByTimeAsync(399);
    expect(observe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(observe).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    expect((await promise).fullyLoaded).toBe(true);
  });

  it('uses per-pass small steps, minimum and polling without changing the defaults', async () => {
    for (const clientHeight of [900, 100]) {
      const { container, harvest } = createVirtualList({
        total: 154,
        windowSize: 3,
        clientHeight,
      });
      const observe = vi.fn(harvest);
      const promise = accumulateWhileScrolling(container, observe, {
        stepFactor: 0.2,
        minStep: 64,
        pollIntervalMs: 100,
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(observe).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(container.scrollTop).toBe(10_000 - Math.max(64, clientHeight * 0.2));
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.fullyLoaded).toBe(true);
      expect(result.items).toEqual(Array.from({ length: 154 }, (_, i) => `v${i}`));
    }
  });

  it.each([
    { stepFactor: NaN },
    { stepFactor: Infinity },
    { stepFactor: 0 },
    { stepFactor: -0.2 },
    { stepFactor: 1.1 },
    { minStep: NaN },
    { minStep: Infinity },
    { minStep: 0 },
    { minStep: -1 },
    { minStep: 1.5 },
    { pollIntervalMs: NaN },
    { pollIntervalMs: Infinity },
    { pollIntervalMs: 0 },
    { pollIntervalMs: -1 },
    { pollIntervalMs: 0.5 },
    { pollIntervalMs: 15_000 },
  ] satisfies AccumulateOptions[])(
    'rejects unsafe internal tuning before scrolling: %j',
    async options => {
      const container = document.createElement('div');
      const write = vi.fn();
      Object.defineProperty(container, 'scrollTop', { set: write, configurable: true });
      const harvest = vi.fn(() => []);

      await expect(accumulateWhileScrolling(container, harvest, options)).rejects.toThrow(
        'Invalid internal accumulation tuning.'
      );
      expect(write).not.toHaveBeenCalled();
      expect(harvest).not.toHaveBeenCalled();
    }
  );

  it('reconstructs the true order from the live ChatGPT window trace, without any order index (issue #353)', async () => {
    // ChatGPT turns are keyed by uuid, so the `order` fallback that fixed Claude
    // (#352) is unavailable — the merge itself has to get this right.
    const { container, harvest } = createRecordedWindowList(TURN_WINDOWS);

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.itemCount).toBe(21);
    expect(result.items).toEqual(Array.from({ length: 21 }, (_, i) => `v${i + 1}`));
  });

  it('reconstructs the same order from the live trace when an order index is present', async () => {
    // Belt-and-suspenders layer: ChatGPT's `conversation-turn-N` ordinal fed
    // through HarvestEntry.order must agree with the merge-derived order.
    const { container, harvest } = createRecordedWindowList(TURN_WINDOWS, true);

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.itemCount).toBe(21);
    expect(result.items).toEqual(Array.from({ length: 21 }, (_, i) => `v${i + 1}`));
  });

  it('permanently falls back to anchor order after numeric order is invalidated', async () => {
    const { container, harvest: nextWindow } = createRecordedWindowList([
      [4, 5],
      [2, 3, 5],
      [0, 1],
    ]);
    let harvestCount = 0;
    const harvest = () => {
      const currentHarvest = harvestCount++;
      return nextWindow().map(entry => ({
        ...entry,
        order: Number(entry.key.slice(1)),
        ...(currentHarvest === 2 ? { invalidateOrder: true as const } : {}),
      }));
    };

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.items).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5']);
  });

  it('clears prior indices even when the invalidating window adds no keys', async () => {
    const { container, harvest: nextWindow } = createRecordedWindowList([
      [0, 1, 2],
      [1, 2],
      [0, 1, 2],
    ]);
    let harvestCount = 0;
    const harvest = () => {
      const currentHarvest = harvestCount++;
      return nextWindow().map((entry, index, window) => ({
        ...entry,
        order: currentHarvest < 2 ? Number(entry.key.slice(1)) : window.length - index,
        ...(currentHarvest === 1 ? { invalidateOrder: true as const } : {}),
      }));
    };

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.items).toEqual(['v0', 'v1', 'v2']);
  });

  it('orders turns by their monotonic index when the tail never evicts (issue #352)', async () => {
    // The last 3 turns stay mounted in every window; the middle evicts. Overlap
    // stitching alone wedges the tail into the middle — the engine must fall back
    // to the per-turn `order` to reconstruct the true conversation order.
    const { container, harvest } = createPersistentTailList({
      total: 20,
      movingWindow: 6,
      tail: 3,
    });

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.itemCount).toBe(20);
    expect(result.items).toEqual(Array.from({ length: 20 }, (_, i) => `v${i}`));
  });

  it('accumulates every turn across windows despite eviction', async () => {
    const { container, harvest } = createVirtualList({ total: 12, windowSize: 4 });

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.skipped).toBe(false);
    expect(result.fullyLoaded).toBe(true);
    expect(result.itemCount).toBe(12);
    // Ordered from first turn to last.
    expect(result.items).toEqual(Array.from({ length: 12 }, (_, i) => `v${i}`));
  });

  it('keeps accumulating past the old fixed 30s wall while progress continues (issue #360)', async () => {
    // A very long conversation: reaching the top takes ~150 scroll iterations,
    // far more than the old 30_000ms / 400ms ≈ 75-iteration wall-clock wall.
    // Because every step surfaces new turns, the progress-aware deadline must
    // never cut off mid-scroll — the whole conversation must be captured.
    const { container, harvest } = createVirtualList({
      total: 300,
      windowSize: 6,
      clientHeight: 1000, // step = 600px → 90_000 / 600 = 150 iterations to top
      maxScroll: 90_000,
    });

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.fullyLoaded).toBe(true);
    expect(result.itemCount).toBe(300);
    expect(result.items).toEqual(Array.from({ length: 300 }, (_, i) => `v${i}`));
  });

  it('captures the turns above a single viewport-dwarfing turn (issue #365)', async () => {
    // Measured on live Claude via the CDP daemon (2026-08-02, 1440x900):
    //   clientHeight 852 -> step = floor(852 * 0.6) = 511px
    //   idle window     = 15_000 / 400 = 37 iterations
    //   => at most 37 * 511 = 18_907px may be traversed without a new turn
    //   code blocks render at 14px/22.75px line-height (measured 22.16 px/line)
    //   => a ~1000-line code block turn is ~22_160px and blows past that limit.
    // Crossing such a turn surfaces no new key by construction (the key is the
    // turn's own data-index), so an idle deadline that only counts new turns as
    // progress aborts mid-conversation and loses everything above it.
    const TALL_TURN = 22_160;
    const heights = [...Array(10).fill(800), TALL_TURN, ...Array(10).fill(800)];
    const { container, harvest } = createVirtualListByHeights(heights, 852);

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.fullyLoaded).toBe(true);
    expect(result.itemCount).toBe(21);
    // The regression: the turns *above* the tall one must survive.
    expect(result.items.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `v${i}`));
  });

  it('gives up when neither new turns nor the scroll position move', async () => {
    // The counterpart guard for the fix above: widening "progress" to include
    // scroll movement must not defeat ADR-018's stuck-scroller detection. Here
    // the container refuses to move at all, so the idle deadline must still fire
    // promptly rather than grinding to the absolute cap (~750 iterations).
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', {
      get: () => 5_000,
      set: () => {}, // a scroller that ignores every write
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 852, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { get: () => 50_000, configurable: true });
    const window = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));

    const promise = accumulateWhileScrolling(container, () => window);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.fullyLoaded).toBe(false);
    expect(result.itemCount).toBe(6);
    // 15_000ms / 400ms ≈ 38 iterations, plus slack — nowhere near the cap.
    expect(result.iterations).toBeLessThan(45);
  });

  it('stops via the idle deadline (not the absolute cap) when stuck below the top', async () => {
    // The scroll never reaches the top and no new turns ever mount after the
    // seed window: a broken/stuck scroller. Accumulation must give up promptly
    // on the no-progress (idle) deadline, not grind until the absolute cap.
    const container = document.createElement('div');
    let scrollTop = 10_000;
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = Math.max(3_000, v); // never pins at the top
      },
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 900, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { get: () => 10_900, configurable: true });
    // Fixed window: the same 6 turns mount forever, so no iteration ever grows.
    const window = Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
    const harvest = () => window;

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.fullyLoaded).toBe(false);
    expect(result.itemCount).toBe(6);
    // The scroller still travels 10_900 → 3_000 before pinning, i.e. ~15
    // iterations of real upward movement, and movement is progress (issue
    // #365). The idle deadline (~38 iters) then runs from the moment motion
    // stops, so ~53 iterations total — still nowhere near the absolute cap
    // (~750): this proves the idle path, not the cap.
    expect(result.iterations).toBeLessThan(80);
  });

  it('captures the newest turn even when Sync starts scrolled up (issue #348)', async () => {
    // The view is scrolled up on Sync, so the last turn (v19) is below the fold
    // and not in the initially-mounted window. Upward-only accumulation would
    // never reach it; the engine must seed at the bottom first.
    const { container, harvest } = createVirtualList({
      total: 20,
      windowSize: 6,
      startFraction: 0.5,
    });

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.itemCount).toBe(20);
    expect(result.items).toEqual(Array.from({ length: 20 }, (_, i) => `v${i}`));
    // The regression: the final turn must be present.
    expect(result.items[result.items.length - 1]).toBe('v19');
  });

  it('skips scrolling when the container starts at the top (short conversation)', async () => {
    const { container, harvest } = createVirtualList({
      total: 3,
      windowSize: 5,
      startAtTop: true,
    });

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.skipped).toBe(true);
    expect(result.items).toEqual(['v0', 'v1', 'v2']);
  });

  it('does not skip a zero-range reversed view while a top-settle load can still arrive', async () => {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column-reverse';
    const started = Date.now();
    let scrollTop = 0;
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        const range = Date.now() - started >= 1_000 ? 1_000 : 0;
        scrollTop = Math.max(-range, Math.min(0, value));
      },
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 500, configurable: true });
    Object.defineProperty(container, 'scrollHeight', {
      get: () => (Date.now() - started >= 1_000 ? 1_500 : 500),
      configurable: true,
    });
    const harvest = () =>
      Date.now() - started >= 1_000
        ? [
            { key: 'older', value: 'older' },
            { key: 'newest', value: 'newest' },
          ]
        : [{ key: 'newest', value: 'newest' }];

    const promise = accumulateWhileScrolling(container, harvest, { topSettleMs: 2_000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.skipped).toBe(false);
    expect(result.fullyLoaded).toBe(true);
    expect(result.items).toEqual(['older', 'newest']);
  });

  it('restarts the full top settle whenever another zero-range history page arrives', async () => {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column-reverse';
    Object.defineProperty(container, 'scrollTop', {
      get: () => 0,
      set: () => {},
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 1_000, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { get: () => 1_000, configurable: true });
    const started = Date.now();
    const harvest = () => {
      const elapsed = Date.now() - started;
      if (elapsed >= 4_000) {
        return [
          { key: 'oldest', value: 'oldest' },
          { key: 'older', value: 'older' },
          { key: 'newest', value: 'newest' },
        ];
      }
      if (elapsed >= 2_200) {
        return [
          { key: 'older', value: 'older' },
          { key: 'newest', value: 'newest' },
        ];
      }
      return [{ key: 'newest', value: 'newest' }];
    };

    const promise = accumulateWhileScrolling(container, harvest, { topSettleMs: 2_000 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.fullyLoaded).toBe(true);
    expect(result.items).toEqual(['oldest', 'older', 'newest']);
    expect(Date.now() - started).toBeGreaterThanOrEqual(6_000);
  });

  it('never calls a hidden zero-range settled pass complete', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column-reverse';
    Object.defineProperty(container, 'scrollTop', {
      get: () => 0,
      set: () => {},
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 500, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { get: () => 500, configurable: true });

    try {
      const promise = accumulateWhileScrolling(
        container,
        () => [{ key: 'visible-window', value: 'visible-window' }],
        { topSettleMs: 2_000 }
      );
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.skipped).toBe(false);
      expect(result.fullyLoaded).toBe(false);
      expect(result.items).toEqual(['visible-window']);
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
  });

  it('reports fullyLoaded=false when the DOM never stabilizes (timeout)', async () => {
    // Harvest that always yields a brand-new unique key → never stabilizes.
    const container = document.createElement('div');
    let scrollTop = 10_000;
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = Math.max(0, v);
      },
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 900, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { get: () => 10_900, configurable: true });
    let n = 0;
    const harvest = () => [{ key: `new${n++}`, value: `val${n}` }];

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.fullyLoaded).toBe(false);
    expect(result.skipped).toBe(false);
  });

  it('keeps the freshest content when a key re-appears in a later window', async () => {
    const container = document.createElement('div');
    let scrollTop = 10_000;
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = Math.max(0, v);
      },
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', { get: () => 900, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { get: () => 10_900, configurable: true });

    let round = 0;
    const harvest = () => {
      round++;
      // First harvest: key "a" has stale (streaming) content; later: final content.
      if (round === 1) return [{ key: 'a', value: 'partial' }];
      return [{ key: 'a', value: 'final' }];
    };

    const promise = accumulateWhileScrolling(container, harvest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.items).toEqual(['final']);
  });
});
