/**
 * CSS Selectors for Perplexity AI (www.perplexity.ai)
 *
 * Selectors are ordered by stability (HIGH → LOW)
 * @see docs/adr/005-shared-selector-modules.md
 */

import type { SelectorGroup } from './types';

export const SELECTORS = {
  // User query text
  // 2026-09: queries are markdown-rendered inside a semantic user bubble.
  // Legacy select-text spans remain private detection selectors in perplexity.ts.
  userQuery: [
    '[class*="group/user-bubble"] [data-renderer="lm"]', // Semantic bubble + renderer (HIGH)
    'div.bg-subtle.rounded-2xl [data-renderer="lm"]', // Styled bubble + renderer (MEDIUM)
  ],

  // Prose content within response
  proseContent: [
    '.prose.dark\\:prose-invert', // Standard (HIGH)
    '.prose', // Fallback (LOW)
  ],

  // Answers now mount beside an empty markdown-content placeholder or without
  // one. Legacy placeholders remain private detection selectors in perplexity.ts.
  // `inline` narrows the match, but reports also nest inline prose: the extractor
  // excludes anything inside the report's max-w-none wrapper to avoid duplicates.
  answerProse: [
    '.prose.dark\\:prose-invert.inline', // Answer block (HIGH)
    '.prose.inline', // Without the theme class (MEDIUM)
    '.prose[data-renderer="lm"]', // Renderer hook, added 2026-08 (LOW)
  ],

  // Inline citation pill carrying the source URL (issue #291).
  // Observed 2026-07-02: every citation (hover-trigger pill and anchor variant)
  // wraps in a span whose data-pplx-citation-url attribute holds the source URL.
  citation: [
    'span.citation[data-pplx-citation-url]', // Semantic (HIGH)
    '[data-pplx-citation-url]', // Attribute-only fallback (MEDIUM)
  ],

  // Empty spacer span rendered before each citation pill; produces no
  // whitespace in text extraction, so it is removed during transformation.
  citationSpacer: [
    'span.citation-nbsp', // Semantic (HIGH)
  ],

  // Legacy citation pill (observed before 2026-07): rendered WITHOUT a
  // data-pplx-citation-url ancestor, so no source URL exists in the static
  // DOM. Matched only AFTER the modern-citation pass replaced every
  // URL-carrying pill; pills embedding an <a href> are kept (perplexity.ts).
  legacyCitationPill: [
    'span[class~="group/trigger"]', // Legacy hover-trigger wrapper (HIGH)
    'span.citation', // Residual citation pill after modern pass (MEDIUM)
  ],
} as const satisfies SelectorGroup;
