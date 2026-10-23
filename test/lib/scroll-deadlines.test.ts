import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_IDLE_TIMEOUT, SCROLL_MAX_TIMEOUT } from '../../src/lib/constants';
import {
  DEFAULT_SCROLL_DEADLINES,
  buildScrollTimeoutWarning,
  getScrollTimeoutReason,
  isScrollTimeoutReason,
  logScrollStop,
  resolveScrollDeadlines,
} from '../../src/lib/scroll-deadlines';

afterEach(() => vi.restoreAllMocks());

describe('scroll deadlines', () => {
  it('resolves missing and configured settings at the sole milliseconds boundary', () => {
    expect(resolveScrollDeadlines()).toEqual(DEFAULT_SCROLL_DEADLINES);
    expect(resolveScrollDeadlines(null)).toEqual(DEFAULT_SCROLL_DEADLINES);
    expect(resolveScrollDeadlines({})).toEqual(DEFAULT_SCROLL_DEADLINES);
    expect(resolveScrollDeadlines({ scrollIdleTimeoutSec: 120, scrollMaxTimeoutSec: 30 })).toEqual({
      idleTimeoutMs: 120_000,
      maxTimeoutMs: 30_000,
    });
    expect(
      getScrollTimeoutReason(
        0,
        0,
        30_000,
        resolveScrollDeadlines({ scrollIdleTimeoutSec: 120, scrollMaxTimeoutSec: 30 })
      )
    ).toBe('max-timeout');
  });

  it.each([
    undefined,
    null,
    '999999',
    0,
    -1,
    30.5,
    NaN,
    Infinity,
    -Infinity,
    1,
    301,
    3600,
    Number.MAX_VALUE,
  ])('never resolves malformed/direct seconds %s above the shipped hard cap', value => {
    const deadlines = resolveScrollDeadlines({
      scrollIdleTimeoutSec: value,
      scrollMaxTimeoutSec: value,
    } as never);
    expect(deadlines.idleTimeoutMs).toBeGreaterThan(0);
    expect(deadlines.maxTimeoutMs).toBeGreaterThan(0);
    expect(deadlines.idleTimeoutMs).toBeLessThanOrEqual(300_000);
    expect(deadlines.maxTimeoutMs).toBeLessThanOrEqual(300_000);
  });

  it.each([undefined, null, '999999', 0, -1, NaN, Infinity, -Infinity, 3600_000, Number.MAX_VALUE])(
    'enforces the hard cap for direct malformed millisecond limits: %s',
    value => {
      const deadlines = { idleTimeoutMs: value, maxTimeoutMs: value } as never;
      expect(getScrollTimeoutReason(0, 299_999, 300_000, deadlines)).toBe('max-timeout');
    }
  );

  it('defaults to the shipped 15s idle window and 300s absolute cap', () => {
    expect(DEFAULT_SCROLL_DEADLINES).toEqual({ idleTimeoutMs: 15_000, maxTimeoutMs: 300_000 });
    expect(DEFAULT_SCROLL_DEADLINES.idleTimeoutMs).toBe(SCROLL_IDLE_TIMEOUT);
    expect(DEFAULT_SCROLL_DEADLINES.maxTimeoutMs).toBe(SCROLL_MAX_TIMEOUT);
    expect(Object.isFrozen(DEFAULT_SCROLL_DEADLINES)).toBe(true);
    expect(getScrollTimeoutReason(100, 100, 15_099)).toBeUndefined();
    expect(getScrollTimeoutReason(100, 100, 15_100)).toBe('idle-timeout');
    expect(getScrollTimeoutReason(100, 299_000, 300_100)).toBe('max-timeout');
  });

  it.each([
    [undefined, 15_000, 300_000],
    [null, 15_000, 300_000],
    [{}, 15_000, 300_000],
    [{ idleTimeoutMs: 40 }, 40, 300_000],
    [{ maxTimeoutMs: 100 }, 15_000, 100],
    [{ idleTimeoutMs: 40.5, maxTimeoutMs: 100.5 }, 40.5, 100.5],
    [{ idleTimeoutMs: 3_600_000, maxTimeoutMs: Number.MAX_VALUE }, 300_000, 300_000],
    [{ idleTimeoutMs: NaN, maxTimeoutMs: Infinity }, 15_000, 300_000],
    [{ idleTimeoutMs: -Infinity, maxTimeoutMs: NaN }, 15_000, 300_000],
    [{ idleTimeoutMs: 0, maxTimeoutMs: -1 }, 15_000, 300_000],
    [{ idleTimeoutMs: '999999', maxTimeoutMs: false }, 15_000, 300_000],
    [{ idleTimeoutMs: null, maxTimeoutMs: {} }, 15_000, 300_000],
  ])('uses and logs the same effective direct limits for %j', (input, idle, max) => {
    const deadlines = input as Parameters<typeof getScrollTimeoutReason>[3];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    // With recent progress, only the absolute cap is eligible to expire.
    expect(getScrollTimeoutReason(0, max - 1, max - 1, deadlines)).toBeUndefined();
    expect(getScrollTimeoutReason(0, max - 1, max, deadlines)).toBe('max-timeout');
    // Without progress, preserve first-expiry behavior (idle wins a tie).
    const firstExpiry = Math.min(idle, max);
    expect(getScrollTimeoutReason(0, 0, firstExpiry - 1, deadlines)).toBeUndefined();
    expect(getScrollTimeoutReason(0, 0, firstExpiry, deadlines)).toBe(
      idle <= max ? 'idle-timeout' : 'max-timeout'
    );
    expect(() => logScrollStop('max-timeout', max, deadlines, 1, 2)).not.toThrow();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[G2O] Auto-scroll stopped: max-timeout',
      expect.objectContaining({ idleTimeoutMs: idle, maxTimeoutMs: max })
    );
    expect(() => logScrollStop('skipped', 0, deadlines, 0, 0)).not.toThrow();
    expect(info).toHaveBeenCalledExactlyOnceWith(
      '[G2O] Auto-scroll stopped: skipped',
      expect.objectContaining({ idleTimeoutMs: idle, maxTimeoutMs: max })
    );
    expect(idle).toBeLessThanOrEqual(300_000);
    expect(max).toBeLessThanOrEqual(300_000);
  });

  it.each([
    { lastProgress: 1_000, expected: 'idle-timeout' },
    { lastProgress: 290_000, expected: 'max-timeout' },
    { lastProgress: 285_000, expected: 'idle-timeout' },
  ])('reports the first expiry even when both were crossed: $expected', state => {
    expect(getScrollTimeoutReason(0, state.lastProgress, 500_000)).toBe(state.expected);
  });

  it('supports per-call limits without changing defaults', () => {
    const limits = { idleTimeoutMs: 40, maxTimeoutMs: 100 };
    expect(getScrollTimeoutReason(10, 80, 109, limits)).toBeUndefined();
    expect(getScrollTimeoutReason(10, 80, 110, limits)).toBe('max-timeout');
    expect(getScrollTimeoutReason(10, 10, 50, limits)).toBe('idle-timeout');
    expect(getScrollTimeoutReason(10, 10, 110)).toBeUndefined();
  });

  it.each(['stable', 'skipped'] as const)('does not warn or infer a deadline from %s', reason => {
    expect(isScrollTimeoutReason(reason)).toBe(false);
    expect(buildScrollTimeoutWarning(reason, 10)).toBeUndefined();
  });

  it('builds distinct actionable warnings without claiming configurable settings or completeness', () => {
    const idle = buildScrollTimeoutWarning('idle-timeout', 12);
    const max = buildScrollTimeoutWarning('max-timeout', 12);
    expect(idle).toContain('idle-timeout: no loading progress');
    expect(max).toContain('max-timeout: safety time limit reached');
    expect(max).not.toContain('no loading progress');
    for (const warning of [idle, max]) {
      expect(warning).toContain('Auto-scroll timed out');
      expect(warning).toContain('Some earlier messages may be missing (12 turns loaded)');
      expect(warning).toContain('Load earlier messages and retry.');
      expect(warning).not.toMatch(/settings|configur|complete|reaching the top/i);
    }
  });

  it('logs only allowlisted reason and bounded numerical diagnostics', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    logScrollStop(
      'max-timeout',
      Number.POSITIVE_INFINITY,
      { idleTimeoutMs: -12, maxTimeoutMs: Number.MAX_VALUE },
      3.5,
      Number.NaN
    );
    expect(warn).toHaveBeenCalledExactlyOnceWith('[G2O] Auto-scroll stopped: max-timeout', {
      reason: 'max-timeout',
      elapsedMs: 0,
      idleTimeoutMs: 15_000,
      maxTimeoutMs: 300_000,
      iterations: 3,
      count: 0,
    });
    logScrollStop('stable', 1000, DEFAULT_SCROLL_DEADLINES, 3, 12);
    expect(info).toHaveBeenCalledExactlyOnceWith(
      '[G2O] Auto-scroll stopped: stable',
      expect.objectContaining({ reason: 'stable', count: 12 })
    );
    expect(buildScrollTimeoutWarning('idle-timeout', -1)).toContain('(0 turns loaded)');
    expect(buildScrollTimeoutWarning('max-timeout', Number.MAX_VALUE)).toContain(
      '(1000000000 turns loaded)'
    );
  });
});
