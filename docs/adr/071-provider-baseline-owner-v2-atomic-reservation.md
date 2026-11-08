# ADR-071: Persist provider reservations in an isolated owner v2

## Status

Accepted on 2026-11-08 as an unwired reservation-only browser-local storage
slice. Native Chromium acceptance and current-head GitHub gates remain separate
acceptance steps.

## Context

ADR-069 introduced the closed ChatGPT/Claude journal/3 record and ADR-070 added
provider checkpoint/2 reconciliation over those records. The accepted baseline
plan is already provider-aware, but the new pure layer owns neither a complete
record inventory nor an atomic persistence boundary.

The existing `liska-baseline-owner-v1` database is source-pinned to journal/2
and later gained an execution port. Widening that accepted owner would mix old
and new record domains, weaken rollback and make a provider migration implicit.
Keeping plan/checkpoint state in one database and journal/3 records in another
would retain the crash gap that the first owner was designed to remove.

The next safe step therefore needs to own exact catalog, plan, checkpoint and
reserved-operation bytes together while still granting no provider effect.

## Decision

### Create one fresh fixed atomic domain

Add database `liska-baseline-owner-v2`, physical version 1, with exactly two
out-of-line-key stores and no indexes:

- `owner`: one `liska-baseline-owner/2` binary envelope at key `baseline`;
- `operations`: canonical journal/3 records keyed by operation ID.

The envelope length-prefixes exact canonical catalog bytes, unchanged
`liska-explicit-baseline-plan/1` bytes and exact
`liska-explicit-baseline-checkpoint/2` bytes. Admission reconstructs and
revalidates the plan from the stored catalog, snapshots every journal/3 record
independently and requires exact byte round-trips. Unknown owner/store keys,
foreign schemas, unsupported providers and inconsistent link, charge or
observation cardinality fail closed.

The old owner, journal/1/2/3 and baseline-plan sources and physical namespaces
remain unchanged. Rollback simply stops using this new unwired database; no
migration, adoption, dual write or compatibility rewrite occurs.

### Preserve complete-inventory CAS and terminal outcomes

Every read scans both stores in one transaction, including unknown keys. Every
mutation prepares and validates detached next-state bytes outside IndexedDB
callbacks, then opens one readwrite transaction that:

1. rescans and byte-compares both complete inventories;
2. checks the current owner session and caller cancellation;
3. writes the optional journal/3 record and owner envelope together;
4. releases committed facts only after the terminal transaction event.

Concurrent handles therefore produce one winning complete commit. Record-only
phantoms, owner-only changes and write failures cannot leave a valid half-state.
There is no reread-and-retry loop.

Timeout, close and versionchange request abort and wait for the terminal result.
An observed commit returns its local facts; an observed abort returns the
initiating failure. A missing terminal result fences the handle as
`transaction-outcome-unknown`; open cancellation keeps the accepted
`open-outcome-unknown` boundary. Neither case authorizes replacement IDs,
refunds or automatic retry.

### Expose reservation-only authority

The owner exposes exactly:

- open and close;
- create one exact paused owner;
- read one complete validated snapshot;
- apply the closed activation, pause, cooldown and budget-window controls;
- reserve the first deterministic untouched ChatGPT or Claude item;
- explicitly recover after restart to paused planning;
- inspect one exact reservation read-only.

Reservation rehashes the provider-aware conversation key, takes caller-supplied
operation/attempt/capture IDs and creates only a revision-0
active/open/reserved journal/3 record. The record, immutable checkpoint link,
current-window charge and latest-record observation commit atomically. Every
result contains `executionAuthorized: false`.

Opening an existing owner never restores mutation authority. A new handle must
explicitly recover it to paused planning. Pause, recovery, close and failed or
cancelled mutation rotate/fence the session before a stale continuation can
write. One pending reservation intentionally prevents progress to another item
because this slice has no evidence transition.

### Retain bounded control headroom

The owner admits at most 16 lifetime operations, matching checkpoint links and
charges, at most 128 observations, 64 windows and 16 reservation slots per
window. Every current journal/3 record must fit its 64 KiB canonical and control-
headroom contracts. Every active checkpoint must retain enough revision, time
and byte headroom for mandatory pause/restart; a terminal paused checkpoint may
remain readable without inventing further authority.

Only revision-0 active/open/reserved records are valid in this reservation-only
database. In-flight, unknown, awaiting-resolution or nonzero-revision records
are corruption here because no execution or evidence writer exists.

## Rejected alternatives

- Widen or import the old owner: changes its accepted journal/2 rollback and
  execution boundaries.
- Persist checkpoint/2 and journal/3 in separate databases: cannot make the
  charge and reservation one IndexedDB transaction.
- Add a standalone journal/3 store or dual-write old and new owners: creates two
  authorities that can diverge after a crash.
- Import the old baseline-plan barrel: silently restores journal/2 checkpoint
  and progress dependencies.
- Retry an uncertain commit or allocate replacement IDs: may duplicate a hidden
  successful reservation.
- Add an execution port now: combines storage acceptance with provider effects
  before this new physical domain has native acceptance.

## Compatibility and non-goals

This slice is additive and unwired. It adds no production consumer, provider
request, coordinator, dispatch token, claim/consume capability, evidence writer,
destination write, retry, settlement, replacement, deletion, pruning,
migration, account traversal, automatic continuation, scheduler, UI or living
memory.

External complete-snapshot truth remains caller-supplied. The owner proves that
the exact bytes it was given stay atomically consistent; it does not prove
account completeness, provider scope or that a reserved effect occurred.

## Evidence and validation

- The focused parent matrix passes 28 files / 435 tests. The new owner suite
  contributes 60 behavior cases, and its architecture guard contributes six
  exact boundary cases.
- TypeScript, scoped zero-warning ESLint, focused Prettier and diff checks pass.
- Fake IndexedDB covers exact create/read/control/reserve/reopen/recovery,
  provider-aware equal-ID ordering, complete-inventory CAS, both-store rollback,
  timeout/close/versionchange and missing-terminal outcomes, schema corruption,
  headroom ceilings and exact read-only inspection.
- Deterministic delayed-hash tests prove abort/close and same-handle
  pause/recovery fence stale reservation continuations before any extra write.
- Independent review reports ready with no material finding. It confirmed the
  two-store atomic commit, canonical admission, session fences, paused recovery,
  terminal-event discipline and reservation-only boundary.
- Full coverage passes 357 files with one skipped and 12,113 tests with three
  skipped: 95.28% statements, 91.89% branches, 98.40% functions and 97.48%
  lines. Global lint has zero errors and the unchanged 55 warnings; full
  Prettier, Idea Threads at 9 threads / 37 relations, documentation links at
  91/91 and the production dependency audit with zero vulnerabilities pass.
- The guarded production build/ZIP passes. Fresh `dist` contains 65 files /
  6,087,953 bytes with zero provider-owner-v2 markers. The 2,792,264-byte ZIP
  has SHA-256
  `4935ccbe44cafe2dfa3b3a779d0f1517dd663ff8aa044fd3813cc8a422a3b592`.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates for this branch.

## Next gate

Accept this exact storage-only owner in a fresh native Chromium database with
close/reopen, explicit paused recovery, two-handle CAS and cleanup evidence.
Only after that may a separately reviewed owner-backed lifecycle/execution port
be designed. A real Claude request, provider/account scope, multi-item runner,
account-wide baseline and daily scheduler remain separately authorized later
decisions.
