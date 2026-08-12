/**
 * DeepSeek auto-scroll (virtualization) integration tests.
 *
 * DeepSeek renders messages in `.ds-virtual-list`; only a small window is
 * mounted at once. These tests make that behavior deterministic and verify
 * that BaseExtractor's accumulation engine reconstructs the current branch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekExtractor } from '../../src/content/extractors/deepseek';
import { clearFixture, resetLocation } from '../fixtures/dom-helpers';
import type { SyncSettings } from '../../src/lib/types';

const MAX_SCROLL = 10_000;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  id: string;
}

function setDeepSeekLocation(id: string): void {
  const pathname = `/a/chat/s/${id}`;
  Object.defineProperty(window, 'location', {
    value: {
      hostname: 'chat.deepseek.com',
      pathname,
      href: `https://chat.deepseek.com${pathname}`,
      origin: 'https://chat.deepseek.com',
      protocol: 'https:',
      host: 'chat.deepseek.com',
      search: '',
      hash: '',
    },
    writable: true,
    configurable: true,
  });
}

function renderTurn(turn: Turn, index: number): string {
  const body =
    turn.role === 'user'
      ? `<div class="gh-user-query-markdown">${turn.content}</div>`
      : `<div class="ds-markdown"><p>${turn.content}</p></div>`;
  return `<div data-index="${index}"><div class="ds-message" data-message-id="${turn.id}" data-role="${turn.role}">${body}</div></div>`;
}

function mountVirtualizedDeepSeek(turns: Turn[], windowSize: number): void {
  document.body.innerHTML = `
    <aside><div class="ds-scroll-area" id="sidebar"></div></aside>
    <main><div class="ds-scroll-area" id="scroller"><div class="ds-virtual-list"></div></div></main>`;
  const scroller = document.getElementById('scroller') as HTMLElement;

  let scrollTop = MAX_SCROLL;
  const maxStart = Math.max(0, turns.length - windowSize);

  const render = (): void => {
    const fraction = scrollTop / MAX_SCROLL;
    const start = Math.round(fraction * maxStart);
    scroller.innerHTML = `<div class="ds-virtual-list"><div class="ds-virtual-list-items">${turns
      .slice(start, start + windowSize)
      .map((turn, index) => renderTurn(turn, start + index))
      .join('')}</div></div>`;
  };

  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(MAX_SCROLL, value));
      render();
    },
    configurable: true,
  });
  Object.defineProperty(scroller, 'clientHeight', { get: () => 900, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', {
    get: () => MAX_SCROLL + 900,
    configurable: true,
  });

  render();
}

function settings(overrides: Partial<SyncSettings> = {}): SyncSettings {
  return { enableAutoScroll: true, ...overrides } as SyncSettings;
}

function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
}

describe('DeepSeekExtractor auto-scroll (virtualization)', () => {
  let extractor: DeepSeekExtractor;

  beforeEach(() => {
    vi.useFakeTimers();
    extractor = new DeepSeekExtractor();
    setDeepSeekLocation('a960c1d4-e8aa-4ad9-b273-6bc50fba8a39');
  });

  afterEach(() => {
    vi.useRealTimers();
    clearFixture();
    resetLocation();
  });

  const conversation: Turn[] = Array.from({ length: 8 }, (_, index) => ({
    role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: index % 2 === 0 ? `Q${index / 2 + 1}` : `A${(index - 1) / 2 + 1}`,
    id: `message-${index}`,
  }));

  it('accumulates all virtualized turns in active-branch order when enabled', async () => {
    mountVirtualizedDeepSeek(conversation, 3);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages).toHaveLength(8);
    expect(result.data?.messages.map(message => plainText(message.content))).toEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'A3',
      'Q4',
      'A4',
    ]);
    expect(result.data?.messages.map(message => message.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.warnings).toBeUndefined();
  });

  it('extracts only the currently mounted window when auto-scroll is disabled', async () => {
    mountVirtualizedDeepSeek(conversation, 3);
    extractor.applySettings(settings({ enableAutoScroll: false }));

    const result = await extractor.extract();

    expect(result.success).toBe(true);
    expect(result.data?.messages).toHaveLength(3);
  });

  it('uses data-index as a stable harvest order when available', () => {
    document.body.innerHTML = `
      <main><div class="ds-scroll-area">
        ${renderTurn({ role: 'user', content: 'Q9', id: 'first' }, 17)}
        ${renderTurn({ role: 'assistant', content: 'A9', id: 'second' }, 18)}
      </div></main>`;

    const entries = extractor['harvestWindow']();

    expect(entries.map(entry => entry.key)).toEqual(['first', 'second']);
    expect(entries.map(entry => entry.order)).toEqual([17, 18]);
  });
});
