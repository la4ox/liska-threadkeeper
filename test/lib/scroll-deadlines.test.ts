import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_IDLE_TIMEOUT, SCROLL_MAX_TIMEOUT } from '../../src/lib/constants';
import {
  DEFAULT_SCROLL_DEADLINES,
  buildScrollTimeoutWarning,
  getScrollTimeoutReason,
  isScrollTimeoutReason,
  logScrollStop,
} from '../../src/lib/scroll-deadlines';

afterEach(() => vi.restoreAllMocks());

describe('scroll deadlines', () => {
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
      idleTimeoutMs: 0,
      maxTimeoutMs: 1_000_000_000,
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
