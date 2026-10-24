# ADR-039: Local ChatGPT reconciliation delivery

## Status

Candidate. The explicit local File workflow, bounded delivery bundle, and
content-free real core smoke are implemented. The exact candidate page is loaded
in the installed extension; completing its user-owned file/Save As dialogs and
an independent Obsidian bundle destination remain separate gates.

## Context

ADR-037 imports one exact conversation from an official ChatGPT export, and
ADR-038 compares that canonical result with an existing web canonical snapshot.
Neither decision exposed a user flow or persisted the official raw/manifest/
canonical evidence and comparison as a durable unit.

The two selected source files have different trust boundaries. The web file is
an already-saved `liska-thread/1` snapshot; the official source can be a large
uncompressed conversations array. A browser file input grants read access only:
it does not reveal a reusable source path or grant permission to write beside
that file. Existing raw/canonical companion messages are also bound to content-
script capture authority and fixed web-capture paths, so disguising a comparison
report as an ordinary canonical companion would weaken provenance.

## Decision

1. The popup opens a dedicated extension page. Its two explicit, read-only file
   inputs accept one web canonical JSON file and one uncompressed official
   conversations JSON file. No title/filename matching, ZIP discovery, folder
   crawl, live ChatGPT request, or automatic source lookup is performed.
2. The web file is copied before asynchronous work, capped at 64 MiB before
   decode, decoded as fatal UTF-8 without BOM, scanned for duplicate decoded
   object keys and bounded depth/value count, then fully validated as one
   `liska-thread/1` ChatGPT archive with exactly one `chatgpt-web/1` input.
   Exact input cardinality plus node/block/asset/diagnostic ceilings are checked
   before a one-issue fail-fast canonical validator can allocate diagnostics.
3. The exact validated web conversation ID is the only official selector. It
   must satisfy the official importer's portable-ID contract. The official file
   streams in 1 MiB chunks under the existing 2 GiB source and 64 MiB per-object
   limits; the complete array, neighbors, and trailing bytes remain validated.
4. A normalized result returns five fixed JSON artifacts in order: exact
   `official/conversation.json`, exact-hash `official/manifest.json`, official
   canonical snapshot, content-free comparison envelope, and root bundle
   manifest. A canonical-normalization refusal returns a truthful three-file
   raw-only recovery bundle: exact excerpt, official manifest, root manifest.
   It never claims comparison success or discards verified raw evidence.
5. The comparison envelope binds the exact selected web-file byte length and
   SHA-256, the official excerpt/manifest descriptors, and the unchanged
   `liska-chatgpt-comparison/1` report. It stores no selected filename, local
   path, title, message text, source reference, extension payload, or diagnostic
   prose in plaintext.
6. The root schema is `liska-chatgpt-reconciliation-bundle/1`. It describes all
   preceding artifacts but not itself; its exact byte SHA-256 is the opaque
   bundle ID. The conversation directory key is SHA-256 of the exact provider
   conversation ID. Per-artifact and aggregate allocation limits are lower-only.
7. The page wraps the ordered artifacts in one deterministic ZIP32 archive using
   STORE entries, UTF-8 names, fixed 1980 timestamps, CRC-32, fixed safe relative
   paths, and explicit entry/input/output ceilings. One ZIP avoids browser
   multiple-download prompts while retaining independently verifiable files.
8. One explicit `Save As` download is dispatched with a content-addressed
   default filename. The page distinguishes browser-confirmed completion,
   terminal interruption, start failure, and unconfirmed completion. An
   uncertain operation is never retried automatically; its Blob URL remains
   owned until a late terminal event or a bounded deferred cleanup.
   Completion discovered by the timeout's authoritative search is awaited and
   confirmed from that observed item before an `unknown` result is possible.
9. Cancellation aborts local source streaming before output dispatch. Both
   selected files remain unchanged. The UI explicitly tells the user to choose
   the source directory in Save As when physical same-folder placement is
   desired; Liska does not pretend the file input grants that authority.
10. This slice is File-only and independent of ordinary destination settings.
    Obsidian delivery requires a separate immutable multi-artifact contract with
    exact readback length/hash receipts; it must not reuse Markdown append or
    rewrite official manifest paths.

## Compatibility

No content-script capture route, provider page, output setting, archive companion
kind, raw/canonical staging contract, Obsidian API path, permission, or network
host changes. The new extension page is a Vite entry opened through
`chrome.runtime.getURL`; all import, comparison, ZIP, and download work stays in
that local extension context.

## Verification evidence

Synthetic coverage exercises normalized and raw-only bundles, exact identity
binding, wrong/provider/normalizer/multi-input/nonportable identities, web byte
preflight, fatal UTF-8/BOM/malformed/duplicate-key rejection, complete official
stream validation, lowered official/comparison/delivery ceilings, final UTF-8
comparison-envelope boundaries, artifact/aggregate limits, deterministic
chunking, reused buffers, exact original web-byte receipts, hostile hash
callbacks, ZIP structure/CRC/path/size limits, terminal/early/interrupted/unknown
download states, cancellation, popup launch, and fixed error surfaces.

A private content-free local smoke streamed the existing 109,346,038-byte
official export against the existing 4,401,278-byte web canonical snapshot. It
completed as normalized in about three seconds and produced five artifacts:
2,516,091 total artifact bytes, a 402,891-byte comparison envelope, and a
2,516,775-byte deterministic ZIP with the root manifest last. Only content-free
counts/sizes were logged and no filesystem output was created; the intentionally
private exact raw/canonical payload remained inside the in-memory bundle.

The new page and popup entry were rendered through the local production source.
The page remained readable at the desktop layout and retained semantic labels,
disabled initial actions, explicit raw-only wording, and honest Save As guidance.
Independent review found an issue-amplification path before canonical validation
and a timeout/completion race; cheap shape ceilings, bounded validation, awaited
terminal reconciliation, and exact regressions closed both. The bounded recheck
reported no remaining material finding.

## Follow-up

Complete one user-owned real Save As canary in the already-loaded exact candidate
build. Verify ZIP signature, central directory, every manifest entry length/
SHA-256, the content-free report boundary, and absence of unrelated conversation
bytes. Only then add an Obsidian bundle writer as a separate reviewed destination
contract.
