# ADR-064: Admit one ordinary direct PNG family through explicit offline capabilities

## Status

Accepted on 2026-11-07 for one unwired staged execution slice.

## Context

ADR-063 made staged raw/canonical ownership explicit but deliberately kept
attachment acquisition disabled. The established manual ChatGPT producer still
has useful broad behavior, but omission in that path can invoke real legacy raw
recapture, global `fetch`, runtime binary staging and additional resolver
families. Those defaults are not an honest authority contract for the isolated
single-operation coordinator.

The next gate needs to prove the missing end-to-end shape without silently
enabling every existing route: committed raw evidence, one exact resolver
family, verified bounded bytes, one binary sink, destination-specific archive
truth and retained interruption facts.

Ordinary direct PNG is the narrowest available family. It consumes an already
observed page-owned resolver response and requires neither a second raw capture
nor an active provider-ID request. Library, active, interpreter, numeric-cid and
the retired ordinary XLSX experiment each require separate identity and
transport authority.

## Decision

### One staged-only policy

The staged coordinator accepts an optional exact own-data `attachmentPolicy`.
Omission or `{ mode: "disabled" }` preserves the existing inventory-only path.
The only enabled value is `ordinary-direct-png/1`, with all of these mandatory:

- one opaque resolver-observation request capability;
- one browser-managed fetch capability;
- one single verified-binary sink capability;
- an integer byte limit from 1 byte through 8 MiB;
- an integer timeout from 1 through 30 seconds.

The policy is snapshotted synchronously before dispatch claim. Accessors,
unknown fields, partial capability bags, invalid limits and inline-route policy
injection fail before the provider request or any durable write. The attempt
budget is fixed at one and is not caller-configurable.

### Exact family admission

After the original raw companion reaches at least one reserved destination, the
explicit path:

1. verifies and parses the already bound original raw bytes;
2. invokes the mandatory resolver observation once;
3. runs the real matcher against the complete committed ledger before filtering;
4. derives deny-only interpreter ownership for every ledger record;
5. selects at most one deterministic originally `not-attempted` PNG candidate;
6. invokes the real bounded acquisition core with the mandatory fetcher;
7. invokes the mandatory single-asset binary sink for exactly the raw-successful
   reserved destinations;
8. reuses existing destination reconciliation, canonical construction, producer
   receipts and v2 evidence persistence.

The selected URL must pass the existing conversation-bound transient URL
validator, have no resolver key and have no numeric resolver file ID. Any
Library, interpreter, ambiguous, numeric-cid, foreign-conversation, other-MIME
or unsupported identity remains `not-attempted`.

Interpreter denial is deliberately not the dispatch planner. A new boolean
helper reports whether any exact interpreter evidence exists for one ledger
record, independent of record state, planner cardinality and the bounded plan
cap. It exposes no message, sandbox path or provider identity. This prevents an
ambiguous merged interpreter record or weaker alias from falling through to the
ordinary family.

### Verified bytes and binary ownership

The real acquisition core still owns URL, response origin, status, media type,
bounded stream, PNG bytes, length and SHA-256 validation. The injected fetcher
is only the effect capability; it cannot replace those checks. No omitted
fetcher can reach global `fetch` in this path.

Execution owns detached verified bytes until binary-sink invocation. From that
invocation, the sink owns internal staging and cleanup even if it throws,
rejects or returns malformed/unknown output. The coordinator does not retry,
compensate or clean a possibly issued binary write. It does not import the
existing ambient runtime binary orchestrator.

The sink result is snapshotted and validated against the exact asset commitment
and destination set. `unknown` and `not-dispatched` write outcomes normalize to
unsuccessful facts with no success observation and conservative cleanup
uncertainty. They cannot become a fetched destination. Arbitrary sink errors are
not retained.

### Cancellation and retained facts

The stop latch is checked immediately before the actual resolver request,
actual fetch call, binary-sink invocation, destination builder/archive write
and evidence effect. Started work drains; cancellation prevents every later
effect and never claims to undo an issued request or write.

The outcome retains immutable execution-local attachment facts independently
from final producer receipts and evidence persistence:

- resolver state plus eligible/matched counts;
- acquisition attempt state and verified/failed/unknown outcome;
- only the opaque asset ID and verified PNG media type, byte length and SHA-256;
- binary invocation, exact destinations, normalized per-destination facts and
  cleanup uncertainty.

Signed URLs, resolver keys, provider IDs, message/path values, tokens, response
bodies and arbitrary exceptions are not representable. A later canonical build,
archive write or evidence CAS failure cannot erase earlier facts. These facts
remain best-effort runtime output; no durable spool, retry or settlement is
introduced.

## Rejected alternatives

- Passing the broad manual producer dependency bag would make omission an
  authority grant and re-enable hidden fallbacks.
- Library JPEG/CSV/text and ordinary active images require additional
  provider-ID dispatch authority.
- Interpreter assets require their own bounded transport and diagnostic
  contract rather than being reclassified as ordinary.
- The retired ordinary XLSX branch remains unaccepted and receives no new
  authority through a generic attachment flag.
- Importing `persistVerifiedBinaryAssets` would reintroduce ambient runtime
  messaging and multi-asset staging instead of proving the injected boundary.

## Non-goals

This decision does not add a live extension capability provider, UI setting,
numeric/active/Library/interpreter/XLSX support, batching, account scope,
provider discovery, baseline traversal, scheduler, retry, settlement, new v2
schema or durable fact spool.

## Evidence and validation

- The focused coordinator/resolver/acquisition/producer/architecture matrix
  passes 12 files / 614 tests, including 78 explicit-policy cases and 254
  resolver cases.
- TypeScript, scoped zero-warning lint, focused Prettier and diff checks pass.
- Independent review found and closed two material seams before acceptance:
  ambiguous interpreter ownership had been confused with an empty dispatch
  plan, and unknown/not-dispatched sink facts had retained an optimistic success
  bit. Re-review reports ready with no additional material finding.
- The source architecture gate keeps the coordinator and policy outside every
  production import closure and scans generated/config output for their markers.
- Full coverage passes 326 files with one skipped and 11,581 tests with three
  skipped: 95.16% statements, 91.80% branches, 98.33% functions and 97.43%
  lines. The execution-coordinator aggregate reports 93.20% statements, 88.94%
  branches, 98.85% functions and 97.22% lines; the new policy reports 90.51%,
  87.01%, 100% and 95.68% respectively.
- Global lint passes with zero errors and the unchanged 55 warnings. Full
  Prettier, Idea Threads at 9 threads / 37 relations, documentation links at
  84/84, production dependency audit with zero vulnerabilities and the guarded
  production build/ZIP pass.
- Fresh `dist` contains 65 files / 6,087,953 bytes and zero coordinator/policy/
  v2 authority markers. The 2,792,264-byte candidate ZIP has SHA-256
  `0d45c9359f84bb6420e4b84debaceaaafd8192a19b45f083175c36dfc828f166`.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates before merge.

## Next gate

This completes an offline capability proof only. Any live adapter or installed
byte acceptance is a separate explicit decision. It must bind these exact three
capabilities without enabling another family or fallback; provider scope,
account-wide baseline authority and scheduling remain later gates.
