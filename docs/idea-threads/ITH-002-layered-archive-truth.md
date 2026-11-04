---
title: "ITH-002 — Layered archive truth and readable views"
type: idea-thread
permalink: ith-002-layered-archive-truth
tags: [idea-thread, archival, canonical, presentation, privacy]
thread_id: ITH-002
thread_state: settled
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-11-04
---

# ITH-002 — Layered archive truth and readable views

Liska began as a convenient conversation exporter, but long, branching and
tool-rich chats do not fit one flat Markdown note. This thread preserves why
source evidence, canonical meaning and readable output became separate layers.

## Thread

### H1 — One lossless export format can also be the reading format

A single JSON or Markdown file looked simpler: capture once, keep one artifact,
and use it both as the archive and as the user-facing note. That remained
plausible while conversations were treated as linear user/assistant rows.

### E1 — Flat exports lose structure before presentation starts

Measured exports omitted branch edges, attachment records, ordered structured
blocks, provider fields and exact source bytes. Even a third-party JSON export
retained text while dropping graph and attachment meaning. A presentation file
therefore cannot prove that it is a complete archive merely because it is JSON
or renders every visible paragraph.

This evidence establishes loss in measured formats; it does not imply that
every provider exposes the same graph or that every raw response is complete.

### E2 — The layered pipeline survived real provider differences

ChatGPT and DeepSeek now preserve exact raw evidence, a credential-free
manifest and a versioned canonical graph before deriving Markdown or durable
destination output. ChatGPT branch exports reuse one capture while projecting
the provider current path, one selected leaf or every leaf. DeepSeek uses its
own source shape while retaining the same separation.

The live and test receipts prove the implemented provider slices and their
stated limits, not a universal provider-neutral capture method.

### E3 — Canonical-derived HTML validated independent views

The HTML renderer consumes a validated canonical branch and finalized local
asset bindings rather than reparsing Markdown. It is deliberately a derived
artifact, not a fourth archive-core companion. Single-branch and all-branch
HTML delivery can evolve without changing the raw, manifest or canonical bytes.

### H2 — Multi-format export is only a row of independent save buttons

Once Markdown and HTML existed, it looked plausible to add PDF, DOCX, image,
text and JSON buttons directly to the current export path. That would be a
small UI change if every button could safely reuse the same rendered string.

### E4 — A mature exporter puts selection and preview before format rendering

A read-only inspection of an installed third-party exporter showed a local
preview with search, per-message checkboxes, range/all selection, visual
inspection and only then PDF, DOCX, image, Markdown, JSON, text and copy
actions. This is useful product evidence that format is downstream of an
explicit presentation selection, not evidence that its formats are lossless or
that its privacy and delivery contracts are suitable for Liska.

### E5 — Liska already has distinct archive and presentation products

Current source already emits Markdown, exact raw/manifest/canonical JSON and a
canonical-derived offline HTML view. The missing product layer is therefore an
explicit bounded presentation choice and additional honest renderers, not a
second capture pipeline or a renamed canonical archive.

### E6 — Canonical-derived plain text closed the first new-format slice

The installed Comet path now renders one bounded structured ChatGPT branch from
validated canonical meaning into deterministic UTF-8 `index.txt`, then records
the browser-confirmed byte length and digest in a format-specific receipt. The
same capture retained raw, manifest, canonical, Markdown and HTML products, so
plain text did not become archive authority or change the older projections.

The live evidence closes the measured File/single-branch seam only. It does not
claim all branches, Clipboard, Obsidian text, preview selection, PDF or DOCX.

### E7 — Installed Text preview stayed a selected view, not a second archive

The installed Comet path opened one extension-owned current-branch preview as
40 bounded canonical-derived rows with no initial selection. Selecting one row,
then filtering to the assistant role, retained that row as one hidden selection
while 32 rows remained visible. Clear removed every row and disabled Copy and
Download. No output action ran and no raw, manifest, canonical, asset or
destination setting entered the page.

The live run also showed that Comet aliases extension URLs and can return a
stale page from `tabs.update()` while navigation is pending. The final protocol
keeps exact extension ID/path/session identity and waits for completed read-back
before source capture. This proves the measured installed current-branch Text
slice; it does not yet prove selected-branch interaction, HTML/Markdown excerpts,
PDF or DOCX.

### E8 — One detached projection now serves rich Text, Markdown and HTML selection

The next installed slice prepares self-contained per-message Text, Markdown and
HTML bodies while the authorized canonical branch exists, then discards the
canonical/capture stages before one-shot transfer. The strict frozen projection
contains no topology, canonical messages, raw/source references, provider
extensions, asset IDs/bytes/paths or destination authority. Combined row,
aggregate, parser-work and wire ceilings prevent the three representations from
silently tripling admitted work.

One current ChatGPT branch again exposed 40 rows with no initial selection. A
single short row produced a browser-confirmed 817-byte Markdown clipboard source.
The HTML browser outcome expired as `unknown` without retry; completing the same
already-open Save As dialog independently produced a 2,412-byte file with one
article, CSP and no script element. This separates physical-file evidence from
the browser terminal receipt and does not claim selected-branch, DeepSeek, PDF
or DOCX acceptance.

### X1 — Treat readable Markdown or convenient JSON as archival authority

This path looked attractive because those files are easy to inspect and move.
It was rejected after they proved unable to represent or verify source graph,
attachment and structured-block evidence without silent loss.

Revisit when: never as a general rule; a format may be an authority only for
the exact evidence contract it explicitly preserves and verifies.

### X2 — Generate every later view from the existing Markdown

This would reuse mature formatting code, but it would turn known compatibility
loss into the input of HTML, PDF or future memory. A later view could no longer
distinguish source absence from an earlier projection omission.

Revisit when: only for an explicitly Markdown-native import whose source of
truth is the Markdown itself, not for a canonical provider archive.

### X3 — Copy every third-party format button or use remote conversion

This would produce visible parity quickly, but remote conversion would transmit
private conversation content and a Markdown-first implementation would compound
known projection loss. A single unlimited conversation image also exceeds
practical browser canvas and memory limits for long chats.

Revisit when: never for remote conversion; individual local formats may return
after they have their own bounded renderer, resource policy and delivery proof.

### D1 — Keep evidence append-only and derive views from canonical meaning

The adopted architecture is capture, normalize, then present and deliver.
Exact raw bytes and their manifest remain source evidence; the canonical graph
is the versioned semantic archive; Markdown, HTML, Obsidian notes and future
views are replaceable projections. Later captures create new snapshots instead
of rewriting earlier evidence.

Evidence: E1, E2, E3

### D2 — Grow one local presentation pipeline in reviewed vertical slices

New formats will consume validated canonical meaning through an immutable
selection/profile contract, render locally without network access, and retain
format-specific diagnostics and terminal receipts. Archive JSON remains a
separate download from any future user-facing `view.json`. The first slice may
prove one renderer and its delivery seam before a larger preview UI; it must not
silently generalize all-branches, Clipboard or Obsidian behavior.

Evidence: E3, E4, E5, E6

### D3 — A selected view points to canonical truth; it never becomes another canonical

The preview selection binds one exact canonical digest, one branch target, an
ordered subset of message node IDs and one reading profile. It does not rewrite
the graph or create a reduced archive. Search queries and UI ranges are not
authority: ranges resolve to explicit IDs, while search only filters the visible
rows and never changes selection.

The completed preview/search/selection slice supports explicit Text, rich
canonical-derived Markdown and safe offline HTML Copy/Download over the same
ordered IDs. Legacy Markdown is not reused as shared search text or renderer
input because its omission semantics differ from the canonical presentation
profile.

Evidence: E1, E4, E5, E6, E7, E8

Decision record: ADR-048

### T1 — Add richer reading formats without enlarging archive authority

PDF, new HTML profiles or other reading views may be useful, but each needs its
own renderer, resource limits, offline-asset policy and terminal persistence
evidence. Styling alone must not change the archive schema or completeness
claim.

Trigger: one format has a concrete user need and a bounded implementation can
prove deterministic derivation from canonical evidence.

### T2 — Let future living memory index evidence without rewriting it

A later semantic or thread-memory layer may link themes, unfinished questions
and related captures. It should point back to immutable evidence and disclose
its own inference boundary rather than silently merging or deleting snapshots.

Trigger: capture, reconciliation and recovery are stable enough that indexing
can be rebuilt without becoming the only copy of archival meaning.

### T3 — Extend canonical-derived plain text only through a new bounded slice

The first deterministic bounded `.txt` File view was completed and
installed-live-verified on 2026-11-04. Any later all-branches, Clipboard,
Obsidian, Claude/DOM-fallback or selection-aware text behavior remains a
separate slice; it must not be inferred from the accepted File contract.

Trigger: a concrete need for one deferred destination or scope has its own
bounded identity, rendering and terminal-delivery contract.

### T4 — Add one local preview and immutable message selection contract

Completed on 2026-11-04 as a behavior-preserving capture-seam refactor followed
by an extension-owned preview with bounded detached Text/Markdown/HTML bodies,
search, checkbox/range selection, one format selector and explicit
Copy/Download. Search and format changes do not alter selection implicitly, and
a partial selection cannot silently cause the full archive to be shared as a
view.

Trigger: met on 2026-11-04 after the Text slice merged and the capture-only
lifecycle, stage cleanup and no-second-canonical boundary were specified.

### T5 — Add document and image renderers separately

Treat local PDF and DOCX generation as distinct products. PDF needs
pagination/font/math/table evidence; DOCX needs editable structural mapping.
Conversation-to-image is not on the active roadmap: an ordinary browser
screenshot already covers the current user need without adding a canvas,
pagination or memory-heavy rendering subsystem.

Trigger: met for PDF/DOCX on 2026-11-04 when the shared multiformat
selection/profile contract passed installed current-branch evidence. Each format
still needs its own enforceable renderer/output budget. Reopen image only for a
concrete scenario that an ordinary screenshot cannot solve.

## Observations

- [hypothesis] H1: one convenient file initially appeared able to serve as both archive and reading view
- [evidence] E1: measured flat Markdown and JSON exports omitted graph, attachment and structured-block evidence
- [evidence] E2: ChatGPT and DeepSeek use different capture shapes while sharing the raw-manifest-canonical-presentation separation #live
- [evidence] E3: canonical-derived HTML evolved independently without becoming archive authority
- [hypothesis] H2: multi-format export initially looked like a row of independent save buttons
- [evidence] E4: the inspected exporter places search and explicit message selection before format rendering #local-only
- [evidence] E5: Liska already separates Markdown, archive JSON and canonical-derived HTML in current source
- [evidence] E6: installed Comet persisted deterministic canonical-derived text and a matching terminal receipt without changing older products #live
- [evidence] E7: installed Comet kept bounded preview selection local and separate from canonical archive authority #live
- [evidence] E8: one detached bounded projection now renders selected Text, Markdown and HTML without retaining canonical authority #live
- [rejected] X1: readability and a JSON extension do not establish archival completeness
- [rejected] X2: deriving later views from lossy Markdown would compound earlier omissions
- [rejected] X3: third-party button parity, remote conversion and unlimited image capture do not meet Liska's privacy or boundedness contract
- [decision] D1: keep raw and canonical evidence append-only and derive replaceable views from it
- [decision] D2: add local canonical-derived formats through reviewed selection, renderer and receipt slices
- [decision] D3: bind selected views to one exact canonical digest without creating or rewriting a canonical graph
- [tail] T1: add richer reading formats only with separate bounded rendering and persistence evidence
- [tail] T2: allow future living memory to index but never silently rewrite archive truth
- [tail] T3: extend text beyond the completed single-branch File view only through a separately bounded contract
- [tail] T4: bounded local Text/Markdown/HTML preview and immutable message selection are complete
- [tail] T5: treat PDF and DOCX as separate budgeted renderers; leave image dormant unless screenshots prove insufficient

## Relations

- informs [[ith-003-imperfect-sources-stay-separate]]
- informs [[ith-004-attachment-acquisition-authority]]
- informs [[ith-005-bounded-completeness-proof]]
- informs [[ith-006-preserve-before-deduplicate]]
- informs [[ith-007-update-driven-backup-and-memory]]
- relates_to [[ith-001-claude-isolated-artifact-capture]]

## Source receipts

- S1 — [ADR-031: Separate Capture, Canonical Archive, and Presentation](../adr/031-loss-aware-archive-pipeline.md)
- S2 — [ADR-036: Canonical-derived HTML presentation](../adr/036-canonical-html-presentation.md)
- S3 — [PR #7: loss-aware ChatGPT archive and branch exports](https://github.com/la4ox/liska-threadkeeper/pull/7)
- S4 — [PR #8: DeepSeek canonical archive and verified attachments](https://github.com/la4ox/liska-threadkeeper/pull/8)
- S5 — [PR #38: all-branches canonical HTML delivery](https://github.com/la4ox/liska-threadkeeper/pull/38)
- S6 — local receipt `LISKA-CHAT-SYNTHESIS-20261031-ARCHIVE`; visibility: local-only; safe aggregate only
- S7 — [User-facing derived-output roadmap](../chatgpt-todo.md#7-user-facing-derived-outputs)
- S8 — local receipt `LISKA-MULTIFORMAT-REFERENCE-20261103`; visibility: local-only; safe aggregate only
- S9 — [ADR-047: Canonical-derived plain-text presentation](../adr/047-canonical-text-presentation.md)
- S10 — installed Comet text/receipt acceptance artifacts; retained locally; repository visibility: safe aggregate only
- S11 — [ADR-048: Selected presentation preview without a second canonical archive](../adr/048-selected-presentation-preview.md)
- S12 — local receipt `LISKA-TEXT-PREVIEW-20261104`; visibility: local-only; safe aggregate only
- S13 — local receipt `LISKA-MULTIFORMAT-PREVIEW-20261104`; visibility: local-only; safe aggregate only
