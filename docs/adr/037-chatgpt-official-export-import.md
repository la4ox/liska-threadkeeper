# ADR-037: Exact ChatGPT official-export excerpts

## Status

Candidate. The pure archive-core slice is implemented and locally verified;
browser file selection, durable output UI, binary-directory import, and
cross-format comparison remain later slices.

## Context

ChatGPT's official export is a JSON array containing many conversations. Keeping
the complete batch inside every per-conversation archive would copy unrelated
private chats, while `JSON.parse` followed by `JSON.stringify` would destroy the
original whitespace, escapes, number spelling, and duplicate-key evidence.

The measured local export is 109,346,038 bytes and contains 100 conversations.
Every conversation is a self-contained object with `id`/`conversation_id`,
`mapping`, and `current_node`; individual object spans range from 2,582 to
4,659,395 bytes. The file uses escaped strings extensively, so delimiter or
regular-expression splitting is not a valid boundary detector.

Official graph nodes also differ from live web history: they retain `parent`
but omit `children`. Secondary metadata lineage is not authoritative—some
`metadata.parent_id` and every observed `source_analysis_msg_id` point outside
the selected conversation—while every node `parent` in the measured file is
internally valid.

The existing capture manifest already admits method `official-export`, but its
artifact record previously required an HTTP endpoint. Inventing a GET endpoint
for a local file would be false provenance.

## Decision

1. The importer selects only by exact provider conversation ID. Titles, array
   positions, timestamps, and plausible graph shapes are never selectors.
2. A byte-level JSON-aware scanner consumes an `AsyncIterable<Uint8Array>`,
   validates the complete source array, and retains one exact owned object span.
   It scans past the match to reject duplicate IDs and malformed trailing data.
3. Hard maxima are 2 GiB per source, 64 MiB per conversation, 100,000
   conversations, and 512 JSON container levels. Callers may lower but never
   raise them. UTF-8 BOM is explicitly unsupported in this first contract.
4. `liska-capture/1` artifact records become a discriminated union. Browser
   captures retain their exact HTTP endpoint unchanged. Official excerpts carry
   `official-export-slice` provenance: semantic file role, conversation index,
   byte offset, and observed source byte length. No local filename or absolute
   path is serialized.
5. The selected artifact SHA-256 is the durable raw authority. The source batch
   is fully validated and its length recorded, but this slice does not persist a
   whole-file digest; byte offset/index are contextual provenance, not a claim
   that the absent parent file can later be reconstructed.
6. Asset inventory runs over the exact excerpt before normalization. Discovered
   official-export files/images/audio remain metadata-only `not-attempted`
   records until a separate export-directory binary contract proves exact bytes.
7. The official normalizer profile reconstructs child arrays exclusively from
   authoritative node `parent` links in parsed mapping order. It records the
   `official-export-children-derived` diagnostic and uses normalizer identity
   `chatgpt-official/1`; it never claims the shape came from the web endpoint.
8. Canonical raw pointers are relative to the retained excerpt. Original batch
   position stays in the artifact source descriptor instead of being prepended
   to every pointer.
9. If exact selection and manifest verification succeed but canonical
   normalization refuses the graph, the importer returns an explicit
   `raw-only` result. It never reports a false canonical success or discards the
   verified excerpt.
10. The official-export warning states that completeness applies to the
    selected export object. It does not claim that current exports contain
    provider-only hidden/tool/Canvas history absent from that object.

## Compatibility

Existing web and DeepSeek artifact records still serialize only `endpoint`, so
their manifest bytes and hashes remain unchanged. Official source format and
method must be selected together; callers cannot use the official profile to
weaken a web capture. Future official exports that provide explicit `children`
are accepted only when every node provides them; mixed explicit/derived graphs
fail closed.

The importer lives in the browser-independent archive layer. It does not import
from content/background/popup/offscreen modules, issue network requests, inspect
cookies, or write a destination.

## Verification evidence

Synthetic coverage exercises arbitrary chunk boundaries, reused/cross-realm
buffers, escaped identity keys, Unicode and escaped strings, duplicate IDs,
alias disagreement, malformed neighbors/trailing input, UTF-8/BOM failures,
lowered resource ceilings, exact offsets, parent-only branches, two-root forests,
metadata-only assets, pointer resolution, unknown content types, deterministic
chunking, and raw-only fallback.

Two privacy-safe live smokes streamed the same 109,346,038-byte local export
without logging titles or content:

- a 1,051,058-byte excerpt normalized to 294 nodes, 293 messages, one root, one
  leaf, and 42 metadata-only assets;
- a 2,322,195-byte excerpt normalized to 686 nodes, one root, two leaves, one
  branch point, and 22 metadata-only assets.

These smokes prove exact selection and canonical normalization for the measured
file. They do not prove external attachment availability, complete historical
Canvas/tool retention, browser UI import, or cross-format equality with a live
web capture.

## Follow-up

The next slice is a pure compare-only reconciliation report. It must scope every
fact by left/right capture, compare provider plus conversation identity and then
exact node/message IDs, and report matched, source-only, and conflicting facts.
It must not merge archives, deduplicate snapshots, infer equality from titles or
timestamps, or concatenate source references whose artifact IDs are ambiguous
across captures.
