---
title: "ITH-003 — Imperfect sources stay separate before reconciliation"
type: idea-thread
permalink: ith-003-imperfect-sources-stay-separate
tags: [idea-thread, reconciliation, official-export, provenance, chatgpt]
thread_id: ITH-003
thread_state: settled
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-10-31
---

# ITH-003 — Imperfect sources stay separate before reconciliation

Live web history, official exports and provider libraries overlap without being
interchangeable. This thread preserves why Liska compares their evidence while
keeping each capture independently recoverable.

## Thread

### H1 — The newest or most official source should replace older captures

An official account export or a later provider snapshot appears more
authoritative than a browser capture. Replacing older local evidence would also
reduce storage and leave one apparently current archive.

### E1 — Web and official histories retain different facts

The official ChatGPT format uses a different graph shape and does not reproduce
every fact observed in live web history. A private content-free comparison found
200 web-only nodes/messages while all 42 exact asset IDs matched. That is strong
evidence of differing retention boundaries, but it does not prove why those
nodes were absent or that either side is universally complete.

### E2 — Exact official import works only by preserving its own provenance

The importer selects one exact provider conversation ID, retains the original
object bytes and records file-slice or shard provenance without copying
neighboring chats. Shards, optional manifests and the bounded ZIP source adapter
extend how bytes are supplied without changing the official normalizer or
turning a container into a new truth source.

### E3 — Comparison can expose disagreement without merging it

The compare-only core scopes every node, message, topology and asset fact to its
left or right capture. File and Obsidian delivery preserve the official raw,
manifest, canonical archive, comparison and root bundle manifest as a new
immutable reconciliation snapshot. Source-local references remain unambiguous.

### X1 — Merge captures by title, time, filename or current Markdown

Those fields are convenient but not identity or provenance. Concatenating
canonical graphs would also make artifact references ambiguous because they are
capture-local.

Revisit when: a versioned merge contract preserves capture-scoped provenance,
proves exact identity and has a concrete user need beyond comparison.

### X2 — Treat ZIP support as a second importer or stronger authority

ZIP is useful pre-extraction convenience, but its container structure and CRC
do not authenticate provider completeness. Duplicating import semantics inside
the ZIP layer would create two readers with drifting claims.

Revisit when: never for the current adapter; new source semantics belong in the
official importer, while containers remain bounded byte sources.

### D1 — Preserve each source and reconcile exact facts before any merge

The adopted path keeps web, official and library-derived evidence as separate
immutable captures. Reconciliation uses exact provider identity, exact canonical
IDs, typed conflicts and semantic commitments. It does not fuzzy-match, delete,
merge or declare one source globally superior.

Evidence: E1, E2, E3

### T1 — Wire official ZIP selection only after browser evidence

The core ZIP adapter still needs installed-browser raw-DEFLATE behavior, bounded
File range reads, cancellation, backpressure, responsiveness and authorized
private-export acceptance before it can enter the local reconciliation page.

Trigger: those exact browser gates pass without changing importer or provenance
semantics.

### T2 — Consider explicit merge only after provenance becomes composable

A future synthesis might help navigation, but it must retain source-local facts,
conflicts and omissions rather than flattening disagreement into one graph.

Trigger: capture-scoped references and a conflict-preserving output schema are
specified, independently reviewed and preferred to linked separate captures.

## Observations

- [hypothesis] H1: a newer or official source initially appeared able to replace older local captures
- [evidence] E1: one real comparison retained 200 web-only nodes/messages while all 42 exact asset IDs matched #local-only
- [evidence] E2: exact official import preserves slice and shard provenance while manifests and ZIP remain bounded input evidence
- [evidence] E3: compare-only delivery exposes exact differences while keeping both archives immutable
- [rejected] X1: titles, times, filenames and readable Markdown cannot authorize archive merging
- [rejected] X2: ZIP is a bounded byte-source adapter, not a second importer or stronger truth source
- [decision] D1: preserve imperfect sources independently and reconcile exact scoped facts before any merge
- [tail] T1: add ZIP UI only after installed-browser streaming and cancellation gates
- [tail] T2: revisit merge only with composable provenance and conflict-preserving semantics

## Relations

- informed_by [[ith-002-layered-archive-truth]]
- informs [[ith-006-preserve-before-deduplicate]]
- informs [[ith-007-update-driven-backup-and-memory]]

## Source receipts

- S1 — [ADR-037: Exact ChatGPT official-export excerpts](../adr/037-chatgpt-official-export-import.md)
- S2 — [ADR-038: Compare-only ChatGPT cross-format reconciliation](../adr/038-chatgpt-cross-format-reconciliation.md)
- S3 — [ADR-041: Bounded ChatGPT official-export shard sets](../adr/041-chatgpt-official-shards.md)
- S4 — [ADR-046: Bounded official ChatGPT export ZIP source adapter](../adr/046-official-export-zip-source.md)
- S5 — [PR #50: compare ChatGPT archive formats](https://github.com/la4ox/liska-threadkeeper/pull/50)
- S6 — [PR #84: bounded official export ZIP core](https://github.com/la4ox/liska-threadkeeper/pull/84)
- S7 — local receipt `LISKA-CHAT-SYNTHESIS-20261031-SOURCES`; visibility: local-only; safe aggregate only
