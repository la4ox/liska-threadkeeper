# ADR-038: Compare-only ChatGPT cross-format reconciliation

## Status

Candidate. The pure archive-core comparison is implemented and locally
verified; browser file selection, durable report output, archive merging, and
snapshot deduplication remain separate slices.

## Context

The same ChatGPT conversation can be captured from live web history and from an
official export. Those sources have different retention boundaries and graph
shapes. Equal titles, timestamps, filenames, Markdown, or archive IDs therefore
cannot establish equality, while concatenating two canonical archives would
make their capture-local artifact references ambiguous.

A useful first reconciliation step must answer narrower questions: which exact
canonical IDs occur on each side, which common IDs are semantically equal or
conflicting, how topology differs, and whether asset claims agree. It must do so
without copying message text, filenames, diagnostic text, source references, or
provider extensions into the report.

## Decision

1. `compareChatGptArchives` is a pure compare-only operation. It accepts exactly
   one `chatgpt-web/1` archive and one `chatgpt-official/1` archive for the same
   exact provider conversation ID. Orientation may be reversed, but every fact
   remains explicitly scoped as left or right.
2. Both inputs are synchronously detached before the first hash await. The
   descriptor-based snapshot rejects accessors, symbols, sparse arrays, cycles,
   non-plain objects, non-finite numbers, and other non-JSON values without
   invoking accessors or `toJSON`. JavaScript Proxy traps remain caller code and
   are contained behind the fixed public error surface rather than treated as a
   sandbox boundary.
3. The report schema is `liska-chatgpt-comparison/1`; semantic projections use
   version `chatgpt-canonical-semantic/1`. The caller supplies SHA-256, but the
   implementation validates lowercase 64-hex results, hashes sequentially,
   detects mutation of owned hash bytes, and emits only value-free errors.
4. Conversation metadata is represented only by changed field names and
   domain-separated semantic hashes. Nodes, messages, and assets use exact
   canonical IDs with per-side semantic hashes, exact source-only ID sets, and
   typed conflict-field names.
5. Node comparison covers parent, child membership, child order, and message ID.
   Message comparison covers ownership, canonical message fields, and ordered
   typed blocks. Asset comparison separates metadata, byte/hash claims, and
   destination-honest acquisition state.
6. Root, leaf, and branch-point membership are compared explicitly. Common leaf
   paths are compared by exact ancestor chains. Root and sibling order remain
   informational, especially when the official graph discloses parent-derived
   ordering; order alone is never a content conflict.
7. Diagnostic output contains only safe bounded code/severity counts. Unsafe or
   overlong diagnostic codes collapse to `unclassified-diagnostic-code`.
   Diagnostic messages, paths, references, and extensions are excluded.
8. The result deliberately does not merge archives, copy source references,
   fuzzy-match IDs, deduplicate snapshots, infer asset absence from an unmatched
   ID, or claim raw-byte equality from canonical semantic equality.
9. Combined hard ceilings cover JSON values/depth/string units, nodes, blocks,
   assets, diagnostics, difference rows, per-projection and aggregate digest
   bytes, and final report bytes. Callers may lower but never raise them.

## Compatibility

The comparator lives in the browser-independent archive layer and is exported
from `src/archive/index.ts`. It performs no fetch, browser inspection, cookie or
storage access, destination write, or mutation of either input. Existing web,
official-export, DeepSeek, rendering, and destination contracts are unchanged.

Because the report retains exact canonical IDs and capture IDs, it is a local
diagnostic artifact rather than an anonymized publication format. It excludes
conversation prose and the other high-risk payload fields listed above, but its
scope identifiers should still be handled as archive metadata.

## Verification evidence

Synthetic tests cover orientation, deterministic repetition, input detachment,
all supported block types, topology and membership changes, moved messages,
asset claim/acquisition differences, safe diagnostic aggregation, invalid
normalizer/identity/cardinality pairs, every lowered resource ceiling, exact
UTF-8 digest/report boundaries, accessors and hostile JSON shapes, mutating or
throwing hash implementations, and value-free error surfaces.

A private content-free local smoke compared an existing web canonical archive
with the exact official-export conversation of the same provider ID:

- web: 494 nodes, 493 messages, 42 assets;
- official: 294 nodes, 293 messages, 42 assets;
- nodes: 128 exact semantic matches, 200 web-only IDs, no official-only IDs,
  and 166 common-ID conflicts;
- messages: 200 web-only IDs, no official-only IDs, and 293 common-ID conflicts;
- assets: all 42 exact IDs matched with no conflicts;
- report size: 402,000 UTF-8 bytes.

The smoke logged no title, message content, filename, path, source reference, or
diagnostic text. It proves that the comparator can expose a real retention gap
without erasing the simultaneous asset agreement. It does not prove why the
official export omitted those 200 nodes, external binary availability, or that
either source is independently complete.

## Follow-up

Add an explicit user-selected local flow that imports the official conversation
and writes this bounded comparison as its own durable artifact beside the two
unchanged source snapshots. Do not turn that delivery slice into an implicit
merge or a default snapshot deduplicator.
