# ADR-072: Accept provider owner/2 through a native storage-only harness

## Status

Accepted on 2026-11-09 as a separate opt-in synthetic harness. Its exact
compiled bundle, offline browser simulation and one continuously visible
installed-Comet run are accepted only for provider-owner/2 storage semantics.

## Context

ADR-071 added the fresh rollback-isolated `liska-baseline-owner-v2` database and
proved its reservation-only behavior with fake IndexedDB. That evidence did not
establish Chromium's physical IndexedDB cursor/transaction scheduling,
extension-page CSP, native WebCrypto boundary, real multiple connections,
close/reopen behavior or visible timer gaps.

Loading the production extension would mix this gate with unrelated provider,
destination, messaging and UI authority. Reusing the accepted ADR-068 harness
would also pull its journal/2 owner, coordinator, capture and synthetic sink
machinery into a storage-only question. A copied mini-owner would prove the
fixture instead of the real owner/2 implementation.

## Decision

### Build a second independent zero-permission MV3 extension

Add one direct opt-in Node builder and one test-only Options page under a new
directory. Do not import, refactor or change the accepted ADR-068 builder or
harness. The new builder does not load production Vite/CRX configuration and is
not added to package scripts. It emits exactly four files beneath guarded
`test-results` output:

- `manifest.json`;
- `index.html`;
- `assets/runner.js`;
- `assets/style.css`.

The manifest is exact: MV3, empty `permissions`, empty `host_permissions`, one
tab-opened Options page and a fixed CSP with `connect-src 'none'`, no objects,
frames, remote images, inline code, forms or external base URL. The output audit
rejects extra files, chunks, maps, remote references, extension/Web Storage,
clipboard, worker, dynamic-code and runtime-import authority.

The default output is
`test-results/provider-baseline-owner-browser/extension`. The shared safe-output
policy rejects repository/production roots, unrelated nonempty directories and
symlink ancestors or children. Rebuilding an exact output is deterministic and
never clears unknown content.

### Compile the real owner/2 closure without ambient replacements

The runner imports the real provider owner, catalog encoder, plan/checkpoint/2,
journal/3 record encoder and pure ChatGPT/Claude evidence adapters. It copies no
state machine and performs no source transform. The exact resolved closure is
37 source modules plus one HTML runtime module; any missing, additional,
external, dynamic or old-owner/coordinator/capture/destination dependency fails
the build.

This differs intentionally from ADR-068. Owner/2's closure already has no
messaging, provider request, capture or destination defaults, so a source-pinned
replacement layer would add machinery rather than remove authority.

Before any IndexedDB open, the page installs counted throwing replacements for
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and
`navigator.sendBeacon`. Installation failure fails closed. Manifest CSP and a
zero-call runtime receipt independently deny network effects.

### Exercise two deterministic native lifecycles

Each run creates one cryptographically random database name under the exact
`liska-baseline-owner-v2-native-acceptance-*` suffix grammar. A guarded factory
permits only that exact name and version 1; production/legacy names, a foreign
name, a wrong or omitted version and foreign deletes are refused before a
native request. The same test name is deleted and recreated for an independent
second lifecycle.

The first lifecycle:

1. encodes a deterministic mixed ChatGPT/Claude catalog whose equal conversation
   IDs retain distinct provider-aware keys and deterministic plan order;
2. creates the real owner paused, prepares a second handle through byte-preserving
   paused recovery and activates revision 1;
3. holds one handle inside a real SHA-256 continuation after its native read,
   lets the second handle commit one complete ChatGPT reservation and requires
   the stale continuation to fail exactly with `revision-conflict`;
4. independently reads both native stores and checks canonical operation bytes,
   owner bytes, link, charge and latest observation digest;
5. proves exact and absent read-only inspection change no bytes;
6. closes/reopens, proves mutation requires explicit recovery, recovers active to
   paused while preserving the reservation, and proves repeated paused recovery
   is byte-identical;
7. reactivates and proves the outstanding reservation blocks another item with
   no write or automatic continuation.

The second fresh lifecycle creates a Claude-only plan. It holds a reservation
hash, pauses the same handle, releases the stale continuation and requires exact
`invalid-input` with zero records. A fresh handle then preserves already-paused
recovery, activates and commits one genuine revision-0 active/open/reserved
Claude journal/3 record. Fenced handles are never reused.

Cleanup releases every gate, drains pending work, closes all owner/native
handles and deletes only the exact guarded database after each lifecycle. The
first deletion deliberately resets the same guarded name for the independent
second lifecycle; PASS requires both deletions, and the scenario never reopens
after the final deletion.

### Require visible bounded scheduling and a content-free receipt

The Options tab must remain visible throughout the run. A latched hidden state,
clock regression, total duration above 15 seconds, scheduling gap above one
second or a final ten-millisecond probe outside 5–1,000 ms makes the outcome
`INCONCLUSIVE`, never PASS.

The page renders a fixed 13-row vocabulary and capped nonnegative integers only.
It returns no database, operation, capture or conversation ID, path, URL, hash,
raw byte, exception prose or serialized snapshot. Unexpected failure becomes one
generic code.

## Compatibility and boundaries

No production source, manifest, package script, Vite configuration, lockfile,
committed `dist` artifact or accepted old harness file changes. Six architecture
guards exempt only the exact new direct-builder path while retaining all source,
manifest, config and generated-output scans.

This harness grants no provider, account, capture-page, execution, download,
Obsidian, clipboard, messaging, retry, settlement, migration, pruning,
automatic continuation, scheduler or living-memory authority. File and vault
facts are not simulated because they are outside this storage gate.

Removing the test source/generated output removes only the harness. The
production extension and owner/2 database schema remain unchanged.

## Rejected alternatives

- Loading the production extension would mix unrelated authority into the gate.
- Reusing ADR-068 would import the old owner and coordinator instead of testing
  owner/2 storage alone.
- Node/fake-IDB acceptance cannot establish native IndexedDB or visible browser
  scheduling.
- A copied mini-owner would test a second implementation.
- A hopeful concurrent `Promise.all` would not prove both handles observed the
  same revision; explicit post-read SHA gates make the interleaving deterministic.
- Returning IDs, paths, digests or errors would turn the receipt into a data
  disclosure surface.
- Continuing from the stored reservation would create an execution runner and
  exceed this gate.

## Evidence and validation

- The focused matrix passes 13 files / 152 tests across both harnesses, six
  architecture boundaries and the provider-owner suite. The new harness file
  contributes 46 cases.
- TypeScript, strict scoped zero-warning ESLint, focused Prettier and diff checks
  pass. Independent review reports ready with no material finding.
- Offline compiled JSDOM execution with native WebCrypto and fake IndexedDB
  passes all 13 rows, verifies both-store bytes, exact CAS/recovery outcomes,
  denial installation/restoration, failure sanitization, cleanup failure and
  hidden/late/regressed scheduling boundaries.
- Full coverage passes 358 files with one skipped and 12,159 tests with three
  skipped: 95.29% statements, 91.91% branches, 98.41% functions and 97.49%
  lines. The first full pass exposed three missing exact test-builder exceptions;
  after narrow corrections, the second full pass is clean.
- Global lint has zero errors and the unchanged 55 warnings. Full Prettier and
  the production dependency audit with zero vulnerabilities pass.
- The direct harness build contains 37 source and 38 runtime modules. Its
  155,137-byte `assets/runner.js` has SHA-256
  `f3fc628d099d08c4832ea6db57a849d482371b54baa707be9c0a9fe27a168e97`.
  The complete four-file inventory is pinned by deterministic tests.
- The guarded production build/ZIP passes. Fresh `dist` contains 65 files /
  6,087,953 bytes and zero harness markers. The 2,792,264-byte ZIP has SHA-256
  `fc07883da5fa691ffc50ce6b889a5cd89ef36157b2de507f15db093d9e7358dd`.
- The exact generated directory was installed as a separate unpacked extension
  in Comet after explicit user confirmation. One continuously visible Options-
  page run returned overall PASS with all 13 rows PASS, `elapsedMs: 249` and
  `maxGapMs: 21`. The guarded database row refused seven foreign/wrong-version
  operations before any native open; cleanup observed 18 exact opens, two exact
  deletes and two completed deletions. Network calls remained zero.
- Local receipt `LISKA-PROVIDER-OWNER-V2-NATIVE-20261109` retains only the fixed
  row/status/integer payload. It contains no provider, conversation, database,
  operation, capture, path, URL, digest, raw byte or exception content.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates for this branch.

## Next gate

Design a new owner/2 lifecycle/evidence port that can claim and consume one
reserved journal/3 operation and atomically retain its factual observation
without automatic continuation, settlement or retry. The storage-only native
PASS does not authorize a real Claude request, provider/account scope, a
multi-item runner, an account-wide baseline or scheduling.
