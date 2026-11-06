# ADR-061: Persist purpose-aware single-capture state in a separate v2 journal

- Status: Accepted separate browser-local persistence boundary
- Date: 2026-11-06
- Base main: `94af6fe90f495cc2fee2b426a028c1da719c8b1c`
- Related: ADR-050, ADR-051, ADR-054, ADR-058, ADR-059, ADR-060, ITH-007

## Context

ADR-060 prepares exact catalog-bound operation/attempt/reserved-capture identity
before one injected ChatGPT request, but the immutable handoff is not durable.
Restarting the browser loses any in-memory authority and does not prove whether
dispatch happened.

The accepted journal v1 cannot be extended in place. Its database contract
requires database version 1, exactly one `journals` object store, no indexes and
an upgrade only from an empty version-0 database. Adding a v2 store or upgrading
that database would make the v1 reader reject its own schema. Journal v1 also
lacks purpose, operation and required-destination semantics.

The next safe boundary is therefore a separate, unwired, purpose-aware local
journal for one immutable operation. It must commit reservation before releasing
a token, retain exact producer evidence and assessment without turning
`consistent` into settlement, and recover uncertainty without retrying.

## Decision

### Use a separate database and schema

Introduce `liska-resumability-journal/2` under an isolated
`purpose-persistence-v2` namespace. Its default database is
`liska-resumability-journal-v2`, initially IndexedDB database version 1, with one
out-of-line-key `operations` store and no indexes or auto-increment.

The v1 core, IDB adapter, page, default database and serialized bytes remain
unchanged. No migration, shared store or inferred `runId`/`itemId` meaning is
added. One v2 database retains at most 16 operation records, each canonically
encoded to at most 8 MiB.

### One record owns one immutable attempt

Each record stores the exact admitted `NewCaptureOperation`, a safe revision and
orthogonal lifecycle fields:

- phase: `reserved`, `in-flight`, `awaiting-resolution` or `unknown`;
- control: `active` or `paused`;
- disposition: `open` or `abandoned`;
- optional interruption reason: `pause`, `restart` or `abandon`;
- at most one observation containing exact accepted ChatGPT producer receipts,
  the derived evidence when available, the complete adapter result and an
  explicit adapter/hash-outcome version.

There is no recorded, confirmed, successful, settled or completed state. One
operation already owns one attempt and reserved capture; there is no retry,
reset, delete or identity-reuse API.

### Commit reservation and dispatch fences atomically

`reserveChatGpt` internally runs the real exact-catalog handoff using the one
store-owned SHA-256 capability, then inserts the operation in a readwrite
transaction. The same bounded store scan atomically enforces uniqueness of
operation ID, attempt ID and capture ID across every retained record, including
unknown and abandoned records. Catalog identity or conversation identity is not
globally unique: later explicit operations may target the same conversation.

`claimDispatch` atomically requires an open, active, reserved record and commits
`in-flight` with one revision increment. Its opaque token is released only after
`transaction.oncomplete`. Request success, a successful `put`, an accepted abort
or a committing transaction that refuses abort is not enough.

Tokens live only in the current store handle's private registry and bind the
exact committed record snapshot. Forged, copied, cross-store, stale,
post-pause/restart and restored objects cannot authorize currentness. Closing a
store handle is terminal and clears its token session; reopening requires a new
handle. `checkCurrent` is a snapshot, not a lock over a later provider request
and cannot promise exactly-once effects.

### Retain receipts and recompute assessment

`recordProducerReceipts` accepts only strictly snapshotted factual receipts. It
runs the existing adapter outside IndexedDB, then performs an exact full-store
snapshot CAS in a readwrite transaction. Any concurrent change rejects the
write; there is no automatic retry.

The committed observation retains receipts as well as the full adapter result.
This preserves adapter-level conflicts that have no evidence envelope and avoids
downgrading them to missing evidence after restart. Caller-supplied assessment
is never accepted.

One constructor-owned hash capability is used for reservation, adaptation and
replay. Available observations are replayed on every public read/preflight and
must match their cached adapter result. A temporarily unavailable verifier
produces a fixed `read-failed` without rewriting history. If the hash dependency
actually failed when an observation was created, that historical
`hashOutcome: failed` and rejected adapter result are retained and replayed as
the fact of that moment; they are not silently re-evaluated later.

Committing any assessment moves the record to `awaiting-resolution` and
invalidates the dispatch token. `consistent` remains only an internal relation;
it grants no settlement, retry or success state.

### Preserve control-transition capacity

Every write passes the actual canonical record through a shared control-headroom
gate. The gate constructs the real pause, restart and abandon transitions,
including two-step interruption-to-abandon paths, and encodes them at full
`Number.MAX_SAFE_INTEGER` revision width. No approximate byte allowance is used.

This prevents an accepted near-limit observation from becoming impossible to
pause, recover or abandon. Exact tests cover an 8,388,606-byte previously
accepted candidate, the largest projected encoding at exactly 8,388,608 bytes,
the next byte rejection and revision growth from 9 through 11.

### Recover uncertainty explicitly, never on open

Opening a handle only creates or validates the separate schema. Explicit
`recoverAfterRestart` validates every record and observation before starting a
write transaction, then atomically converts only `in-flight` records to
`unknown/restart`. Reserved and assessed records remain unchanged. Recovery is
idempotent; one corrupt record or failed write aborts the whole batch.

Pause and abandonment preserve identity, evidence and uncertainty. In-flight
records become unknown with the corresponding interruption reason. There is no
resume or retry API in this slice.

## Transaction semantics and limits

The v2 adapter reproduces the accepted v1 terminal-event discipline locally,
without importing or refactoring v1:

- request success is not transaction commit;
- transaction output resolves only on `oncomplete`;
- timeout, close and version change request abort, but an abort that is refused
  during commit waits for the terminal event;
- a missing terminal event becomes `transaction-outcome-unknown`, even if bytes
  may have committed;
- all IDB callbacks remain synchronous; catalog hashing and adapter replay occur
  outside transactions before exact CAS;
- strict transaction durability is requested where supported, with a
  compatibility fallback.

This is browser-local committed bookkeeping, not permanent archival storage.
Quota, eviction, process or operating-system shutdown can still lose or make
storage uncertain.

## Boundaries

- No v1 source or test fixture is modified; an exact 21-file Git-blob baseline
  guard enforces that boundary.
- The v2 store has no production entrypoint, page, UI, background, provider,
  baseline or scheduler consumer and is absent from the built extension.
- No provider request, destination write, positive settlement, retry, cleanup or
  deletion is added.
- The store does not connect its token to `capturePreparedChatGpt`; a later
  coordinator must own currentness at the actual request boundary.
- No full catalog bytes or conversation bodies are retained in v2 records. The
  stored catalog digest is an admission commitment, not a self-contained proof
  of original membership.

## Native browser acceptance

A temporary local Vite harness imported the actual v2 store into an isolated
Chromium tab and exercised native IndexedDB:

1. reserve revision 0;
2. claim revision 1 and verify the current token;
3. close the first handle and reopen with a fresh handle;
4. observe durable `in-flight`, explicitly recover `unknown/restart` at revision
   2 and verify the old token is not current;
5. record exact factual receipts and a `consistent` adapter result at revision
   3;
6. close/reopen again and read the same `awaiting-resolution` observation;
7. close all handles and delete only the unique smoke database.

The harness reported `ok: true` and `databaseRemoved: true`. It used no user
account, extension, archive or production database. This proves the ordinary
native commit/reopen/recovery path, not quota/eviction or abrupt OS shutdown.

## Next gate

Design a separately reviewed single-operation execution coordinator. It must
connect a committed v2 reservation and current session token to the actual
request boundary, define ownership and cancellation races, and preserve
evidence when capture or evidence persistence becomes uncertain. A token check
before an awaited hash is not enough; the future owner must consume currentness
at the effect boundary.

Provider scope, terminal traversal, update markers, account-wide baseline
authority and scheduling remain later, separate decisions.

## Evidence and validation

- Focused parent validation passes 18 files / 514 tests across v2 core, store,
  transaction faults, the real offline capture/producer/adapter integration and
  architecture boundaries. The full coverage run passes 318 files with one
  skipped and 11,372 tests with three skipped: 95.18% statements, 91.81%
  branches, 98.32% functions and 97.42% lines. V2 core reports 98.37%
  statements, 98.03% branches, 100% functions and 100% lines; v2 IDB reports
  92.8% statements, 83.82% branches, 98.78% functions and 96% lines.
- Global TypeScript, full lint with zero errors and the unchanged 55 warnings,
  full Prettier, Idea-Threads validation at 9 threads / 37 relations,
  documentation links at 81/81, production dependency audit with zero
  vulnerabilities and the guarded production build/ZIP pass.
- Independent review found a hash-authority P1 and near-limit transition-headroom
  P2. One store-owned hash authority, exact candidate replay semantics and real
  projected control encodings resolved them. Delta review reports ready.
- The worker production build passes with v2 markers absent from `dist`. All 21
  v1 source blobs match exact base `94af6fe`.
- Local receipt `LISKA-PURPOSE-V2-NATIVE-IDB-20261106`; visibility: local-only;
  safe lifecycle/revision/assessment aggregate only.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  E24/E25/D15/T15 and the remaining coordinator/provider/baseline authority
  gates.

The production closure contains zero matches for the v2 schema/database,
factory, token, namespace and receipt-recording API. Generated `dist` remains 65
files / 6,086,237 bytes. The 2,791,807-byte candidate ZIP has SHA-256
`8eb1ce321ea9c68972040a87d1fc8ba8733f3f3a0290e8c2b368e489be62d9f6`.

Current-head GitHub CI, Code Review and Security Review remain acceptance gates
for this branch.
