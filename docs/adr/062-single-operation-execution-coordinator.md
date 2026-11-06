# ADR-062: Coordinate one inline ChatGPT capture without retry or hidden effects

- Status: Accepted unwired inline/no-acquisition coordinator
- Date: 2026-11-06
- Base main: `a370036d8e57672b968b1bd60bba0646818a7e30`
- Related: ADR-058, ADR-059, ADR-060, ADR-061, ITH-007

## Context

ADR-061 durably reserves one purpose-aware operation and releases a session
token only after commit, but `checkCurrent` is reusable and provides only a
snapshot. The prepared capture performs identity hashes before it reaches the
injected request. A check made before those awaits cannot own the actual effect
boundary, and concurrent callers could reuse the same token.

The existing ChatGPT producer also has hidden effectful defaults. If resolver,
acquisition or binary-persistence dependencies are omitted, it may recapture the
conversation, use authenticated global fetch or send runtime messages. A
coordinator that injects only the final archive sink would not be offline or
bounded.

The immediate safe step is one unwired, one-shot coordinator for inline capture
and explicit no-acquisition preservation. It must consume the token at the real
request boundary, run the actual capture and archive producer, persist exact
receipts once and return every known fact independently when later stages fail.

## Decision

### Consume session authority once at the effect boundary

Add store-owned `consumeDispatch(token, exactOperation, beginEffect)`.

- The token is removed from the private session registry synchronously before
  the first await and is never restored.
- A readwrite transaction serializes and checks the exact committed in-flight,
  active, open record and operation against the burned token.
- After transaction completion the store rechecks the same handle/session fence
  and invokes the captured generic `beginEffect` callback synchronously in that
  continuation, outside IndexedDB and with no intervening await.
- Callback throw or rejection still consumes the token. Concurrent consumers
  have one winner.

Independent review found an earlier microtask gap between a successful consume
and the coordinator's caller continuation. Same-handle close, pause, recovery or
abandon could invalidate authority in that gap while the request still started.
Moving the final fence and callback invocation into one store-owned synchronous
continuation closes that P1. Exact event-order tests cover invalidation both
before and after the fence.

This is at-most-one invocation through one in-memory capability, not atomic
database/network execution. A different store handle can still race the final
transaction-to-request boundary, and a started request cannot be retracted.

### Run one prepared operation through the real capture

`createChatGptExecution(...).run()` owns one cached execution promise. It derives
destinations and producer intent only from the prepared operation and captures
all dependency references and the abort latch before the first await.

The real `capturePreparedChatGpt` remains responsible for identity verification,
normalization, manifest creation and reserved-ID propagation. Its injected
request wrapper calls `consumeDispatch`; only the callback invoked after the
final store fence marks the request as invoked and synchronously calls the
captured request dependency.

Successful staged provider responses are rejected after that one request but
before any stage read/abort runtime helper. A narrow `inlineOnly` capture seam
also prevents automatic canonical staging when normalized JSON crosses the
inline limit. Ordinary manual capture keeps its existing staged behavior.

### Preserve asset-bearing captures without acquisition

Add an explicit `assetAcquisition: disabled` producer mode. It preserves every
discovered asset record as `not-attempted` and performs zero resolver
observation, recapture, acquisition, authenticated fetch, Library/active route
or binary sink invocation. This is not a zero-asset-only path: asset-bearing
captures remain represented honestly and keep an insufficient asset inventory.

The coordinator calls the real destination-aware producer with:

- the exact prepared producer intent;
- the real destination archive builder in inline-only mode;
- one mandatory injected archive persistence dependency;
- no presentation or acquisition capability.

Every archive sink invocation checks the synchronous abort latch before it
starts. A sink already started is allowed to drain so its late facts are not
discarded; no later sink begins after cancellation.

### Return independent facts instead of one success flag

The outcome separately reports:

- claim and token-consumption persistence;
- request not invoked or invoked;
- dispatch not started or started;
- capture or a fixed capture error plus retained partial companion;
- the exact producer result, including raw facts and factual receipts;
- evidence persistence as not attempted, committed, failed or outcome unknown;
- best-effort uncertainty transition and interruption state.

`evidence-recorded` means only that receipts/assessment were committed. It does
not mean successful backup, settlement or strict completeness. The v2 store
remains the sole assessment authority.

Capture, producer and receipts are retained in the returned runtime outcome even
when evidence CAS, quota, close or terminal-event handling fails. If the
evidence transaction is `transaction-outcome-unknown`, the coordinator performs
no compensating write or retry because the commit may already exist.

### Preserve uncertainty without retry

The v2 record accepts fixed execution interruption reasons:
`execution-cancelled`, `capture-failed`, `producer-failed` and
`evidence-persistence-failed`. These mean resolution is required; they do not
prove whether an external effect happened.

Abort before the request boundary yields zero request. Abort after the boundary
cannot undo the request; the coordinator drains started work, prevents later
sink starts and retains returned facts. Before evidence persistence it reads one
current revision and makes one CAS attempt. Pause, recovery or abandonment may
win that race; there is no reread-and-retry loop.

Shared control-transition headroom includes every new interruption reason and
its pause/abandon paths at full safe-integer revision width.

## Boundaries

- The coordinator, store consume API and no-acquisition mode have no production
  entrypoint, page, UI, background, baseline or scheduler consumer and remain
  absent from `dist`.
- No live provider or user account action is performed by acceptance tests.
- Staged response ownership, attachment acquisition and binary persistence are
  deliberately unsupported in this coordinator.
- Late capture/producer facts returned only in memory are not crash durable when
  evidence persistence fails.
- No retry, settlement, deletion or exactly-once guarantee is added. Journal v1
  and its exact 21 source blobs remain unchanged.

## Next gate

Decide and implement ownership for staged capture plus attachment acquisition
without hidden runtime defaults. In the same separately reviewed design, decide
whether late raw/producer facts that miss v2 evidence persistence require a
crash-durable spool or may remain best-effort runtime output. Do not wire a live
provider, account-wide baseline or scheduler until those ownership and recovery
semantics are explicit.

Provider scope, terminal traversal, update markers and request budgeting remain
separate evidence gates.

## Evidence and validation

- Focused parent validation passes 30 files / 799 tests across coordinator, v2
  store/faults, real capture and producer, manual/staged compatibility and
  architecture boundaries. The full coverage run passes 324 files with one
  skipped and 11,441 tests with three skipped: 95.19% statements, 91.81%
  branches, 98.33% functions and 97.42% lines. The coordinator reports 96.63%
  statements, 90.58% branches, 100% functions and 97.22% lines.
- Global TypeScript, full lint with zero errors and the unchanged 55 warnings,
  full Prettier, Idea-Threads validation at 9 threads / 37 relations,
  documentation links at 82/82, production dependency audit with zero
  vulnerabilities and the guarded production build/ZIP pass.
- The worker broader regression passes 2,408 tests with two skipped across 76
  files; a separate manual/staged ChatGPT subset passes 1,826 tests.
- Independent review found the final token-consumption microtask P1. The
  store-owned synchronous effect-start callback and eight exact ordering
  regressions resolved it; delta review reports ready.
- The real offline integration exercises reserve, claim/consume, actual inline
  capture/normalizer, no-acquisition producer, injected archive sinks and v2
  evidence commit. Asset-bearing inventory remains `not-attempted` and the
  assessment remains insufficient.
- The worker production build passes with coordinator/v2 authority markers
  absent from `dist`; all 21 v1 source blobs remain unchanged.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  E26/E27/D16/T16 and the remaining staged/acquisition/provider/baseline gates.

The production closure contains zero matches for the coordinator, token
consumption, uncertainty-transition and v2 authority markers. Generated `dist`
is 65 files / 6,086,636 bytes. The 2,791,929-byte candidate ZIP has SHA-256
`a212d9be7745630ce352cb5867fba0f4a523b1bdbe746ac45380e68d3dcc11dc`.

Current-head GitHub CI, Code Review and Security Review remain acceptance gates
for this branch.
