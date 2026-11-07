# ADR-069: Add a closed multi-provider journal/3 without wiring execution

## Status

Accepted on 2026-11-07 as an additive pure record/evidence slice. It has no
store, owner, coordinator, browser or provider consumer.

## Context

The first manual Claude baseline operation cannot be added as a small wrapper
around the accepted ChatGPT path. Baseline plan selection is provider-aware, but
its operation observation, checkpoint and progress code consume exact
`liska-resumability-journal/2` records. Journal/2 deliberately rejects every
provider except ChatGPT and replays only `liska-chatgpt-producer-evidence/1`.

Those v2, plan, owner and ChatGPT source sets are independently pinned as the
rollback boundary. Widening the old provider or receipt parser would change the
meaning of already accepted bytes. Storing Claude receipts beside an old-owner
reservation would instead create two mutable authorities and lose atomic
operation/checkpoint/evidence ownership.

Claude already has an exact one-detail-request capture and raw/manifest/
canonical archive path, but ordinary manual export returns UI effects rather
than one durable operation receipt. A new record contract must exist before any
owner or live runner can bind those facts honestly.

## Decision

### Preserve every accepted namespace and byte contract

Do not open, upgrade, rewrite, import from or dual-write the v1/v2 journals or
`liska-baseline-owner-v1`. Their source files and pinned blobs remain unchanged.

Add a separate pure record schema, `liska-resumability-journal/3`. Journal/3 is
not a migration and has no IndexedDB store in this slice. It admits exactly two
providers, `chatgpt` and `claude`; every other provider fails closed.

### Discriminate provider, receipt schema and replay adapter together

An awaiting-resolution observation contains an exact closed union:

- ChatGPT + `liska-chatgpt-producer-adapter/1` + existing ChatGPT receipts; or
- Claude + `liska-claude-producer-adapter/1` +
  `liska-claude-producer-evidence/1` receipts.

The observation provider must equal the operation provider. Receipt parser,
adapter version and replay function are selected by that same provider. Mixed,
unknown, missing or future schema/version combinations are corrupt rather than
best-effort compatible.

Structural admission never authenticates a cached assessment. Every read with
an observation must replay the exact provider adapter and compare the canonical
adaptation. A historically failed hash dependency is retained as failed; a
currently unavailable verifier does not alone prove stored bytes corrupt.

### Keep Claude factual evidence precise and pre-bound

The Claude receipt mirrors only the established factual archive boundary:

- pre-write operation/attempt/capture/provider/conversation/catalog intent;
- exact requested destination set;
- raw, manifest and canonical commitments;
- provider completeness facts and metadata-only asset states;
- per-destination File path confirmation or Obsidian byte readback observations.

It carries no raw body, credentials, organization/workspace ID, stage token,
browser capability or inferred success. Getter-backed, prototype-bearing,
cyclic, sparse, symbolic, oversized or inexact data is rejected before hashing.

The Claude adapter independently verifies the provider-aware conversation-key
recipe and the legacy routing digest, exact identity binding, destination set,
commitment agreement and sink assurance. Missing pre-write intent, incomplete
coverage, metadata-only assets or missing delivery remain insufficient.
`consistent` means only that the supplied facts agree with the pure purpose
contract; it is not producer provenance, settlement or proof of a real write.

### Retain the lifecycle but lower the pure record ceiling

Journal/3 preserves the accepted reserved, in-flight, unknown and
awaiting-resolution phases; active/paused control; open/abandoned disposition;
and fixed interruption reasons. Unknown work always retains an interruption
reason, in-flight work remains active/open and only awaiting-resolution records
contain observations.

Canonical JSON is built from bounded own enumerable data with no getters,
`toJSON`, capabilities, unsafe keys or cycles. The record ceiling is 64 KiB.
Control/headroom projection tests every retained pause/restart/abandon/
interruption shape at maximum safe revision. No store or transaction semantics
are implied by this pure byte contract.

### Keep the entire slice unwired

The new runtime closure contains only purpose assessment, exact receipt parsing,
provider-aware identity hashing and local record/control helpers. It has no
browser, storage, network, clock, owner, plan, coordinator, UI, manifest, build
or generated-dist consumer. Architecture tests permit only exact intra-slice
imports and the two existing pure adapters used for replay.

## Rejected alternatives

- Widen journal/2 or the ChatGPT receipt schema: changes accepted byte meaning
  and rollback expectations.
- Store Claude receipts in a sidecar ledger: splits mutable authority from the
  owner transaction.
- Relabel Claude as ChatGPT: loses provider-aware identity and permits false
  capture/evidence relationships.
- Build a throwaway Claude-only journal: demonstrates a canary but does not
  advance the multi-provider baseline architecture.
- Add a generic dynamic provider registry now: broadens the closed evidence
  surface before a second provider is even wired.
- Wire the existing manual exporter directly: its Markdown File result is not a
  strict durable operation receipt and its fallback/scroll behavior exceeds the
  one-request baseline gate.

## Compatibility and boundaries

Existing v1/v2 stores, baseline plan, baseline owner, execution coordinator,
ChatGPT capture/receipt behavior, production entrypoints and built extension are
unchanged. Rolling back ignores the new unwired source because no persisted
journal/3 bytes can yet be created by production.

This decision does not add a journal/3 IDB store, checkpoint/progress schema,
owner, reservation, dispatch token, provider request, destination write,
attachment acquisition, retry, settlement, traversal, automatic continuation,
account-wide baseline, scheduler, migration or UI.

## Evidence and validation

- The focused matrix passes 8 files / 119 tests across strict Claude receipt
  parsing, pure adaptation, journal/3 replay/lifecycle/headroom, exact architecture
  boundaries and old v1/v2/plan/owner pins.
- Project TypeScript, scoped ESLint with zero warnings, focused Prettier and diff
  checks pass.
- Tests cover both provider branches; provider/schema/adapter mismatch; forged
  cached assessment/evidence; failed/current hash replay; canonical decode;
  corruption; descriptor/proxy/cycle rejection; exact 64 KiB boundary; and
  pause/restart/abandon/interruption headroom.
- Independent review reports ready with no material finding. It confirmed that
  partial Claude completeness, metadata-only assets and missing observations
  cannot become consistent, and that old blobs/production closures remain
  unchanged.
- Full coverage passes 347 files with one skipped and 11,935 tests with three
  skipped: 95.28% statements, 91.91% branches, 98.39% functions and 97.49%
  lines. Global lint has zero errors and the unchanged 55 warnings; full
  Prettier, Idea Threads at 9 threads / 37 relations, documentation links at
  89/89 and the production dependency audit with zero vulnerabilities pass.
- The guarded production build/ZIP passes. Fresh `dist` contains 65 files /
  6,087,953 bytes with zero journal/3 or Claude-adapter markers. The
  2,792,264-byte ZIP has SHA-256
  `7f70e6780f571dcdca1d6a830ccd9a013935ccfc7838f08e86c43a5d85f2fe8e`.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates for this branch.

## Next gate

Design a rollback-isolated provider baseline owner namespace whose new
checkpoint/progress schema atomically owns journal/3 operations. Reuse the
provider-neutral identity/plan construction and existing transaction discipline,
but do not feed journal/3 records into the frozen v1 checkpoint reducer. Keep
production wiring and the one-Claude-request launcher behind later separately
reviewed gates.
