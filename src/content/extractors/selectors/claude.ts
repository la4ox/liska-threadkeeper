/**
 * CSS Selectors for Claude AI (claude.ai)
 *
 * Selectors are ordered by stability (HIGH → LOW)
 * @see docs/adr/005-shared-selector-modules.md
 */

import type { SelectorGroup, ComputedSelectors } from './types';

const USER_MESSAGE_SELECTORS = [
  '[data-testid="user-message"]',
  '.whitespace-pre-wrap.break-words',
] as const;
const ASSISTANT_RESPONSE_SELECTORS = [
  '[data-testid="assistant-message"]',
  '[data-cds="AssistantMessage"]',
  '.font-claude-response',
  '[class*="font-claude-response"]',
  '[data-is-streaming]',
] as const;
const THREAD_MESSAGE_ROOT = `:is(${[
  ...USER_MESSAGE_SELECTORS,
  ...ASSISTANT_RESPONSE_SELECTORS,
].join(', ')})`;

/**
 * CSS Selectors for normal chat extraction
 */
export const SELECTORS = {
  // Conversation block selectors (each message block)
  // Stability: HIGH → LOW order for fallback
  conversationBlock: [
    '.group[style*="height: auto"]', // Structure-based (HIGH)
    '[data-test-render-count]', // Test attribute (LOW)
    '.group', // Generic (MEDIUM)
  ],

  // User message content selectors
  //
  // Primary targets the grid container that wraps the entire user turn,
  // so multi-paragraph questions and <pre>/<code> blocks stay together
  // in a single extracted message (see issue #200).
  // Legacy selectors remain as fallbacks for older Claude DOM variants
  // that did not expose [data-testid="user-message"].
  //
  // 2026-08: two fallbacks dropped, both measured at zero on the live pages.
  // `.bg-bg-300 p` — Claude removed the bg-bg-300 token outright (the user
  // bubble is now `.bg-neutral-30 dark:…bg-surface-3 .rounded-xl`).
  // `[class*="user-message"]` — the turn is identified by the data-testid
  // attribute, not by a class; the `!font-user-message` class that made this
  // substring match work disappeared a day after bg-bg-300 did. Chasing either
  // token would only buy the next rename.
  userMessage: USER_MESSAGE_SELECTORS,

  // Virtual row of one conversation turn: the numeric index gives the
  // accumulation order, and the row boundary distinguishes a collapsed
  // prompt's inert overflow from a dismissed panel enclosing the whole row.
  conversationRow: ['[data-index]'],

  // Assistant roots: prefer October's identities while retaining legacy turns.
  // The extractor unions these in priority order instead of stopping at the
  // first matching selector, so mixed old/new DOM does not lose distinct turns.
  assistantResponse: ASSISTANT_RESPONSE_SELECTORS,

  // October tool rows are positively classified by their content-block group.
  // Thinking (:grp:th...) and unknown groups are not tool activity. Only the
  // row's own label is available consistently; never click to expand details.
  toolStatus: ['[data-cds="TurnStatus"][data-item-key*=":grp:cblk_"]'],

  // Markdown content selectors
  // 2026-07: .progressive-markdown disappeared from the live site (removed
  // under the zero-match baseline contract)
  markdownContent: [
    '.standard-markdown', // Semantic (HIGH)
    '[class*="markdown"]', // Partial match (MEDIUM)
  ],

  // NOTE (2026-08): `userWrapper` and `messageDate` used to live here. No code
  // ever read either of them — Claude date extraction was never implemented —
  // yet the live selector suite validates every declared group, so when Claude
  // dropped the `bg-bg-300` and `.text-text-500.text-xs` classes the run failed
  // over selectors nothing consumes. Declare them again only alongside the code
  // that reads them, measured against the DOM of that day.

  // Scroll container for virtualized-conversation auto-scroll (ADR-017).
  // Claude windows/evicts turns. The sidebar now shares the thread's overflow
  // classes and precedes it in the DOM (upstream #499). Prefer the semantic
  // thread root; only accept the class fallback when it contains virtual rows.
  // Broad overflow-only fallbacks can scroll the sidebar instead of the chat.
  scrollContainer: [
    '[data-autoscroll-container]', // Semantic scroll root (HIGH)
    '.overflow-y-auto.overflow-x-hidden.flex-1' +
      ':not(nav):not([role="navigation"]):not(nav *):not([role="navigation"] *)' +
      `:has([data-index] ${THREAD_MESSAGE_ROOT})`, // Extractor-owned thread fallback (MEDIUM)
  ],
} as const satisfies SelectorGroup;

/**
 * CSS Selectors for Deep Research extraction
 *
 */
export const DEEP_RESEARCH_SELECTORS = {
  // Artifact container (existence check)
  artifact: [
    '#markdown-artifact', // ID (HIGH)
    '[id*="markdown-artifact"]', // Partial match (HIGH)
  ],

  // Report title
  // 2026-08: `h1.text-text-100` dropped — text-text-100 survives elsewhere in
  // the DOM but no longer lands on an h1, so the pairing can never match.
  title: [
    '#markdown-artifact h1', // Structure (HIGH)
    '.standard-markdown h1', // Structure (HIGH)
    'h1', // Generic (LOW)
  ],

  // Report content
  content: [
    '#markdown-artifact .standard-markdown', // Structure (HIGH)
    '.standard-markdown', // Semantic (HIGH)
  ],

  // Inline citation links
  // 2026-07: the group/tag class moved from a wrapper onto the <a> itself
  inlineCitation: [
    'span.inline-flex a[href^="http"]', // Structure (HIGH)
    'a[class~="group/tag"][href^="http"]', // Class on the anchor (MEDIUM)
    'a[target="_blank"][href^="http"]', // Attribute (MEDIUM)
  ],
} as const satisfies SelectorGroup;

/**
 * Pre-computed selector strings for querySelectorAll
 * Avoids repeated .join(', ') calls at runtime
 */
export const JOINED_SELECTORS = {
  inlineCitation: DEEP_RESEARCH_SELECTORS.inlineCitation.join(', '),
} as const satisfies ComputedSelectors;
