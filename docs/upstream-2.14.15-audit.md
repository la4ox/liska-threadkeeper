# Upstream 2.14.15 delta audit

This audit continues the retained
[`v2.14.9` audit](upstream-2.14.9-audit.md). It compares upstream
`244df7f` (`v2.14.9`) with `c1c199c` (`v2.14.15`) and evaluates the 13-commit,
52-file delta against Liska `main` after the ZIP/CSV evidence checkpoint.

The delta is not suitable for a wholesale merge. Liska's raw/canonical archive,
trusted append markers, structured `contentFormat`, branch presentations,
destination receipts, staged transport, physical-byte accounting, and reduced
privacy diagnostics are independent contracts.

## Already present or inapplicable

| Upstream change                                     | Verdict                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `1f17d44` DOMPurify 3.4.17                          | Already installed and locked in Liska.                                                       |
| `47bf35a` Vite 8.3.5                                | Already installed and locked in Liska.                                                       |
| `f2e4569` Vitest/coverage updates                   | Liska already uses Vitest and coverage-v8 4.1.12.                                            |
| `f2e4569` markdown-it 14.3.3 / zod                  | Inapplicable unless a future design deliberately adopts those currently absent dependencies. |
| `93728b0` fast-uri 3.1.9                            | Inapplicable; it is absent from Liska's dependency tree.                                     |
| release, changelog, store and Japanese copy commits | Product/release churn; retain Liska's 3.0.0 identity and copy.                               |

The upstream manifest change in this range is version-only. There are no new
permissions, host permissions, CSP entries, provider routes, or persistence
protocols to port.

## NotebookLM dead citation fallback

Upstream `f11d50d` removes `.xap-inline-dialog.citation-marker`: its October
2026 live baseline recorded zero matches, while
`button.citation-marker:not(:has(mat-icon))` matched all current citations,
including the new `citation-marker chat-bidi-enabled` class.

Liska still carries the dead fallback, but runtime citation transformation uses
`button.citation-marker` independently and retains stronger capability-bound
footnote provenance. Liska also removed the authenticated live-E2E selector
baseline that the upstream change unblocked. Removing the fallback is safe
housekeeping with a current-class fixture, not a runtime or security fix.

## DES-019 final note-body HTML boundary

Upstream `321020d3` adds a final rendered-body parser/gate, per-path text and
attribute escaping, append-context repair, post-transform size checks, and
resolve-before-image-write ordering. These are high-value candidate behaviors,
but the commit cannot be cherry-picked.

### Audit-baseline candidate behavior

- At the audited baseline, Liska had no parser-confirmed raw-HTML gate at the
  final ordinary-note boundary.
- Upstream escapes page-derived text and ordinary link/image attributes inside
  Turndown rather than rescanning the generated Markdown.
- Its append path parses existing and new bodies together, repairs only new
  lines, and refuses unplaceable/open HTML context.
- It checks the transformed body size before fresh Obsidian image writes.

These are candidates, not confirmed exploitable Liska findings. A bounded local
adversarial reproducer and renderer observation must establish each reachable
gap before implementation.

### Already superseded locally

- question headings are entity-serialized after truncation;
- tool metadata uses literal fences and shared conversion-work budgets;
- citations use a per-isolated-world provenance capability plus strict labels and safe
  destination/title serialization;
- math, tables, image descriptions, unsafe links and collision-safe code fences
  have independent hardened local implementations;
- Gemini image markers use fixed extension-owned IDs, not upstream's collector.

Treat upstream tests as candidate reproducers for those areas, not replacement
implementations.

### Required integration design

1. Liska's trusted message-boundary sentinels are literal HTML comments:
   `<!-- liska-message-boundaries:v1 -->` and `<!-- liska-message:v1 -->`.
   A generic raw-HTML gate would escape them, break append/count identity, and
   disable the gate's normal no-angle-bracket fast path. Preservation must use
   extension-owned provenance, never a caller-forgeable string allowlist.
2. Liska's `contentFormat` means structured `'html' | 'markdown'`; upstream uses
   a different user-text contract. Blind replacement would corrupt structured
   ChatGPT/DeepSeek projections.
3. Any gate must leave raw/manifest/canonical evidence and canonical-derived
   HTML untouched while preserving destination-local asset receipts, immutable
   snapshots, typed partial outcomes, and append refusal semantics.
4. Upstream's note cap counts UTF-16 characters. Liska's physical-byte and
   staged-write budgets are different authority; a product setting cannot be
   imported implicitly.
5. Upstream logs note IDs and image filenames/errors in paths where Liska keeps
   value-free or count-only diagnostics. Preserve the local privacy boundary.

## Local reproducer-led follow-up

A bounded local matrix confirmed two reachable seams without importing the
upstream implementation: lone-CR fence state could hide later HTML from the
line escape, and a list-contained fence could make that scanner treat the
closer as a new top-level opener. The latter survived the actual
`conversationToNote` path for both user text and structured assistant Markdown.

The local candidate now normalizes CommonMark line endings before fence
tracking and uses parser positions for fenced, indented, and multiline inline
code. More importantly,
the final ordinary-note safety pass entity-literalizes parser-confirmed HTML and
reparses after edits. The composer supplies exact ranges for its own two
message-boundary comments; the safety layer validates and shifts those ranges,
so a marker-shaped provider string receives no exception. Raw, manifest,
canonical, canonical-derived HTML, destination receipts, append refusal, and
physical-byte accounting are unchanged.

This is the confirmed per-path port, not upstream's generic gate.

### Final-context evidence and local adaptation

A second source-exact matrix then exercised the complete Deep Research body and
the joined append body. On the unchanged runtime, 11 of 18 cases failed: an old
open `<script>`, `<pre>`, comment, or Markdown fence activated or swallowed an
independently safe tail, and Deep Research retained an automatic remote image
plus private body/References links. Closed contexts and parser/forgery controls
passed. This promoted append context and complete Deep Research composition from
candidate risks to confirmed local gaps.

The adaptation remains smaller than upstream DES-019:

- the complete Deep Research reading body now uses Liska's existing structural
  active-Markdown policy after References are composed;
- a separate bounded, refusal-only mdast gate validates the exact joined append
  context, owned marker positions, opaque nodes, and cross-seam CommonMark
  reference bindings;
- only the new tail is transformed, the existing body is not sanitized, and a
  refusal is terminal with no write or overwrite fallback;
- fixed diagnostics contain no titles, paths, URLs, or parser prose.

ADR-042 records the contract. Upstream's generic parser dependency, UTF-16 note
cap, diagnostics, and whole-writer replacement were not imported. Final
serialized-size policy and preflight-before-image-write remain separate product
decisions; the current tests characterize them without claiming atomicity.

The NotebookLM selector removal may be taken later as an isolated maintenance
commit. It should not displace the reproducer-led security work above.
