---
title: "ITH-004 — Attachment acquisition authority and honest loss states"
type: idea-thread
permalink: ith-004-attachment-acquisition-authority
tags: [idea-thread, attachments, privacy, integrity, obsidian]
thread_id: ITH-004
thread_state: settled
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-11-01
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

### E5 — The first normal-mode XLSX canary stopped honestly before dispatch

After the normal-mode resolver wiring was reviewed and installed, one trusted
export selected exactly the retained XLSX candidate. File and Obsidian received
complete raw, manifest and canonical companions with byte-identical archive
hashes, but the active resolver ended before helper dispatch with legacy
`source-http-error`. The XLSX remained `not-attempted`; timestamp, local path,
byte length and SHA-256 stayed null, no binary was written and no retry ran.

This proves the planner, normal-mode seam and honest durable loss state. The
legacy code does not prove whether the source response was 4xx/5xx/other or
whether status/header/media/Promise processing failed.

### E6 — The origin-specific canary reached a 4xx source boundary

The reviewed attribution build was installed and exercised exactly once. It
selected the same single XLSX, then reported `source-http-4xx` before helper
dispatch. File and Obsidian again preserved byte-identical raw, manifest and
canonical companions; the asset stayed `not-attempted` with null timestamp,
path, length and hash, no XLSX existed and no retry ran.

This proves only that the separate temporary source request received a
client-error-class response. It does not identify authentication, availability,
expiry, rate limiting or any other cause, and normal capture success does not
resolve the separate request.

### E7 — The final approved canary reached the helper but acquired no XLSX

The final explicitly approved installed canary completed on 2026-11-01. It
selected one ordinary direct XLSX; the source gate passed with HTTP 200 and
JSON, and one known helper dispatch completed. The provider envelope was
classified as `provider-status-other`, with no accepted download candidate.
No binary acquisition, expected-length check or structural OOXML validation
occurred. The local exact-status diagnostic did not fire because the source did
not fail with 4xx; this does not explain the earlier source failure or a finer
provider-envelope cause.

The manifest asset is `failed` with `attemptedAt` present. Exact XLSX MIME
remains identity metadata, while path, byte length and SHA-256 are null. File
and Obsidian preserved byte-identical raw, manifest and canonical companions;
File additionally saved HTML with its receipt. Both Markdown notes were saved but
differ by the configured presentation transform, so no Markdown byte identity
is claimed. Neither capture contains an XLSX binary and no retry ran.

Receipt S10 records the safe aggregate. This spends the final canary approval:
ordinary XLSX remains implemented but live-unaccepted and PR #89 remains
draft. No code change, retry or transport redesign follows from this result;
any finer envelope diagnostic is a separate future decision.

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

### X5 — Retry or change transport from one ambiguous source error

The fixed legacy code combines several mutually different failures. Retrying
could hide a server response or reproduce a processing defect while consuming
the family's one-shot ownership. Changing the helper route would expand network
authority without evidence.

Revisit when: an origin-specific fixed code identifies the boundary, and only
then if a separately reviewed transport change is actually warranted.

### X6 — Infer a cause from the 4xx class

Calling the result an authorization error, missing resource or rate limit would
turn a broad protocol class into an unsupported causal claim. Each hypothesis
has materially different architecture and retry consequences.

Revisit when: a separately authorized future decision establishes a narrower
source or provider-envelope diagnostic. E7 supplied no exact 4xx integer and
does not reopen this branch or authorize transport changes.

### D1 — Separate discovery, acquisition and durable persistence

Liska records what was discovered, whether a request was actually attempted and
which exact bytes each destination verified. `not-attempted`, `declined`,
`unavailable`, `expired`, `failed` and `fetched` are evidence states, not UI
synonyms. New asset families earn support through bounded, provider-specific
proof rather than name or route guesses.

Evidence: E1, E2, E3, E4, E5, E6, E7

### D2 — Admit ordinary direct XLSX through one explicit runtime profile

The narrow family requires exact raw identity, whole-ledger owner separation,
positive declared size, immediate committed-raw replan, one shared active slot,
exact response MIME/length and bounded structural OOXML validation. It never
widens legacy interpreter XLSX, images, Library assets, endpoints, permissions
or retry authority. Durable support remains conditional on a successful live
File/Obsidian canary. E7 exhausted the current approval without that byte proof;
this slice authorizes no further canary.

Evidence: E2, E4, E5, E6, E7

### D3 — Attribute the source gate before changing acquisition

Current active code distinguishes actual source response classes as
`source-http-4xx`, `source-http-5xx`, or `source-http-other`, and uses
`source-response-processing-rejected` for status/header/media or observation
processing failure. Apart from the explicitly approved local 400–499
source-status diagnostic, exact status, exception, URL, header and body values
remain outside the contract. The legacy generic code stays accepted only for
coherent mixed-version cleanup; every new code remains before-dispatch and preserves
`not-attempted`/null binary evidence.

Evidence: E5, E6

### D4 — Stop at 4xx unless the exact local status is explicitly approved

The 4xx class does not authorize retry, source-gate relaxation or a new
transport. At E6, the only remaining bounded diagnostic was one local integer
restricted to 400–499, with no URL, status text, header, body, credential,
identifier, new request, retry or timing change, followed by exactly one final
canary. Without that explicit decision the ordinary XLSX candidate would remain
unaccepted and this line would stop.

That approval was subsequently granted and consumed by E7. Its source gate
passed, so no exact 4xx status was recorded. The candidate remains unaccepted;
the earlier conditional approval is not authority for another canary or for
provider-envelope diagnostics.

Evidence: E6, E7

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

Trigger: a separately authorized future decision defines whether and how to
investigate the `provider-status-other` envelope or revisit live acceptance.
E7 spent the final canary approval; this slice permits no further canary, retry,
code change or transport redesign. Any later acceptance must still prove one
resolver dispatch, expected-length structurally valid bytes, content-addressed
File/Obsidian equality and exact manifest/canonical receipts, with no signed
transport value or new provider identity in durable output and no retry or
sibling-state change. Until that separate decision, leave PR #89 draft and the
implemented XLSX family live-unaccepted.

## Observations

- [hypothesis] H1: plausible provider pointers, names and media types initially appeared sufficient to identify assets
- [evidence] E1: real captures exposed incompatible pointer families and ambiguous preview records
- [evidence] E2: `fetched` now requires exact verified bytes, length, media type and SHA-256 per destination
- [evidence] E3: installed Obsidian append acceptance proved tail-only content-addressed image persistence #live
- [evidence] E4: one complete standard-owner capture exposes a unique ordinary direct XLSX candidate, but no live byte proof yet
- [evidence] E5: one installed normal-mode canary selected the XLSX but preserved it honestly as not-attempted after an ambiguous pre-dispatch source failure #live
- [evidence] E6: the reviewed source-attribution canary narrowed the separate temporary source request only to 4xx and preserved null binary truth #live
- [evidence] E7: the final approved canary passed the source gate and completed one helper dispatch, but provider-status-other left XLSX failed without bytes; approval is spent #live
- [rejected] X1: guessed routes and reusable credential extraction exceed the evidence and privacy boundary
- [rejected] X2: ambiguity is not an explicit decline and must not be recorded as one
- [rejected] X3: later captures cannot silently authorize historical image backfill
- [rejected] X4: XLSX is neither an ordinary image nor safely identified by MIME and ZIP magic alone
- [rejected] X5: an ambiguous source error does not authorize retry or transport changes
- [rejected] X6: a broad 4xx class does not establish authentication, absence or rate limiting
- [decision] D1: keep discovery, acquisition and durable persistence as separate evidence-bearing stages
- [decision] D2: gate one ordinary direct XLSX behind exact identity, size and structural OOXML validation
- [decision] D3: distinguish source response class from source processing failure before changing acquisition
- [decision] D4: the one explicitly approved local source-status canary was consumed by E7 and grants no further canary or envelope-diagnostic authority
- [tail] T1: add attachment families only through provider-specific identity and byte proofs
- [tail] T2: keep orphan cleanup behind a separate reversible authority boundary
- [tail] T3: revisit provider-envelope diagnostics or XLSX acceptance only through a separately authorized future decision; no further canary belongs to this slice

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
- S8 — local receipt `LISKA-XLSX-NORMAL-MODE-20261031`; visibility: local-only; safe aggregate only
- S9 — local receipt `LISKA-XLSX-SOURCE-4XX-20261031`; visibility: local-only; safe aggregate only
- S10 — local receipt `LISKA-XLSX-PROVIDER-STATUS-OTHER-20261101`; visibility: local-only; safe aggregate only
