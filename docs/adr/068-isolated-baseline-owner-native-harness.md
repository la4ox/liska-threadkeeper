# ADR-068: Accept owner-backed execution through an isolated native harness

## Status

Accepted on 2026-11-07 as a separate opt-in synthetic harness. Its compiled
logic, offline browser simulation and one visible installed-Comet run are
accepted within the synthetic owner/coordinator boundary.

## Context

ADR-067 connected one durable baseline-owned reservation to the existing
execution coordinator, but every acceptance check still ran in Node with fake
IndexedDB. That proved contracts and transaction logic, not Chromium's physical
IndexedDB scheduling, extension-page CSP, close/reopen behavior or timer gaps.

Loading the production extension would be the wrong test. It carries provider,
destination, messaging and UI authority unrelated to this gate, and a synthetic
run must not touch a real account, the production owner database, downloads or
an Obsidian vault. A browser fixture that reimplemented the owner or coordinator
would prove only the fixture.

The production import closure also contains dormant ambient defaults. They are
not selected by the synthetic capabilities, but bundling them unchanged would
make the test extension appear to contain authority it must never exercise.

## Decision

### Build a separate zero-permission MV3 extension

Add one direct opt-in Node builder and a test-only Options page. The builder does
not load the production Vite/CRX configuration and is not added to package
scripts. It emits exactly four files under a guarded `test-results` directory:

- `manifest.json`;
- `index.html`;
- `assets/runner.js`;
- `assets/style.css`.

The manifest is exact rather than permissive: MV3, empty `permissions`, empty
`host_permissions`, one tab-opened Options page and a fixed CSP with
`connect-src 'none'`, no objects, frames, remote images, inline code, forms or
external base URL. The build audit rejects extra files, chunks, source maps,
remote references, extension APIs, Web Storage, clipboard, dynamic code and
runtime imports.

The default output stays under the dedicated harness result directory. A caller
may instead supply its own external directory for a disposable build; that path
must be outside and must not contain or be contained by the repository. Existing
nonempty output must already be the exact harness inventory. Production roots,
repository paths, unrelated nonempty directories and symlink ancestors or
children are rejected. Rebuilding an existing exact output is deterministic;
the builder never clears an unknown directory.

### Compile the real owner and coordinator, deny ambient defaults exactly

The runner imports the real catalog encoder, baseline owner, branded execution
store port, ChatGPT coordinator, capture normalizer/producer path and evidence
logic. It does not copy their state machines.

Four dormant ambient seams in that closure are replaced only in this test build:

- extension messaging;
- export-operation ambient scope defaults;
- the structured-capture manifest permission probe;
- default runtime binary persistence.

Every replacement is pinned to the LF-normalized SHA-256 of the exact production
source. Unknown, missing, duplicate or drifted replacements fail the build. Each
replacement calls one counted throwing sentinel, and a PASS requires zero
sentinel calls. The real owner, store port, coordinator, capture validation,
normalization, producer, stage and evidence logic are not transformed.

The page separately replaces `fetch`, `XMLHttpRequest`, `WebSocket`,
`EventSource` and `navigator.sendBeacon` with counted throwing sentinels before
the scenario starts. Manifest CSP and runtime counters therefore provide two
independent network-denial layers.

### Exercise two bounded synthetic lifecycles

Each run creates one cryptographically random database name under the exact
`liska-baseline-owner-v1-native-acceptance-*` prefix. A guarded IDB factory
allows only that name and version 1; attempts to open or delete the production
name, a different version or another database must be refused before any native
request. Cleanup closes every owner and deletes only the exact test database.

The first lifecycle:

1. encodes a deterministic two-item synthetic catalog;
2. creates the owner paused, activates it and atomically reserves one item;
3. runs the existing coordinator with a staged synthetic raw response just over
   the real 16 MiB inline threshold;
4. reads all selected artifact bytes independently at the synthetic sink and
   verifies each length and SHA-256 before returning observations;
5. retains committed awaiting-resolution evidence;
6. reserves the second item only through a separate explicit call;
7. closes and reopens the database, performs paused recovery and proves that no
   request, sink or stage effect grew and no old token became usable.

The second lifecycle starts from a deleted fresh database, claims one dispatch,
closes while its already-started synthetic effect is held, then reopens. Restart
recovery must convert the retained in-flight operation to unknown/restart,
preserve one link/charge, reject old and foreign capabilities, and start no new
effect.

File and Obsidian observations are explicitly simulated in memory. They prove
selected-byte and receipt integration only; they are not download-path or vault
acceptance.

### Require visible bounded native scheduling and a content-free receipt

The Options tab must remain visible for the entire run. A latched hidden state,
clock regression, total duration over 15 seconds, scheduling gap over one second
or a final ten-millisecond timer probe outside its bounded window makes the result
`INCONCLUSIVE`, never PASS. A fixed heartbeat closes owner handles and releases
held synthetic effects when timing becomes unprovable.

The page renders a fixed row set and nonnegative capped integers only. It never
returns database names, operation/capture/conversation IDs, paths, URLs, hashes,
raw bytes or exception prose. Any unexpected top-level exception becomes one
generic failure code.

## Compatibility and boundaries

No production source, manifest, package script, Vite configuration or committed
`dist` artifact is changed. The harness build test snapshots the current local
`dist`, production manifest/config/package/lock inputs and proves that invoking
the direct builder leaves them byte-identical. The two architecture tests exempt
only the exact direct test-builder path while continuing to scan all production
closures and output.

The harness grants no provider, account, capture-page, download, Obsidian,
clipboard, storage, messaging, scheduler, retry, settlement or deletion
authority. It does not establish provider discovery, real destination delivery,
private-data handling, production-extension permissions or a usable manual
baseline runner.

Removing the harness removes only test source and generated test results. The
production extension and all baseline owner bytes remain unchanged.

## Rejected alternatives

- Loading the production extension would mix this gate with unrelated authority.
- A Node-only test cannot establish native IndexedDB and browser scheduling.
- A copied mini-owner/coordinator would test a second implementation.
- A generic mock of ambient modules could silently drift as production exports
  change; exact source pins make that drift a build failure.
- Giving the test extension `storage`, scripting or host permissions is
  unnecessary and would weaken the acceptance claim.
- Returning detailed errors, hashes or IDs would make the receipt itself a data
  disclosure surface.
- Automatically continuing from the second reservation would create a runner
  and expand scope beyond this gate.

## Non-goals

This decision does not bind a live ChatGPT page, enumerate conversations, choose
an account, discover updates, run an account-wide baseline, write a real File or
Obsidian destination, settle or retry operations, add retention/deletion, create
a scheduler or begin the living-memory project.

## Evidence and validation

- The focused matrix passes 18 files / 363 tests across the harness, owner,
  coordinator and both architecture boundaries.
- TypeScript, scoped ESLint with zero findings, focused Prettier and diff checks
  pass.
- The deterministic build contains four files. `assets/runner.js` is 685,683
  bytes with SHA-256
  `83f69312946abf98e0b94d3834085486b508f8afc65f40f830c7665401f6d3ad`.
- Offline JSDOM/native WebCrypto/fake-IDB execution passes every fixed row,
  verifies the selected bytes and leaves no database. Failure, hidden/late/
  regressed scheduling and forbidden-effect cases fail closed or become
  inconclusive without exposing exception content.
- Independent review reports ready with no material finding. It independently
  checked the diff, Node syntax, exact four-file build inventory, authority audit
  and all four source-context pins.
- Full coverage passes 343 files with one skipped and 11,833 tests with three
  skipped: 95.24% statements, 91.84% branches, 98.38% functions and 97.46%
  lines. One first-pass pre-existing v2 headroom test exceeded its 30-second
  timeout under full local load; its exact isolated rerun passed 3/3 and the
  unchanged second full coverage command passed cleanly.
- Global lint has zero errors and the unchanged 55 warnings. Full Prettier, Idea
  Threads at 9 threads / 37 relations, documentation links at 88/88,
  production dependency audit with zero vulnerabilities and the guarded
  production build/ZIP pass. Fresh `dist` contains 65 files / 6,087,953 bytes
  with zero harness markers. The 2,792,264-byte ZIP has SHA-256
  `2920e34fc8816916f3774586347204ffbfa3c05edf051eaea983831c1a1fe493`.
- The exact generated directory was loaded as a separate unpacked extension in
  Comet after explicit user confirmation. Its details page reported no special
  permissions and no additional site access. One continuously visible Options-
  page run returned overall PASS with all 14 fixed rows PASS, `elapsedMs: 842`
  and `maxGapMs: 146`. The guarded database row refused three foreign/wrong-
  version operations before any native open; cleanup observed four exact opens,
  two exact deletes and the same three denials. Network and denied-ambient call
  counts stayed zero. This closes native MV3 CSP, physical IndexedDB,
  close/reopen/restart and bounded timer scheduling for this synthetic build.
- Local receipt `LISKA-BASELINE-OWNER-NATIVE-20261107` retains only the fixed
  row/status/integer payload; it contains no provider, conversation, database,
  operation, capture, path, URL, digest, raw byte or exception content. A
  separate local-only screenshot proves the visible PASS and is not committed.

## Next gate

Design a manual one-operation provider runner only after a new explicit scope,
account, capability and request-budget decision. The installed synthetic PASS
does not authorize provider traversal, real File/Obsidian delivery, automatic
continuation, an account-wide baseline or scheduling. The test extension may
remain inert or be removed separately after user confirmation.
