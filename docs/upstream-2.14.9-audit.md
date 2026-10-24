# Upstream 2.14.9 delta audit

This audit compares Liska's former upstream baseline `b96bfc5` (`v2.7.13`)
with `sho7650/obsidian-AI-exporter` `244df7f` (`v2.14.9`), then checks each
candidate against Liska `main` at `6e9098a`.

The upstream delta contains 85 commits and changes 172 files. It is not suitable
for a wholesale merge: Liska now has raw/canonical archives, branch selection,
immutable snapshots, DeepSeek support, stricter credential boundaries, and a
different ChatGPT capture architecture.

## Adapted in the current branch

### Perplexity layout compatibility

Source commits: `1f2e07f`, `d35af68`, `2fe0609`.

- collect assistant prose rendered beside an empty legacy placeholder or after
  the placeholder was removed;
- support renderer-backed user bubbles while retaining legacy query spans;
- deduplicate transitional old/new markup;
- preserve paragraph/list boundaries in renderer-backed user prompts;
- group sibling prose sections by answer owner without absorbing separately
  owned Deep Research content;
- detect opened Deep Research report prose without obsolete card classes;
- never invent a body for a collapsed report that is absent from the DOM;
- preserve Liska's hardened citation-title and footnote pipeline.

### Strict popup settings reads

Source commit: `c2edc47`.

The popup now fails closed when local or sync storage cannot be read, instead of
populating an editable form with defaults that a later save could write over
real settings. Runtime/service-worker callers retain the existing fallback.
Liska's local-only API-key authority, verified migration, mutation queue and
worker-mediated saves remain unchanged.

### Length-aware append reader

Source commit: `c2d4371`.

Liska already writes collision-safe long code fences. The legacy message
counter now reads matching fence character/length too, so an inner triple fence
cannot expose fake `User`, `Assistant`, or callout headings inside a longer
outer block. Backticks remain the only writer/reader fence family.

### Dependency and build-chain refresh

The branch updates compatible versions of DOMPurify, CRXJS, Vite, Vitest,
coverage, ESLint and the Undici override. The single-purpose
`vite-plugin-static-copy` dependency was replaced with Node's built-in `fs.cp`
for `_locales`; exact locale copies are maintained in both the resolved dev
output and production ZIP, including serialized watcher refreshes. The
extension ZIP still retains both locale files. A fresh
`npm audit` reports zero known vulnerabilities at this checkpoint. This is a
dated registry result, not a permanent safety claim.

## High-value remaining ports

### Claude current DOM and scrolling — local candidate complete

Source commits: `472ec7d`, `af7b475`, `54b8f7c`, `f5d240f`.

Adapt in one evidence-gated slice:

- distinguish long collapsed conversation turns from dismissed inert panels;
- anchor auto-scroll on the transcript rather than an overflow sidebar;
- recognize October assistant-message anchors;
- remove screen-reader/action chrome and expanded thinking/tool rows from the
  ordinary answer body;
- preserve Liska's richer legacy tool-content path instead of replacing the
  extractor wholesale with upstream's label-only implementation.

The fresh `codex/claude-october-dom` port carries only the two prior local
compatibility commits for transcript scrolling and October message roots onto
current `main`; it does not merge the stale compatibility branch or its
superseded truncation guard. The port preserves the current shared
`ClaudeToolConversionBudget`, unions strong and legacy turn identities, admits
collapsed inert content only inside a live indexed row, removes answer chrome
on a detached clone, and merges October labels with rich legacy tool evidence.

Independent review found four retained gaps before publication: October labels
bypassed the aggregate tool budget; the class fallback could scroll an earlier
indexed navigation sidebar; containment deduplication ran quadratically before
the budget; and the first hardened fallback omitted two supported legacy role
roots. October rows now consume section, metadata, separator, Markdown, and DOM
work budgets. Selector anchors derive from the complete supported role groups
outside navigation ancestry. Priority-preserving ancestry sets replace pairwise
containment without merging sibling operations; the first connected-component
attempt was rejected by a dedicated data-loss regression. Focused and full
evidence plus the bounded live canary are recorded in `STATUS.md`.

### ChatGPT DOM fallback — local candidate complete

Source commit: `b60e88c`.

The local candidate adapts paired prompt/answer turns and a direction-neutral
scroll axis only inside the rendered fallback. Current and legacy roots are
unioned by DOM identity rather than using upstream's global current-layout
switch. Stable turn keys outrank late child IDs; keyless remount identity stays
explicitly best-effort. A visible top-settle prevents late history from being
declared complete, including the zero-range seed edge, while hidden pages remain
runtime-partial. Each newly harvested history page resets both the stability
counter and the settle timestamp, so successive small pages receive the full
wait rather than a shortened remainder.

API-first complete graph capture, selected/replay failure behavior, raw archive
companions, canonical projection, verified binary acquisition, and destination
receipts remain authoritative. Upstream blob-image collection is not ported.
Focused/full tests and exact residual live gaps are recorded in `STATUS.md`.

### Typed truncation protection

Source commits: `7b9532c`, `c2edc47`.

Legacy DOM providers need a structured incomplete-scroll signal carried into
note persistence. A known partial capture with fewer messages must not replace
a longer same-conversation note. This requires a shared contract and write
guard; warning prose alone is insufficient. It must not alter immutable raw
archive companions or equate an unknown count with completeness.

Implemented in the typed partial-DOM persistence checkpoint: Base virtualized
extractors and Gemini now carry a runtime-only DOM loader outcome through note
dispatch. Exact same-conversation mutable Obsidian overwrites refuse a smaller
known-partial count and also fail closed when the old count cannot be trusted.
File/Clipboard, first saves, valid complete/unknown traffic, and immutable archive
presentations remain unchanged. The count comparison deliberately does not
claim message-prefix equivalence.

### Selector-derived provider readiness — local candidate complete

Four compatibility commits are ported independently onto current `main` without
the stale branch's truncation or roadmap history. Bootstrap's old joined generic
selector is replaced by an exhaustive typed map derived from each provider's
owned selector module. The current provider alone is queried, with complete
current/legacy fallbacks and one unchanged 10-second escape for absent or
virtualized DOM.

This is an injection hint, not extraction authority. It starts no capture,
request, message, write, or credential path, and it does not change ChatGPT or
DeepSeek structured-first behavior. Perplexity's legacy query path is
single-sourced for extraction and readiness without joining it to the current
live-selector contract. Focused/full evidence and the independent cross-provider
matrix are recorded in `STATUS.md`; live provider timing remains unproven.

### Gemini completeness and title

Source commits: `c2edc47`, `2c06dbe`.

- typed timeout/incomplete propagation is implemented; warning text remains for
  user visibility;
- prefer a meaningful document title before falling back to the first query.

### Google image redirect host

Source commit: `a049f06`.

Evaluate one exact redirect-only permission/CSP entry for `lh3.google.com`.
Do not admit it as a caller-supplied image source and do not broaden to
`*.google.com`. A current live redirect observation is still desirable.

## Already present or superseded

- nested code-fence writing is superseded by Liska's stronger fence and
  Markdown-container handling;
- rejected output responses already receive stricter destination/result
  validation in Liska;
- modulepreload output is already disabled;
- upstream's configurable UTF-16 note-size policy must not replace Liska's
  byte-accurate message and staged-archive ceilings;
- upstream generated-image capture is presentation-oriented and cannot replace
  Liska's provider-bound, original-byte canonical asset acquisition;
- NotebookLM has no material new extraction behavior in this range; retain
  Liska's stronger citation-title escaping.

## Deliberately deferred

- persistent sync badges and custom frontmatter tags are product features, not
  correctness fixes;
- restoring upstream's removed E2E selector harness is a separate project;
- the proposed final note-body HTML gate in upstream ADR-044 is documentation,
  not shipped implementation at `v2.14.9`;
- broad lockfile or Nix/release churn is not imported merely for parity.

## Evidence limits

This audit proves source deltas, tests and local package behavior. It does not
prove today's authenticated Perplexity, Claude, Gemini or ChatGPT DOM. Each
provider port still needs a focused live canary before being called generally
complete.
