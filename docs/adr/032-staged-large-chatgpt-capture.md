# ADR-032: staged ChatGPT graph capture above 16 MiB

## Status

Accepted and implemented for the experimental ChatGPT complete-graph path.
Synthetic live-browser verification covers staging, exact byte round trips,
durable File output, cleanup, and the 16 MiB boundary, so the implementation is
ready to remain in the draft PR. A native provider response above 16 MiB is
still required before claiming that full real-world path as live-verified.

## Context

The original no-scroll bridge deliberately capped one exact ChatGPT response at
16 MiB. The page-owned response clone was assembled as bytes, converted to one
base64 string, returned through `chrome.scripting.executeScript`, decoded and
hashed again in background, then returned as another whole extension message.
The same amplification occurred later when raw and canonical archive companions
were persisted.

Raising that number would not remove the boundary. It would only increase the
largest simultaneous byte, binary-string, base64, parsed-object, canonical, and
Markdown working sets while approaching Chrome's message limit.

The binary attachment route already proved that 512 KiB independently encoded
chunks can be staged in extension-owned OPFS and verified before a durable
write. Raw conversation graphs are not attachment assets, however: they have
different paths, identity, lifetime, and cleanup semantics.

## Decision

Use a versioned `inline | staged` transport and a separate
`liska-archive-stages` OPFS namespace.

- Exact responses up to 16 MiB retain the established inline path.
- Responses above 16 MiB and up to 64 MiB remain as a closure-private
  `Uint8Array` in the marker tab. Background pulls independently canonical
  512 KiB base64 chunks and writes them sequentially to a random
  `archive-stage-*` entry.
- The page snapshot exposes only transport, byte length, SHA-256, media type,
  and chunk count. It never exposes the complete base64 value or OPFS path.
- Background creates the unpredictable stage ID. Page code cannot select an
  OPFS name or archive-relative path.
- A stage moves from `OPEN` to `SEALED`. Every append must use the next exact
  offset. A repeated fully acknowledged chunk is accepted only after a bounded
  byte-for-byte comparison; gaps, partial overlaps, and conflicting repeats
  fail closed.
- Sealing independently verifies final length and SHA-256 over the staged file.
  Content reads a sealed raw response back in bounded chunks only because the
  current normalizer still needs ordinary bytes for UTF-8 decoding and
  `JSON.parse`; content re-verifies the final SHA-256.
- The raw archive companion retains the opaque sealed stage until its selected
  File/Obsidian destinations finish. A canonical companion larger than the old
  32 MiB inline limit uses the same staged mechanism. Manifest remains inline
  and records only stable artifact length/hash evidence, never the stage ID.
- File and Obsidian writes retain the existing append-only archive path. The
  staged Blob is released only after destination handling; Obsidian still
  performs binary readback and SHA-256 verification.
- Before a File download starts, background durably records only its numeric
  download ID (initially null), random stage ID, extension-owned Blob URL, and
  creation time. A fresh MV3 worker registers terminal/startup/install recovery
  synchronously and performs exact release-or-abort cleanup. A null callback ID
  is never guessed; it remains quarantined until the 24-hour age bound.
- Stages never become a fourth user-visible destination. Exact stale entries
  are pruned opportunistically after 24 hours, at most 20 stages per later
  begin. There is no recursive or root-level deletion.

The explicit opaque replay experiment remains on its existing 16 MiB inline
contract in this checkpoint. It is not an oversized fallback.

## Trust and failure boundaries

- The MAIN observer still clones only the exact page-owned same-origin
  conversation response. It reads no request-header value, cookie, browser
  storage, or unrelated response.
- Archive-stage content messages are accepted only from the top frame of an
  exact ChatGPT conversation route. The random stage ID is an isolated-world
  bearer capability; provider conversation IDs and response bytes are absent
  from stage metadata and diagnostics.
- Offscreen accepts stage operations only from the extension background, never
  directly from a content-script tab. A worker sender has no tab or document ID;
  its URL may be absent or exactly the worker entry declared by this extension's
  own manifest. Popup/options/document URLs remain rejected. Offscreen reads
  that entry once from `runtime.getURL('manifest.json')` using a package-local
  fetch with a three-second deadline, omitted credentials, and redirects
  rejected. It keeps the message channel open while checking the URL and starts
  no storage/clipboard operation before verification. `runtime.getManifest`
  itself is unavailable in offscreen contexts, as specified by
  [Chromium's API context restrictions](https://chromium.googlesource.com/chromium/src/+/a39e8b410b94fa34e0aa099620a5a2ac0e335aa2/extensions/common/api/_api_features.json).
- Stage begin failures expose only fixed diagnostic codes for offscreen
  availability, message transport, sender rejection, and known storage exception
  classes. Native error messages, sender URLs, stage IDs, and archive contents
  are never forwarded as diagnostics. A rejection diagnostic does not authorize
  a storage operation.
- A suspended or failed worker cannot publish an incomplete stage. An
  unfinished stage remains quarantined for bounded stale cleanup. A lost append
  or seal acknowledgement can be repeated only under the exact idempotence
  rules above.
- No staged failure falls back to a larger whole-base64 message. If raw was
  sealed but canonicalization fails, the normal loss-aware failure path may
  still persist raw plus manifest; it must not claim canonical success.

## Consequences and deferred work

This removes the 16 MiB transport and archive-message bottlenecks without
changing the deterministic archive schema or Markdown renderer. It does not
make normalization fully streaming: the content process still materializes the
raw bytes and parsed graph, and OPFS seal/Obsidian verification still hash or
read one bounded file at a time. The 64 MiB ceiling therefore remains a safety
bound, not a promise that every provider graph below it will fit every browser
heap.

Moving normalization into offscreen, streaming JSON parsing, staged manifest,
cross-capture deduplication, automatic retries, and a higher cap are deferred
until synthetic and live measurements justify the larger blast radius.

## Verification

Synthetic checks cover:

- the exact 16 MiB inline/staged boundary and a 20 MiB complete capture;
- a canonical artifact above 32 MiB without a whole runtime message;
- 512 KiB chunk bounds, ordering, UTF-8 split preservation, and final SHA-256;
- exact append retry, gap/overlap/conflict, seal retry, and size/hash failures;
- sender/offscreen gating, URL ownership, destination release, stale cleanup,
  and cancellation of uncommitted stages;
- unchanged inline and opaque-replay behavior.

Live Comet checks on 2026-08-31 confirm zero-byte begin/abort and a 16,777,264-byte
synthetic stage written/read in 33 independently encoded chunks. The latter
completed in 3.792 seconds with an exact SHA-256 round trip and acknowledged
abort. A 131-byte UTF-8 synthetic JSON also passed staged File output and a
filesystem length/hash check; the control read before commit succeeded and the
read after terminal output was rejected. No personal content entered these
synthetic checks.

A real provider response above 16 MiB remains unverified. That canary must still
prove the complete native capture-to-normalization path, exact raw/manifest/
canonical destination bytes, no whole-base64 runtime payload, no leftover marker
tab, and no orphaned stage after terminal output. The explicit replay cap is
unchanged.
