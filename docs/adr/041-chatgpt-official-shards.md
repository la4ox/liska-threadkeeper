# ADR-041: Bounded ChatGPT official-export shard sets

## Status

Candidate. Multi-shard selection, import, delivery provenance, and explicit
multi-file UI are implemented and verified against one real six-shard export.
The exact installed extension has now completed a real six-file FileList to
verified Obsidian snapshot run. Direct production-core evidence separately
covers shuffled ordering, later-shard cancellation and ZIP parity.

## Context

Recent official ChatGPT exports no longer necessarily contain one
`conversations.json`. Three measured `export_manifest.json` v1 files each define
logical `conversations.json` as `sharded: true` with six physical files named
`conversations-000.json` through `conversations-005.json`.

The measured August export contains 561 array records across six shards totaling
477,261,486 bytes; the largest shard is 133,894,326 bytes. Selecting only a known
shard works for a known conversation but is not a generally usable importer: the
user should not have to guess which physical array contains an exact provider ID,
and later shards can still invalidate the supplied source set.

Reading `export_manifest.json` or the full export directory would expose names
for 1,933 logical / 1,938 physical files unrelated to the selected conversation.
This slice instead accepts only explicitly selected conversation-array files.

## Decision

1. Legacy `conversations.json` remains a single-source contract. A sharded run
   accepts only exact plain descriptors `{shardIndex, chunks}` with unique integer
   indices 0–999. The page admits one legacy file or one or more exact basenames
   `conversations-NNN.json`; mixed modes, duplicate indices, manifests, archives,
   assets, and noncanonical names fail before any file bytes are read.
2. The page snapshots the complete FileList at the trusted click, sorts shards
   numerically independent of picker order, and reads them sequentially in 1 MiB
   chunks. Filenames are used only for local admission and are never serialized.
   The UI says “all selected shards”: without the export manifest it does not
   claim that a missing physical shard was inferred or validated.
3. All shards share the existing hard ceilings as aggregate budgets: at most
   1,000 sources, 2 GiB observed bytes including trailing whitespace, and 100,000
   array records. The 64 MiB current-object and depth-512 ceilings remain per
   object/parser stack. Budgets are not reset for each shard.
4. One shared conversation-ID ledger spans the complete selected set. Duplicate
   target IDs, unrelated IDs, or `id`/`conversation_id` aliases across shards
   fail closed. A match never short-circuits later shards; every independent root
   array, UTF-8 stream, neighbor, and trailing byte must validate before import.
5. At most one selected exact object survives. It is copied into an owned byte
   allocation, and any later malformed shard, duplicate, read failure, or limit
   erases that retained match before returning a fixed error. Import/bundle/
   normalization run once only after every supplied shard validates.
6. Conversation index, JSON pointer, byte offsets, and source byte length remain
   shard-local; they are never virtual concatenation coordinates. Optional
   numeric `shardIndex` is added to raw source provenance, canonical
   `openai.officialExport`, and reconciliation receipt. It is omitted from the
   legacy single-file path so existing serialized bytes/hashes stay unchanged.
7. The measured shard set also contains four literal empty objects in shard 004.
   Exact `{}` is treated as provider padding: it still consumes the aggregate
   record budget, is ignored only for identity/mapping validation, and increments
   `ignoredEmptyRecordCount` in source/canonical/delivery provenance plus an
   explicit official-manifest warning. Any nonempty object without a valid
   identity and nonempty mapping remains malformed.
8. Core cancellation remains source-driven: the page checks its AbortSignal
   before and after every File slice and between shards. A thrown iterable is
   sanitized as source-read failure; the page maps an already-aborted operation
   to cancelled and dispatches no File or Obsidian output.

## Compatibility

The public single-source selector/importer remains unchanged. Multi-source entry
points and provenance fields are additive. Existing browser captures, official
single-file manifests, normalizer IDs, artifact paths, comparison schema, File
ZIP, and Obsidian root-last protocol retain their current contracts.

No manifest/directory/ZIP discovery, asset-file association, whole-shard hash,
parallel read, or arbitrary filename persistence is added.

## Verification evidence

Synthetic tests cover target in first/middle/last shard, numeric ordering,
complete later-shard consumption, all absent, invalid UTF-8/JSON/trailing data
after an earlier match, cross-shard duplicate target/unrelated/alias IDs, reused
buffers, exact shard-local offsets, aggregate exact/excess byte and record limits,
empty arrays, source-count and descriptor errors, selected-byte cleanup, single
normalization after all validation, raw-only, optional provenance at every layer,
legacy omission/hash compatibility, delivery both/neither refusal, UI FileList
sorting/admission, and hostile thrown Proxy sanitization.

A private content-free live smoke processed all six real arrays sequentially:
477,261,486 source bytes and 561 records in about 11.7 seconds. It selected shard
0, counted four empty padding records in shard 4, completed normalized delivery,
and produced five artifacts totaling 2,516,426 bytes with a 402,944-byte
comparison envelope. Only status/count/size/timing facts were logged; no output
was written and no conversation value or provider ID was printed.

After rebasing onto the merged Obsidian slice, an exact-head production-core
canary accepted the six real files in shuffled descriptor order, consumed all
477,261,486 bytes numerically, selected shard 0, and disclosed the same four
padding records. It produced five artifacts totaling 2,516,416 bytes, a
402,940-byte comparison envelope and a deterministic 2,517,100-byte ZIP whose
entry order and bytes matched the delivery exactly. Obsidian write/readback was
confirmed. Cancellation during shard 4 performed no hash or output work; a set
omitting shard 0 consumed all 367,915,448 supplied bytes before not-found
refusal.

The exact build was then reloaded in Comet. One installed-page run exposed a
six-file FileList and completed its Obsidian-only destination. The new attempt
contained exactly five files totaling 2,516,521 bytes. Independent readback
matched every descriptor, SHA-256, the exact selected source slice, shard index,
four ignored records, root hash and root-last ordering. The accessibility tree
reported the exact six-file selection and final verified status; native Windows
screenshot capture was unavailable.

## Follow-up

The installed positive FileList/output path, direct shuffled ordering,
later-shard cancellation, ZIP parity and omitted-target refusal are closed.
Installed negative-input acceptance also closes an invalid selected extra file
and a trusted native Cancel against a transient instrumented pending-read
boundary. The invalid extra failed before output with the fixed public status,
hidden result and zero Local REST requests. On a freshly reloaded page, a
synthetic 512 MiB later shard was paused only at its selected `File` read; the
native Cancel event was trusted, released the hold after the click and produced
the exact no-output warning. File was selected and Obsidian disabled; both
baseline and terminal Local REST request counts were zero. Source hashes,
lengths and modification stamps remained unchanged and no new ZIP or partial
was written. Reload removed the instrumentation.

An earlier uninstrumented attempt reached Save As before Cancel and completed
one synthetic Obsidian snapshot before the File dialog was dismissed, so it is
not cancellation evidence and the immutable snapshot is not deleted. General
uninstrumented scheduling timing and actual page unload remain follow-ups.
Omitting a non-target shard cannot be detected without the manifest and must
reduce the completeness claim rather than invent a refusal. Manifest-guided ZIP/
directory discovery and external binary association remain separate evidence-
gated work.
