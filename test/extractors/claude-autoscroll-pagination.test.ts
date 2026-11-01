/** Delayed older-page loading and growing geometry in an isolated Claude fixture. */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeExtractor } from '../../src/content/extractors/claude';
import { installClaudeScrollPrimeMain } from '../../src/content/capture/claude-scroll-prime-main-runtime';
import { clearFixture, setClaudeLocation, resetLocation } from '../fixtures/dom-helpers';
import {
  MAX_SCROLL,
  createClaudeAutoscrollFixture,
  setPendingHistoryMarker,
  settings,
  type Turn,
} from '../fixtures/claude-autoscroll';

const { turnUuid, turnKey, mountVirtualizedClaude } = createClaudeAutoscrollFixture();

describe('ClaudeExtractor auto-scroll (virtualization)', () => {
  let extractor: ClaudeExtractor;
  let removePrimeBridge: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.title = 'Claude';
    removePrimeBridge = installClaudeScrollPrimeMain({ document });
    extractor = new ClaudeExtractor();
    setClaudeLocation('1fbb8252-2bec-4ef2-bf1f-88393dd9bb5f');
  });

  afterEach(() => {
    removePrimeBridge();
    vi.restoreAllMocks();
    vi.useRealTimers();
    clearFixture();
    resetLocation();
  });

  const longConversation: Turn[] = Array.from({ length: 154 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Synthetic turn ${index}`,
  }));
  longConversation.forEach(turnUuid);

  it.each([
    { delays: [700] },
    { delays: [600, 1000] },
    { delays: [2300] },
    { delays: [2300, 3200] },
    { delays: [100, 100, 100, 100] },
  ])('waits for delayed older history pages and geometry growth ($delays)', async ({ delays }) => {
    const pageStarts =
      delays.length === 4
        ? [122, 90, 58, 26, 0]
        : Array.from({ length: delays.length + 1 }, (_, index) =>
            Math.round(122 * (1 - index / delays.length))
          );
    const turns = longConversation.slice(pageStarts[0]);
    let page = 0;
    let pending = false;
    let geometry = MAX_SCROLL + 900;
    let lastGrowth = 0;
    const mounted = mountVirtualizedClaude(turns, 3, {
      onScroll: () => {
        setPendingHistoryMarker(scroller, !pending && page < delays.length);
        if (scroller.scrollTop !== 0 || pending || page >= delays.length) return;
        pending = true;
        setPendingHistoryMarker(scroller, false);
        setTimeout(() => {
          const previousStart = pageStarts[page];
          const firstIndex = pageStarts[page + 1];
          turns.splice(0, turns.length, ...longConversation.slice(firstIndex));
          page++;
          pending = false;
          geometry += MAX_SCROLL;
          lastGrowth = Date.now();
          // Provider anchor adjustment after prepending an older page. The
          // logical window shifts by the prepend delta while geometry stays
          // near the top, matching the observed short post-request insertion.
          mounted.anchorAfterPrepend(previousStart - firstIndex);
        }, delays[page]);
      },
    });
    const { scroller } = mounted;
    setPendingHistoryMarker(scroller, true);
    Object.defineProperty(scroller, 'scrollHeight', { get: () => geometry, configurable: true });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(page).toBe(delays.length);
    expect(Date.now() - lastGrowth).toBeGreaterThanOrEqual(5000);
    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(longConversation.map(turnKey));
    expect(result.data?.metadata).toMatchObject({
      messageCount: 154,
      userMessageCount: 77,
      assistantMessageCount: 77,
    });
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    expect(scroller.querySelectorAll('[data-index]')).toHaveLength(3);
  });
});
