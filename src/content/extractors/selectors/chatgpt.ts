/**
 * CSS Selectors for ChatGPT (chatgpt.com)
 *
 * Selectors are ordered by stability (HIGH → LOW)
 * @see docs/adr/005-shared-selector-modules.md
 */

import type { SelectorGroup } from './types';

export const SELECTORS = {
  // Current paired turn: one stable wrapper holds a prompt and its answer.
  // `fallback-turn-N` descendants are window-relative and are never used as
  // conversation-wide order evidence.
  conversationTurn: ['div[data-turn-key]'],

  // Prompt text inside a paired turn.
  userMessage: ['[data-user-message-bubble] .whitespace-pre-wrap'],

  // Role marker, not answer content. It also exists on image-only answers.
  assistantRole: ['[data-conversation-role="assistant"]'],

  // Assistant Markdown blocks inside a paired turn.
  markdownContent: ['[data-markdown-text-style="assistant-message"]'],

  // Current semantic thread scroller. It is column-reverse; the sidebar uses a
  // distinct data-app-action-sidebar-scroll attribute.
  scrollContainer: ['[data-app-action-timeline-scroll]'],
} as const satisfies SelectorGroup;

/** Supported pre-paired rollout, kept outside the current live baseline. */
export const LEGACY_SELECTORS = {
  conversationTurn: ['section[data-turn-id]', 'section[data-testid^="conversation-turn"]'],
  userMessage: [
    '[data-message-author-role="user"] .whitespace-pre-wrap',
    'section[data-turn="user"] .whitespace-pre-wrap',
    '.user-message-bubble-color .whitespace-pre-wrap',
  ],
  assistantResponse: [
    '[data-message-author-role="assistant"] .markdown.prose',
    'section[data-turn="assistant"] .markdown.prose',
    '.markdown.prose.dark\\:prose-invert',
  ],
  markdownContent: ['.markdown.prose', '.markdown-new-styling'],
  scrollContainer: ['[data-scroll-root]', '[class*="not-print:overflow-y-auto"]'],
} as const satisfies SelectorGroup;
