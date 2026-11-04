# ADR-051: Durable inert resumability journal before provider execution

- Status: Accepted for the second backup-foundation slice
- Date: 2026-11-04
- Related: ADR-031, ADR-043, ADR-050, ITH-005, ITH-007

## Context

The manifest catalog can deterministically inventory one explicitly selected
local archive root, but it neither authorizes recapture nor knows which provider
conversations are accessible in an account. The next backup layer needs durable
work bookkeeping that survives an extension/page restart without pretending
that provider enumeration, update discovery, request budgets or a scheduler
already exist.

Existing persistence seams have different authority:

- the export-operation controller stores short-lived tab/document/settings
  grants in `chrome.storage.session` and deliberately restores those grants;
- the operation write ledger is closure-owned runtime accounting, not archive
  provenance or remaining-work state;
- archive/binary download recovery registries own 24-hour Blob/stage cleanup,
  not capture success;
- OPFS stage stores hold temporary bytes and cleanup metadata.

None can be lengthened or renamed into a multi-day backup journal without
changing its meaning.

## Decision

Add a new browser-independent journal state machine, a dedicated
extension-origin IndexedDB adapter and a separate private page. No journal code
enters content scripts, provider extractors, the service-worker startup path,
existing recovery or the manifest catalog closure.

### Explicit admission

Version 1 creates a journal only after a trusted user action selects and
byte-validates a deterministic `liska-snapshot-catalog/1` file, then explicitly
chooses to create a paused journal. One unique valid provider/conversation key
becomes one work item. Invalid catalog entries are not admitted; multiple
captures of one conversation do not create duplicate work.

The admission record retains only:

- fixed source `explicit-catalog-selection`;
- exact catalog SHA-256;
- provider, provider conversation ID and versioned conversation key;
- local run/item identifiers supplied before persistence.

Catalog selection is explicit scope bookkeeping, not proof of account binding,
recoverability, recapture permission or provider completeness. Stable provider
identifiers remain private local data. No title, URL, path, content, endpoint,
directory handle, cookie, token, signed URL or transport value enters the
journal.

### Pure state machine

The journal schema is `liska-resumability-journal/1`. A run has an exact
revision and control state `paused`, `active`, `cancelled` or `completed`.
Every item has its own revision, immutable admission and ordered attempts. An
attempt has a unique ID/revision, a reserved capture ID, state `running` or
`settled`, and one fixed outcome:

- `confirmed` — requires bounded typed evidence references;
- `unknown` — the side effect may have happened but is not proven;
- `not-dispatched` — persistence proves no dispatch was authorized;
- `deferred` — no dispatch occurred; a fixed reason and optional explicit
  `notBefore` observation remain;
- `failed` — a terminal fixed failure code, never native exception text.

Creating a journal always yields `paused`. A future executor must persist a new
`running` attempt and receive its exact run/item/attempt revision token before
any side effect. Failure to commit means no dispatch. Observation accepts only
that exact token; stale callbacks cannot settle a newer attempt. An explicit
retry creates another attempt and never resets or overwrites an unknown one.

`recoverAfterRestart` always opens the run paused. Every running attempt becomes
settled `unknown`, run/item/attempt revisions advance, and no work is dispatched
or retried. Pause/cancel similarly fence unfinished callbacks and preserve all
confirmed/unknown evidence; they are not rollback claims.

Typed evidence is only a bounded reference: kind, exact digest, byte length,
optional capture ID and optional destination enum. It does not independently
verify archive integrity or genericize provider-specific receipts.

### Persistence

Journal records live in a dedicated extension-origin IndexedDB database and
object store. Schema-v1 creation/version handling is isolated in one adapter.
Each mutation is one read-write transaction that loads the current record,
checks the expected revision, applies the pure transition and writes the exact
next record. Competing pages therefore receive a fixed revision-conflict rather
than last-write-wins behavior.

The adapter closes on version change, fails closed on blocked upgrades,
malformed/corrupt records, transaction aborts and quota/write errors, and never
silently resets the database. No service-worker startup listener opens or
recovers it. Opening the dedicated page invokes restart recovery and renders
the paused result; it never activates or executes work.

The journal survives ordinary extension/page restarts, but it is not a backup
and does not protect against browser-profile deletion. Version 1 retains at
most 16 runs, 2,048 items per run, 8 attempts per item and 8,192 attempts per
run, with an 8 MiB encoded-record ceiling. It performs no automatic deletion;
creating beyond the bound refuses.

### Private page

The journal page may:

- select and validate one private catalog JSON;
- display bounded identity-free counts before a trusted create action;
- create a paused journal from the deduplicated valid catalog identities;
- list runs and fixed aggregate states;
- reopen/recover records into paused/unknown state;
- export a deterministic private journal snapshot for inspection.

It does not expose Activate, Begin attempt, Retry, Schedule or Provider controls
in this slice. It has no runtime messaging, provider/network access, content
capture, tab opening, destination write, alarms or archive mutation. Journal
creation/persistence is the only local write authority and is clearly disclosed.

## Rejected alternatives

- Persisting inside the catalog would break its proven zero-storage boundary and
  turn a rebuildable index into competing authority.
- `chrome.storage.local` plus an in-memory Promise queue cannot prove atomic
  revision conflicts across two open pages.
- OPFS and download-recovery registries carry staging/cleanup semantics and are
  not transactional work records.
- Restoring active/running state after restart would silently reacquire execution
  authority.
- A generic provider cursor/update token before one real provider adapter would
  encode speculation as contract.

## Acceptance gates

1. Pure contract tests cover every state transition, exact revisions, stale
   callbacks, explicit new attempts, pause/cancel, restart-to-unknown, evidence
   validation, limits and deterministic encoding.
2. IndexedDB adapter tests cover schema creation, atomic expected-revision CAS,
   two-store conflicts, blocked/version-change behavior, corrupt records,
   abort/write/quota failures and restart recovery. `fake-indexeddb` may provide
   deterministic unit coverage; installed browser evidence remains separate.
3. Architecture checks prove zero import path to provider capture, content,
   runtime messaging, service-worker startup, alarms, destinations, OPFS stages
   or existing recovery registries.
4. The private page proves trusted catalog selection/create, fixed-field
   rendering, no automatic activation, stale-result rejection and private
   deterministic export with exact terminal states.
5. Installed acceptance creates a paused journal from a real catalog, reloads
   the extension/page, and confirms persistence plus paused recovery.
   Deterministic IndexedDB conflict tests separately prove that one expected
   revision wins across two store handles. Core and adapter recovery tests prove
   that a committed-running fixture becomes unknown without dispatch or retry;
   the v1 page intentionally exposes no execution control with which to
   fabricate that state in production.

## Accepted evidence — 2026-11-04

Installed Comet selected the deterministic catalog produced by ADR-050. The
page admitted 24 unique valid conversations from 121 valid capture occurrences,
created one revision-0 paused journal with zero attempts, then survived an
extension reload that closed the page. Reopening the page recovered the same 24
paused items from its dedicated IndexedDB.

The private export produced 7,366 canonical bytes with SHA-256
`3d93db2fd8dfee4804584d02d3ef3c1982b2f3e81571ea779b5003d0d20e2c7b`.
The production decoder accepted the physical file and the production encoder
reproduced every byte. Its catalog digest matched the accepted ADR-050 catalog.
No provider page, network route, scheduler, capture or destination was invoked.

A final integration review also found that Chromium clears a live `FileList` in
place when the file input is reset. The page now owns the selected `File`
references before resetting the input; a live-list regression and installed
chooser acceptance close that production-only ordering defect.

## Deferred provider execution

This decision implements durable resumability mechanics only. A separate ADR
and PR must establish one provider's account/workspace binding, pagination,
duplicate/reorder behavior, cursor expiry, deletion/archive visibility,
rate-limit handling and exact update-marker semantics before it can enumerate or
execute journal items. Account-wide baseline execution and scheduling still
require the user's separate explicit choice.
