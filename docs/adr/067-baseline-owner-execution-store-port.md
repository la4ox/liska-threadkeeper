# ADR-067: Bind the durable baseline owner to the existing coordinator

## Status

Accepted on 2026-11-07 as an unwired single-operation execution/evidence slice.

## Context

ADR-066 could atomically persist one plan item, charge and reserved v2-format
operation, but deliberately exposed no dispatch token or evidence writer. The
existing ChatGPT coordinator already owns the correct request, staged-artifact,
attachment, destination and stop-fence sequencing; duplicating it for the owner
would create two subtly different execution systems.

The coordinator was coupled to the concrete `PurposePersistenceStore` class and
recognized only its error type. The new owner uses a different database and
transaction authority. Calling the legacy store would split operation and
checkpoint ownership; passing owner errors unadapted could also turn an uncertain
commit into generic failure and trigger an inappropriate compensating write.

## Decision

### One coordinator, one narrow store port

Extract the exact five storage methods the coordinator consumes:

- read one operation;
- claim dispatch;
- consume one opaque dispatch capability;
- record explicit execution uncertainty;
- record factual producer receipts.

Ports are frozen, runtime-branded factory results with an exact method surface.
Method references are captured synchronously; arbitrary accessor-backed or
decorated duck types are rejected. A compatibility wrapper preserves the
existing concrete `PurposePersistenceStore` behavior and tests without changing
its database, token semantics or source.

The port uses a closed fixed-code error boundary. Native and owner storage errors
map conservatively; `transaction-outcome-unknown` and `open-outcome-unknown`
remain outcome-unknown, never generic `write-failed`. Callback errors after the
provider effect begins stay outside storage mapping and remain coordinator-owned.

### Operation-bound owner adapter

`BaselineOwner.createExecutionPort` binds one exact plan digest, item ordinal and
full identity triple, operation/attempt/capture IDs, plus an explicit monotonic
caller clock capability. It returns no reservation, control, transaction or
scheduler method. The owner itself remains the sole database, WeakMap token,
session-generation and fence authority.

Claim requires a recovered healthy handle, active planning checkpoint, exact
link/charge/operation binding and an active/open/reserved operation at the
expected revision. No other reserved, in-flight or unknown operation may own the
effect boundary. Claim atomically revises the operation to `in-flight` and
appends its exact checkpoint observation in the same two-store CAS. Only after
commit and a final same-session check is an opaque nonserializable token minted.

Consume burns that token synchronously before its first await, revalidates the
complete owner/operation inventory through a serializing transaction, then checks
the session fence and invokes the captured effect callback in the same
continuation outside IndexedDB. A token is never restored after validation
failure, callback throw or request rejection. This provides at-most-one callback
invocation per capability, not exactly-once external effects; another handle can
still race after the final transaction and before provider start.

### Atomic lifecycle and evidence

Every operation mutation derives the next operation and checkpoint observation
outside IndexedDB callbacks, then atomically replaces both operation bytes and
the owner envelope under complete-inventory CAS:

- claim: reserved → in-flight;
- interruption: in-flight → unknown with a fixed execution reason and paused
  planning;
- pause/restart: in-flight → unknown with the corresponding control reason and
  paused planning;
- receipts: open in-flight/unknown → awaiting-resolution with store-owned factual
  receipt adaptation and replay.

No caller-supplied assessment is accepted. Late evidence may update an unknown
operation and preserves a paused checkpoint; it never reactivates or settles the
plan. After an active operation reaches awaiting-resolution, the pure planner may
identify a different untouched item, but no method automatically reserves it.

The owner envelope now admits the exact supported lifecycle states and requires
the latest checkpoint observation revision/digest to match every current record.
In-flight/unknown effects block planning rather than corrupting storage. One
immutable link and charge remain associated with each operation; history is
append-only.

### Session invalidation and recovery

Close, versionchange, transaction uncertainty, pause and restart invalidate
session capabilities before any persistence await. A failed pause does not
restore authority; a later explicit activation is required. Restart recovery
pauses planning, converts an in-flight record to unknown/restart and appends the
matching observation atomically. It never recreates tokens.

If an owner is already paused with no in-flight record, explicit recovery performs
the same full inventory/session/CAS fencing but preserves exact checkpoint bytes
and revision. This avoids consuming the final revision merely to rewrite
`paused`, while restoring neither dispatch authority nor old tokens.

### Headroom and deterministic snapshots

Execution headroom is validated on every commit and read admission. The exact
phase/control projection reserves checkpoint revisions and observation slots for
claim, mandatory pause/restart/interruption and late evidence:

- active reserved: four revisions / three observations;
- in-flight: three revisions / two observations;
- paused unknown: one revision / one observation;
- active unknown: two revisions / one observation;
- awaiting-resolution: none.

At most one reserved/in-flight/unknown effect owner is admitted. Exact MAX tests
prove reserved `M−4` → in-flight `M−3` → unknown `M−1` → awaiting-resolution `M`
for pause, restart and explicit interruption. States without required revision,
observation-count or 64 KiB checkpoint capacity fail on read/reopen before a port
is returned. Paused reservations remain readable; activation must separately pay
its revision and prove active headroom.

Returned operation arrays are sorted by ordinal operation-ID comparison, so the
atomic commit result and later read/reopen snapshots use the same order without
reordering checkpoint history.

## Compatibility and boundaries

The existing v1, v2, pure plan and capture/producer contracts remain unchanged.
The shared port module imports native v2 classes only for the compatibility
wrapper; the baseline owner never constructs or opens the native store. No
second connection or token registry is introduced.

Rolling back to ADR-066 code preserves all bytes but fails closed when it sees
newer in-flight/unknown/awaiting-resolution owner records. This is intentional;
no compatibility rewrite or silent downgrade is attempted.

## Rejected alternatives

- A second coordinator would duplicate effect ordering and cancellation logic.
- Subclassing or writing through `PurposePersistenceStore` would split ownership
  across databases and private token registries.
- A broad generic repository interface would expose unrelated mutation authority.
- Automatic reserve-next after evidence would create an implicit runner and
  scheduler.
- Treating `consistent` evidence as settlement would change purpose semantics.
- Restoring a token after failed pause/recovery would permit effects after an
  explicit stop attempt.

## Non-goals

This decision does not add production wiring, provider enumeration, automatic
reservation/execution loops, account scope, update detection, pacing, scheduler,
settlement, retry, deletion, multiple owners, UI, live provider acceptance or
living memory. Late runtime facts still have no separate durable spool when
atomic evidence persistence itself fails.

## Evidence and validation

- The parent focused matrix passes 35 files / 723 tests across owner, native and
  owner-backed coordinator paths, pure planning, v2 semantics and architecture.
  The implementation adds 62 focused cases before final headroom corrections.
- TypeScript, scoped zero-warning lint, focused Prettier and diff checks pass.
- Integration tests cover inline, staged and one-PNG injected execution; atomic
  evidence/checkpoint commit; reopen; explicit second reservation after
  awaiting-resolution; and late evidence after pause/unknown.
- Fault tests cover two-handle claim/consume races, forged/stale/cross-owner
  tokens, both store-write rollback, timeout/close/versionchange/missing terminal
  uncertainty, final-effect fences, failed-pause latch and no retry/compensation.
- Independent review found and closed three P2 headroom/recovery seams: mandatory
  control transitions were undercounted, read admission omitted execution
  headroom, and reopening paused unknown at `M−1` consumed the only late-evidence
  revision. Final re-review reports ready with no material finding.
- Architecture tests pin one coordinator, exact port consumers/imports and zero
  production/provider/UI/runner/scheduler paths; existing v1/v2/baseline-plan
  source blobs remain unchanged.
- Full coverage passes 342 files with one skipped and 11,814 tests with three
  skipped: 95.23% statements, 91.84% branches, 98.38% functions and 97.46%
  lines. The owner aggregate reports 95.63% statements, 89.70% branches, 99.24%
  functions and 97.03% lines; the coordinator reports 93.93%, 89.54%, 99.05%
  and 97.53%; the new store port reports 100%, 97.29%, 100% and 100%.
- Global lint passes with zero errors and the unchanged 55 warnings. Full
  Prettier, Idea Threads at 9 threads / 37 relations, documentation links at
  87/87, production dependency audit with zero vulnerabilities and the guarded
  production build/ZIP pass.
- Fresh `dist` contains 65 files / 6,087,953 bytes and zero owner/port authority
  markers. The 2,792,264-byte candidate ZIP has SHA-256
  `62566aca6d3dde098ef1913be46299eabf6bf4b34b2a937df85134fd280b6a67`.
- Native-browser IndexedDB timing and current-head GitHub CI, Code Review and
  Security Review remain acceptance gates before merge.

## Next gate

Accept the owner-backed coordinator in a native browser with synthetic injected
effects and exact physical database reopen/recovery evidence. After that, a
separately authorized manual one-operation runner may bind provider capabilities.
Account traversal, multi-day baseline execution and a daily scheduler remain
later decisions.
