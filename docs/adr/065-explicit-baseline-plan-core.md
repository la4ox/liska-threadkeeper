# ADR-065: Plan an explicit selected baseline without execution authority

## Status

Accepted on 2026-11-07 as an unwired offline planning/checkpoint core.

## Context

The canonical-backup foundation already has a deterministic manifest-only
catalog, an inert whole-list journal, purpose-aware single-operation v2 records,
one-shot execution and explicit staged/attachment ownership. It still lacked a
bounded owner for the question across multiple conversations: which explicitly
selected item is untouched, which has an observed v2 operation, and why must a
slow baseline stop before considering another item?

Journal v1 cannot answer this without changing its meaning: it does not encode
new-capture purpose, strict completeness or destination assurance. Journal v2
stores one immutable operation at a time, retains at most 16 records, has no
settlement/retry/deletion API and requires an exact one-store schema. Extending
its database in place would mix plan ownership with operation ownership before
their atomic relationship is designed.

Provider discovery evidence is also insufficient for account-wide planning.
ChatGPT pages remain scope-unbound/nonterminal; Claude's accepted terminal page
requires externally resolved scope and token equality carries no freshness or
safe-skip meaning.

## Decision

### Exact explicit-selected plan

Add an isolated pure `baseline-plan` module. Plan creation admits exact canonical
catalog bytes through the existing catalog admission and requires a nonempty
caller-selected subset of complete `{provider, conversationId,
conversationKey}` triples. Catalog loading alone creates no plan.

Every selected triple must be an exact catalog member. The plan is sorted by
ordinal code-unit comparison, rejects duplicate/conflicting identities, binds
the exact catalog SHA-256, requires purpose `new-capture`, canonical nonempty
destination requirements and the existing strict completeness policy. Coverage
is always `explicit-selected-inputs-only`; account scope, current accessibility,
never-archived conversations and account completeness are not inferred.

Canonical plan bytes and their SHA-256 remain separate. Every public admission,
reducer and projection boundary rehashes those exact bytes through an injected
algorithm and captured abort signal. The module cannot authenticate that
algorithm, so it never treats the digest as external trust or execution
authority.

### Data-only checkpoint

The versioned checkpoint contains only planning facts:

- exact plan digest and revision;
- control `paused` or `active`;
- caller-supplied monotonic observation time;
- opaque explicit budget windows and a maximum reservation-slot budget;
- immutable operation links, charges and record observations;
- an optional explicit cooldown observation.

Creation and restart recovery are paused. Activation, pause, cooldown changes,
window rollover and operation observation are explicit pure commands with exact
revision/time fences. A clock jump never opens a new window; rollover requires a
new opaque window ID. Unknown outcomes, pause and restart never refund a charge.
Prior touched items never become retryable after rollover.

Lifetime links/charges are capped at the existing v2 capacity of 16. Observation
history is bounded at 128 and window history at 64. Exhaustion stops; there is
no pruning, rotation, deletion or hidden limit increase. Repeating an exact
record observation is effect-idempotent—no duplicate link, charge or history
entry—but a successfully accepted command still advances checkpoint revision
and the caller-supplied observation time for CAS/event ordering.

Operation linking validates the full plan identity, catalog digest, purpose,
operation/attempt/capture IDs, destinations and completeness policy. It observes
an already-existing validated v2 record. This is explicitly not an atomic
checkpoint-charge plus v2 reservation transaction; a future durable owner must
design that protocol before dispatch.

### Conservative projection and next decision

Projection requires the caller's complete detached v2 snapshot and replays every
stored observation through the existing v2 validators. It classifies each plan
item only as:

- untouched;
- reserved;
- in-flight-or-unknown;
- awaiting-resolution;
- paused-or-abandoned;
- conflict.

No class means backed up, complete, settled or retryable. Every
`awaiting-resolution` assessment, including `consistent`, remains resolution
required. Existing catalog captures never satisfy the new-capture purpose.

The next-decision result always contains `executionAuthorized: false`. It either
returns one deterministic untouched candidate or a fixed stop reason: paused,
clock-regressed, cooldown, budget-exhausted, capacity-unavailable,
linked-operation-pending, unresolved-effect, conflict or no-unattempted-items.
The last reason is explicitly not baseline completion.

Reserved active operations block as pending. In-flight and unknown operations
block even if later paused or abandoned. Awaiting-resolution and safely
non-in-flight paused/abandoned records remain touched and cannot be retried, but
may permit consideration of a different untouched item.

Any supplied foreign/unrelated v2 record stops with conflict instead of being
silently ignored. An unlinked operation matching this plan stops as an unresolved
effect. The module cannot prove that a caller omitted a never-linked record from
the claimed complete snapshot; future integration must own that read boundary.

## Ownership boundaries

- The planner owns deterministic intended order and eligibility explanation.
- V2 owns operation reservation, dispatch fencing and retained producer evidence.
- The coordinator owns effect sequencing and best-effort runtime facts.
- A later durable baseline owner must atomically relate plan item, budget charge
  and operation reservation before dispatch.

The module imports only pure catalog admission, purpose validation and v2 core
snapshot/replay helpers. It has no IndexedDB/store, provider discovery, capture
handoff, coordinator, browser global, clock, timer, network, UI or production
consumer.

## Rejected alternatives

- Mutating journal v1 would give legacy attempt states new purpose semantics.
- Adding a second store or fields to v2 would be a schema migration without a
  retention/atomicity design.
- Treating `consistent` as completion would silently introduce settlement.
- Ignoring foreign or missing operations would make a filtered snapshot look
  complete.
- Reading time internally or rolling windows on elapsed time would create a
  hidden scheduler and silently replenish budget.
- Feeding provider discovery pages into this plan would overstate current scope,
  terminal traversal and update-marker evidence.

## Non-goals

This decision does not add plan persistence, baseline execution, operation
reservation, atomic charging, provider enumeration, authenticated scope,
pagination/cursors, update detection, request pacing, scheduling, live adapters,
retry, settlement, deletion, v1/v2 schema changes or living memory.

## Evidence and validation

- The parent focused matrix passes 19 files / 522 tests across plan/checkpoint/
  projection, catalog admission, purpose/v2 semantics and architecture. The new
  implementation contributes 64 functional and five architecture cases.
- TypeScript, scoped zero-warning lint, focused Prettier and diff checks pass.
- Architecture tests pin seven source files, the exact 24-file pure runtime
  closure, zero external/production consumers and zero generated/config markers.
  All v2 source Git blobs remain byte-identical to merged main; existing v1
  invariants still pass.
- Independent review reports no P0–P2 finding. It confirms digest/replay paths,
  immutable charges/links, stop precedence and narrow allowlists. The complete
  v2 snapshot obligation, conservative foreign-record conflict and
  effect-idempotent revision advance remain explicit boundaries.
- Full coverage passes 332 files with one skipped and 11,651 tests with three
  skipped: 95.22% statements, 91.86% branches, 98.36% functions and 97.46%
  lines. The baseline-plan aggregate reports 99.53% statements, 99.07% branches,
  100% functions and 99.74% lines.
- Global lint passes with zero errors and the unchanged 55 warnings. Full
  Prettier, Idea Threads at 9 threads / 37 relations, documentation links at
  85/85, production dependency audit with zero vulnerabilities and the guarded
  production build/ZIP pass.
- Fresh `dist` contains 65 files / 6,087,953 bytes and zero baseline-plan
  authority markers. The 2,792,264-byte candidate ZIP has SHA-256
  `d1f187116b302bc8dafae39796867666c2c1067fac0abf0b6ece75745a0b5bf1`.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates before merge.

## Next gate

Design a durable baseline-plan owner only after deciding atomic
checkpoint/charge/operation reservation, storage evolution, capacity/retention
and unknown-commit reconciliation. Provider scope/terminal traversal and the
multi-day manually approved baseline remain separate later gates; no daily
scheduler follows from this core.
