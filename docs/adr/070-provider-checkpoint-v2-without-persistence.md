# ADR-070: Rebind provider baseline checkpointing to journal/3 without persistence

## Status

Accepted on 2026-11-08 as an additive pure checkpoint/progress slice. It has no
owner, store, transaction, execution or provider consumer.

## Context

ADR-069 introduced a closed ChatGPT/Claude journal/3 record and evidence replay,
but the accepted baseline checkpoint and progress modules still import
journal/2 decoding directly. Feeding journal/3 records into those frozen modules
would either fail admission or require widening a source-pinned rollback
boundary.

The accepted baseline plan itself is already provider-aware and independent of
operation storage. Its canonical plan bytes, digest, explicit-selected coverage,
identity ordering and catalog membership should remain the same. Only the
checkpoint/progress layer needs a new record domain.

A future atomic owner needs pure answers before opening IndexedDB: whether the
complete journal/3 snapshot matches the plan/checkpoint, what each item means,
and whether one deterministic untouched candidate exists. That computation must
not itself grant reservation or execution authority.

## Decision

### Keep the plan; version only the checkpoint domain

Reuse `liska-explicit-baseline-plan/1` and its canonical digest unchanged through
direct imports from the accepted plan/data modules. Do not import the old
baseline-plan barrel because it reexports journal/2 checkpoint/progress code.

Add `liska-explicit-baseline-checkpoint/2` in a new pure
`provider-baseline` namespace. This layer admits only plans whose items are
closed to `chatgpt` or `claude`, matching journal/3. Unsupported provider plans
fail closed at creation, assertion, projection and next-decision boundaries;
items are never silently skipped.

The new checkpoint retains the accepted fields and ceilings:

- exact plan digest and monotonically increasing revision/time;
- explicit active/paused control;
- immutable budget windows, reservation-slot charges and operation links;
- append-only latest-record observations and optional cooldown;
- at most 4,096 plan items, 16 lifetime operations/links/charges, 128
  observations, 64 windows, 16 slots per window and 64 KiB checkpoint bytes.

### Snapshot and replay every journal/3 record independently

Complete operation snapshots are bounded to 16 and admitted only through the
journal/3 parser/encoder. They never pass through the plan data traversal, whose
string/depth limits intentionally differ.

For every observation, journal/3 replay validates the provider-specific cached
adaptation before its record digest is trusted. The checkpoint separately binds:

- the complete provider/conversation/key triple and plan ordinal;
- immutable purpose, catalog digest, destination assurances and completeness
  policy;
- unique operation/attempt/capture IDs;
- an immutable operation digest;
- the exact full-record digest and strictly increasing record revision.

First observation of an item appends one link, one current-window charge and one
record observation together in the returned pure value. Repeating the exact
same record appends no history, though the closed reducer still advances
checkpoint revision/time for CAS ordering. Charges are never refunded and
history is never pruned, adopted, reset or rewritten.

### Preserve conservative reconciliation and stop order

Progress receives a caller-claimed complete detached journal/3 snapshot. It
cannot prove that external completeness; instead it fails conservatively:

- duplicate or foreign identities, missing known records, changed immutable
  operations and stale/same-revision changed bytes are conflicts;
- an existing record with no known link is an unresolved-effect fence;
- in-flight and unknown records remain unresolved even when paused/abandoned;
- awaiting-resolution remains touched and resolution-required even when its
  assessment is consistent;
- safely paused/abandoned and awaiting-resolution items never become retryable.

The exact next-decision precedence is:

`conflict → clock-regressed → paused → unresolved-effect → linked-operation-pending → cooldown → no-unattempted-items → budget-exhausted → capacity-unavailable`.

Only after every earlier stop is absent may the first deterministic untouched
item be returned. Every decision contains `executionAuthorized: false`; no
candidate is a reservation, completion or retry permission.

### Keep the entire slice pure and unwired

The new module imports only direct provider-neutral plan primitives and pure
journal/3 record/replay functions. It has no owner, transaction, IDB, browser,
network, clock, capture, destination, UI, retry, settlement, migration,
automatic continuation or scheduler capability.

Architecture guards pin all five files, exact direct imports, the complete pure
runtime closure, precise external consumer maps, checkpoint schema/limits and
zero production/config/manifest/dist consumers. Existing plan and journal/3
guards receive only exact per-file/per-target test allowlist additions; all old
source pins remain unchanged.

## Rejected alternatives

- Widen the frozen checkpoint to journal/3: changes accepted source/rollback
  semantics.
- Import the old baseline-plan barrel: reintroduces journal/2 into the runtime
  closure.
- Cast journal/3 records to old operation types: bypasses exact provider evidence
  replay and byte admission.
- Put checkpoint state directly into the new owner: hides pure reconciliation
  and makes transaction code own policy.
- Infer missing records as untouched: permits duplicate external effects after
  incomplete reads.
- Treat consistent awaiting-resolution evidence as completed: changes purpose
  semantics and silently grants progression.
- Add provider-specific fields to links: the plan ordinal and immutable operation
  digest already bind the full provider-aware identity.

## Compatibility and boundaries

Existing plan bytes/digests, journal/1/2/3, baseline-plan checkpoint v1,
baseline-owner v1, ChatGPT/Claude adapters, production entrypoints and built
extension remain unchanged. Rolling back ignores this unwired source because no
checkpoint/2 bytes can yet be created by production.

This decision does not add persistence, atomicity, complete-snapshot proof,
operation control headroom, an owner, reservation, provider request, destination
write, traversal, retry, settlement, account-wide baseline, scheduler or UI.

## Evidence and validation

- The focused parent matrix passes 16 files / 222 tests. The slice adds 106
  checkpoint/progress behavior cases and four exact architecture cases across
  ChatGPT, Claude and mixed-provider plans.
- Project TypeScript, scoped ESLint with zero warnings, focused Prettier and diff
  checks pass.
- Tests cover canonical checkpoint roundtrip; old schema/v2 record rejection;
  activation/recovery/cooldown/window rollover; immutable charges/no refunds;
  mixed same-ID providers; unsupported plans; journal/3 long/deep values;
  provider replay/hash failures; hostile getters/proxies and mutation before
  await; every lifecycle category and stop precedence; 16/17 operations; 128
  observations; 64 windows; and exact 65,536/65,537-byte checkpoint boundaries.
- Independent review reports ready with no material finding. It confirmed exact
  snapshot/replay/digest fences, append-only relationships, stop precedence and
  exact guard allowlists with no journal/2 runtime in the new closure.
- Full coverage passes 351 files with one skipped and 12,046 tests with three
  skipped: 95.31% statements, 91.95% branches, 98.40% functions and 97.50%
  lines. Global lint has zero errors and the unchanged 55 warnings; full
  Prettier, Idea Threads at 9 threads / 37 relations, documentation links at
  90/90 and the production dependency audit with zero vulnerabilities pass.
- The guarded production build/ZIP passes. Fresh `dist` contains 65 files /
  6,087,953 bytes with zero checkpoint/2 markers. The 2,792,264-byte ZIP has
  SHA-256 `f8b2f4b5608824e6c744fe3d89838c5e7a0d46bff2808fd4c27f18c78f9bc697`.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates for this branch.

## Next gate

Add a fresh `liska-baseline-owner-v2` physical namespace and
`liska-baseline-owner/2` envelope that atomically stores the unchanged plan,
checkpoint/2 and journal/3 reservations. It must reuse the accepted complete-
inventory CAS and terminal-event discipline without importing or modifying the
old owner, and expose reservation-only authority before any execution port or
Claude request is considered.
