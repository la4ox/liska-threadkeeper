/** Shared DOM fixtures for Claude auto-scroll integration tests. */

import { vi } from 'vitest';
import type { SyncSettings } from '../../src/lib/types';

export const MAX_SCROLL = 10_000;

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolHtml?: string;
  bodyHtml?: string;
  uuid?: string;
}

export function setPendingHistoryMarker(
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

export function settings(overrides: Partial<SyncSettings> = {}): SyncSettings {
  return { enableAutoScroll: true, ...overrides } as SyncSettings;
}

export function createClaudeAutoscrollFixture() {
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
      inner =
        turn.role === 'assistant' ? withAssistantIdentity(turn, turn.bodyHtml) : turn.bodyHtml;
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
      maxScroll = MAX_SCROLL,
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
      maxScroll?: number;
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
        get: () => maxScroll,
        set: sidebarScroll,
        configurable: true,
      });
    }

    let scrollTop = maxScroll; // opens at the bottom
    let unlocked = !requireRelativeNudge;
    let remainingRelativeFailures = relativeNudgeFailures;
    let renderedStart = Math.max(0, turns.length - windowSize);
    const render = (preserveStart = false): void => {
      const maxStart = Math.max(0, turns.length - windowSize);
      const frac = scrollTop / maxScroll;
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
        scrollTop = Math.max(0, Math.min(maxScroll, v));
        onScroll?.();
        render();
      },
      configurable: true,
    });
    Object.defineProperty(scroller, 'clientHeight', { get: () => 900, configurable: true });
    Object.defineProperty(scroller, 'scrollHeight', {
      get: () => maxScroll + 900,
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

  return { turnUuid, turnKey, withAssistantIdentity, renderTurn, mountVirtualizedClaude };
}
