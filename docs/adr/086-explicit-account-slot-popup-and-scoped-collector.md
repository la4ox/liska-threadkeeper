# ADR-086: Explicit local account slots and a single-scope Claude collector

Status: implemented locally on base main `961c109`; exact-head GitHub gates and
the installed current-account canary remain pending.

## Context

Base main `961c109` includes PR #153's local account slots and partitioned
owners plus PR #154's offline, copy-only adoption of the legacy Claude catalog.
Those foundations deliberately had no popup consumer or production collector
wiring. PR-3 connects them through an explicit local choice without turning a
display label into provider identity or widening ordinary collection to
multiple scopes.

## Decision

### Keep slot choice visible and explicit

Add one compact **Claude catalog** block under **Settings → Archive Tools**.
The slot picker remains unselected for zero, one, or many slots; every option
shows its disambiguating suffix. **New local slot** creates a display label,
and the block exposes the trusted actions **Collect from current tab** and
**Copy old local catalog**. There is no modal, new page, Export tab, saved
default, or latest-slot selection. Labels organize this installation locally;
they do not assert a provider account or human identity. A new slot is created
atomically with its first owner, not as an empty user-visible slot.

Inventory may initialize only the fixed new database schema when that database
is absent. Listing does not create slots or owners. Closed responses may return
slot IDs and labels for the local picker; adoption and collection responses
remain content-free and expose no scope, collection, target, or private owner
data.

### Keep legacy adoption copy-only and unrelated to the active tab

Adoption accepts only a newly selected slot as its destination. It reads and
validates the legacy catalog, copies it into the new owner, and preserves the
original. It never reads or derives authority from the current tab. The
underlying adoption API supports an exact same-target rerun, but the popup does
not persist that target: every new-slot click generates a fresh slot ID. After
an uncertain popup response, close and reopen the extension popup to inspect
local inventory; the UI does not retry or redispatch.

### Bind collection to the click and exactly one scope

The trusted collect action synchronously freezes its slot target before the
first await and starts `tabs.query` in the same click task. It snapshots the
returned active tab, window, and exact URL before dispatch; the worker accepts
only that bound source and rechecks it rather than selecting a substitute.
Exact sender/envelope validation covers all three dedicated popup routes. The
existing shared `/5`-/`/6` provider lock covers probe and collection; inventory
and adoption perform only bounded local storage work under their own atomic
transactions.
Closing the popup does not cancel dispatched work. Closing and reopening the
extension popup refreshes inventory; merely switching Export/Settings does not.
Neither path retries or creates a journal entry.

After the bounded active and archived reads pass admission, collection opens
the new catalog owner:

- For an existing selected slot with the same scope, report
  `scoped-owner-already-present` with `owner-existing`; do not write.
- For an existing selected slot without that scope, report
  `slot-scope-mismatch`; do not add an implicit second scope.
- For a new target, atomically create the slot and its first paused owner via
  `createPausedClaudeSingleScope`. If a concurrent operation already created
  the slot, it cannot absorb an unrelated scope.

New-owner commit truth and existing-owner observation have distinct
post-verification codes and retention values. The generic collector no longer
preflights or writes the legacy singleton owner. The existing multi-scope
`createPausedClaude` storage capability remains available for a future,
separately explicit add-workspace flow, but generic collection never calls it.
Legacy adoption uses the single-scope exact-rerun path.

Every closed collection response keeps `accountComplete` and
`executionAuthorized` false, with `detailRequests` and `downloads` equal to
zero. The popup routes add no manifest permission, content script, scheduler,
detail request, or download. User-facing strings are English and Japanese;
there is no Russian locale entry.

## Validation and limits

The affected worker matrix passed 467/467 tests across 22 files; the broader
run reported 1,891 passed and 2 existing skips. Parent exact-file validation
passed 358/358 across 14 files plus TypeScript and diff checks. `build:zip` and
the emitted-runtime check passed. After the Settings-listener and recovery-copy
corrections, the final ZIP is 2,822,639 bytes with SHA-256
`f11126da0d5f4554dd23f87af62a1725487f6c7f459b920229d3cfd9f189d5f7`.
Scoped lint added no warnings; four inherited warning categories remain.

This is local implementation evidence only. No visual review, browser run,
installed extension check, live current-account canary, second-account test,
or KYC test is claimed. Exact-head GitHub gates remain pending. The user's
deferred spare-account/KYC check is not part of the next canary.

After GitHub gates, the accepted installed canary is limited to the current
account: explicitly choose a label, copy the old catalog into a new slot, then
check the selected current tab in that slot. Expect the existing scope to be
retained as existing, or a scope mismatch with no write. After Claude, a fresh
installed ChatGPT regression remains required before detail/File baseline
work; ChatGPT scope evidence and its adapter remain separate.

## Evidence

- [PR-1 slot and owner contract](084-local-account-slots-and-scope-partitioned-owners.md)
- [PR-2 explicit legacy adoption](085-explicit-legacy-claude-catalog-adoption.md)
- [Account slot routes](../../src/background/account-slot-actions.ts),
  [popup catalog](../../src/popup/account-catalog.ts), and
  [Claude collector](../../src/background/claude-account-collector.ts)
- [Slot action tests](../../test/background/account-slot-actions.test.ts),
  [collector tests](../../test/background/claude-account-collector.test.ts),
  [popup tests](../../test/popup/index.test.ts), and
  [slot contract tests](../../test/lib/account-slot-contract.test.ts)
- [Legacy adoption storage tests](../../test/account-catalog-adoption/storage.test.ts)
