# ADR-043: Snapshot analysis never authorizes mutation

## Context

Append-only archive snapshots deliberately retain provider drift, partial
captures, acquisition outcomes, normalizer changes, and recovery evidence. They
can also consume substantial local space. A future user-invoked deduplicator
needs evidence stronger than matching titles, filenames, raw hashes, semantic
counts, or apparently identical Markdown.

Existing ChatGPT reconciliation compares one web canonical archive with one
official-export archive. Its asymmetric contract is not a same-source snapshot
deduplicator and remains unchanged. Destination receipts are runtime evidence,
not durable files for every historical snapshot, while Markdown and HTML may
contain incoming capture-specific references outside the selected folders.

## Decision

1. The first slice is a browser-independent pure analyzer:
   `analyzeSnapshots()` accepts only explicit selected byte inventories and
   `encodeSnapshotAnalysisPlan()` emits a deterministic local report. It has no
   filesystem, browser, storage, network, delete, move, quarantine, or rewrite
   capability.
2. Every report declares `analysisOnly: true`, `mutationAuthorized: false`,
   `referenceCoverage: selected-inputs-only`, and `preserveBoth: true` for every
   relation. Even `byte-identical` is a candidate observation, never cleanup
   authority.
3. Input admission accepts exact own-data shapes, copies every native
   `Uint8Array` before the first await, rejects shared/resizable/detached or
   incompatible buffers, and fails closed on accessors, symbols, sparse arrays,
   non-plain records, extra keys, and trapping proxies. Portable JavaScript
   cannot identify a fully transparent Proxy; the API does not claim otherwise.
4. A trusted injected SHA-256 capability receives an isolated copy. Mutation,
   rejection, malformed output, and operation-limit failures are detected. The
   API cannot prove a malicious callback implements SHA-256; exact byte equality
   still confirms every digest-grouped duplicate candidate.
5. JSON bytes use fatal UTF-8 decoding, reject BOM, duplicate decoded keys and
   unsafe object keys, and enforce aggregate depth/value/string/work limits
   before schema use. Supported manifest and canonical files must match the
   exact current writer encoding.
6. Version 1 supports ordinary current-writer ChatGPT web snapshots only. It
   recomputes every supplied file length/hash, rebuilds and verifies raw plus
   fetched assets, validates canonical provenance, replays the allowlisted
   normalizer, and requires byte-exact canonical equality. Raw-only,
   unsupported, malformed, missing, opaque, presentation-bearing, or replay-
   drifting inventories remain preserved as partial/unverifiable evidence.
7. Sparse relations are limited to one prior candidate rather than an all-pairs
   report:
   - `byte-identical`: complete verified inventories have equal internal slots
     and exact bytes;
   - `same-raw-different-evidence`: raw bytes match while other verified
     evidence differs;
   - `semantic-candidate`: same verified conversation and versioned canonical
     projection match while raw differs;
   - `unverifiable`: an exact inventory match is not fully verified.
8. The public inventory digest commits only the sorted multiset of byte lengths
   and content digests. Private/title-derived input slot names remain internal
   to exact equality and cannot be recovered from the report by guessing paths.
9. Capture times are observations, not authoritative chronology. Tied
   timestamps preserve every tie and compare graph sets without inventing an
   ordinal order. Raw-only/unverifiable observations do not hide transitions
   between adjacent verified graph observations; reversions such as A→B→A keep
   every transition endpoint.
10. Reports expose only ordinals, fixed enums/codes, counts, measured lengths,
    content commitments, and fixed booleans. They contain no paths, filenames,
    titles, provider/conversation/capture/message/node/asset identifiers,
    timestamps, source pointers, URLs, diagnostics text, or native exception
    prose.

## Local analysis page

The first UI adapter remains analysis-only. A dedicated extension page accepts
two to sixteen separately selected snapshot folders through repeated trusted
directory picks. It snapshots each `FileList`, validates one common top-level
folder segment, strips and immediately discards that segment, preserves every
nested snapshot-relative file (including opaque extras), and completes the full
count/path/size preflight before its first sequential byte read.

The page has no settings or storage dependency, background/runtime message,
network request, filesystem handle, source-file write, or mutation control.
Selection changes invalidate old results; cancelled or rejected picker attempts
do not. Cancellation is honest: it stops between native reads and hashes and
discards stale results, but synchronous parsing and an active Web Crypto digest
cannot stop instantly.

Rendering uses only fixed localized labels plus ordinal/count/length/digest/code
fields from the validated encoded plan. Folder/file names, source text and
native exception prose never enter the DOM or logs. The exact encoder bytes can
be saved only by a fresh trusted click to a fixed JSON filename with browser
Save As. Download-ID assignment is not success: exact-ID completion is
confirmed, interruption/no-start is failure, and timeout/channel/search
uncertainty is `unknown` with no automatic retry. Confirmation is still a
browser terminal event, not independent disk readback.

The page is a private build entry with a restrictive `connect-src 'none'` CSP.
Its analyzer/controller/selection/download/render chunk is not web-accessible;
the only shared provider-accessible chunk is the existing pure ChatGPT
normalizer/validator code genuinely used by both content extraction and replay.
No manifest permission or host scope is added.

## Limits

Hard ceilings are 16 snapshots, 256 files per snapshot, 1,024 total files,
64 MiB per file, 256 MiB aggregate selected bytes, 96 JSON container levels,
1,000,000 JSON values, 20,000 canonical nodes, 100,000 blocks, 10,000 assets,
20,000 diagnostics, bounded projection/hash work, 48 sparse relations, and a
256 KiB report. Callers may lower but never raise limits.

The canonical replay ceiling is checked before certification, but some replay
allocations necessarily occur before the resulting graph/block counts exist.
This is not a proof of zero transient allocation. Presentations, receipts,
Markdown, DeepSeek, official exports, old writer versions, and external
backlinks are intentionally unsupported in version 1 and force preservation.
The installed Comet page is live-verified on two immutable seven-file snapshots:
both exact folder picks and byte inventories completed, Save As moved from an
honest initial `unknown` to exact terminal completion, the physical 1,022-byte
JSON matched an independently encoded oracle byte-for-byte, and cancelling a
later picker preserved the existing result. Source files remained unchanged.

A second installed Comet acceptance used sixteen separately selected synthetic
raw-only folders with 36 files and exactly 255 MiB of selected bytes, one MiB
below the unchanged aggregate ceiling. One uninstrumented Analyze completed and
rendered all sixteen fixed ordinal cards without saving a report. A separate
native Cancel was accepted while the page displayed `Checking bytes,
provenance, and canonical replay…`, reached the exact no-report terminal status
within the next 284 ms refresh, and remained stable without a late report after
another 38.8 seconds. Independent post-run verification matched every selected
source hash and size, found timestamps unchanged at inventory precision, and
found no new snapshot-analysis report or partial in either checked Downloads
root. This proves the near-limit read/copy/hash path, not parser-heavy near-limit
replay or peak-memory bounds.

A separate user-operated Google Chrome acceptance selected two 1,081-byte
synthetic raw-only folders on the installed private page. Analyze reached the
exact unchanged-source terminal status, rendered two ordinal-only
`Unverifiable` cards and preserved both with no candidate relation. Save was not
invoked. Independent post-run hashing, sizing and timestamp comparison matched
the selected inventory, and no newer report or partial appeared in the checked
Downloads roots. This closes ordinary Chrome portability for this private page,
not every browser family or provider content-script route. Synthetic headless
rendering alone could not establish this result.

## Future mutation adapter

A separate explicit adapter must still establish filesystem containment through
stable handles; reject symlinks, Windows junctions/reparse points, ADS, UNC and
alias/case escapes; revalidate a hash-bound plan immediately before action;
show exact paths and realistic recovered-space estimates; preserve protected
first/latest/graph-change/partial evidence; and move candidates into a
same-volume quarantine with a collision-refusing journal and undo. Permanent
recursive deletion is not part of this decision.
