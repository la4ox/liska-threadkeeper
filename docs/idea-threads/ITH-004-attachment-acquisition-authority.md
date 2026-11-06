---
title: "ITH-004 — Attachment acquisition authority and honest loss states"
type: idea-thread
permalink: ith-004-attachment-acquisition-authority
tags: [idea-thread, attachments, privacy, integrity, obsidian]
thread_id: ITH-004
thread_state: growing
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-11-07
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

### E4 — A branch candidate bounded one ordinary direct XLSX

The unmerged PR #89 branch retained a complete 13,118,031-byte standard-owner
capture with one exact direct XLSX, declared as 12,101 bytes. Whole-ledger
evidence contained no Library, interpreter/sandbox, custom-GPT/project or
template ownership marker for that asset. Its branch-only planner required
exact identity/MIME, positive bounded size, immediate committed-raw replan and
one shared active slot; its runtime-only profile required exact response length
and bounded structural OOXML admission. Recorded independent review corrected
legacy-XLSX and XML-amplification defects, and offline tests passed with the
coverage-run limits recorded in STATUS. This established a bounded candidate,
not mainline support or live workbook bytes. Sources: S7.

### E5 — The first installed branch canary failed ambiguously before dispatch

After the normal-mode wiring correction, one trusted export selected the XLSX
but ended before helper dispatch with legacy `source-http-error`; the durable
dispatch metric was unknown. File and Obsidian preserved pairwise equal raw,
manifest and canonical companions. The asset stayed `not-attempted` with null
timestamp/path/length/SHA-256; no binary or retry occurred. That legacy code did
not distinguish source-response class from status/header/media or observation
processing failure. This was historical branch wiring/loss-state evidence, not
accepted XLSX support. Sources: S8.

### E6 — The attribution branch canary established only a source 4xx class

One reviewed installed branch canary reported `source-http-4xx` before helper
dispatch. The asset again stayed `not-attempted` with null attempt/binary
fields, pairwise equal File/Obsidian raw/manifest/canonical companions and no
XLSX binary or retry. This proved only a client-error-class response on the
separate source request, not authentication, absence, expiry, rate limiting or
another cause. Normal capture success did not resolve that request. Sources: S9.

### E7 — The final approved branch canary dispatched but acquired no XLSX

On 2026-11-01 the final approved installed canary selected one ordinary direct
XLSX, passed its source gate with HTTP 200 JSON and completed one known helper
dispatch. The envelope was classified as `provider-status-other`, without an
accepted download candidate. No binary acquisition, expected-length check or
structural OOXML validation occurred. The approved local 400–499 integer
diagnostic did not fire and explained neither E6 nor a finer envelope cause.

The branch manifest recorded `failed` with `attemptedAt` present, exact XLSX
MIME only as identity metadata, and null path/byte length/SHA-256. Raw,
manifest and canonical companions matched pairwise across File/Obsidian; their
final safe lengths/hashes are in the dated STATUS checkpoint. File also saved
HTML/receipt, and both Markdown notes saved but differed by configured
presentation transform. No XLSX binary or retry occurred. The final approval
was consumed without byte acceptance; the candidate remained branch-only and
unaccepted. Sources: S10.

### E8 — Optional broad producer dependencies were not an execution authority

After staged ownership became explicit, the isolated coordinator still had to
keep acquisition disabled. The established manual producer uses useful omission
defaults: legacy resolver observation may recapture raw, acquisition may reach
global `fetch`, and binary persistence may reach runtime staging. Merely removing
the disabled flag would therefore grant several unrelated effects at once.

### E9 — One complete ordinary direct PNG capability now closes the offline chain

ADR-064 admits exactly one staged-only `ordinary-direct-png/1` policy. A complete
resolver/fetch/single-binary bundle is snapshotted before claim; one real
whole-ledger observation, one deterministic conversation-bound nonnumeric PNG,
one real bounded acquisition and one injected binary sink feed existing
destination reconciliation and receipts. Omission remains inventory-only.

Review found two authority seams before acceptance. Ambiguous merged interpreter
evidence initially looked like an empty dispatch plan and could fall through to
ordinary acquisition; deny-only ownership now treats any exact evidence as a
block. Unknown/not-dispatched binary writes initially retained an optimistic
success fact; normalized public facts and producer results now agree on failure
and cleanup uncertainty.

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

### X4 — Treat the XLSX candidate as an image or trust MIME/ZIP magic alone

The historical experiment rejected that shortcut: image classification would
mix audit families, and a generic ZIP is not proof of a workbook. Its separate
runtime profile proposed bounded OOXML relationships and ownership checks, but
the live canaries never reached byte validation. No such profile is adopted
into main through these docs.

Revisit when: never as image classification; broader Office-family admission
requires a new authorized identity, package and provider-evidence plan.

### X5 — Retry or redesign transport after an ambiguous source error

E5 combined materially different source and processing failures. The branch
instead tested fixed attribution codes before changing acquisition. Neither the
ambiguous failure nor that diagnostic experiment granted retry, endpoint or
transport authority; all three canaries ended without a retry.

Revisit when: a new separately authorized evidence plan establishes both the
failure boundary and any justified change; the historical authorization is spent.

### X6 — Infer a specific cause from source 4xx or provider-status-other

The broad E6 class did not establish authentication, missing/expired content or
rate limiting. E7 passed the source gate but supplied neither an exact earlier
4xx integer nor a finer provider-envelope cause. Treating either result as a
diagnosis would invent evidence and imply unjustified transport consequences.

Revisit when: a new separately authorized, bounded evidence plan can establish
the missing distinction without reopening old canary authority.

### D1 — Separate discovery, acquisition and durable persistence

Liska records what was discovered, whether a request was actually attempted and
which exact bytes each destination verified. `not-attempted`, `declined`,
`unavailable`, `expired`, `failed` and `fetched` are evidence states, not UI
synonyms. New asset families earn support through bounded, provider-specific
proof rather than name or route guesses.

Evidence: E1, E2, E3

### D2 — Preserve the branch admission design without adopting XLSX support

The historical candidate kept exact direct identity, owner separation,
committed-raw replan, shared budgets, response MIME/length and structural OOXML
gates separate from images and legacy interpreter XLSX. The reviews/tests are
useful design evidence, but no canary acquired the workbook. Retain that history
without importing the implementation or treating its runtime profile as main's
contract; ordinary direct XLSX remains unaccepted.

Evidence: E2, E4, E5, E6, E7

### D3 — Preserve source attribution as historical diagnostic evidence only

The branch distinguished `source-http-4xx`, `source-http-5xx` and
`source-http-other` from `source-response-processing-rejected`, retaining the
legacy generic code for mixed-version cleanup. This was a candidate-specific
diagnostic split, not current-main behavior adopted by these docs. Its only
extra local diagnostic approval was a 400–499 integer without URL, status text,
headers, body, credential, identifier, new request, retry or timing changes.
It did not fire in E7 and established no specific earlier cause.

Evidence: E5, E6, E7

### D4 — Retire the unaccepted candidate with its canary authority spent

E7 consumed the final explicit approval without byte acceptance. Intended
disposition is to merge the docs-only evidence PR, then close PR #89 unmerged
and retain `codex/chatgpt-ordinary-xlsx` as historical evidence. This records an
unaccepted, retired capability, not a new mainline implementation or permission
for another canary, code change, retry, envelope diagnostic or transport redesign.

Evidence: E6, E7

### D5 — Admit one attachment family only through a complete capability bundle

Adopt ADR-064's staged-only ordinary direct PNG offline contract. Whole-ledger
identity and interpreter ownership are evaluated before one candidate is
selected. Real byte validation remains inside the acquisition core; the caller
supplies only exact effect capabilities. The binary sink owns staging/cleanup
from invocation, and uncertain outcomes never become fetched assurance.

Keep every other family, manual default and live provider adapter outside this
decision. The offline proof grants no installed-run or account-wide authority.

Evidence: E1, E2, E8, E9

Decision record: ADR-064

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

### T3 — Revisit ordinary XLSX only through a new evidence plan

The retired experiment is not an open implementation or acceptance step.
Any later candidate must independently establish scoped identity/ownership,
provider evidence and bounded, expected-length structural byte validation,
plus exact File/Obsidian manifest/canonical/path/hash agreement and privacy.
The old branch's design and negative canaries are evidence, not authority.

Trigger: a new, separately authorized evidence plan defines whether and how to
investigate the unresolved provider envelope or attempt new XLSX acceptance.
Until then the final canary approval remains spent and no further run follows.

### T4 — Bind and accept a live ordinary direct PNG adapter separately

The offline capability proof does not establish that current provider traffic
offers a useful eligible direct PNG or that a live adapter preserves the exact
three-capability boundary. Do not infer support from synthetic byte acceptance.

Trigger: a separately authorized installed plan binds the exact resolver,
browser-managed fetch and single-binary sink without enabling numeric, active,
Library, interpreter, XLSX, recapture or fallback routes, then proves one
physical File/Obsidian byte outcome with privacy-safe receipts.

## Observations

- [hypothesis] H1: plausible provider pointers, names and media types initially appeared sufficient to identify assets
- [evidence] E1: real captures exposed incompatible pointer families and ambiguous preview records
- [evidence] E2: `fetched` now requires exact verified bytes, length, media type and SHA-256 per destination
- [evidence] E3: installed Obsidian append acceptance proved tail-only content-addressed image persistence #live
- [evidence] E4: unmerged PR #89 bounded and offline-tested one ordinary direct XLSX candidate, not mainline or live byte support
- [evidence] E5: the first historical installed XLSX canary ended before dispatch with ambiguous source-http-error and null binary truth #live
- [evidence] E6: the attribution branch canary proved only a source 4xx class before dispatch, not a specific cause or XLSX bytes #live
- [evidence] E7: the final branch canary passed source 200 JSON and dispatched once, but provider-status-other yielded no candidate or bytes and spent approval #live
- [evidence] E8: broad manual producer omissions could recapture raw, use global fetch or invoke runtime binary staging, so omission was not coordinator authority #code
- [evidence] E9: a complete staged-only ordinary direct PNG bundle now proves one offline resolver-to-destination chain without enabling another family #code
- [rejected] X1: guessed routes and reusable credential extraction exceed the evidence and privacy boundary
- [rejected] X2: ambiguity is not an explicit decline and must not be recorded as one
- [rejected] X3: later captures cannot silently authorize historical image backfill
- [rejected] X4: the retired XLSX candidate could not be identified safely as an image or by MIME/ZIP magic alone
- [rejected] X5: the historical ambiguous source error did not authorize retry or transport redesign
- [rejected] X6: source 4xx and provider-status-other did not establish a specific causal diagnosis
- [decision] D1: keep discovery, acquisition and durable persistence as separate evidence-bearing stages
- [decision] D2: preserve the unmerged branch admission design without adopting its implementation or claiming XLSX support
- [decision] D3: retain the candidate source-diagnostic split as history, not an adopted mainline contract
- [decision] D4: retire the unaccepted candidate after spent approval; merge evidence docs before closing #89 unmerged and retain the branch
- [decision] D5: admit one attachment family only through a complete staged capability bundle and keep live wiring separate
- [tail] T1: add attachment families only through provider-specific identity and byte proofs
- [tail] T2: keep orphan cleanup behind a separate reversible authority boundary
- [tail] T3: reopen ordinary XLSX only under a new separately authorized evidence plan, never the spent canary approval
- [tail] T4: bind and accept a live ordinary direct PNG adapter only through a separate installed plan

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
- S7 — unmerged [PR #89](https://github.com/la4ox/liska-threadkeeper/pull/89), historical [candidate head `f6fb659`](https://github.com/la4ox/liska-threadkeeper/commit/f6fb6591e9311932de29394798de42f5738861b7); branch-only design/review/test record, retired unaccepted
- S8 — local receipt `LISKA-XLSX-NORMAL-MODE-20261031`; visibility: local-only; safe aggregate only; historical ambiguous pre-dispatch failure
- S9 — local receipt `LISKA-XLSX-SOURCE-4XX-20261031`; visibility: local-only; safe aggregate only; historical pre-dispatch source 4xx class
- S10 — local receipt `LISKA-XLSX-PROVIDER-STATUS-OTHER-20261101`; visibility: local-only; safe aggregate only; [final evidence `a086fe3`](https://github.com/la4ox/liska-threadkeeper/commit/a086fe3af022b67dc2e52e2170677f1a0f961a08) and [safe aggregate hashes](../../STATUS.md#ordinary-direct-xlsx-experiment-retired-unaccepted--2026-11-01)
- S11 — [ADR-064: Admit one ordinary direct PNG family through explicit offline capabilities](../adr/064-explicit-ordinary-direct-png-acquisition.md), base main `c22aed4cb18b1311033533cd4e1c75a9ce825be1`
