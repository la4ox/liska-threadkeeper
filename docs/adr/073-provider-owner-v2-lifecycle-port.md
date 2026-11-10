# ADR-073: Add a provider-closed journal/3 lifecycle port to owner/2

## Status

Accepted on 2026-11-10 as an unwired local lifecycle/evidence slice. It exposes
no provider request, capture pipeline, destination, UI, runner or scheduler.

## Context

ADR-071 persisted one exact journal/3 reservation in owner/2, and ADR-072 proved
that storage boundary in native Chromium. The owner still admitted only
revision-0 reserved records. One pending reservation therefore blocked every
later item because no authority could atomically claim it, retain interruption
facts or append provider evidence.

The accepted journal/3 contract already expresses `reserved`, `in-flight`,
`unknown` and `awaiting-resolution` records for both ChatGPT and Claude. Its
checkpoint/2 reducer can append higher-revision observations without adding a
second link or charge. The missing boundary is owner/session/token authority and
atomic replacement writes, not another record schema.

ADR-067 is a useful race and transaction precedent, but its
`ExecutionStorePort` and coordinator are journal/2 and ChatGPT specific. They
import the old persistence store and own actual ChatGPT capture, staging,
attachments and destinations. Widening them would cross accepted rollback pins
rather than merely reuse sequencing.

## Decision

### Keep the physical and serialized owner/2 domain

Retain database `liska-baseline-owner-v2`, physical version 1, stores
`owner`/`operations`, envelope `liska-baseline-owner/2`, plan/1, checkpoint/2
and journal/3. Add no migration, dual write or new store.

The commit path now accepts either a new record insert or an exact existing-key
replacement. Both record bytes and owner/checkpoint bytes still commit under one
complete two-store inventory CAS and become visible only after the terminal
transaction event.

New code can read prior reservation-only owners only when they retain the newly
required execution headroom. Old reservation-only code may reject evolved
lifecycle records as corruption; rollback preserves the bytes but neither
rewrites nor downgrades them.

### Expose one owner-bound exact five-method port

`ProviderBaselineOwner.createExecutionPort(identity, clock)` returns one frozen,
runtime-branded `ProviderExecutionPort` with exactly:

- `read()`;
- `claimDispatch(expectedRevision)`;
- `consumeDispatch(token, operation, beginEffect)`;
- `markExecutionUnknown(expectedRevision, reason)`;
- `recordProducerReceipts(expectedRevision, receipts)`.

The identity binds plan digest, complete provider/conversation/key item plus
operation, attempt and capture IDs. The captured clock must return monotonic
nonnegative safe integers. Regression revokes the owner session and fails
closed.

The port exposes no reservation, checkpoint control, transaction, adapter
registration, settlement or retry method. Owner snapshots continue to return
`executionAuthorized: false`.

### Keep dispatch authority in the owner session

Claim requires a recovered healthy owner, explicitly active planning checkpoint,
the exact active/open/reserved record revision and no competing
reserved/in-flight/unknown record. It revises the record to `in-flight`, appends
its checkpoint observation and replaces both bytes atomically.

Only after known terminal commit does the owner check the same session. If it is
still current, claim returns `dispatch: available` with an opaque token. If the
commit is known but pause/close/recovery already revoked the session, it returns
the committed record with `dispatch: revoked`, never a false rollback claim.
Unknown transaction outcome remains a distinct error.

Consume deletes the token synchronously before its first await, validates the
bound immutable operation and exact inventory captured at claim, completes a
serializing readwrite scan over both stores, then performs one final same-session
check immediately before calling the supplied callback outside IndexedDB. A
validation failure, callback rejection or stale session never restores the
token.

This provides at-most-one callback invocation per capability, not exactly-once
external effects or instantaneous cross-handle cancellation. Another handle can
commit after the final transaction and before effect start; stronger guarantees
would require a separately designed inter-context lease.

### Retain interruption and evidence facts atomically

`markExecutionUnknown` revokes dispatch before any persistence await. It accepts
only an exact open in-flight record and one closed journal/3 execution reason,
revises it to `unknown`, pauses planning and appends the matching checkpoint
observation atomically.

Explicit checkpoint pause converts an in-flight record through
`controlRecord(..., 'pause')`; restart recovery uses
`controlRecord(..., 'restart')`. Reserved records remain reserved. Already
paused owners with no in-flight record preserve exact checkpoint bytes.

`recordProducerReceipts` snapshots the provider-selected strict receipts before
awaiting. The bound operation—not caller input—chooses the ChatGPT or Claude
adapter, provider tag and adapter version. The owner computes the historical
hash outcome and complete adaptation and revises only open in-flight/unknown
records to `awaiting-resolution`. It accepts no caller assessment.

Late factual evidence may be written through the bound port after pause/restart
when the exact record revision still matches. `consistent` remains factual
agreement, not settlement. No method automatically reserves the next item.

If evidence persistence fails after an external effect, the caller retains its
detached runtime facts and the fixed persistence outcome. This slice promises no
crash-durable late-fact spool, compensating retry or replacement IDs.

### Admit only the supported owner lifecycle and replay it exactly

Owner admission now requires one immutable link and charge per record, append-
only observation history and an exact latest revision/full-record digest for
every current record. Observation count may exceed record count. At most one
record may remain reserved, in-flight or unknown; other records may be
awaiting-resolution. Every record is open; abandoned records remain outside the
owner/2 writer surface.

Reserved records must retain `control: active`. Journal/3 structural control
states for unknown/awaiting records remain admitted through their closed control
graph. A forged canonical reserved/paused record is rejected even when its
checkpoint digest is recomputed.

Historical observations are replayed through the provider-selected adapter on
every read. A transient inability to re-hash previously available evidence is
reported as `read-failed`, never relabelled as corrupt historical data.

### Reserve exact lifecycle headroom

Read/reopen and every commit validate both journal/3 record control headroom and
worst-width checkpoint/observation capacity. At most 128 checkpoint observations
remain append-only.

For the sole pending record, retained budgets are:

| Durable state   | Checkpoint revisions | Observation slots |                           Record revisions |
| --------------- | -------------------: | ----------------: | -----------------------------------------: |
| active reserved |                    4 |                 3 |                                          5 |
| paused reserved |                    0 |                 0 |            0 until activation revalidation |
| in-flight       |                    3 |                 2 |                                          4 |
| active unknown  |                    2 |                 1 |                                          3 |
| paused unknown  |                    1 |                 1 |                                          3 |
| active awaiting |                    1 |                 0 | 0 beyond its own control-headroom encoding |
| paused awaiting |                    0 |                 0 | 0 beyond its own control-headroom encoding |

The record budget includes the eventual awaiting-resolution pause/abandon
control projections, not only the immediate lifecycle revision. Exact boundary
tests prove reserved `M−5` → claim `M−4` → interruption/control `M−3` → evidence
`M−2`, while each adjacent overfull state fails before an effect or late write.
Paused reservation admission remains byte-stable; activation must pay its own
checkpoint revision and then satisfy the full active budget.

## Compatibility and boundaries

Old journal/1/2, old baseline owner, old execution coordinator, plan/1,
checkpoint/2, journal/3, producer evidence contracts and adapters remain
unchanged. The provider owner gains two local modules and exact architecture
allowlists; it remains absent from production/config/manifest/dist consumers.

The ADR-072 storage harness keeps its 13 storage rows and zero-permission
manifest. Its exact source/runtime closure grows to include the owner lifecycle
modules, so its historical native PASS does not certify token races or evidence
transitions. A separate lifecycle acceptance remains the next gate.

This decision adds no provider request, capture/staging/attachment logic,
destination write, production entrypoint, UI, live account scope, traversal,
automatic continuation, settlement, retry, scheduler or living memory.

## Rejected alternatives

- Reuse/widen the old `ExecutionStorePort` or coordinator: journal/2 and
  ChatGPT-specific dependencies cross frozen rollback boundaries.
- Add a second database/store or dual write: breaks one-owner atomicity.
- Accept caller-provided assessments or adapter selection: lets input redefine
  retained evidence meaning.
- Mint a token before commit or restore it after failure: permits duplicate
  callback invocation.
- Retry an unknown commit or evidence CAS: can duplicate effects or overwrite
  concurrent facts.
- Treat awaiting-resolution as settled or reserve automatically: changes purpose
  semantics and creates an implicit runner.
- Raise history/byte limits to make edge states fit: hides capacity exhaustion
  instead of retaining a truthful stop.

## Evidence and validation

- The parent broad matrix passes 31 files / 542 tests across provider owner,
  provider checkpoint, journal/3, baseline plan/owner, six architecture guards
  and the storage harness. The final provider-owner suite passes 7 files / 121
  tests.
- New lifecycle tests cover both providers, exact port branding, claim/consume,
  provider-selected evidence replay, hash outage, pause/restart/interruption,
  late evidence, competing claims, double/forged/cross-owner/stale tokens,
  callback failure, known-commit revoked dispatch, both-store rollback, phantom
  CAS, missing terminal outcomes and exact read/reopen behavior.
- Exact headroom tests cover record/checkpoint `MAX`, 128 observations, 64 KiB
  encodings, all three uncertainty routes, paused activation and accepted/rejected
  adjacent boundaries. Independent review found and closed reserved/paused
  admission and 5/4/3 record-headroom gaps; final re-review reports ready.
- TypeScript, scoped zero-warning ESLint, focused Prettier and diff checks pass.
- The unchanged storage-only scenario passes 46 tests after its exact closure
  moves to 39 source / 40 runtime modules. The rebuilt 172,353-byte runner has
  SHA-256 `5e660a7ded0e2f7a3087fddf6863b1259344a3a6425ae84bed1989cfe3aba19e`.
- Full coverage passes 360 files with one skipped and 12,222 tests with three
  skipped: 95.31% statements, 91.93% branches, 98.43% functions and 97.50%
  lines. Global lint has zero errors and the unchanged 55 warnings; full
  Prettier, Idea Threads at 9 threads / 37 relations, documentation links at
  93/93 and the production dependency audit with zero vulnerabilities pass.
- The guarded production build/ZIP passes. Fresh `dist` contains 65 files /
  6,087,953 bytes and zero lifecycle markers. The 2,792,264-byte ZIP has SHA-256
  `0f47af77431d0f6395e1fa162f1c20dbf62b543e0a7fb460c7c2c886ba07679d`.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates for this branch.

## Next gate

Accept the new lifecycle/token/evidence path through a separate zero-permission
synthetic native harness. Only after that may one manually authorized
provider-bound operation be designed with an explicit provider, account/scope,
request budget, capabilities and stop conditions. No account-wide baseline or
scheduler follows automatically.
