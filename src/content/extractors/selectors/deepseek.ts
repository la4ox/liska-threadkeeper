/**
 * CSS selectors for DeepSeek (chat.deepseek.com).
 *
 * DeepSeek's conversation is rendered as a virtual list. The `ds-*` classes
 * are deliberately preferred over generated CSS-module class names.
 *
 * The extractor reads the currently mounted, active conversation view only.
 * Alternative conversation branches that are not rendered by DeepSeek are not
 * present in the DOM and cannot be exported from this selector surface.
 */

import type { SelectorGroup } from './types';

export const SELECTORS = {
  /** One visible user or assistant turn. */
  message: [
    '.ds-message', // DeepSeek semantic message root (HIGH)
  ],

  /** Assistant turns carry rendered markdown; user turns do not. */
  userMessage: [
    '.ds-message:not(:has(.ds-markdown))', // Structure (HIGH)
  ],

  /** Rendered answer body inside an assistant message. */
  markdownContent: [
    '.ds-markdown', // DeepSeek semantic markdown body (HIGH)
  ],

  /** DeepSeek's expanded reasoning / thinking panel. */
  thoughtContent: [
    '.ds-think-content', // DeepSeek semantic thinking container (HIGH)
  ],

  /**
   * Direct user-query children. The final fallback intentionally excludes
   * DeepSeek's raw/duplicate query containers and focus-ring controls.
   */
  userContent: [
    ':scope > .gh-inline-bookmark + div', // Current attachment/bookmark layout (HIGH)
    ':scope > div.gh-user-query-markdown', // Rendered rich user query (MEDIUM)
    ':scope > div:not(.gh-user-query-raw):not(.gh-user-query-markdown):not(.ds-focus-ring)', // Fallback (LOW)
  ],

  /**
   * Scrollable response area. `:has(.ds-message)` avoids selecting the
   * composer/sidebar scroll areas, which can use the same ds-scroll-area class.
   */
  scrollContainer: [
    'main .ds-scroll-area:has(.ds-message)', // Main conversation view (HIGH)
    '[role="main"] .ds-scroll-area:has(.ds-message)', // Accessible main fallback (MEDIUM)
    '.ds-scroll-area:has(.ds-message)', // Last-resort conversation scroller (LOW)
  ],
} as const satisfies SelectorGroup;
