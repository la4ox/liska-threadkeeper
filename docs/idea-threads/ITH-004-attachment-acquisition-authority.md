---
title: "ITH-004 — Attachment acquisition authority and honest loss states"
type: idea-thread
permalink: ith-004-attachment-acquisition-authority
tags: [idea-thread, attachments, privacy, integrity, obsidian]
thread_id: ITH-004
thread_state: settled
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-10-31
---

# ITH-004 — Attachment acquisition authority and honest loss states

Finding an attachment reference is not the same as being allowed to fetch it,
and fetching something is not the same as proving durable bytes. This thread
keeps those boundaries and the policy corrections that made them necessary.

## Thread

### H1 — A plausible pointer, filename or media type identifies the asset

Provider-shaped filenames and familiar image extensions made it tempting to
infer ownership, construct a download route or classify an omitted preview as an
intentional decline.

### E1 — Real captures contain incompatible and ambiguous reference families

ChatGPT captures contained `sediment:`, `file-service:` and metadata-only forms.
Some preview-shaped records lacked enough identity to authorize acquisition.
A filename-only preview policy was therefore corrected: ambiguity returns to
`not-attempted`, not `declined`, because no supported choice or safe request
actually occurred.

### E2 — A `fetched` claim can be checked against exact bytes

The current archive contract requires an attempted timestamp, runtime bytes,
media type, byte length and SHA-256. Bytes are reverified before normalization
and written independently per destination. Signed URLs, reusable credential
values and transient transport pointers stay outside manifest and canonical
output; stable provider IDs remain only where the archive contract needs them
for identity or source correlation.

### E3 — Obsidian append proved that ownership must be tail-scoped

Installed append acceptance writes images only for the already verified new
message tail. Assets use full-hash content-addressed paths, create-only writes
and exact readback; the note base is reread before the final note write.
Historical messages are never backfilled from a later full capture, and a
verified unreferenced asset may honestly remain after a later refusal.

### E4 — One ordinary direct XLSX is identifiable but not yet live-proven

A complete standard-owner capture retained one exact direct XLSX attachment
with a positive declared size. Whole-ledger evidence contains no Library,
interpreter/sandbox, custom-GPT/project or template ownership marker for that
asset. The earlier archive kept it `not-attempted`; this proves a narrow
admission candidate, not that the current page-owned helper can return valid
bytes.

### X1 — Guess provider routes or copy credential/header values

This could increase apparent success, but it broadens network authority and can
bind the wrong object while leaking authentication context. The adopted routes
use page-owned requests or exact already-observed evidence and never serialize
credential values.

Revisit when: a provider exposes a documented, scoped capability whose identity
and authorization can be proven without extracting reusable credentials.

### X2 — Record ambiguous omissions as `declined`

That state implies an explicit user or bounded policy choice. Using it for an
unknown identity would hide the difference between “we chose not to fetch” and
“we could not safely know what to fetch.”

Revisit when: the policy and exact eligible object are both known before the
choice is made.

### X3 — Backfill historical note images during a later append

A current capture does not prove ownership of old placeholders after title,
ordering, failures or provider layout changes. Backfill would grant new write
authority beyond the verified tail.

Revisit when: historical message identity and asset ownership are durably stored
and a separate user-invoked repair flow can preview and verify the exact change.

### X4 — Treat XLSX as an ordinary image or trust MIME/ZIP magic alone

That shortcut would mix audit families, permit ambiguous ownership and accept a
generic ZIP container as a workbook. The candidate instead has one explicit
runtime profile and validates bounded OOXML package relationships before bytes
can become durable truth.

Revisit when: never for image classification; broader Office-family admission
still requires its own identity, package and live-provider evidence.

### D1 — Separate discovery, acquisition and durable persistence

Liska records what was discovered, whether a request was actually attempted and
which exact bytes each destination verified. `not-attempted`, `declined`,
`unavailable`, `expired`, `failed` and `fetched` are evidence states, not UI
synonyms. New asset families earn support through bounded, provider-specific
proof rather than name or route guesses.

Evidence: E1, E2, E3, E4

### D2 — Admit ordinary direct XLSX through one explicit runtime profile

The narrow family requires exact raw identity, whole-ledger owner separation,
positive declared size, immediate committed-raw replan, one shared active slot,
exact response MIME/length and bounded structural OOXML validation. It never
widens legacy interpreter XLSX, images, Library assets, endpoints, permissions
or retry authority. Durable support remains conditional on a successful live
File/Obsidian canary.

Evidence: E2, E4

### T1 — Admit new attachment families one evidence gate at a time

Owner-context binaries, project assets, additional media and isolated provider
frames may each need different identity and authorization proofs.

Trigger: a real sample exposes a concrete family and a narrow route can prove
identity, bounded bytes, privacy and per-destination truth.

### T2 — Design cleanup separately from acquisition

Content-addressed or unreferenced files are not automatically safe to delete;
another note or uncertain write may reference them.

Trigger: reference discovery, containment, quarantine, journal and undo can be
proven without granting the capture path deletion authority.

### T3 — Close the ordinary XLSX live gate

Trigger: the exact standard-owner conversation loads again. One trusted export
must show one resolver dispatch, expected-length structurally valid bytes,
content-addressed File/Obsidian equality and exact manifest/canonical receipts,
with no signed transport value or new provider identity in durable output and
no retry or sibling-state change.

## Observations

- [hypothesis] H1: plausible provider pointers, names and media types initially appeared sufficient to identify assets
- [evidence] E1: real captures exposed incompatible pointer families and ambiguous preview records
- [evidence] E2: `fetched` now requires exact verified bytes, length, media type and SHA-256 per destination
- [evidence] E3: installed Obsidian append acceptance proved tail-only content-addressed image persistence #live
- [evidence] E4: one complete standard-owner capture exposes a unique ordinary direct XLSX candidate, but no live byte proof yet
- [rejected] X1: guessed routes and reusable credential extraction exceed the evidence and privacy boundary
- [rejected] X2: ambiguity is not an explicit decline and must not be recorded as one
- [rejected] X3: later captures cannot silently authorize historical image backfill
- [rejected] X4: XLSX is neither an ordinary image nor safely identified by MIME and ZIP magic alone
- [decision] D1: keep discovery, acquisition and durable persistence as separate evidence-bearing stages
- [decision] D2: gate one ordinary direct XLSX behind exact identity, size and structural OOXML validation
- [tail] T1: add attachment families only through provider-specific identity and byte proofs
- [tail] T2: keep orphan cleanup behind a separate reversible authority boundary
- [tail] T3: run one exact installed File/Obsidian XLSX canary when the provider conversation loads

## Relations

- informed_by [[ith-002-layered-archive-truth]]
- informed_by [[ith-006-preserve-before-deduplicate]]
- relates_to [[ith-001-claude-isolated-artifact-capture]]
- informs [[ith-005-bounded-completeness-proof]]
- informs [[ith-007-update-driven-backup-and-memory]]

## Source receipts

- S1 — [ADR-031: Separate Capture, Canonical Archive, and Presentation](../adr/031-loss-aware-archive-pipeline.md)
- S2 — [ADR-045: Obsidian append images belong only to the verified new tail](../adr/045-tail-only-obsidian-append-images.md)
- S3 — [PR #13: acquire ordinary JPEG assets](https://github.com/la4ox/liska-threadkeeper/pull/13)
- S4 — [PR #16: bind research assets to finalized archives](https://github.com/la4ox/liska-threadkeeper/pull/16)
- S5 — [PR #76: append verified tail images to Obsidian](https://github.com/la4ox/liska-threadkeeper/pull/76)
- S6 — local receipt `LISKA-CHAT-SYNTHESIS-20261031-ASSETS`; visibility: local-only; safe aggregate only
- S7 — candidate commit `5964957`; ordinary direct XLSX implementation and tests; installed/live acceptance pending
