# ADR-074: Accept owner/2 lifecycle semantics through a native harness

## Status

Accepted on 2026-11-11 as a separate opt-in synthetic harness. Its exact
compiled bundle, offline browser simulation and one continuously visible
installed-Comet run are accepted only for the provider-owner/2 lifecycle,
single-use token, native transaction and factual-evidence boundaries added by
ADR-073.

## Context

ADR-073 added one provider-closed five-method port to the unwired owner/2
domain. Unit and fake-IndexedDB coverage established its state machine, but did
not prove native Chromium transaction terminal ordering, real multi-connection
CAS, opaque token fencing, physical two-store rollback, extension-page CSP or
visible timer behavior.

ADR-072's historical native PASS covered reservation-only storage before this
port existed. Reusing that result, widening the accepted storage harness or
loading production Liska would mix distinct evidence and authority boundaries.
A copied lifecycle implementation would prove a fixture rather than the real
owner/2 closure.

## Decision

### Build a third independent zero-permission MV3 extension

Add one direct opt-in builder and one test-only Options page under new paths.
Do not import, refactor or change either accepted native harness. The builder
does not load production Vite/CRX configuration and is absent from package
scripts. It emits exactly four files beneath the guarded
`test-results/provider-baseline-owner-lifecycle-browser/extension` output:

- `manifest.json`;
- `index.html`;
- `assets/runner.js`;
- `assets/style.css`.

The exact MV3 manifest has empty `permissions`, empty `host_permissions`, one
tab-opened Options page and a restrictive CSP with `connect-src 'none'`. The
build rejects extra files, chunks, maps, dynamic/runtime imports, remote
references and browser, extension, Web Storage, clipboard, worker or
dynamic-code authority.

The runner compiles the unchanged real owner/2 lifecycle and pure evidence
closure without source transforms or ambient replacements. Its exact closure is
39 source modules and 40 runtime modules. Six architecture guards exempt only
the exact new direct-builder path while retaining production, source,
configuration and generated-output scans.

Before any database access, the page installs counted throwing sentinels for
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and
`navigator.sendBeacon`. Installation failure fails closed. The guarded factory
admits only one cryptographically random lifecycle-test database name and
version 1; production, legacy, foreign, wrong-version and final-cleanup access
is refused before a native request.

### Exercise one fixed 13-row lifecycle matrix

The visible run uses deterministic isolated lifecycles and the fixed rows:

1. `guarded-database`;
2. `claim-consume-once`;
3. `pause-late-evidence`;
4. `restart-late-evidence`;
5. `claim-committed-revoked`;
6. `consume-final-fence`;
7. `two-handle-claim-cas`;
8. `consume-inventory-fence`;
9. `interruption-observation`;
10. `evidence-atomic-abort`;
11. `cleanup`;
12. `visibility-deadline`;
13. `network-denial`.

The scenarios call the real owner/2 port. Synthetic consume callbacks only
increment bounded in-memory counters and return strict synthetic ChatGPT or
Claude factual receipts. They perform no provider request, page capture,
attachment acquisition, download or destination write.

Native post-read SHA gates establish two-handle claim ordering. Scoped one-shot
wrappers delegate real `IDBObjectStore.put` and `IDBDatabase.transaction`
methods; they observe native requests and terminal events without replacing
owner methods, transactions or event outcomes. Claim and consume fences,
pause/restart/interruption, late provider-selected evidence and every successful
mutation are checked against independent complete byte inventories of both
stores.

The atomic-abort row aborts the real evidence transaction after the operation
replacement request succeeds. PASS requires the exact `transaction-aborted`
outcome, one observed request success, one real abort terminal, no complete
terminal and byte-identical operation and owner stores. The fenced lifecycle is
not retried, repaired or reopened.

Cleanup releases gates, drains pending work, restores wrappers, closes every
owner/native handle and observes deletion of only the exact guarded database.
The page never reopens after final deletion.

### Treat the first native failure as evidence, not noise

The first installed-Comet run of the reviewed candidate passed 12 of 13 rows
and failed only `evidence-atomic-abort`. Cleanup still completed and network
calls remained zero. The failure exposed a harness observation race: the
owner's earlier native `onabort` handler may reject its Promise before the
later test observer increments its abort counter. Fake IndexedDB delivered the
listeners in a different order and hid that boundary.

The correction adds an independently awaited promise resolved only by the same
real transaction's `complete` or `abort` observer. The wait remains bounded by
the existing 1.5-second deadline. It does not add a sleep or weaken the exact
error, request-success, terminal-count or two-store byte-equality assertions.
Regression cases delay that observer, omit it, mutate the operations store and
mutate the owner store; only delayed delivery may PASS.

### Require visible bounded scheduling and content-free receipts

The Options tab must remain visible. Hidden state, clock regression, total
duration above 15 seconds, a scheduling gap above one second or the bounded
final probe outside 5–1,000 ms makes the timing outcome `INCONCLUSIVE`, never
PASS. Independently observed correctness, cleanup or network failures remain
FAIL.

The receipt contains only a fixed schema, row/status/code vocabulary and capped
nonnegative integer metrics. It contains no provider payload, conversation,
database, operation, attempt or capture identity, path, URL, digest, raw byte,
exception prose or serialized snapshot.

## Compatibility and boundaries

No production source, manifest, package script, Vite configuration, lockfile,
database schema, envelope, plan, checkpoint or journal/3 contract changes. The
accepted older harnesses stay byte-identical. Production `dist` contains no
lifecycle-harness marker.

This acceptance grants no provider/account access, page traversal, capture,
attachment, destination, download, Obsidian, messaging, settlement, retry,
automatic continuation, account-wide baseline, scheduler or living-memory
authority. Synthetic receipts prove only provider-selected local adaptation and
atomic retention. Close/reopen recovery simulation is not a browser crash or
power-loss proof, and at-most-one callback is not exactly-once external effect.

## Rejected alternatives

- Reuse ADR-072's PASS: it predates the lifecycle port and token races.
- Widen an accepted harness: it would erase the meaning of its historical
  evidence and couple unrelated gates.
- Load production Liska: unrelated provider, destination, messaging and UI
  authority would enter a storage/lifecycle question.
- Accept fake IndexedDB alone: its listener ordering masked the native race.
- Add timer sleeps around abort: timing luck is not terminal-event evidence.
- Drop terminal counts or byte equality: that would turn the discovered failure
  into an assertion bypass rather than a fix.
- Run a real provider request: provider/account scope and request budget are a
  later explicit decision.

## Evidence and validation

- The corrected compiled harness passes 65/65 cases. A focused current-source
  matrix across the harness, owner lifecycle and fault suites passes 3 files /
  115 tests. The unrelated headroom test that timed out under the overloaded
  full-coverage worker passes 3/3 in isolation.
- The pre-native candidate had a clean full coverage run across 361 files plus
  one skipped and 12,283 tests plus three skipped: 95.31% statements, 91.93%
  branches, 98.43% functions and 97.50% lines. The correction changes only the
  test harness and its tests. A later all-suite coverage attempt was stopped
  after multiple timeout-only failures under host contention; it is not counted
  as acceptance evidence.
- TypeScript and the production build pass. Global lint has zero errors and the
  unchanged 55 warnings; the new harness has zero warnings under its scoped
  lint. Full Prettier and diff checks pass.
- Production-only dependency audit reports zero vulnerabilities. The complete
  development tree currently reports 13 moderate `minimatch` findings through
  lint/architecture tooling with `No fix available`; it reports no high or
  critical vulnerability and no dependency was force-updated in this slice.
- Independent review reports ready with no material finding. It confirms the
  bounded terminal wait preserves exact `transaction-aborted`, `[1,0,1]`,
  request success and independent two-store rollback checks.
- The exact corrected bundle contains 39 source / 40 runtime modules. Its
  184,971-byte `assets/runner.js` has SHA-256
  `73d7b56c23a7512751c2882f6f088768223ffd5f4ccde06a38be932f4a3d07c8`.
- The guarded production build/ZIP passes. Fresh `dist` remains 65 files /
  6,087,953 bytes with zero lifecycle-harness markers. The 2,792,264-byte ZIP
  has SHA-256
  `18dbd0606502eb4a0ab87948ee0acbed4dd96fba7c157e26012fd66be9c9f6b5`.
- After explicit user confirmation, only the separate lifecycle harness was
  reloaded in Comet. One continuously visible run returned overall PASS with
  all 13 rows PASS, `elapsedMs: 1356` and `maxGapMs: 26`. Cleanup observed 77
  exact opens, nine exact deletes and nine completed deletions; seven guarded
  operations were denied and network calls remained zero.
- Local receipt `LISKA-PROVIDER-OWNER-V2-LIFECYCLE-NATIVE-20261111` retains only
  the fixed row/status/integer payload. The earlier local FAIL receipt is kept
  separately as regression provenance and contains the same content-free
  boundary.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates for this branch.

## Next gate

The native lifecycle precondition is satisfied. Designing or running one manual
provider-bound baseline operation still requires a separate explicit decision
that names the provider, active account/scope evidence, request and page budget,
capability bundle, stop conditions and receipt boundary. No account-wide
baseline or scheduler follows automatically.
