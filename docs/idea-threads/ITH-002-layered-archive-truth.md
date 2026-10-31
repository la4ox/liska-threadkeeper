---
title: "ITH-002 — Layered archive truth and readable views"
type: idea-thread
permalink: ith-002-layered-archive-truth
tags: [idea-thread, archival, canonical, presentation, privacy]
thread_id: ITH-002
thread_state: settled
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-10-31
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

### D1 — Keep evidence append-only and derive views from canonical meaning

The adopted architecture is capture, normalize, then present and deliver.
Exact raw bytes and their manifest remain source evidence; the canonical graph
is the versioned semantic archive; Markdown, HTML, Obsidian notes and future
views are replaceable projections. Later captures create new snapshots instead
of rewriting earlier evidence.

Evidence: E1, E2, E3

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

## Observations

- [hypothesis] H1: one convenient file initially appeared able to serve as both archive and reading view
- [evidence] E1: measured flat Markdown and JSON exports omitted graph, attachment and structured-block evidence
- [evidence] E2: ChatGPT and DeepSeek use different capture shapes while sharing the raw-manifest-canonical-presentation separation #live
- [evidence] E3: canonical-derived HTML evolved independently without becoming archive authority
- [rejected] X1: readability and a JSON extension do not establish archival completeness
- [rejected] X2: deriving later views from lossy Markdown would compound earlier omissions
- [decision] D1: keep raw and canonical evidence append-only and derive replaceable views from it
- [tail] T1: add richer reading formats only with separate bounded rendering and persistence evidence
- [tail] T2: allow future living memory to index but never silently rewrite archive truth

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
