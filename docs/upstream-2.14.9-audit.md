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

### Claude current DOM and scrolling

Source commits: `472ec7d`, `af7b475`, `54b8f7c`, `f5d240f`.

Adapt in one evidence-gated slice:

- distinguish long collapsed conversation turns from dismissed inert panels;
- anchor auto-scroll on the transcript rather than an overflow sidebar;
- recognize October assistant-message anchors;
- remove screen-reader/action chrome and expanded thinking/tool rows from the
  ordinary answer body;
- preserve Liska's richer legacy tool-content path instead of replacing the
  extractor wholesale with upstream's label-only implementation.

### ChatGPT DOM fallback

Source commit: `b60e88c`.

Upstream supports paired prompt/answer turns, current selectors and a reversed
scroll axis. Liska should adapt those only inside its explicitly partial DOM
fallback. API-first complete graph capture, selected-branch failure behavior,
raw companions and canonical projection remain authoritative.

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
