---
title: "ITH-006 — Preserve before destructive deduplication"
type: idea-thread
permalink: ith-006-preserve-before-deduplicate
tags: [idea-thread, snapshots, deduplication, recovery, privacy]
thread_id: ITH-006
thread_state: settled
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-10-31
---

# ITH-006 — Preserve before destructive deduplication

Append-only captures can consume substantial local space, but equality in one
dimension does not prove that a snapshot is redundant. This thread preserves
why analysis arrived before cleanup authority.

## Thread

### H1 — Equivalent-looking snapshots can be deleted automatically

The same title, Markdown, raw hash or canonical graph can make two capture
folders appear interchangeable. A deduplicator could keep one representative
and recover space without asking the user to inspect every pair.

### E1 — Equal content can retain different evidence

The snapshot analyzer distinguishes byte identity, the same raw bytes with
different verified companions, semantic candidates and unverifiable inputs.
Even its strongest current relationships return `preserveBoth: true`. Equal raw
content does not erase different receipts, destinations, diagnostics or
chronological transition evidence.

### E2 — Read-only analysis works without mutation authority

The local page snapshots explicit folder selections, completes preflight before
reading, hashes sequentially and emits a bounded path-free report only after a
fresh trusted Save As click. Installed Comet and Chrome acceptance, a 255 MiB
near-limit pass and parser-heavy tests left sources unchanged and created no
unsolicited output.

These receipts prove the measured analysis paths, not safe cleanup, peak-memory
bounds for every workload or immediate cancellation of synchronous parsing.

### X1 — Delete by title, Markdown, timestamp or one digest

Those signals can collide, omit archive layers or hide a later verified state.
Timestamp order is also not authoritative when captures tie or clocks differ.

Revisit when: never as sole deletion evidence; each may contribute to a bounded
plan only after complete inventory and protected-evidence rules.

### X2 — Let a saved analysis report become write authority

A report is portable evidence, not a live filesystem capability. Paths, files,
links and hashes may change after it is saved, and the current report
deliberately excludes paths.

Revisit when: a separate adapter reacquires stable handles and revalidates the
entire hash-bound plan immediately before a reversible action.

### D1 — Keep snapshot analysis preserve-only

The adopted analyzer may explain relations and likely redundancy, but it never
deletes, merges, moves or rewrites a capture. A future cleanup product must make
its own privacy and recovery decisions instead of inheriting mutation authority
from comparison success.

Evidence: E1, E2

### T1 — Design a reversible mutation adapter only after product choices

Before cleanup, decide whether File and Obsidian copies of one capture may ever
be candidates, whether HTML/receipt-bearing snapshots are in scope and whether
backlink coverage may inspect selected Markdown outside capture directories.

Trigger: those choices are explicit and an adapter proves containment, symlink
and alias refusal, exact path preview, recovered-space estimates, protected
first/latest/graph-change/partial evidence, same-volume quarantine, journal and
undo.

### T2 — Require a second confirmation for permanent cleanup

Even after quarantine, permanent deletion has a different recovery boundary.

Trigger: quarantine has been inspected over a useful period and a separate
cleanup command can show exactly what becomes unrecoverable.

## Observations

- [hypothesis] H1: equivalent-looking snapshot folders initially appeared safe to deduplicate automatically
- [evidence] E1: byte or semantic similarity can coexist with different receipts, diagnostics and chronology
- [evidence] E2: installed analysis passes produced bounded reports while leaving every selected source unchanged #live
- [rejected] X1: title, Markdown, timestamp or one digest cannot independently authorize deletion
- [rejected] X2: a saved analysis report is evidence and never a live write capability
- [decision] D1: snapshot analysis remains preserve-only and grants zero mutation authority
- [tail] T1: design cleanup only after explicit scope choices and reversible containment proof
- [tail] T2: keep permanent deletion behind a later separate confirmation

## Relations

- informed_by [[ith-002-layered-archive-truth]]
- informed_by [[ith-003-imperfect-sources-stay-separate]]
- informs [[ith-004-attachment-acquisition-authority]]
- informs [[ith-007-update-driven-backup-and-memory]]

## Source receipts

- S1 — [ADR-043: Exact-byte snapshot analysis with no mutation authority](../adr/043-snapshot-analysis-only.md)
- S2 — [Snapshot parser-heavy acceptance](../snapshot-parser-heavy-acceptance.md)
- S3 — [PR #56: preserve-only snapshot analysis core](https://github.com/la4ox/liska-threadkeeper/pull/56)
- S4 — [PR #57: local snapshot analysis page](https://github.com/la4ox/liska-threadkeeper/pull/57)
- S5 — [PR #83: parser-heavy installed acceptance](https://github.com/la4ox/liska-threadkeeper/pull/83)
- S6 — local receipt `LISKA-CHAT-SYNTHESIS-20261031-SNAPSHOTS`; visibility: local-only; safe aggregate only
