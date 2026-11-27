# ADR-085: Explicit offline adoption of the legacy Claude catalog

Status: implemented locally as an unwired offline source slice; fake-IndexedDB
validation passed. Current-head GitHub gates remain pending.

## Context

PR-1, present on base main `859dddf`, added the rollback-isolated
`liska-account-catalog-owner-v1` domain for explicit local slots and
scope-partitioned owners. It did not change the accepted legacy singleton owner
or wire a consumer. PR-2 adds a separate `src/account-catalog-adoption/`
operation so a user can deliberately copy a canonical legacy Claude baseline
into a selected local slot without turning that source into an automatic
migration path.

## Decision

Require an explicit `slotId` and display label. Before opening the legacy
database, require `IDBFactory.databases()` to discover exactly the named
`liska-claude-account-baseline-owner-v1` database at version 1. Unsupported or
failed discovery is an error; it never falls back to opening the database.
An absent source returns `legacy-absent`, while an existing empty source returns
`legacy-empty`. Neither outcome opens or creates the destination.

For an existing source, open only version 1. If a removal race would make that
open create or upgrade a database, abort the upgrade and report that the legacy
source changed. Discovery proves only the listed name/version at that moment;
it does not prove that a same-name version-1 database is the same physical
incarnation. Validate the exact opened database/store schema and bounded key
inventory, then read the bytes in one read-only transaction. After its terminal
completion and handle close, validate the canonical baseline through the
existing decoder. The source operation performs no write, delete, upgrade,
re-versioning or repair. A source close failure also stops before the
destination is opened.

Only after that read completes, copy the original `collectionId` and admitted
baseline through the public new account-catalog owner API. Then read back the
exact owner keyed by `[claude, slotId, scopeKey]`. The old singleton remains
intact. An exact repeat with the same slot, label and seed is already-created;
a different label or seed at an occupied locator conflicts without overwrite.
The same source may be explicitly copied into another slot. There is no global
adoption registry or cross-slot deduplication.

## Commit and recovery truth

The two databases cannot commit atomically. If interruption leaves the outcome
unknown, the user can explicitly rerun with the same slot, label and source
seed; destination idempotency converges without allocating another collection
ID. There is no automatic retry or silent fallback.

Once the destination owner API reports `created` or `already-created`, that
commit truth remains the outcome even if read-back is unavailable/mismatched or
database close later fails. Verification and close status are separate facts;
neither cleanup failure nor missing verification turns a committed owner into a
failed write. Cancellation during destination open may leave only the empty
fixed destination schema, never a slot or owner.

## Consequences and boundaries

- The adoption module has no production caller, build/manifest entry or UI.
  It performs no provider request, download, journal, execution or scheduling.
- No native/live, second-account or KYC check is claimed. This PR-2 slice is
  deliberately accepted on offline/fake-IndexedDB evidence.
- PR-3 remains the next separate gate for explicit slot UI and Claude collector
  wiring. ChatGPT scope/adapter work and detail/File delivery remain separate.
- This is copy-only adoption, not a source migration and not proof of a human
  account identity or account completeness.

## Validation

The local implementation report records 1,872 passing tests and 2 skipped
across 67 files, TypeScript checking, scoped lint with zero warnings,
Prettier, and diff checks. The adoption tests cover distinct absent/empty
outcomes, exact read-only validation and destination read-back, idempotent
replay, conflict preservation, explicit cross-slot copy, discovery/open races,
cancellation, and commit/read-back/cleanup truth. This is offline evidence;
no current-head GitHub gate is claimed as complete.

## Evidence

- [PR-1 owner model](084-local-account-slots-and-scope-partitioned-owners.md)
- [Adoption entry point](../../src/account-catalog-adoption/index.ts) and
  [read-only legacy source](../../src/account-catalog-adoption/legacy-source.ts)
- [Storage tests](../../test/account-catalog-adoption/storage.test.ts),
  [fault tests](../../test/account-catalog-adoption/faults.test.ts), and
  [architecture boundary](../../test/arch/account-catalog-adoption-boundary.test.ts)
