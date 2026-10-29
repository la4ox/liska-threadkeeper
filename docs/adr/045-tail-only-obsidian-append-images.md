# ADR-045: Obsidian append images belong only to the verified new tail

- Status: Candidate; offline implementation verified, installed acceptance pending
- Date: 2026-10-29
- Related: ADR-008, ADR-021, ADR-027, ADR-033

## Context

Fresh Obsidian saves can resolve captured image placeholders and write binary
files before writing the note. Append mode previously stripped every image
placeholder and warned that newly appended images were skipped. Reusing fresh
save behavior directly is unsafe:

- its `{note basename}-img-{array index}` names are unstable after earlier
  capture failures, reordered images, title changes, or tail filtering;
- a full-capture image array does not grant permission to backfill historical
  messages;
- ordinary binary PUT can overwrite an occupied path and has no readback;
- note and asset writes are not one transaction;
- a tail lacks the document-level message-boundary format declaration, so a
  generic rewrite can neutralize its real message markers;
- matching placeholders inside code, HTML, links, or other protected Markdown
  must never become active embeds.

Append already proves only conversation identity plus ordinal message boundaries.
It does not retain provider message IDs in the saved note and cannot infer a
historical image owner after the fact.

## Decision

### 1. Tail authority precedes every image operation

The existing lookup and `buildAppendContent` path first selects a genuine new
message tail. Diagnostics-only, equal-count, shorter-capture, no-op, image-free,
and image-export-disabled paths preserve their prior behavior and perform zero
binary writes. Historical-prefix images are never inspected or backfilled.

Only exact active line-isolated `g2o-image://` placeholders outside protected
Markdown are eligible. Neutralized placeholders remain removal-only. Missing,
duplicate, empty or invalid referenced IDs, disallowed MIME, noncanonical base64,
or parser uncertainty fail with fixed content-free codes and leave the note
unchanged. Unreferenced captured images are ignored.

All tail transforms, callout flattening, marker counting, and final joined-
context validation complete before any binary side effect.

### 2. Assets are immutable and content-addressed

Each unique exact byte sequence is decoded, bounded, SHA-256 hashed, and named:

`<resolved image root>/liska-v1/sha256-<full digest>.<canonical extension>`

Names contain no provider ID, URL, note title, array index, message ordinal, or
capture order. Different tail IDs with identical bytes share one asset path;
repeated occurrences retain separate embeds. A same path with different bytes
is a collision and blocks the note.

Image-bearing append requires a stable Local REST API version 5.5.0 or later.
An existing exact file is reused. A missing path uses `If-None-Match: *`; every
successful or race-reconciled asset receives an exact bounded readback. Failed or
unknown writes are accepted only when that exact path subsequently returns the
expected bytes. There is no numbered fallback and no unconditional append-image
binary PUT.

### 3. Assets commit before the note

After every required asset is verified, Liska rereads the exact note path and
requires byte-for-byte equality with the base used to derive the tail. Only then
does it write the finalized full note and read it back exactly. A failed note PUT
is reconciled only when the expected note is already readable; otherwise it
returns the fixed `append-note-write-unknown` outcome and is never blindly
repeated in that operation. That outcome does not prove the note is unchanged.

This narrows but does not eliminate the existing note GET-to-PUT race. Local REST
API exposes no external compare-and-swap contract used here, so this decision
does not claim safety against an unrelated concurrent writer or exactly-once
delivery.

### 4. Failure preserves evidence, not cosmetic atomicity

If one asset is verified and a later asset or pre-PUT note check fails, the note
remains unchanged but verified content-addressed assets may remain available for
retry without a current note reference. After note PUT begins, failed or
nonmatching readback leaves the note outcome unknown and those assets may
already be referenced. Retained assets are not automatically deleted or claimed
safe to delete: another note may legitimately reference the same bytes. A later
retry reuses an exact path when routing is unchanged, while existing message-
count logic prevents a confirmed tail from being appended twice.

Text-only append remains available by explicitly disabling image export. Strict
image-enabled append does not silently degrade to text-only because that would
make the skipped tail images impossible to recover without violating the no-
backfill boundary.

## Compatibility

Fresh File/Obsidian/Clipboard image behavior is unchanged except that a matching
private placeholder inside protected Markdown can no longer activate. Ordinary
append without an eligible tail image keeps its existing server requirements,
line-ending behavior, and response schema. Stored notes and historical asset
names are not rewritten.

## Verification

Focused coverage includes trusted-tail selection, marker preservation, protected
Markdown, duplicate/missing/bad image evidence, full-hash naming, distinct IDs
sharing one path, existing identical reuse, different-byte collision, create-
only race reconciliation, readback failure, unsupported server versions, path
refusal, changed base note, note-write reconciliation, image-export-disabled
byte preservation, historical no-backfill, and a second-asset failure after the
first asset was verified. Tests assert exact write counts: no-op and pre-asset
refusal paths write neither binaries nor notes, while the intentional second-
asset failure may retain the first verified binary but still performs zero note
writes.

Installed Obsidian acceptance remains required: one real append with a new image,
an exact retry/reuse, a changed-base refusal after asset verification, and
filesystem readback of both the content-addressed asset and appended note.
