# ADR-066: Persist one baseline owner and reserve atomically without dispatch

## Status

Accepted on 2026-11-07 as an unwired browser-local storage slice.

## Context

ADR-065 introduced exact baseline plan/checkpoint/projection semantics but no
durable owner. Its reducer could only observe an operation that already existed;
writing a checkpoint charge and then independently calling the v2 reservation
store would leave a crash window between two databases.

The existing v2 database is version 1 with exactly one `operations` store. An
additive version upgrade could place plan and operation writes in one
transaction, but older rollback code would then fail with `VersionError` and
could no longer read the accepted v2 namespace. A separate plan database plus
the existing v2 store cannot provide a single IndexedDB transaction.

## Decision

### A new fixed atomic domain

Add a separate fixed-name database `liska-baseline-owner-v1`, version 1, with
exactly two out-of-line-key/no-index stores:

- `owner`: exactly one fixed-key binary envelope;
- `operations`: canonical existing `liska-resumability-journal/2` record bytes,
  keyed by operation ID.

The owner envelope contains exact canonical catalog bytes, canonical plan bytes
and digest, and canonical checkpoint bytes. It is length-prefixed and bounded;
decoding requires exact byte round-trips and reconstructs the plan from the
stored catalog rather than trusting the digest alone.

This database owns only future baseline reservations. It neither opens nor
migrates the existing v1/v2 databases. Code rollback simply stops using the new
namespace; previous data remains untouched. One retained owner is supported—no
replacement, multiple-plan namespace, pruning, deletion, automatic database
rotation or adoption of legacy records.

### Complete snapshot and atomic CAS

Every read scans both stores in one transaction, including unknown keys. Owner
and operation values are detached and bounded. Every mutation:

1. reads the complete owner and operation inventories;
2. validates plan/checkpoint/catalog and replays every operation observation
   outside IndexedDB callbacks;
3. prepares the exact next state outside the transaction;
4. opens one readwrite transaction over both stores;
5. rescans and byte-compares the complete inventories;
6. writes the owner update and optional new operation;
7. releases output only after `transaction.oncomplete`.

Concurrent handles therefore produce exactly one winning complete commit. A
failed operation insert or owner write aborts both halves. There is no
reread-and-retry loop.

### Small public surface

The owner exposes only:

- create one exact plan and paused checkpoint;
- read the complete validated snapshot;
- explicit plan controls (activate, pause, cooldown and window rollover);
- atomically reserve the current deterministic ChatGPT candidate;
- explicit restart recovery to paused planning;
- read-only exact reservation inspection;
- close.

Reservation receives exact catalog bytes, caller-supplied operation/attempt/
capture IDs, explicit caller time and an abort signal. Item identity,
destinations and completeness policy come only from the stored plan. The real
ChatGPT handoff verifies catalog membership and provider-aware identity. The
owner constructs one revision-0 active/open/reserved v2-format record and uses
the pure checkpoint reducer to add its inseparable link, charge and observation.
Both bytes commit atomically.

Every returned result retains `executionAuthorized: false`. No dispatch token,
claim, consume callback, coordinator call or generic transaction escape hatch is
exposed.

### Recovery and uncertain outcomes

Opening never activates an existing owner. A fresh handle may inspect data but
cannot mutate until explicit restart recovery records paused planning. Reserved
operations remain reserved. This slice accepts no in-flight, unknown,
awaiting-resolution or nonzero-revision operation record; such state is
corruption because no dispatch writer exists here.

Transaction timeout, close and versionchange request abort, then wait for the
terminal event. A refused abort continues waiting: observed completion returns
committed local facts, observed abort returns the initiating failure, and only a
missing terminal result fences the handle with `transaction-outcome-unknown`.
A fresh complete read may inspect the exact reservation, but no automatic retry,
refund or replacement IDs follow.

Database open cancellation also retains the live upgrade transaction. Timeout or
close after `onupgradeneeded` attempts abort. If the transaction is already
committing—or its handle is absent after upgrade completion but before queued
open success—the result is `open-outcome-unknown`, never a false rollback claim.
Late success closes the database and exposes no connection.

### Bounds and headroom

Existing plan/checkpoint bounds remain: 4,096 selected items, 1 MiB plan, 64 KiB
checkpoint, 128 observations and 64 windows. The new database retains at most 16
lifetime operation/link/charge triples and each operation record remains bounded
by the existing 8 MiB codec.

Operation admission and insert both run the existing v2
`encodeWithControlHeadroom` projection before accepting canonical current bytes.
Checkpoint headroom is state-dependent: every active state retains one revision
for restart recovery; pause/recovery may consume the final safe revision and
produce terminal paused read-only state. No counter wraps or resets.

The owner cannot currently progress past its first successful reservation:
reserved active work blocks the next candidate, and this slice has no dispatch or
evidence writer. That is deliberate. It proves durable atomic reservation, not a
running multi-day baseline.

## Rejected alternatives

- Upgrading the existing v2 database would compromise old-code rollback and mix
  previously independent ownership.
- Two databases with a write-ahead intent would be reconcilable but not atomic
  and would require a larger orphan/retry protocol.
- A new operation-only envelope inside the owner store would conflict with the
  exact v2 decoder and duplicate identity semantics.
- Automatically retrying an uncertain local commit could double-charge or create
  replacement IDs after a successful hidden commit.
- Adding dispatch/settlement here would combine storage atomicity with provider
  effects before a compatible store adapter is reviewed.

## Non-goals

This decision does not add provider requests, dispatch, coordinator integration,
evidence persistence, settlement, retry, multiple owners, deletion, account
scope, pagination/update markers, pacing, baseline execution, scheduler, UI,
production wiring or living memory.

## Evidence and validation

- The parent focused matrix passes 24 files / 456 tests across owner, plan,
  purpose/v2/catalog semantics and architecture. The owner suite contributes 79
  behavior cases after review corrections.
- TypeScript, scoped zero-warning lint, focused Prettier and diff checks pass.
- Fake IndexedDB verifies create, activate, atomic reserve, reopen, explicit
  paused recovery and exact readback under a unique test database name.
- Fault tests cover both store-write failures, two-handle races, full-inventory
  CAS, accepted/refused abort, timeout/close/versionchange, missing terminal
  events, schema corruption, uncertain reconciliation and MAX revision states.
- Independent review found and closed three P2 seams: pause headroom was too
  strict; upgrade cancellation did not abort a live schema transaction; and the
  post-commit/pre-success null-transaction interval had been mistaken for a
  successful abort. Operation control headroom is now explicit at read and
  insert. Re-review reports ready with no material finding.
- Architecture tests pin the exact new module/closure and narrow pure imports;
  existing v1, v2 and baseline-plan source blobs remain unchanged.
- Full coverage passes 338 files with one skipped and 11,735 tests with three
  skipped: 95.22% statements, 91.84% branches, 98.37% functions and 97.45%
  lines. The durable owner aggregate reports 94.98% statements, 89.07% branches,
  98.92% functions and 96.66% lines.
- Global lint passes with zero errors and the unchanged 55 warnings. Full
  Prettier, Idea Threads at 9 threads / 37 relations, documentation links at
  86/86, production dependency audit with zero vulnerabilities and the guarded
  production build/ZIP pass.
- Fresh `dist` contains 65 files / 6,087,953 bytes and zero durable-owner
  authority markers. The 2,792,264-byte candidate ZIP has SHA-256
  `c69723aed42149f298859c07b044ea861f715925f31157095becff0e90a61714`.
- Native-browser IndexedDB timing and current-head GitHub CI, Code Review and
  Security Review remain acceptance gates before merge.

## Next gate

Design a baseline-owned operation store adapter that can claim/consume exactly
one reserved record, run the existing coordinator and atomically retain resulting
v2 evidence plus the matching checkpoint observation. Only after that owner can
move a reservation to awaiting-resolution may a slow manually controlled
multi-item baseline progress beyond its first item. Provider traversal and a
daily scheduler remain separate later decisions.
