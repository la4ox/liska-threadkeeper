# ADR-063: Make staged ChatGPT capture ownership explicit before acquisition

- Status: Accepted unwired staged/no-acquisition ownership contract
- Date: 2026-11-07
- Base main: `39914cfe23c1752b1b3b5c7350faa603aeba8273`
- Related: ADR-031, ADR-059, ADR-060, ADR-061, ADR-062, ITH-004, ITH-007

## Context

ADR-062 coordinates one inline capture and deliberately blocks staged transport.
The existing manual capture path can read, create and abort staged archive
artifacts through ambient runtime messaging. Those helpers were not injectable,
so an unwired coordinator could not prove staged behavior without touching the
extension runtime.

The legacy archive persistence seam also takes ownership of every staged
artifact in a supplied companion, not only the requested kinds. After a raw-only
write it aborts all unselected stages. That is acceptable for its manual
one-shot lifecycle but cannot support a coordinator outcome that retains a
canonical stage reference: the sink could already have deleted it.

Before enabling attachment acquisition, staged ownership must be explicit from
request response through read, normalization, canonical stage creation, selected
sink transfer and final cleanup. No generic runtime sender or implicit fallback
may remain reachable.

## Decision

### Add an explicit staged transport capability

The coordinator now accepts a discriminated capture transport:

- existing `inline-only`; or
- `staged` with a complete, frozen, own-data stage port and selected-artifact
  sink.

The stage port exposes only bounded semantic capabilities:

- read exact bytes from an accepted sealed lease;
- create an exact sealed canonical lease from verified bytes/commitment;
- release an execution-owned lease and return an explicit cleanup outcome.

It is not a generic runtime message sender. Missing, partial, accessor-backed or
mutating capability bundles fail before claim and dispatch. Manual callers that
omit the port retain their existing runtime stage behavior.

### Bind each lease to execution identity and commitment

A request-returned staged response transfers ownership only after the response
and lease are structurally accepted together. The lease binds:

- exact operation, attempt, capture and conversation identity;
- artifact kind, stage ID and immutable byte-length/SHA-256 commitment;
- an opaque execution-local ownership token.

Duplicate tokens or stage IDs, commitment mismatch, late caller mutation and
cross-execution reuse fail closed. The request dependency owns any unaccepted
stage; the coordinator never releases a stage it did not accept.

The same explicit port is threaded through the real admitted capture, raw stage
materialization, canonical companion creation and destination archive builder.
Inline raw producing an oversized canonical artifact and staged raw producing
inline or staged canonical artifacts use only injected capabilities.

### Transfer only selected stages to the sink

The isolated staged path uses a new selected-artifact sink contract rather than
the legacy companion-wide sink semantics. At invocation:

- the coordinator synchronously transfers only the exact selected staged
  artifacts required by that write;
- the sink owns those leases from that instant, including throw, rejection,
  malformed response and uncertain completion;
- the coordinator never releases a possibly dispatched lease;
- unselected stages remain execution-owned until their last reader and every
  already-started sink have drained.

Raw, manifest and destination-canonical ownership therefore remain explicit.
An initial canonical stage is not silently destroyed by a raw-only sink, and a
new destination canonical stage transfers only when its selected final sink
starts.

### Keep cleanup independent from capture/write facts

Release returns `released`, `deferred` or `outcome-unknown`. Cleanup failure does
not erase capture, archive-write or evidence facts and never becomes confirmed
cleanup by assumption. Each execution-owned lease is released at most once;
transferred leases are never released by the coordinator.

Cleanup continues after cancellation. Stop fences prevent each new read,
canonical creation, selected sink and evidence effect, while an already-started
operation drains and contributes its late facts.

After cleanup, returned outcomes do not expose usable-looking live staged
companions. They retain detached normalized capture material and independent
stage-ownership, archive-write and cleanup facts instead. Partial capture errors
retain only material whose ownership remains explicit.

### Keep acquisition disabled

This PR does not enable any resolver, recapture, authenticated fetch, Library or
active route, acquisition, binary stage or binary sink. Asset-bearing inventory
remains `not-attempted` under the accepted no-acquisition producer mode, and the
assessment remains insufficient.

The real raw capture, normalizer, destination builder, receipt producer and v2
evidence store are exercised with synthetic stage and selected-sink
capabilities. No live account or extension runtime action is performed.

## Runtime fact durability decision

For this and the next unwired acquisition slice, late facts remain explicit
best-effort runtime output. The existing durable unknown state and no-retry rule
prevent their absence from being treated as proof that nothing happened.

No spool is added now. A future product promise that observed receipts survive
restart when v2 evidence persistence fails requires a separately specified,
bounded, operation-bound fact spool. Existing temporary stages and download
cleanup records are not that spool and cannot reconstruct purpose evidence.

## Boundaries

- The staged coordinator and capability contract have no production consumer,
  page, UI, background, baseline or scheduler wiring and remain absent from
  `dist`.
- Real capability-provider sealing and selected-sink cleanup are contractual and
  synthetic in acceptance tests; no live implementation is enabled.
- No acquisition, binary persistence, retry, settlement, automatic partial
  persistence or durable fact spool is added.
- Journal v1 and its exact 21 source blobs remain unchanged. Existing manual
  inline/staged behavior is preserved.

## Next gate

Add one explicitly named attachment acquisition family under a complete
capability bundle: explicit resolver, bounded acquisition and binary sink, with
no fallback to recapture, global fetch or runtime messaging. Every effect start
must use the same stop/ownership discipline, and binary writes must be limited
to reserved destinations that passed raw persistence.

Only after one full staged-plus-asset offline operation is accepted should
additional resolver families or a durable fact spool be considered. Provider
scope, account-wide baseline authority and scheduling remain later gates.

## Evidence and validation

- Initial focused parent validation passes 12 files / 277 tests across staged
  coordinator, capture/producer, manual stage ownership and architecture. After
  the first-head review correction, the current coordinator rerun passes five
  files / 104 tests, including all 52 staged ownership cases. The worker broader
  regression passes 2,450 tests with two skipped across 83 suites.
- The full coverage run passes 325 files with one skipped and 11,494 tests with
  three skipped: 95.18% statements, 91.81% branches, 98.33% functions and
  97.43% lines. The current staged coordinator aggregate reports 94.51%
  statements, 89.77% branches, 98.27% functions and 97.81% lines.
- Global TypeScript, full lint with zero errors and the unchanged 55 warnings,
  full Prettier, Idea-Threads validation at 9 threads / 37 relations,
  documentation links at 83/83, production dependency audit with zero
  vulnerabilities and the guarded production build/ZIP pass. The root lint
  found and corrected one unused fixture binding before acceptance.
- Independent pre-PR review reports no material P0-P2 finding. First-head GitHub
  review then found one P2 cancellation race: a stop arriving during the
  evidence pre-CAS read preserved the effect-start fence but could return before
  recording cancellation uncertainty. The coordinator now attempts that durable
  transition before returning; the focused and full current-head reruns pass.
- Real staged raw exceeds the actual 16-MiB threshold. Canonical staging tests
  use an injected lower threshold while production's 32-MiB threshold remains
  unchanged.
- The worker production build and architecture closure pass with new staged
  coordinator markers absent from `dist`; v1 source remains unchanged.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  E28/E29/E30/D17/D18/T17 and the remaining acquisition/provider/baseline gates.

The production closure contains zero matches for the staged execution factory,
lease/sink contracts, selected-write API, coordinator and v2 authority markers.
Generated `dist` is 65 files / 6,086,741 bytes. The 2,791,971-byte candidate ZIP
has SHA-256
`1fa09682b28812228b36651dfaddf8de8584db5d8cc84fa7020709c890501a79`.

Current-head GitHub CI, Code Review and Security Review remain acceptance gates
for this branch.
