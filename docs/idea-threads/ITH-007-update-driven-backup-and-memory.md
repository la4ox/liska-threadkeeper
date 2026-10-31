---
title: "ITH-007 — Update-driven backup before living memory"
type: idea-thread
permalink: ith-007-update-driven-backup-and-memory
tags: [idea-thread, backup, automation, discovery, memory]
thread_id: ITH-007
thread_state: dormant
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-10-31
---

# ITH-007 — Update-driven backup before living memory

The project is moving from manual export toward a local archive ecosystem, but
daily backup discovery and living semantic memory are different systems. This
thread keeps the intended order and the trigger for reopening automation work.

## Thread

### H1 — Daily backup means reopening every chat or maintaining a fixed list

A scheduler could revisit every known conversation each day, or export only a
configured subset. Both approaches are easy to describe and reuse the existing
manual capture gesture.

### E1 — Manual archive and recovery layers now have distinct contracts

Liska can preserve append-only raw/manifest/canonical snapshots, derive readable
views, compare official and web evidence and analyze snapshot relations without
mutation. Those pieces make a future scheduler conceivable while also showing
that capture, reconciliation, presentation and cleanup have different authority.

This is architectural readiness, not proof that unattended provider discovery
or long-running recovery is implemented.

### E2 — Providers do not share one reliable change signal

Title, list order, page presence and local elapsed time cannot prove that a chat
changed. Reopening every conversation merely to find out can be expensive and
provider-hostile. Each provider needs a bounded index or history signal such as
a revision, update timestamp, cursor or equivalent evidence, plus rate limits
and honest missed/deferred states.

### E3 — The desired ecosystem was clarified as four separate layers

Project discussions converged on periodic official exports as cold external
evidence, daily Liska captures only for conversations with observed updates,
the existing readable archive/reader layer and a later separate living-memory
project. “Selected chats” was explicitly corrected to “chats where updates
appeared.”

### X1 — Reopen every chat daily or confuse a fixed list with change discovery

This scales requests with archive size rather than actual changes and can still
miss provider edits or forks. It also turns absence of a successful visit into a
false no-change claim.

Revisit when: only as a clearly labelled manual catch-up mode with an explicit
budget, not as the default discovery contract.

### X2 — Collapse official exports, daily snapshots, readable views and memory

One mutable store would look simpler, but later inference or cleanup could
silently rewrite primary evidence. It would also make the memory index necessary
for reading or recovering the archive.

Revisit when: never for ownership; layers may integrate through references and
rebuildable indexes while retaining separate authority.

### D1 — Keep the four layers separate and defer automation

The current direction is periodic official-export evidence, update-driven daily
Liska snapshots, derived reading views and only then a separate living-memory
layer. Backup automation stays paused until manual capture, recovery and
reconciliation are boringly reliable and a provider-specific discovery design
is explicitly opened.

Evidence: E1, E2, E3

### T1 — Design provider-specific update discovery

The first automation slice needs a resumable baseline inventory, then one
reviewed discovery contract per provider with request/page budgets, cooldown,
backoff, cursor, observed change evidence, pause, catch-up and honest error or
missed-run states.

Trigger: archive reliability is accepted and the user explicitly opens the
backup-discovery design.

### T2 — Open living memory as its own later project

Memory may surface themes, links, unfinished threads and semantic recall, but it
must index stable evidence and remain rebuildable.

Trigger: the first three layers have reliable recovery and reconciliation, and
the user separately defines the memory product's privacy and interaction scope.

## Observations

- [hypothesis] H1: daily backup initially appeared equivalent to reopening every chat or keeping a fixed selection
- [evidence] E1: manual archive, reconciliation, presentation and analysis now have distinct authority boundaries
- [evidence] E2: reliable change discovery is provider-specific and cannot be inferred from title, order or elapsed time
- [evidence] E3: the desired ecosystem separates periodic official evidence, update-driven captures, reading views and later living memory #local-only
- [rejected] X1: a full daily reopen or fixed list is not a trustworthy default change detector
- [rejected] X2: collapsing archive evidence and living memory would give inference silent rewrite authority
- [decision] D1: preserve four separate layers and pause automation until explicit discovery design
- [tail] T1: build resumable provider-specific update discovery after archive reliability is accepted
- [tail] T2: scope living memory independently after the archival layers have boring recovery

## Relations

- informed_by [[ith-002-layered-archive-truth]]
- informed_by [[ith-003-imperfect-sources-stay-separate]]
- informed_by [[ith-004-attachment-acquisition-authority]]
- informed_by [[ith-005-bounded-completeness-proof]]
- informed_by [[ith-006-preserve-before-deduplicate]]

## Source receipts

- S1 — [ChatGPT follow-up plan: user-facing derived outputs](../chatgpt-todo.md#7-user-facing-derived-outputs)
- S2 — [ADR-031: Separate Capture, Canonical Archive, and Presentation](../adr/031-loss-aware-archive-pipeline.md)
- S3 — [ADR-043: Exact-byte snapshot analysis with no mutation authority](../adr/043-snapshot-analysis-only.md)
- S4 — local receipt `LISKA-CHAT-SYNTHESIS-20261031-BACKUP`; visibility: local-only; safe aggregate only
