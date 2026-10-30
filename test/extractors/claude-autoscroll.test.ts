/**
 * Claude auto-scroll (virtualization) integration tests — ADR-017.
 *
 * Claude mounts only a small window of turns; scrolling up loads earlier turns
 * while evicting later ones. These tests drive the extractor against a
 * simulated virtual list (turns rendered with `data-index`, mounted/evicted by
 * scrollTop) and assert the full history is accumulated in order.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeExtractor } from '../../src/content/extractors/claude';
import * as markdownRules from '../../src/content/markdown-rules';
import * as sanitize from '../../src/lib/sanitize';
import { conversationToNote } from '../../src/content/markdown';
import { countExistingMessages, MESSAGE_BOUNDARY_MARKER } from '../../src/lib/message-counter';
import {
  CLAUDE_TOOL_LIMITS,
  ClaudeToolConversionBudget,
} from '../../src/content/extractors/claude-tool-markdown';
import type { ScrollConfig } from '../../src/content/extractors/base';
import type { HarvestEntry } from '../../src/lib/scroll-manager';
import { clearFixture, setClaudeLocation, resetLocation } from '../fixtures/dom-helpers';
import type { ConversationMessage, SyncSettings } from '../../src/lib/types';
import { installClaudeScrollPrimeMain } from '../../src/content/capture/claude-scroll-prime-main-runtime';

const MAX_SCROLL = 10_000;
const ASSISTANT_PLACEHOLDERS = ['<p></p>', '<p><br></p>', '<span>&nbsp;</span>'];
const STABLE_EMPTY_ASSISTANT =
  '<div data-testid="assistant-message" data-cds="AssistantMessage" data-is-streaming="false"><h3 data-find-omitted aria-hidden="true" class="sr-only select-none"></h3></div>';

function setPendingHistoryMarker(
  container: HTMLElement,
  pending: boolean,
  placement: 'before' | 'between' | 'after' = 'before'
): void {
  container
    .querySelectorAll('[data-testid="transcript-sizer"][data-rocksteady-sizer]')
    .forEach(element => element.remove());
  if (!pending) return;
  const sizer = document.createElement('div');
  sizer.setAttribute('data-testid', 'transcript-sizer');
  sizer.setAttribute('data-rocksteady-sizer', '');
  sizer.setAttribute('data-sizer-excess', '');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sr-only select-none';
  button.tabIndex = -1;
  sizer.append(button);
  if (placement === 'before') {
    container.prepend(sizer);
  } else if (placement === 'after') {
    container.append(sizer);
  } else {
    const rows = container.querySelectorAll('[data-index]');
    const pivot = rows.item(Math.max(1, Math.floor(rows.length / 2)));
    if (pivot) pivot.before(sizer);
    else container.append(sizer);
  }
}

class DefaultStepClaudeExtractor extends ClaudeExtractor {
  protected getScrollConfig(): ScrollConfig {
    return {
      ...super.getScrollConfig(),
      stepFactor: undefined,
      minStep: undefined,
      pollIntervalMs: undefined,
    };
  }
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolHtml?: string;
  bodyHtml?: string;
  uuid?: string;
}

let nextTurnUuid = 1;

function turnUuid(turn: Turn): string {
  if (turn.uuid) return turn.uuid;
  const suffix = (nextTurnUuid++).toString(16).padStart(12, '0');
  turn.uuid = `00000000-0000-4000-8000-${suffix}`;
  return turn.uuid;
}

function turnKey(turn: Turn): string {
  return `${turn.role}:${turnUuid(turn)}`;
}

function withAssistantIdentity(turn: Turn, html: string): string {
  const uuid = turnUuid(turn);
  if (
    html.includes('data-testid="assistant-message"') &&
    html.includes('data-cds="AssistantMessage"') &&
    !html.includes('data-turn-key=')
  ) {
    return html.replace(
      'data-cds="AssistantMessage"',
      `data-cds="AssistantMessage" data-turn-key="${uuid}-hub-reply"`
    );
  }
  if (html.includes('class="font-claude-response"')) {
    return html.replace(
      'class="font-claude-response"',
      `data-testid="assistant-message" data-cds="AssistantMessage" data-turn-key="${uuid}-hub-reply" class="font-claude-response"`
    );
  }
  return html;
}

interface ToolCacheStateForTest {
  entries: Map<string, { input: string; output: string | null; byteLength: number }>;
  totalBytes: number;
}

/** Structural private seam: no production diagnostics or exported test API. */
function createToolCacheHarness(extractor: ClaudeExtractor) {
  const state: ToolCacheStateForTest = { entries: new Map(), totalBytes: 0 };
  const budget = new ClaudeToolConversionBudget();
  const reader = extractor as unknown as {
    extractToolContentFromElement(
      element: Element,
      budget: ClaudeToolConversionBudget,
      cache: { key: string; values: ToolCacheStateForTest }
    ): string | null;
  };
  return {
    state,
    budget,
    read: (key: string, element: Element) =>
      reader.extractToolContentFromElement(element, budget, { key, values: state }),
  };
}

/** Nested candidates are snapshotted but discarded by the ignored outer header. */
function discardedToolRoot(payloads: string[]): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `<div><div class="row-start-1"><div class="group/thinking">Thinking</div>${payloads
    .map(
      () =>
        '<div><div class="row-start-1"><div class="standard-markdown" data-cache-payload></div></div><div class="row-start-2"></div></div>'
    )
    .join('')}</div><div class="row-start-2"></div></div>`;
  root.querySelectorAll('[data-cache-payload]').forEach((element, index) => {
    element.textContent = payloads[index];
  });
  return root;
}

/** Render one turn wrapped in a `data-index` virtual-row wrapper. */
function renderTurn(turn: Turn, index: number | string | null, fallbackOnly = false): string {
  const uuid = turnUuid(turn);
  let inner =
    turn.role === 'user'
      ? fallbackOnly
        ? `<p class="whitespace-pre-wrap break-words">${turn.content}</p>`
        : `<div class="bg-bg-300 rounded-xl"><div data-testid="user-message" id="user-message-${uuid}">${turn.content}</div></div>`
      : `<div ${
          fallbackOnly
            ? 'data-is-streaming="false"'
            : `data-testid="assistant-message" data-cds="AssistantMessage" data-turn-key="${uuid}-hub-reply" class="font-claude-response"`
        }>${
          turn.toolHtml === undefined
            ? `<div class="standard-markdown"><p>${turn.content}</p></div>`
            : `<div class="row-start-1"><div class="standard-markdown">${turn.toolHtml}</div></div>
               <div class="row-start-2"><div class="standard-markdown"><p>${turn.content}</p></div></div>`
        }</div>`;
  if (turn.bodyHtml !== undefined) {
    inner = turn.role === 'assistant' ? withAssistantIdentity(turn, turn.bodyHtml) : turn.bodyHtml;
  }
  return `<div ${index === null ? '' : `data-index="${index}"`}><div data-test-render-count="2">${inner}</div></div>`;
}

/**
 * Install a virtualized Claude conversation into the DOM. Only `windowSize`
 * consecutive turns are mounted at once, chosen by the current scrollTop
 * (bottom on open). Returns the thread and a spy on sidebar scroll writes.
 */
function mountVirtualizedClaude(
  turns: Turn[],
  windowSize: number,
  {
    semanticRoot = true,
    sidebar = false,
    indexedSidebar = false,
    fallbackOnly = false,
    rowIndices,
    onScroll,
    requireRelativeNudge = false,
    relativeNudgeFailures = 0,
    boundedWindowAdvance = true,
  }: {
    semanticRoot?: boolean;
    sidebar?: boolean;
    indexedSidebar?: boolean;
    fallbackOnly?: boolean;
    rowIndices?: readonly (number | string | null)[];
    onScroll?: () => void;
    requireRelativeNudge?: boolean;
    relativeNudgeFailures?: number;
    boundedWindowAdvance?: boolean;
  } = {}
) {
  document.body.innerHTML = `
    ${sidebar ? `<div id="sidebar" role="navigation" class="overflow-y-auto overflow-x-hidden flex-1">${indexedSidebar ? '<div data-index="99">Sidebar item</div>' : 'Sidebar item'}</div>` : ''}
    <div ${semanticRoot ? 'data-autoscroll-container' : ''} class="overflow-y-auto overflow-x-hidden flex-1" id="scroller"></div>
  `;
  const scroller = document.getElementById('scroller') as HTMLElement;
  const sidebarElement = document.getElementById('sidebar');
  const sidebarScroll = vi.fn();
  if (sidebarElement) {
    Object.defineProperty(sidebarElement, 'scrollTop', {
      get: () => MAX_SCROLL,
      set: sidebarScroll,
      configurable: true,
    });
  }

  let scrollTop = MAX_SCROLL; // opens at the bottom
  let unlocked = !requireRelativeNudge;
  let remainingRelativeFailures = relativeNudgeFailures;
  let renderedStart = Math.max(0, turns.length - windowSize);
  const render = (preserveStart = false): void => {
    const maxStart = Math.max(0, turns.length - windowSize);
    const frac = scrollTop / MAX_SCROLL;
    const targetStart = Math.round(frac * maxStart);
    const movingUp = targetStart < renderedStart;
    if (!preserveStart) {
      renderedStart =
        movingUp && boundedWindowAdvance
          ? Math.max(targetStart, renderedStart - Math.max(1, windowSize - 1))
          : Math.min(targetStart, maxStart);
    }
    const start = renderedStart;
    const positions = Array.from(
      { length: Math.min(windowSize, turns.length - start) },
      (_, index) => start + index
    );
    const tail = turns.length - 1;
    if (positions.length > 0 && positions.length === windowSize && !positions.includes(tail)) {
      positions[positions.length - 1] = tail;
    }
    scroller.innerHTML = positions
      .map(position =>
        renderTurn(turns[position], rowIndices ? rowIndices[position] : position, fallbackOnly)
      )
      .join('');
  };

  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      if (!unlocked && v < scrollTop) return;
      scrollTop = Math.max(0, Math.min(MAX_SCROLL, v));
      onScroll?.();
      render();
    },
    configurable: true,
  });
  Object.defineProperty(scroller, 'clientHeight', { get: () => 900, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', {
    get: () => MAX_SCROLL + 900,
    configurable: true,
  });
  scroller.scrollBy = vi.fn((options: ScrollToOptions) => {
    if (remainingRelativeFailures > 0) {
      remainingRelativeFailures--;
      return;
    }
    unlocked = true;
    scroller.scrollTop += options.top ?? 0;
  });

  render();
  return {
    scroller,
    sidebarScroll,
    anchorAfterPrepend(delta: number) {
      renderedStart += delta;
      render(true);
      scrollTop = 400;
    },
  };
}

/** Retain row nodes while a small scroll range drives window-to-window changes. */
function mountMutableClaudeWindow(turns: Turn[], onScroll: (write: number) => void) {
  const { scroller } = mountVirtualizedClaude(turns, turns.length);
  let scrollTop = 1000;
  let writes = 0;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(1000, value));
      onScroll(++writes);
    },
    configurable: true,
  });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => 1900, configurable: true });
  return scroller;
}

function replacementClaudeRoot(turns: Turn[]) {
  const container = document.createElement('div');
  container.setAttribute('data-autoscroll-container', '');
  container.innerHTML = turns.map((turn, index) => renderTurn(turn, index)).join('');
  let top = 1000;
  const writes: number[] = [];
  Object.defineProperty(container, 'scrollTop', {
    get: () => top,
    set: (value: number) => {
      writes.push(value);
      top = Math.max(0, Math.min(1000, value));
    },
    configurable: true,
  });
  Object.defineProperty(container, 'scrollHeight', { get: () => 1900, configurable: true });
  Object.defineProperty(container, 'clientHeight', { get: () => 900, configurable: true });
  container.scrollBy = vi.fn((options: ScrollToOptions) => {
    container.scrollTop += options.top ?? 0;
  });
  return { container, writes };
}

function stableEmptyGateFixture(extractor: ClaudeExtractor) {
  const scroller = mountMutableClaudeWindow(
    [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: '', bodyHtml: STABLE_EMPTY_ASSISTANT },
    ],
    () => {}
  );
  const row = scroller.querySelector('[data-index="1"]')!;
  const assistant = row.querySelector('[data-testid="assistant-message"]')!;
  const heading = assistant.querySelector('h3')!;
  const reader = extractor as unknown as {
    isStableEmptyAssistant(element: Element): boolean;
    getScrollConfig(): ScrollConfig;
  };
  return {
    row,
    assistant,
    heading,
    scroller,
    accepted: () => reader.isStableEmptyAssistant(assistant),
    proof: () => {
      const config = reader.getScrollConfig();
      const entries = config.harvest(scroller);
      return config.isHistoryComplete!(entries.map(entry => entry.value));
    },
  };
}

function settings(overrides: Partial<SyncSettings> = {}): SyncSettings {
  return { enableAutoScroll: true, ...overrides } as SyncSettings;
}

/** Plain text of a message body via the DOM (avoids regex HTML stripping). */
function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
}

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

  const conversation: Turn[] = [
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'Q2' },
    { role: 'assistant', content: 'A2' },
    { role: 'user', content: 'Q3' },
    { role: 'assistant', content: 'A3' },
  ];

  const longConversation: Turn[] = Array.from({ length: 154 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Synthetic turn ${index}`,
  }));
  conversation.forEach(turnUuid);
  longConversation.forEach(turnUuid);

  function directHistoryProof() {
    document.body.innerHTML = '<div data-autoscroll-container id="proof-root"></div>';
    const root = document.getElementById('proof-root') as HTMLElement;
    const config = (extractor as unknown as { getScrollConfig(): ScrollConfig }).getScrollConfig();
    const accumulated = new Map<string, ConversationMessage>();
    const orders = new Map<string, number>();
    const harvest = (turns: Turn[], indices: readonly number[] = turns.map((_, i) => i)) => {
      root.innerHTML = turns.map((turn, position) => renderTurn(turn, indices[position])).join('');
      const entries = config.harvest(root);
      entries.forEach(entry => {
        accumulated.set(entry.key, entry.value);
        if (entry.order !== undefined) orders.set(entry.key, entry.order);
      });
      return entries;
    };
    const messages = () =>
      [...accumulated.entries()]
        .sort((left, right) => (orders.get(left[0]) ?? 0) - (orders.get(right[0]) ?? 0))
        .map(([, message]) => message);
    return { root, config, harvest, messages };
  }

  it('proves live-style prepend epochs, relative order, and an empty assistant boundary', () => {
    const proof = directHistoryProof();
    const pagedConversation = longConversation.map(turn => ({ ...turn }));
    pagedConversation[151].bodyHtml = STABLE_EMPTY_ASSISTANT;
    const starts = [122, 90, 58, 26, 0];
    const expectedMaxima = [31, 63, 95, 127, 153];
    const newestTail = turnKey(pagedConversation[153]);
    let newestOrders: Map<string, number> | undefined;

    starts.forEach((start, wave) => {
      const entries = proof.harvest(pagedConversation.slice(start));
      expect(entries.at(-1)).toMatchObject({ key: newestTail, order: 0 });
      expect(entries.map(entry => entry.order)).toEqual(
        Array.from({ length: expectedMaxima[wave] + 1 }, (_, index) => index - expectedMaxima[wave])
      );
      const currentNewest = new Map(
        entries.slice(-32).map(entry => [entry.key, entry.order as number])
      );
      if (newestOrders) expect(currentNewest).toEqual(newestOrders);
      newestOrders = currentNewest;
    });

    const messages = proof.messages();
    expect(messages).toHaveLength(154);
    expect(new Set(messages.map(message => message.id)).size).toBe(154);
    expect(messages.map(message => message.id)).toEqual(pagedConversation.map(turnKey));
    expect(messages[151]).toMatchObject({
      id: turnKey(pagedConversation[151]),
      role: 'assistant',
      content: '',
    });
    expect(proof.config.isHistoryComplete!(messages)).toBe(true);
  });

  it('allows one UUID across roles because the role namespace is part of the key', () => {
    const proof = directHistoryProof();
    const uuid = '11111111-2222-4333-8444-555555555555';
    const turns: Turn[] = [
      { role: 'user', content: 'Question', uuid },
      { role: 'assistant', content: 'Answer', uuid },
    ];
    const entries = proof.harvest(turns);
    expect(entries.map(entry => entry.key)).toEqual([`user:${uuid}`, `assistant:${uuid}`]);
    expect(proof.config.isHistoryComplete!(proof.messages())).toBe(true);
  });

  it.each([
    {
      name: 'missing user UUID',
      mutate(root: HTMLElement) {
        root.querySelector('[data-testid="user-message"]')?.removeAttribute('id');
      },
    },
    {
      name: 'ambiguous trailing user UUID',
      mutate(root: HTMLElement) {
        root
          .querySelector('[data-testid="user-message"]')
          ?.setAttribute(
            'id',
            '11111111-2222-4333-8444-555555555555-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
          );
      },
    },
    {
      name: 'malformed assistant turn key',
      mutate(root: HTMLElement) {
        root
          .querySelector('[data-testid="assistant-message"]')
          ?.setAttribute('data-turn-key', 'not-a-canonical-provider-key');
      },
    },
  ])('exports an operation-local fallback but cannot complete with $name', ({ mutate }) => {
    const proof = directHistoryProof();
    proof.root.innerHTML = conversation
      .slice(0, 2)
      .map((turn, index) => renderTurn(turn, index))
      .join('');
    mutate(proof.root);
    const entries = proof.config.harvest(proof.root);
    expect(entries).toHaveLength(2);
    expect(entries.some(entry => entry.key.startsWith('fallback:'))).toBe(true);
    expect(proof.config.isHistoryComplete!(entries.map(entry => entry.value))).toBe(false);
  });

  it('makes duplicate same-role UUID evidence sticky partial', () => {
    const proof = directHistoryProof();
    const uuid = '11111111-2222-4333-8444-555555555555';
    const entries = proof.harvest([
      { role: 'user', content: 'First', uuid },
      { role: 'user', content: 'Second', uuid },
    ]);
    expect(entries.map(entry => entry.key)).toEqual([`user:${uuid}`, `user:${uuid}`]);
    expect(proof.config.isHistoryComplete!(proof.messages())).toBe(false);
  });

  it.each(['skipped-window', 'tail-change', 'catalog-shrink', 'tail-append'] as const)(
    'keeps $case evidence sticky partial',
    testCase => {
      const proof = directHistoryProof();
      if (testCase === 'skipped-window') {
        proof.harvest(
          [...longConversation.slice(122, 137), longConversation[153]],
          [...Array.from({ length: 15 }, (_, i) => i), 31]
        );
        proof.harvest(
          longConversation.slice(138),
          Array.from({ length: 16 }, (_, i) => i + 16)
        );
      } else {
        proof.harvest(conversation.slice(0, 4));
        if (testCase === 'tail-change') {
          proof.harvest([
            ...conversation.slice(0, 3),
            { ...conversation[3], uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
          ]);
        } else if (testCase === 'catalog-shrink') {
          proof.harvest(conversation.slice(0, 3));
        } else {
          proof.harvest(conversation.slice(0, 5));
        }
      }
      expect(proof.config.isHistoryComplete!(proof.messages())).toBe(false);
    }
  );

  it('accepts last-write-wins content at one stable key and invariant order', () => {
    const proof = directHistoryProof();
    const turns = conversation.slice(0, 2).map(turn => ({ ...turn }));
    proof.harvest(turns);
    turns[1].content = 'Revised answer';
    proof.harvest(turns);
    const messages = proof.messages();
    expect(plainText(messages[1].content)).toBe('Revised answer');
    expect(proof.config.isHistoryComplete!(messages)).toBe(true);
  });

  it('captures all 154 short virtualized rows exactly once with Claude tuning', async () => {
    const { scroller } = mountVirtualizedClaude(longConversation, 3);
    expect(scroller.querySelectorAll('[data-index]')).toHaveLength(3);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(longConversation.map(turnKey));
    expect(result.data?.messages.map(message => plainText(message.content))).toEqual(
      longConversation.map(turn => turn.content)
    );
    expect(result.data?.messages.map(message => message.index)).toEqual(
      longConversation.map((_, index) => index)
    );
    expect(result.data?.title).toBe('Synthetic turn 0');
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

  it('captures all154 with coordinate-driven overlapping windows and no fixture cap', async () => {
    const { scroller } = mountVirtualizedClaude(longConversation, 8, {
      boundedWindowAdvance: false,
    });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(longConversation.map(turnKey));
    expect(result.data?.metadata).toMatchObject({
      messageCount: 154,
      userMessageCount: 77,
      assistantMessageCount: 77,
    });
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
    expect(scroller.querySelectorAll('[data-index]')).toHaveLength(8);
  });

  it('uses one relative nudge to unlock a fresh sticky root and collects all154', async () => {
    const { scroller } = mountVirtualizedClaude(longConversation, 3, {
      requireRelativeNudge: true,
    });
    extractor.applySettings(settings());
    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(scroller.scrollBy).toHaveBeenCalledExactlyOnceWith({
      top: -130,
      left: 0,
      behavior: 'instant',
    });
    expect(result.data?.messages.map(message => message.id)).toEqual(longConversation.map(turnKey));
    expect(result.data?.metadata).toMatchObject({
      messageCount: 154,
      userMessageCount: 77,
      assistantMessageCount: 77,
    });
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
  });

  it('uses a second bounded MAIN prime only when the first has zero movement', async () => {
    const { scroller } = mountVirtualizedClaude(longConversation, 3, {
      requireRelativeNudge: true,
      relativeNudgeFailures: 1,
    });
    extractor.applySettings(settings());
    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(scroller.scrollBy).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.data?.metadata).toMatchObject({
      messageCount: 154,
      userMessageCount: 77,
      assistantMessageCount: 77,
    });
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
  });

  it('keeps a failed relative prime bounded and partial instead of retrying', async () => {
    const { scroller } = mountVirtualizedClaude(longConversation, 3, {
      requireRelativeNudge: true,
    });
    scroller.scrollBy = vi.fn();
    extractor.applySettings(settings());
    const started = Date.now();
    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(scroller.scrollBy).toHaveBeenCalledTimes(2);
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
    expect(Date.now() - started).toBeLessThanOrEqual(15_200);
  });

  it('retains the official-shaped empty idx151 boundary in a complete154-message note', async () => {
    const turns = longConversation.map(turn => ({ ...turn }));
    turns[151].bodyHtml = STABLE_EMPTY_ASSISTANT;
    const { scroller } = mountVirtualizedClaude(turns, 3, { requireRelativeNudge: true });
    extractor.applySettings(settings());
    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(scroller.scrollBy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(turns.map(turnKey));
    expect(result.data?.messages[151]).toMatchObject({
      id: turnKey(turns[151]),
      role: 'assistant',
      content: '',
      htmlContent: '',
      index: 151,
    });
    expect(result.data?.metadata).toMatchObject({
      messageCount: 154,
      userMessageCount: 77,
      assistantMessageCount: 77,
    });
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
    expect(extractor.validate(result).warnings).toContain('1 message(s) have empty content');
    const note = conversationToNote(result.data!, {
      includeId: true,
      includeTitle: true,
      includeTags: true,
      includeSource: true,
      includeDates: true,
      includeMessageCount: true,
      messageFormat: 'callout',
      userCalloutType: 'QUESTION',
      assistantCalloutType: 'NOTE',
    });
    expect(note.frontmatter.message_count).toBe(154);
    expect(countExistingMessages(note.body)).toBe(154);
    expect(note.body.split(MESSAGE_BOUNDARY_MARKER).length - 1).toBe(154);
  });

  it('accepts only a static evidenced empty boundary while leaving the ordinary pass unchanged', async () => {
    mountMutableClaudeWindow(
      [conversation[0], { ...conversation[1], bodyHtml: STABLE_EMPTY_ASSISTANT }],
      () => {}
    );
    extractor.applySettings(settings());
    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.data?.messages.map(message => message.id)).toEqual(
      conversation.slice(0, 2).map(turnKey)
    );
    expect(result.data?.messages[1].content).toBe('');
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
    extractor.applySettings(settings({ enableAutoScroll: false }));
    const ordinary = await extractor.extract();
    expect(ordinary.data?.messages.map(message => message.role)).toEqual(['user']);
    expect(ordinary.data?.domHistoryLoad).toBe('unknown');
    expect(ordinary.data?.liskaLossDiagnostics).toBeUndefined();
  });

  it.each(['sr-only select-none', 'select-none  sr-only'])(
    'accepts exactly the inert heading class set (%s)',
    classes => {
      const fixture = stableEmptyGateFixture(extractor);
      fixture.heading.setAttribute('class', classes);
      expect(fixture.accepted()).toBe(true);
      expect(fixture.proof()).toBe(true);
    }
  );

  it('requires validated catalog-max growth after an early marker disappearance', () => {
    document.body.innerHTML = '<div data-autoscroll-container id="pending-root"></div>';
    const root = document.getElementById('pending-root') as HTMLElement;
    const newest = conversation.slice(4);
    root.innerHTML = newest.map((turn, index) => renderTurn(turn, index)).join('');
    const reader = extractor as unknown as { getScrollConfig(): ScrollConfig };
    const config = reader.getScrollConfig();

    setPendingHistoryMarker(root, true);
    config.harvest(root);
    expect(config.canCompleteAtTop!(root)).toBe(false);

    setPendingHistoryMarker(root, false);
    config.harvest(root);
    expect(config.canCompleteAtTop!(root)).toBe(false);

    // Reappearance starts a new generation from the latest observed coverage.
    setPendingHistoryMarker(root, true);
    config.harvest(root);
    expect(config.canCompleteAtTop!(root)).toBe(false);
    setPendingHistoryMarker(root, false);
    config.harvest(root);
    expect(config.canCompleteAtTop!(root)).toBe(false);

    root.innerHTML = conversation
      .slice(2)
      .map((turn, index) => renderTurn(turn, index))
      .join('');
    config.harvest(root);
    expect(config.canCompleteAtTop!(root)).toBe(true);
  });

  it('records max growth while the marker remains and releases only after disappearance', () => {
    const proof = directHistoryProof();
    const newest = conversation.slice(4);
    proof.harvest(newest);
    setPendingHistoryMarker(proof.root, true);
    proof.config.harvest(proof.root);
    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(false);

    proof.root.innerHTML = conversation
      .slice(2)
      .map((turn, index) => renderTurn(turn, index))
      .join('');
    setPendingHistoryMarker(proof.root, true);
    proof.config.harvest(proof.root);
    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(false);

    setPendingHistoryMarker(proof.root, false);
    proof.config.harvest(proof.root);
    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(true);
  });

  it('starts a fresh pending generation when the marker reappears after growth', () => {
    const proof = directHistoryProof();
    proof.harvest(conversation.slice(4));
    setPendingHistoryMarker(proof.root, true);
    proof.config.harvest(proof.root);

    setPendingHistoryMarker(proof.root, false);
    proof.root.innerHTML = conversation
      .slice(2)
      .map((turn, index) => renderTurn(turn, index))
      .join('');
    proof.config.harvest(proof.root);

    setPendingHistoryMarker(proof.root, true);
    proof.config.harvest(proof.root);
    setPendingHistoryMarker(proof.root, false);
    proof.config.harvest(proof.root);
    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(false);

    proof.root.innerHTML = conversation.map((turn, index) => renderTurn(turn, index)).join('');
    proof.config.harvest(proof.root);
    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(true);
  });

  it.each(['between', 'after'] as const)(
    'ignores the same marker shape when it represents a %s-row later-history gap',
    placement => {
      const proof = directHistoryProof();
      proof.harvest(conversation);
      setPendingHistoryMarker(proof.root, true, placement);
      proof.config.harvest(proof.root);

      expect(proof.config.canCompleteAtTop!(proof.root)).toBe(true);
      expect(proof.config.isHistoryComplete!(proof.messages())).toBe(true);
    }
  );

  it('releases the final older-history generation after a stable marker absence', () => {
    const proof = directHistoryProof();
    proof.harvest(conversation);
    setPendingHistoryMarker(proof.root, true);
    proof.config.harvest(proof.root);
    setPendingHistoryMarker(proof.root, false);
    proof.config.harvest(proof.root);

    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(false);
    vi.advanceTimersByTime(4999);
    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(false);
    setPendingHistoryMarker(proof.root, true);
    proof.config.harvest(proof.root);
    setPendingHistoryMarker(proof.root, false);
    proof.config.harvest(proof.root);
    vi.advanceTimersByTime(4999);
    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(proof.config.canCompleteAtTop!(proof.root)).toBe(true);
    expect(proof.config.isHistoryComplete!(proof.messages())).toBe(true);
  });

  it('keeps extract blocked through final marker grace and ordinary top settle', async () => {
    let markerRemovedAt: number | undefined;
    let scroller!: HTMLElement;
    scroller = mountMutableClaudeWindow(conversation.slice(0, 2), () => {
      if (scroller.scrollTop !== 0 || markerRemovedAt !== undefined) return;
      setPendingHistoryMarker(scroller, false);
      markerRemovedAt = Date.now();
    });
    setPendingHistoryMarker(scroller, true);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(markerRemovedAt).toBeDefined();
    expect(Date.now() - (markerRemovedAt as number)).toBeGreaterThanOrEqual(10_000);
    expect(result.data?.messages.map(message => message.id)).toEqual(
      conversation.slice(0, 2).map(turnKey)
    );
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it('does not wait for pending progress after identity evidence is irreversibly invalid', async () => {
    const scroller = mountMutableClaudeWindow(conversation.slice(0, 2), () => {});
    scroller.querySelector('[data-index="1"]')!.setAttribute('data-index', ' 1');
    setPendingHistoryMarker(scroller, true);
    extractor.applySettings(settings());
    const started = Date.now();

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(Date.now() - started).toBeGreaterThanOrEqual(5000);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.success).toBe(true);
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
    expect(
      result.warnings?.some(warning => warning.includes('completeness could not be verified'))
    ).toBe(true);
  });

  it.each([
    { name: 'missing data-find-omitted', attribute: 'data-find-omitted', value: null },
    { name: 'nonempty data-find-omitted', attribute: 'data-find-omitted', value: 'hidden' },
    { name: 'false data-find-omitted', attribute: 'data-find-omitted', value: 'false' },
    { name: 'missing aria-hidden', attribute: 'aria-hidden', value: null },
    { name: 'nonexact aria-hidden', attribute: 'aria-hidden', value: 'TRUE' },
    { name: 'missing class attribute', attribute: 'class', value: null },
    { name: 'missing sr-only token', attribute: 'class', value: 'select-none' },
    { name: 'missing select-none token', attribute: 'class', value: 'sr-only' },
    { name: 'extra class token', attribute: 'class', value: 'sr-only select-none extra' },
    { name: 'contenteditable', attribute: 'contenteditable', value: 'true' },
    { name: 'tabindex', attribute: 'tabindex', value: '0' },
    { name: 'onclick', attribute: 'onclick', value: '' },
    { name: 'onerror', attribute: 'onerror', value: '' },
    { name: 'extra data attribute', attribute: 'data-extra', value: '' },
    { name: 'style attribute', attribute: 'style', value: '' },
  ])('rejects a nonexact inert heading attribute: $name', ({ attribute, value }) => {
    const fixture = stableEmptyGateFixture(extractor);
    if (value === null) fixture.heading.removeAttribute(attribute);
    else fixture.heading.setAttribute(attribute, value);
    expect(fixture.accepted()).toBe(false);
    expect(fixture.proof()).toBe(false);
  });

  it.each(['empty-text', 'whitespace', 'comment', 'element', 'wrong-tag'] as const)(
    'rejects a nonexact inert heading node shape: %s',
    kind => {
      const fixture = stableEmptyGateFixture(extractor);
      if (kind === 'empty-text') fixture.heading.append(document.createTextNode(''));
      if (kind === 'whitespace') fixture.heading.append(document.createTextNode(' '));
      if (kind === 'comment') fixture.heading.append(document.createComment(''));
      if (kind === 'element') fixture.heading.append(document.createElement('span'));
      if (kind === 'wrong-tag') {
        const replacement = document.createElement('h4');
        for (const attribute of fixture.heading.attributes)
          replacement.setAttribute(attribute.name, attribute.value);
        fixture.heading.replaceWith(replacement);
      }
      expect(fixture.accepted()).toBe(false);
      expect(fixture.proof()).toBe(false);
    }
  );

  it.each(
    (
      [
        { name: 'busy', attributes: { 'aria-busy': 'true' } },
        { name: 'streaming', attributes: { 'data-is-streaming': 'true' } },
        { name: 'loading', attributes: { 'data-loading': 'true' } },
        { name: 'loading-state', attributes: { 'data-state': 'loading' } },
        { name: 'progress', attributes: { role: 'progressbar' } },
        { name: 'tool', attributes: { 'data-cds': 'TurnStatus' } },
        { name: 'file-thumbnail', attributes: { 'data-testid': 'file-thumbnail' } },
        { name: 'delivered-image', attributes: { 'data-testid': 'delivered-image-tile' } },
        { name: 'attachment-group', attributes: { class: 'MessageAttachments' } },
      ] satisfies Array<{ name: string; attributes: Record<string, string> }>
    ).flatMap(marker => ['row', 'descendant'].map(location => ({ ...marker, location })))
  )('rejects $name evidence on the indexed $location', ({ attributes, location }) => {
    const fixture = stableEmptyGateFixture(extractor);
    const target = location === 'row' ? fixture.row : document.createElement('div');
    if (location === 'descendant') fixture.row.append(target);
    for (const [name, value] of Object.entries(attributes)) target.setAttribute(name, value);
    expect(fixture.accepted()).toBe(false);
    expect(fixture.proof()).toBe(false);
  });

  it.each(['row', 'descendant'])('rejects a legacy tool header on the indexed %s', location => {
    const fixture = stableEmptyGateFixture(extractor);
    const header = location === 'row' ? fixture.row : document.createElement('div');
    header.className = 'row-start-1';
    const body = document.createElement('div');
    body.className = 'row-start-2';
    if (location === 'row') fixture.row.after(body);
    else fixture.row.append(header, body);
    expect(fixture.accepted()).toBe(false);
    expect(fixture.proof()).toBe(false);
  });

  it.each([
    { name: 'weak', html: STABLE_EMPTY_ASSISTANT.replace('data-testid="assistant-message"', '') },
    {
      name: 'streaming',
      html: STABLE_EMPTY_ASSISTANT.replace('data-is-streaming="false"', 'data-is-streaming="true"'),
    },
    {
      name: 'busy',
      html: STABLE_EMPTY_ASSISTANT.replace(
        'data-is-streaming="false"',
        'data-is-streaming="false" aria-busy="true"'
      ),
    },
    {
      name: 'loading',
      html: STABLE_EMPTY_ASSISTANT.replace(
        'data-is-streaming="false"',
        'data-is-streaming="false" data-loading="true"'
      ),
    },
    { name: 'bare-empty', html: STABLE_EMPTY_ASSISTANT.replace(/<h3[^>]*><\/h3>/, '') },
    {
      name: 'wrong-root-tag',
      html: STABLE_EMPTY_ASSISTANT.replace(/^<div/, '<section').replace(/<\/div>$/, '</section>'),
    },
    {
      name: 'wrong-inert-heading',
      html: STABLE_EMPTY_ASSISTANT.replace('aria-hidden="true"', 'aria-hidden="false"'),
    },
    {
      name: 'extra-empty-element',
      html: STABLE_EMPTY_ASSISTANT.replace('</h3>', '</h3><span></span>'),
    },
    { name: 'extra-whitespace-node', html: STABLE_EMPTY_ASSISTANT.replace('<h3', ' <h3') },
    {
      name: 'chrome-only',
      html: STABLE_EMPTY_ASSISTANT.replace(
        '<h3 data-find-omitted aria-hidden="true" class="sr-only select-none"></h3>',
        '<h2 class="sr-only">Assistant</h2>'
      ),
    },
    {
      name: 'tool-only',
      sibling: '<div data-cds="TurnStatus" data-item-key="reply:grp:cblk_0"></div>',
    },
    { name: 'file-thumbnail', sibling: '<div data-testid="file-thumbnail"></div>' },
    { name: 'delivered-image', sibling: '<div data-testid="delivered-image-tile"></div>' },
    { name: 'attachment-group', sibling: '<div class="MessageAttachments"></div>' },
  ])('rejects an unsupported $name empty assistant state', async ({ html, sibling }) => {
    mountMutableClaudeWindow(
      [
        conversation[0],
        { ...conversation[1], bodyHtml: (html ?? STABLE_EMPTY_ASSISTANT) + (sibling ?? '') },
      ],
      () => {}
    );
    extractor.applySettings(settings());
    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
    expect(
      result.warnings?.some(warning => warning.includes('completeness could not be verified'))
    ).toBe(true);
  });

  it.each(['nonempty-to-empty', 'empty-to-nonempty'] as const)(
    'keeps a %s transition sticky partial',
    async direction => {
      const startsEmpty = direction === 'empty-to-nonempty';
      const nonempty =
        '<div data-testid="assistant-message" data-cds="AssistantMessage" data-is-streaming="false"><div class="standard-markdown"><p>A1</p></div></div>';
      const initial = startsEmpty ? STABLE_EMPTY_ASSISTANT : nonempty;
      const next = startsEmpty ? nonempty : STABLE_EMPTY_ASSISTANT;
      const scroller = mountMutableClaudeWindow(
        [conversation[0], { ...conversation[1], bodyHtml: initial }],
        write => {
          if (write === 2) assistantRow.innerHTML = withAssistantIdentity(conversation[1], next);
        }
      );
      const assistantRow = scroller.querySelector('[data-index="1"]')!;
      extractor.applySettings(settings());
      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.data?.messages.map(message => message.id)).toEqual(
        conversation.slice(0, 2).map(turnKey)
      );
      expect(result.data?.messages[1].content).toBe(startsEmpty ? '<p>A1</p>' : '');
      expect(result.data?.domHistoryLoad).toBe('partial');
      expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
      expect(
        result.warnings?.some(warning => warning.includes('completeness could not be verified'))
      ).toBe(true);
    }
  );

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

  it.each([50, 150])(
    'rebinds an exact replacement root at %sms without reading its detached predecessor',
    async at => {
      const old = mountMutableClaudeWindow(conversation, () => {});
      if (at === 50)
        old.innerHTML = renderTurn({ role: 'assistant', content: 'Detached sentinel' }, 99);
      const next = replacementClaudeRoot(conversation);
      setTimeout(() => {
        old.replaceWith(next.container);
        old.innerHTML = renderTurn({ role: 'assistant', content: 'Detached sentinel' }, 99);
      }, at);
      extractor.applySettings(settings());

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.id)).toEqual(conversation.map(turnKey));
      expect(result.data?.messages.map(message => plainText(message.content))).toEqual(
        conversation.map(turn => turn.content)
      );
      expect(result.data?.domHistoryLoad).toBe('complete');
      expect(result.data?.liskaLossDiagnostics).toBeUndefined();
      expect(result.warnings).toBeUndefined();
      expect(next.writes.filter(value => value === 1900)).toHaveLength(at === 50 ? 1 : 0);
    }
  );

  it('allows a same-ID remount across harmless query and hash changes', async () => {
    const initialUrl = window.location.href;
    const old = mountMutableClaudeWindow(conversation, () => {});
    const next = replacementClaudeRoot(conversation);
    setTimeout(() => {
      window.location.search = '?artifact=visible';
      window.location.hash = '#panel';
      window.location.href = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
      old.replaceWith(next.container);
    }, 150);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe('1fbb8252-2bec-4ef2-bf1f-88393dd9bb5f');
    expect(result.data?.url).toBe(initialUrl);
    expect(result.data?.messages).toHaveLength(conversation.length);
    expect(result.data?.domHistoryLoad).toBe('complete');
  });

  it('fails the whole export when SPA navigation replaces A with conversation B', async () => {
    const old = mountVirtualizedClaude(conversation, 3).scroller;
    const conversationB: Turn[] = [
      { role: 'user', content: 'B0' },
      { role: 'assistant', content: 'B1' },
      { role: 'user', content: 'B2' },
      { role: 'assistant', content: 'B3' },
    ];
    const next = replacementClaudeRoot(conversationB);
    setTimeout(() => {
      setClaudeLocation('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      old.replaceWith(next.container);
    }, 300);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({
      success: false,
      error: 'Conversation changed during extraction. No output was created.',
    });
    expect(result).not.toHaveProperty('data');
    expect(result).not.toHaveProperty('warnings');
  });

  it.each(['churn', 'missing'] as const)(
    'records durable partial history when the exact root is %s',
    async mode => {
      let current = mountMutableClaudeWindow(conversation.slice(0, 2), () => {});
      if (mode === 'missing') {
        setTimeout(() => current.remove(), 300);
      } else {
        for (let count = 1; count <= 5; count++) {
          setTimeout(() => {
            const next = replacementClaudeRoot(conversation.slice(0, 2)).container;
            current.replaceWith(next);
            current = next;
          }, count * 300);
        }
      }
      extractor.applySettings(settings());

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.id)).toEqual(
        conversation.slice(0, 2).map(turnKey)
      );
      expect(result.data?.domHistoryLoad).toBe('partial');
      expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
      expect(result.warnings?.some(warning => warning.includes('Auto-scroll timed out'))).toBe(
        true
      );
    }
  );

  it('reproduces missed short rows with the unchanged large-step defaults', async () => {
    mountVirtualizedClaude(longConversation, 3, { boundedWindowAdvance: false });
    const defaultStep = new DefaultStepClaudeExtractor();
    defaultStep.applySettings(settings());

    const promise = defaultStep.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data!.messages.length).toBeLessThan(154);
    expect(result.data?.messages[0].id).toBe(turnKey(longConversation[0]));
    expect(result.data?.messages.at(-1)?.id).toBe(turnKey(longConversation[153]));
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toContain('history-load-partial');
  });

  it.each([
    { name: 'unclassified newest row', index: 5, bodyHtml: '<div><p>Unclassified</p></div>' },
    { name: 'unclassified oldest row', index: 0, bodyHtml: '<div><p>Unclassified</p></div>' },
    { name: 'unclassified interior row', index: 2, bodyHtml: '<div><p>Unclassified</p></div>' },
    { name: 'empty newest row', index: 5, bodyHtml: '<div class="font-claude-response"></div>' },
    {
      name: 'chrome-only newest row',
      index: 5,
      bodyHtml:
        '<div class="font-claude-response"><h2 class="sr-only">Assistant</h2><div data-testid="message-actions">Actions</div></div>',
    },
  ])('does not hide an observed $name from the completeness proof', async ({ bodyHtml, index }) => {
    const turns = conversation.map(turn => ({ ...turn }));
    turns[index].bodyHtml = bodyHtml;
    mountVirtualizedClaude(turns, 3);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(
      conversation.flatMap((turn, position) => (position === index ? [] : [turnKey(turn)]))
    );
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
    expect(result.warnings).toEqual([
      'Auto-scroll reached the top, but message history completeness could not be verified. Some messages may be missing.',
    ]);
  });

  it.each(['empty', 'unclassified', 'chrome-only', 'missing-index-empty'] as const)(
    'retains partial evidence when a previously harvested row becomes %s, even after recovery',
    async state => {
      const scroller = mountMutableClaudeWindow(conversation.slice(0, 2), write => {
        if (write === 2) {
          if (state === 'missing-index-empty') assistantRow.removeAttribute('data-index');
          assistantRow.innerHTML =
            state === 'unclassified'
              ? '<div>Unclassified</div>'
              : state === 'chrome-only'
                ? '<div class="font-claude-response"><h2 class="sr-only">Assistant</h2><div data-testid="message-actions">Actions</div></div>'
                : '<div class="font-claude-response"></div>';
        } else if (write === 3) {
          assistantRow.setAttribute('data-index', '1');
          assistantRow.innerHTML = original;
        }
      });
      const assistantRow = scroller.querySelector('[data-index="1"]')!;
      const original = assistantRow.innerHTML;
      extractor.applySettings(settings());

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.id)).toEqual(
        conversation.slice(0, 2).map(turnKey)
      );
      expect(result.data?.domHistoryLoad).toBe('partial');
      expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
      expect(result.warnings).toEqual([
        'Auto-scroll reached the top, but message history completeness could not be verified. Some messages may be missing.',
      ]);
    }
  );

  it('keeps a disappeared pinned-tail row sticky partial', async () => {
    const scroller = mountMutableClaudeWindow(conversation.slice(0, 2), write => {
      if (write === 2) scroller.querySelector('[data-index="1"]')!.remove();
    });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(scroller.querySelectorAll('[data-index]')).toHaveLength(1);
    expect(result.data?.messages.map(message => message.id)).toEqual(
      conversation.slice(0, 2).map(turnKey)
    );
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
    expect(result.warnings).toContain(
      'Auto-scroll reached the top, but message history completeness could not be verified. Some messages may be missing.'
    );
  });

  it('keeps anchor order when tail loss invalidates window-relative indices', async () => {
    const scroller = mountMutableClaudeWindow(conversation.slice(4), write => {
      if (write === 2) {
        scroller.innerHTML = conversation
          .slice(2, 4)
          .map((turn, index) => renderTurn(turn, index + 2))
          .join('');
      } else if (write === 3) {
        scroller.innerHTML = conversation
          .slice(0, 2)
          .map((turn, index) => renderTurn(turn, index))
          .join('');
      }
    });
    scroller.querySelector('[data-index="0"]')!.setAttribute('data-index', '4');
    scroller.querySelector('[data-index="1"]')!.setAttribute('data-index', '5');
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data?.messages.map(message => message.id)).toEqual(conversation.map(turnKey));
    expect(result.data?.messages.map(message => plainText(message.content))).toEqual(
      conversation.map(turn => turn.content)
    );
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
  });

  it.each(ASSISTANT_PLACEHOLDERS)(
    'marks a static assistant HTML placeholder partial: %s',
    async html => {
      mountMutableClaudeWindow(
        [
          conversation[0],
          {
            ...conversation[1],
            bodyHtml: `<div class="font-claude-response"><div class="standard-markdown">${html}</div></div>`,
          },
        ],
        () => {}
      );
      extractor.applySettings(settings());

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.id)).toEqual(
        conversation.slice(0, 2).map(turnKey)
      );
      expect(result.data?.messages[1].content).toBe(html);
      expect(result.data?.domHistoryLoad).toBe('partial');
      expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
      expect(result.warnings).toEqual([
        'Auto-scroll reached the top, but message history completeness could not be verified. Some messages may be missing.',
      ]);
    }
  );

  it.each(
    ASSISTANT_PLACEHOLDERS.flatMap(html => [
      { html, recover: false },
      { html, recover: true },
    ])
  )(
    'keeps good-to-placeholder history partial (recover=$recover): $html',
    async ({ html, recover }) => {
      const scroller = mountMutableClaudeWindow(conversation.slice(0, 2), write => {
        if (write === 2) {
          assistantRow.innerHTML = withAssistantIdentity(
            conversation[1],
            `<div class="font-claude-response"><div class="standard-markdown">${html}</div></div>`
          );
        } else if (write === 3 && recover) {
          assistantRow.innerHTML = original;
        }
      });
      const assistantRow = scroller.querySelector('[data-index="1"]')!;
      const original = assistantRow.innerHTML;
      extractor.applySettings(settings());

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.id)).toEqual(
        conversation.slice(0, 2).map(turnKey)
      );
      expect(result.data?.messages[1].content).toBe(recover ? '<p>A1</p>' : html);
      expect(result.data?.domHistoryLoad).toBe('partial');
      expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
      expect(result.warnings).toEqual([
        'Auto-scroll reached the top, but message history completeness could not be verified. Some messages may be missing.',
      ]);
    }
  );

  it.each(ASSISTANT_PLACEHOLDERS)(
    'preserves ordinary no-auto-scroll placeholder output: %s',
    async html => {
      mountMutableClaudeWindow(
        [
          conversation[0],
          {
            ...conversation[1],
            bodyHtml: `<div class="font-claude-response"><div class="standard-markdown">${html}</div></div>`,
          },
        ],
        () => {}
      );
      const baseline = extractor.extractMessages();
      extractor.applySettings(settings({ enableAutoScroll: false }));

      const result = await extractor.extract();

      expect(result.success).toBe(true);
      expect(result.data?.messages).toEqual(baseline);
      expect(result.data?.messages[1].content).toBe(html);
      expect(result.data?.domHistoryLoad).toBe('unknown');
      expect(result.data?.liskaLossDiagnostics).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    }
  );

  it('accepts the existing image-only assistant fallback as renderable history', async () => {
    const html = '<img src="https://example.com/diagram.png" alt="Diagram">';
    mountMutableClaudeWindow(
      [
        conversation[0],
        { ...conversation[1], bodyHtml: `<div class="font-claude-response">${html}</div>` },
      ],
      () => {}
    );
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(
      conversation.slice(0, 2).map(turnKey)
    );
    expect(result.data?.messages[1].content).toBe(html);
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it('proves a large assistant answer without extra sanitizer or Markdown conversion calls', async () => {
    const html = `<p>${'Synthetic large answer. '.repeat(12_000)}</p>`;
    mountMutableClaudeWindow(
      [
        {
          role: 'assistant',
          content: 'Answer',
          bodyHtml: `<div class="font-claude-response"><div class="standard-markdown">${html}</div></div>`,
        },
      ],
      () => {}
    );
    const markdown = vi.spyOn(markdownRules, 'htmlToMarkdownRaw');
    const sanitization = vi.spyOn(sanitize, 'sanitizeHtml');
    const proof = vi.spyOn(
      extractor as unknown as {
        hasRenderableHistoryContent(message: ConversationMessage): boolean;
      },
      'hasRenderableHistoryContent'
    );
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages[0].content).toBe(html);
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.liskaLossDiagnostics).toBeUndefined();
    expect(proof.mock.calls.length).toBeGreaterThan(5);
    expect(markdown).not.toHaveBeenCalled();
    // Exactly the existing assistant-section sanitization per harvest, not
    // another sanitization/conversion pass inside the completeness proof.
    expect(sanitization).toHaveBeenCalledTimes(proof.mock.calls.length);
  });

  it.each([
    '<p>' + 'x'.repeat(CLAUDE_TOOL_LIMITS.sectionHtmlBytes) + '</p>',
    '<br>'.repeat(CLAUDE_TOOL_LIMITS.sectionMarkupDelimiters + 1),
  ])('fails closed before parsing oversized semantic proof input', content => {
    const reader = extractor as unknown as {
      hasRenderableHistoryContent(message: ConversationMessage): boolean;
    };
    const create = vi.spyOn(document, 'createElement');

    expect(
      reader.hasRenderableHistoryContent({ id: 'idx-0', role: 'assistant', content, index: 0 })
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['wrong-role', 'duplicate-index', 'conflicting-order', 'noncanonical-index'] as const)(
    'keeps a later %s transition partial after valid indices recover',
    async state => {
      const scroller = mountMutableClaudeWindow(conversation.slice(0, 2), write => {
        if (write === 2) {
          if (state === 'wrong-role') {
            assistantRow.innerHTML = '<div data-testid="user-message">Changed role</div>';
          } else if (state === 'conflicting-order') {
            userRow.setAttribute('data-index', '1');
            assistantRow.setAttribute('data-index', '0');
          } else {
            assistantRow.setAttribute('data-index', state === 'duplicate-index' ? '0' : '01');
          }
        } else if (write === 3) {
          userRow.setAttribute('data-index', '0');
          assistantRow.setAttribute('data-index', '1');
          assistantRow.innerHTML = original;
        }
      });
      const userRow = scroller.querySelector('[data-index="0"]')!;
      const assistantRow = scroller.querySelector('[data-index="1"]')!;
      const original = assistantRow.innerHTML;
      extractor.applySettings(settings());

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.id)).toEqual(
        expect.arrayContaining(conversation.slice(0, 2).map(turnKey))
      );
      expect(result.data?.domHistoryLoad).toBe('partial');
      expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
      expect(result.warnings).toContain(
        'Auto-scroll reached the top, but message history completeness could not be verified. Some messages may be missing.'
      );
    }
  );

  it.each(['sidebar', 'sibling'] as const)(
    'does not substitute an external %s response for an unclassified local indexed row',
    async location => {
      mountMutableClaudeWindow(
        [conversation[0], { ...conversation[1], bodyHtml: '<div>Unclassified</div>' }],
        () => {}
      );
      const external = document.createElement(location === 'sidebar' ? 'nav' : 'section');
      external.innerHTML = renderTurn({ role: 'assistant', content: 'External answer' }, 1);
      document.body.append(external);
      extractor.applySettings(settings());

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => message.id)).toEqual([turnKey(conversation[0])]);
      expect(result.data?.messages.map(message => plainText(message.content))).toEqual(['Q1']);
      expect(result.data?.domHistoryLoad).toBe('partial');
      expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
      expect(result.warnings).toContain(
        'Auto-scroll reached the top, but message history completeness could not be verified. Some messages may be missing.'
      );
    }
  );

  it.each([true, false])(
    'scopes only auto-scroll collection, not the ordinary page pass (%s)',
    async enabled => {
      mountMutableClaudeWindow(conversation.slice(0, 2), () => {});
      const external = document.createElement('section');
      external.innerHTML = renderTurn({ role: 'assistant', content: 'External answer' }, 99);
      document.body.append(external);
      extractor.applySettings(settings({ enableAutoScroll: enabled }));

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages.map(message => plainText(message.content))).toEqual(
        enabled ? ['Q1', 'A1'] : ['Q1', 'A1', 'External answer']
      );
      expect(result.data?.domHistoryLoad).toBe(enabled ? 'complete' : 'unknown');
      expect(result.data?.liskaLossDiagnostics).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    }
  );

  it('downgrades a stable 52-key range spanning idx-0..153 rather than inventing completion', async () => {
    const rowIndices = Array.from({ length: 52 }, (_, index) => index * 3);
    mountVirtualizedClaude(longConversation.slice(0, 52), 3, { rowIndices });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(
      longConversation.slice(0, 52).map(turnKey)
    );
    expect(result.data?.metadata.messageCount).toBe(52);
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
    expect(result.warnings).toEqual([
      'Auto-scroll reached the top, but message history completeness could not be verified. Some messages may be missing.',
    ]);
  });

  it.each([
    { name: 'missing zero', indices: [1, 2, 3, 4, 5, 6] },
    { name: 'missing row identity', indices: [0, 1, null, 3, 4, 5] },
    { name: 'duplicate index', indices: [0, 1, 2, 2, 3, 4] },
    { name: 'noncanonical integer', indices: [0, 1, '02', 3, 4, 5] },
    { name: 'exponent', indices: [0, 1, '2e0', 3, 4, 5] },
    { name: 'fraction', indices: [0, 1, '2.0', 3, 4, 5] },
    { name: 'negative', indices: [0, 1, '-2', 3, 4, 5] },
    { name: 'whitespace', indices: [0, 1, ' 2 ', 3, 4, 5] },
    { name: 'unbounded integer', indices: [0, 1, '2'.repeat(100), 3, 4, 5] },
    { name: 'unsafe integer', indices: [0, 1, '9007199254740992', 3, 4, 5] },
    { name: 'unsafe count', indices: [0, 1, '9007199254740991', 3, 4, 5] },
  ])('fails closed at local top with $name', async ({ indices }) => {
    mountVirtualizedClaude(conversation, 3, { rowIndices: indices });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toContain('history-load-partial');
    expect(result.warnings).toHaveLength(1);
  });

  it('keeps DOM-anchor message order when numeric indices conflict with DOM order', async () => {
    mountVirtualizedClaude(conversation, 3, { rowIndices: [0, 2, 1, 3, 4, 5] });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(conversation.map(turnKey));
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toContain('history-load-partial');
  });

  it('retains a cross-window role conflict even if deduplication leaves a contiguous range', async () => {
    mountVirtualizedClaude(conversation.slice(0, 2), 2);
    const keys = conversation.slice(0, 2).map(turnKey);
    const entry = (
      index: number,
      role: ConversationMessage['role']
    ): HarvestEntry<ConversationMessage> => ({
      key: keys[index],
      order: index - 1,
      value: { id: keys[index], role, content: 'Synthetic', index: 0 },
    });
    // A different role later reuses the same stable key. The final sorted range alone looks
    // valid, so the per-pass evidence must retain the earlier conflict.
    const harvest = vi.spyOn(
      extractor as unknown as { harvestWindow(): HarvestEntry<ConversationMessage>[] },
      'harvestWindow'
    );
    harvest.mockReturnValue([entry(0, 'user'), entry(1, 'assistant')]);
    harvest.mockReturnValueOnce([entry(0, 'assistant'), entry(1, 'assistant')]);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data?.messages.map(message => message.id)).toEqual(keys);
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toContain('history-load-partial');

    // The next export gets fresh per-pass evidence, not a poisoned instance.
    const freshPromise = extractor.extract();
    await vi.runAllTimersAsync();
    const fresh = await freshPromise;
    expect(fresh.data?.domHistoryLoad).toBe('complete');
    expect(fresh.data?.liskaLossDiagnostics).toBeUndefined();
    expect(fresh.warnings).toBeUndefined();
    harvest.mockRestore();
  });

  it('rejects conflicting key/order evidence even when the final ID range is contiguous', async () => {
    mountVirtualizedClaude(conversation.slice(0, 2), 2);
    const keys = conversation.slice(0, 2).map(turnKey);
    const harvest = vi.spyOn(
      extractor as unknown as { harvestWindow(): HarvestEntry<ConversationMessage>[] },
      'harvestWindow'
    );
    harvest.mockReturnValue([
      {
        key: keys[0],
        order: 0,
        value: { id: keys[0], role: 'user', content: 'Synthetic', index: 0 },
      },
      {
        key: keys[1],
        order: 0,
        value: { id: keys[1], role: 'assistant', content: 'Synthetic', index: 0 },
      },
    ]);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data?.messages.map(message => message.id)).toEqual(keys);
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toContain('history-load-partial');
    harvest.mockRestore();
  });

  it('accumulates all virtualized turns in order when enabled', async () => {
    mountVirtualizedClaude(conversation, 3); // only 3 of 6 mounted at a time
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages).toHaveLength(6);
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(result.data?.messages.map(m => plainText(m.content))).toEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'A3',
    ]);
    // Indices are contiguous after accumulation.
    expect(result.data?.messages.map(m => m.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.data?.metadata.userMessageCount).toBe(3);
    expect(result.data?.metadata.assistantMessageCount).toBe(3);
    expect(result.warnings).toBeUndefined();
  });

  it('scrolls the thread instead of a same-class sidebar preceding it', async () => {
    const { sidebarScroll } = mountVirtualizedClaude(conversation, 3, { sidebar: true });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(m => plainText(m.content))).toEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'A3',
    ]);
    expect(sidebarScroll).not.toHaveBeenCalled();
    expect(result.warnings).toBeUndefined();
  });

  it('ignores an exact pending-history marker outside the selected thread root', async () => {
    const { sidebarScroll } = mountVirtualizedClaude(conversation, 3, { sidebar: true });
    const sidebar = document.getElementById('sidebar') as HTMLElement;
    setPendingHistoryMarker(sidebar, true);
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.metadata).toMatchObject({
      messageCount: 6,
      userMessageCount: 3,
      assistantMessageCount: 3,
    });
    expect(result.data?.domHistoryLoad).toBe('complete');
    expect(sidebarScroll).not.toHaveBeenCalled();
  });

  it('prefers the semantic root even when an earlier class fallback has indexed descendants', async () => {
    const { scroller, sidebarScroll } = mountVirtualizedClaude(conversation, 3, {
      sidebar: true,
      indexedSidebar: true,
    });
    scroller.className = 'thread-scroll-root';
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(m => plainText(m.content))).toEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'A3',
    ]);
    expect(sidebarScroll).not.toHaveBeenCalled();
    expect(result.warnings).toBeUndefined();
  });

  it('uses the indexed-row class fallback when the semantic attribute is absent', async () => {
    const { sidebarScroll } = mountVirtualizedClaude(conversation, 3, {
      semanticRoot: false,
      sidebar: true,
      indexedSidebar: true,
    });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(m => plainText(m.content))).toEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'A3',
    ]);
    expect(sidebarScroll).not.toHaveBeenCalled();
    expect(result.warnings).toBeUndefined();
  });

  it('scrolls fallback-only legacy roles when the semantic root is absent', async () => {
    const { sidebarScroll } = mountVirtualizedClaude(conversation, 3, {
      semanticRoot: false,
      sidebar: true,
      indexedSidebar: true,
      fallbackOnly: true,
    });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => plainText(message.content))).toEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'A3',
    ]);
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toEqual(['history-load-partial']);
    expect(sidebarScroll).not.toHaveBeenCalled();
  });

  it.each([
    'overflow-y-auto overflow-x-hidden flex-1',
    'overflow-y-auto overflow-x-hidden',
    'overflow-y-auto',
  ])('never scrolls a sidebar-only page with classes %s', async classes => {
    document.body.innerHTML = `<div id="sidebar" role="navigation" class="${classes}">Sidebar item</div>`;
    const sidebar = document.getElementById('sidebar') as HTMLElement;
    const sidebarScroll = vi.fn();
    Object.defineProperty(sidebar, 'scrollTop', {
      get: () => MAX_SCROLL,
      set: sidebarScroll,
      configurable: true,
    });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(sidebarScroll).not.toHaveBeenCalled();
  });

  it('extracts only the mounted window when auto-scroll is disabled', async () => {
    mountVirtualizedClaude(conversation, 3);
    extractor.applySettings(settings({ enableAutoScroll: false }));

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    // Without scrolling, only the bottom window (last 3 turns) is visible.
    expect(result.data?.messages).toHaveLength(3);
    expect(result.data?.domHistoryLoad).toBe('unknown');
  });

  it.each(['default', 'small'] as const)(
    'reuses unchanged tools on a persistent 10000px row with %s steps and resets per export',
    async step => {
      const turns: Turn[] = [
        { role: 'assistant', content: 'Answer', toolHtml: '<pre><code>x</code></pre>'.repeat(80) },
      ];
      let renders = 0;
      mountVirtualizedClaude(turns, 1, {
        onScroll: () => {
          // An evolving answer must not force unchanged TOOL input to reconvert.
          turns[0].content = `Synthetic answer revision ${renders++}`;
        },
      });
      const target = step === 'default' ? new DefaultStepClaudeExtractor() : extractor;
      const blocks = vi.spyOn(ClaudeToolConversionBudget.prototype, 'addCodeBlocks');
      target.applySettings(settings({ enableToolContent: true }));

      for (let pass = 0; pass < 2; pass++) {
        const promise = target.extract();
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result.success).toBe(true);
        expect(result.data?.domHistoryLoad).toBe('complete');
        expect(result.data?.messages).toHaveLength(1);
        expect(result.data?.messages[0].toolContent).toBe(
          Array.from({ length: 80 }, () => '```\nx\n```').join('\n\n')
        );
        expect(blocks).toHaveBeenCalledTimes(pass + 1);
        expect(blocks.mock.calls.map(([count]) => count)).toEqual(Array(pass + 1).fill(80));
      }
      expect(renders).toBeGreaterThan(step === 'small' ? 100 : 40);
    }
  );

  it.each([
    { markup: '<p>Updated tool</p>', expected: 'Updated tool' },
    { markup: undefined, expected: undefined },
  ])(
    'uses the latest changed tool input, including removed content (%j)',
    async ({ markup, expected }) => {
      const turns: Turn[] = [
        { role: 'assistant', content: 'Answer', toolHtml: '<p>Initial tool</p>' },
      ];
      let renders = 0;
      mountVirtualizedClaude(turns, 1, {
        onScroll: () => {
          if (renders++ >= 2) turns[0].toolHtml = markup;
        },
      });
      const convert = vi.spyOn(
        extractor as unknown as {
          convertToolCandidates(
            candidates: Element[],
            budget: ClaudeToolConversionBudget
          ): string | null;
        },
        'convertToolCandidates'
      );
      extractor.applySettings(settings({ enableToolContent: true }));

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.data?.messages[0].toolContent).toBe(expected);
      expect(convert).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    { revisions: 8, success: true },
    { revisions: 9, success: false },
  ])(
    'charges changed exact tool input at the code-block boundary: $revisions revisions',
    async ({ revisions, success }) => {
      const batchSize = CLAUDE_TOOL_LIMITS.codeBlocks / 8;
      const code = '<pre><code>x</code></pre>'.repeat(batchSize);
      const turns: Turn[] = [{ role: 'assistant', content: 'Answer', toolHtml: code }];
      let renders = 0;
      mountVirtualizedClaude(turns, 1, {
        onScroll: () => {
          const revision = Math.min(renders++, revisions - 1);
          // Comments do not change the Markdown output, but exact source changes
          // must invalidate reuse and charge conversion work again.
          turns[0].toolHtml = `<!-- revision ${revision} -->${code}`;
        },
      });
      const blocks = vi.spyOn(ClaudeToolConversionBudget.prototype, 'addCodeBlocks');
      extractor.applySettings(settings({ enableToolContent: true }));

      const promise = extractor.extract();
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(blocks.mock.calls.map(([count]) => count)).toEqual(Array(revisions).fill(batchSize));
      expect(result.success).toBe(success);
      if (success) {
        expect(result.data?.domHistoryLoad).toBe('complete');
        expect(result.data?.messages[0].toolContent).toBe(
          Array.from({ length: batchSize }, () => '```\nx\n```').join('\n\n')
        );
      } else {
        expect(result.data).toBeUndefined();
        expect(result.error).toBe('Claude tool conversion limit exceeded: code blocks.');
      }
    }
  );

  it('invalidates reuse when candidate ancestry changes beneath an ignored thinking header', async () => {
    const toolStep =
      '<div><div class="row-start-1"><div class="standard-markdown"><p>Tool</p></div></div><div class="row-start-2"></div></div>';
    const response = (nested: boolean): string =>
      `<div class="font-claude-response"><div><div class="row-start-1"><div class="group/thinking">Thinking</div>${nested ? toolStep : ''}</div><div class="row-start-2"><div class="standard-markdown"><p>Answer</p></div></div></div>${nested ? '' : toolStep}</div>`;
    const turns: Turn[] = [{ role: 'assistant', content: 'Answer', bodyHtml: response(true) }];
    let renders = 0;
    mountVirtualizedClaude(turns, 1, {
      onScroll: () => {
        if (renders++ >= 2) turns[0].bodyHtml = response(false);
      },
    });
    const convert = vi.spyOn(
      extractor as unknown as {
        convertToolCandidates(
          candidates: Element[],
          budget: ClaudeToolConversionBudget
        ): string | null;
      },
      'convertToolCandidates'
    );
    extractor.applySettings(settings({ enableToolContent: true }));

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages[0].toolContent).toBe('Tool');
    expect(convert).toHaveBeenCalledTimes(2);
  });

  it('charges identical tool input separately for distinct canonical identities', async () => {
    const toolHtml = '<pre><code>x</code></pre>'.repeat(80);
    const turns: Turn[] = [
      { role: 'assistant', content: 'First answer', toolHtml },
      { role: 'assistant', content: 'Second answer', toolHtml },
    ];
    mountVirtualizedClaude(turns, 2);
    const blocks = vi.spyOn(ClaudeToolConversionBudget.prototype, 'addCodeBlocks');
    extractor.applySettings(settings({ enableToolContent: true }));

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data?.messages.map(message => message.id)).toEqual(turns.map(turnKey));
    expect(blocks.mock.calls.map(([count]) => count)).toEqual([80, 80]);
  });

  it('caps retained snapshots for 18 discarded 1MiB identities and guards uncached conversion', () => {
    const { state, budget, read } = createToolCacheHarness(extractor);
    const encoder = new TextEncoder();
    const cap = CLAUDE_TOOL_LIMITS.rawHtmlBytes;
    const payloadLength = 1024 ** 2;
    const root = discardedToolRoot(['x'.repeat(payloadLength)]);
    const guarded = vi.spyOn(budget, 'assertSectionCapacity');

    for (let index = 0; index < 18; index++) {
      expect(read(`idx-${index}`, root)).toBeNull();
      expect(state.totalBytes).toBeLessThanOrEqual(cap);
      expect(state.totalBytes).toBe(
        [...state.entries.values()].reduce((total, entry) => total + entry.byteLength, 0)
      );
    }
    expect(state.entries.size).toBe(15);
    expect((budget as unknown as { rawHtmlBytes: number }).rawHtmlBytes).toBe(0);
    expect(guarded).toHaveBeenCalledTimes(18);
    const first = state.entries.get('idx-0')!;
    expect(first.byteLength).toBe(encoder.encode(first.input).byteLength);
    expect(read('idx-0', root)).toBeNull();
    expect(guarded).toHaveBeenCalledTimes(18);
    expect(read('idx-17', root)).toBeNull();
    expect(guarded).toHaveBeenCalledTimes(19);
    expect(state.entries.has('idx-17')).toBe(false);

    // Fill the exact remaining allowance, without inventing an invalid state.
    const overhead = first.byteLength - payloadLength;
    const remainingPayload = cap - state.totalBytes - overhead;
    expect(remainingPayload).toBeGreaterThanOrEqual(0);
    expect(read('idx-18', discardedToolRoot(['f'.repeat(remainingPayload)]))).toBeNull();
    expect(state.totalBytes).toBe(cap);
    expect((budget as unknown as { rawHtmlBytes: number }).rawHtmlBytes).toBe(0);

    const charged = document.createElement('div');
    charged.innerHTML = `<div class="row-start-1"><div class="standard-markdown">${'<pre><code>x</code></pre>'.repeat(512)}</div></div><div class="row-start-2"></div>`;
    for (let pass = 0; pass < 8; pass++) {
      expect(read('idx-19', charged)).toContain('```');
      expect(state.entries.has('idx-19')).toBe(false);
      expect(state.totalBytes).toBe(cap);
    }
    expect(() => read('idx-19', charged)).toThrow(
      'Claude tool conversion limit exceeded: code blocks.'
    );
    expect(state.entries.size).toBe(16);
    expect(state.totalBytes).toBe(cap);
  });

  it('accounts exact UTF-8 replacements and removes stale entries before non-cacheable changes', () => {
    const { state, budget, read } = createToolCacheHarness(extractor);
    const encoder = new TextEncoder();
    const initial = discardedToolRoot(['"\\\n😀漢字']);
    const guarded = vi.spyOn(budget, 'assertSectionCapacity');
    read('idx-0', initial);
    read('idx-1', initial);
    const original = state.entries.get('idx-0')!;
    const other = state.entries.get('idx-1')!;
    expect(original.byteLength).toBe(encoder.encode(original.input).byteLength);
    expect(original.byteLength).toBeGreaterThan(original.input.length);
    expect(state.totalBytes).toBe(original.byteLength + other.byteLength);

    const replacement = discardedToolRoot(['Replacement']);
    read('idx-0', replacement);
    const replaced = state.entries.get('idx-0')!;
    expect(replaced.input).not.toBe(original.input);
    expect(state.totalBytes).toBe(other.byteLength + encoder.encode(replaced.input).byteLength);
    read('idx-0', replacement);
    expect(guarded).toHaveBeenCalledTimes(3);

    // Raw input fits the per-snapshot preflight, but JSON escaping alone makes
    // its exact serialized UTF-8 size exceed the aggregate cache ceiling.
    const escaped = '\u0001'.repeat((3 * 1024 ** 2) / 2);
    expect(encoder.encode(JSON.stringify([escaped, escaped])).byteLength).toBeGreaterThan(
      CLAUDE_TOOL_LIMITS.rawHtmlBytes
    );
    const oversized = discardedToolRoot([escaped, escaped]);
    read('idx-0', oversized);
    read('idx-0', oversized);
    expect(guarded).toHaveBeenCalledTimes(5);
    expect(state.entries.has('idx-0')).toBe(false);
    expect(state.totalBytes).toBe(other.byteLength);
    expect(state.entries.get('idx-1')).toBe(other);

    read('idx-0', initial);
    read('idx-0', initial);
    expect(guarded).toHaveBeenCalledTimes(6);
    expect(state.totalBytes).toBe(original.byteLength + other.byteLength);

    // Undefined preflight snapshots also invalidate old entries, not only
    // serialized snapshots that are too large to retain.
    read('idx-0', discardedToolRoot(['x'.repeat(CLAUDE_TOOL_LIMITS.sectionHtmlBytes + 1)]));
    expect(state.entries.has('idx-0')).toBe(false);
    expect(state.totalBytes).toBe(other.byteLength);
    read('idx-0', initial);
    expect(guarded).toHaveBeenCalledTimes(8);

    const rejected = document.createElement('div');
    rejected.innerHTML = `<div class="row-start-1"><div class="standard-markdown">${'<pre><code>x</code></pre>'.repeat(CLAUDE_TOOL_LIMITS.codeBlocks + 1)}</div></div><div class="row-start-2"></div>`;
    expect(() => read('idx-0', rejected)).toThrow(
      'Claude tool conversion limit exceeded: code blocks.'
    );
    expect(state.entries.has('idx-0')).toBe(false);
    expect(state.totalBytes).toBe(other.byteLength);
    expect(state.entries.get('idx-1')).toBe(other);
  });

  it('rejects genuinely over-budget unique input and resets for the next export', async () => {
    mountVirtualizedClaude(
      [
        {
          role: 'assistant',
          content: 'Answer',
          toolHtml: '<pre><code>x</code></pre>'.repeat(CLAUDE_TOOL_LIMITS.codeBlocks + 1),
        },
      ],
      1
    );
    extractor.applySettings(settings({ enableToolContent: true }));

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const rejected = await promise;
    expect(rejected.success).toBe(false);
    expect(rejected.data).toBeUndefined();
    expect(rejected.error).toBe('Claude tool conversion limit exceeded: code blocks.');

    mountVirtualizedClaude(
      [{ role: 'assistant', content: 'Fresh', toolHtml: '<p>small tool</p>' }],
      1
    );
    const freshPromise = extractor.extract();
    await vi.runAllTimersAsync();
    const fresh = await freshPromise;
    expect(fresh.success).toBe(true);
    expect(fresh.data?.messages).toHaveLength(1);
    expect(fresh.data?.messages[0].toolContent).toBe('small tool');
  });

  it('warns when accumulation stalls without ever reaching the top', async () => {
    // Fixed mounted rows and a scroller stuck below zero exercise the idle
    // timeout without thousands of expensive DOM conversions at 100ms polling.
    document.body.innerHTML = `<div class="overflow-y-auto overflow-x-hidden flex-1" id="scroller"></div>`;
    const scroller = document.getElementById('scroller') as HTMLElement;
    let scrollTop = MAX_SCROLL;
    scroller.innerHTML = renderTurn({ role: 'user', content: 'Synthetic question' }, 0);
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = Math.max(1, v); // never pins at the top
      },
      configurable: true,
    });
    Object.defineProperty(scroller, 'clientHeight', { get: () => 900, configurable: true });
    scroller.scrollBy = vi.fn((options: ScrollToOptions) => {
      scroller.scrollTop += options.top ?? 0;
    });
    extractor.applySettings(settings());

    const promise = extractor.extract();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.warnings?.some(w => w.includes('Auto-scroll timed out'))).toBe(true);
    expect(result.data?.domHistoryLoad).toBe('partial');
    expect(result.data?.liskaLossDiagnostics).toContain('history-load-partial');
  });
});
