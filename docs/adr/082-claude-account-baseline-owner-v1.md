# ADR-082: Retain one admitted Claude account catalog in an immutable paused owner

## Status

Implemented on 2026-11-24 and accepted in an isolated native Chromium origin on
2026-11-25, outside the production runtime. One trusted synthetic click returned
the exact five-row PASS receipt below; no retry followed. No provider read takes
place in this slice.

## Context

The user explicitly authorized a full backup of the current-personal Claude
scope through normal Liska, including provider reads and File downloads in
resumable batches. [ADR-081](081-claude-account-catalog-admission.md) can now
admit the structurally closed result intended for a single future live
collector invocation. The product needs a place to retain that result before
another live read. It does not yet need a generic page/cursor accumulator,
an execution journal, or a fabricated snapshot manifest.

## Decision

Create one rollback-isolated IndexedDB domain, named
`liska-claude-account-baseline-owner-v1`, physical version 1, with one
out-of-line-key store `owner` (no indexes or auto-increment) and one permitted
key `baseline`. There is no adoption, migration, dual write, reset, deletion
or access to old domains. Rollback ignores this domain. Opening an unsupported
physical schema does not repair it.

The versioned envelope `liska-claude-account-baseline-owner/1` retains:

- A caller-generated `collectionId` matching
  `claude-account-collection/1:<32 lowercase hex>`. This is a reconciliation
  label, never authentication or authorization.
- The exact detached ADR-081 admitted result, including the catalog and the
  companion evidence. That evidence remains `caller-projected`, not proof of
  provider provenance. The catalog's `archived: unobserved` and the companion's
  terminal-empty archive projection remain separate facts.
- Phase `paused`, revision `0`, and ordered items that match the catalog targets
  exactly, each with only `conversationId` and `state: pending`. Markers appear
  only in the catalog. Both `accountComplete` and `executionAuthorized` are
  permanently `false` for this schema.

There are 0–30 targets with the established lowercase UUID and optional opaque
256-code-unit marker bounds. The encoding is canonical UTF-8 JSON stored as a
detached `Uint8Array`, with a 65,536-byte cap. At the maximum, 30 markers can
each escape to six bytes per code unit; the resulting envelope is 53,291 bytes
(12,245 bytes of headroom). Supported codec overrides only lower hard bounds.
Decoding rechecks the closed schema, reconciles items against the admission,
compares exact canonical bytes and returns a fresh deeply frozen snapshot.
There are no raw header or route fields, URLs, content, presentation data,
timestamps, cursor, operations, marker freshness claims or future placeholders.
Opaque markers remain subject to the exact ADR-081 projection boundary, not
substring certification.

### Storage and terminal truth

The [owner](../../src/claude-account-baseline-owner/index.ts) is the only source
consumer of the new structural admission snapshot validator, and has no
ordinary package, entry point, popup, worker, capture-manifest or scheduler
wiring. Opening/reopening never advances any state. The handle exposes only
`createPaused`, `read` and `close`.

Before a create transaction, validate and detach the full canonical envelope.
One strict-durability readwrite transaction checks exact inventory via a bounded
key cursor: empty, exactly the one permitted key, or corrupt as soon as an
extra/foreign key is proven. An empty store admits only an insert-only
`add`. An occupied store confirms only an exact match of collection label and
canonical bytes; a different seed is a conflict. Malformed or foreign data is
classified as corrupt or unsupported and stays intact. A compatible fallback
for IndexedDB versions that reject the options signature with `TypeError`
matches the previously accepted owner transaction pattern.

Request success is not commit evidence. A native `complete` returns the
committed or inspected state (even if cancellation lost the race). An observed
`abort` returns `transaction-aborted` and made no change. Cancellation,
timeout, closing and version change request an abort, then await the terminal
event. If terminal evidence is missing after a second bounded wait, return
`transaction-outcome-unknown` and fence/close the handle. No automatic retry,
replacement collection ID or recovery write follows: a fresh completed read
may establish stored truth. The code never grants provider, download, capture,
settlement, scheduling or execution authority.

## Acceptance and sequencing

The focused codec and fake IndexedDB tests cover empty, 12 and 30 targets,
worst-case escaping, exact bytes, detachment, closed data, caps, conflicts,
terminal races and inventory preservation. The focused owner/admission,
architecture, harness and documentation-link run passes 9 files / 290 tests.
TypeScript (including the harness entry), scoped zero-warning ESLint, Prettier
and the Idea Threads validator also pass. The independent harness packages the
actual owner with three files, zero permissions, zero host permissions and
`connect-src 'none'`. Its browser-origin data is entirely synthetic. It refuses
an existing owner database in that origin instead of reusing or clearing it.

1. In the repository run
   `node scripts/build-claude-account-baseline-owner-browser.mjs`.
2. In a dedicated test extension origin, load unpacked
   `test-results/claude-account-baseline-owner-browser/extension` (not
   Liska's production build). Open **Extension options** for “Synthetic
   Claude paused owner acceptance (test only)” in one tab. Click **Run
   synthetic checks** once, with no retry on failure.
3. Accept only `"ok": true` with `passed` exactly
   `["cancel","close","race","reopen","cleanup"]`. Each abort row waits for
   the independent native terminal observer and checks no record; the race
   and reopening verify one committed inventory. Cleanup removes only the
   just-created test domain and reads back its absence. The receipt carries
   no target IDs, marker bytes, collection label, profile or provider data.

The native gate completed once in an ephemeral Chrome for Testing 151 profile.
The exact result was `{"ok":true,"passed":["cancel","close","race","reopen","cleanup"]}`.
The three-file harness used zero permissions, zero host permissions and
`connect-src 'none'`; `runner.js` was 32,547 bytes with SHA-256
`01824d8b426cc4aaa04621d77fa04f443b071157a794af7b53651e67f0f51205`.
All temporary profiles were closed and removed. Local-only receipt
`LISKA-CLAUDE-ACCOUNT-OWNER-V1-NATIVE-20261125` retains only these safe facts.

The repository-wide run completed 12,687 tests with three skips and 13 failures
under sustained load: one real broad architecture allowlist omission, nine
owner/2 lifecycle timeouts and three Claude autoscroll timeouts. The allowlist
was corrected without widening the production scan and passed 4/4. The full
owner/2 lifecycle file then passed 65/65 in isolation. The isolated autoscroll
file completed 158/163 before five 30-second timeouts; each of those five exact
tests passed separately. Full lint passes with zero errors and the unchanged 55
warnings; production build/package passes. The resulting 65-file /
6,125,112-byte `dist` remains byte-identical to the installed reviewed `/5`
build because this owner and harness stay outside production closure. GitHub CI
remains the independent current-head single-run gate.

Accept this owner before another live list read. The separately reviewed,
explicitly user-started `/6` must acquire both replies and the exact header
pair in the pinned document, admit in that invocation, and commit through the
owner before public aggregate success. Only after that live gate should one
owner-bound detail capture and File delivery precede resumable manual batches.
Report progress over proven targets separately from account completeness.
No scheduler follows automatically.
