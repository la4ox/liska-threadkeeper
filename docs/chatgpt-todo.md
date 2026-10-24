# ChatGPT follow-up plan

This is the short continuation plan for the ChatGPT exporter. Confirmed state and
evidence receipts remain in [`STATUS.md`](../STATUS.md); architecture and privacy
boundaries remain in [ADR-031](adr/031-loss-aware-archive-pipeline.md) and
[ADR-032](adr/032-staged-large-chatgpt-capture.md).

## Working baseline

The minimum useful ChatGPT path is live-verified:

- no-scroll exact graph capture with raw, manifest, canonical JSON, and Markdown;
- provider-current, explicitly selected, and all-leaf branch presentations;
- Downloads and Obsidian with destination-specific, hash-verified results;
- Canvas and loss-aware canonical blocks;
- current DOCX/PDF interpreter attachments;
- bounded sequential PNG acquisition, including historical assets;
- custom-GPT/project graph capture with an explicit archive-only attachment
  policy, durable warning, and zero binary authority;
- preview-shaped records retained with provenance and ordinary eligibility
  unless a future structural relationship proves a narrower asset family.

Every new slice must preserve raw bytes, append-only capture history, explicit
terminal states, and the existing no-credential-export boundary.

## Priority queue

### 1. Ordinary image families

- Add evidence-gated active support for `image/jpeg`, then GIF/WebP where live
  raw shapes and helper behavior actually match supported routes.
- JPEG is live-verified and enabled for the ordinary route. Explicit Library-ID
  evidence fails closed before active and passive winner selection, and
  PNG/JPEG bytes receive bounded structural validation before hashing.
- Archive reconnaissance found no ordinary GIF and only one WebP, which carries
  explicit Library-ID metadata and no captured binary. It is not ordinary-route
  evidence; GIF/WebP active widening remains deferred.
- Keep derived previews and ordinary images distinct before resolver dispatch.
- Preserve original bytes; do not introduce compression as an archival default.
- Live gate: fresh and historical examples, exact PNG/JPEG signatures,
  length/SHA-256/path reconciliation, byte-identical Downloads/Obsidian copies,
  and no leftover temporary tabs.

### 2. Special ChatGPT attachment families

- Classify and implement Library-ID assets separately.
- Offline classification is implemented without transport authority: exact raw
  source refs produce only opaque associated/ambiguous asset IDs, while
  malformed, conflicting or stale evidence fails closed.
- One exact Library-associated JPEG is live-verified through a separate planner
  and the existing page-owned file-ID transport. It consumes one of four active
  image slots; only the exact direct attachment ID can authorize the request.
- Pointer-only aliases may lose to that exact direct record, but malformed,
  nonempty direct, Library-bearing and interpreter-owned siblings remain hard
  blocks before eligibility.
- Library/gizmo/project/template identifiers are raw-only in canonical output;
  custom-GPT/template context retains only bounded boolean association facts.
- Custom-GPT/project route preservation and raw ownership classification are
  implemented. Live custom-GPT and project captures preserve complete raw and
  canonical evidence; a project sample retained nine attachment references as
  `not-attempted`, emitted one durable policy warning, and performed no binary
  work. Owner slugs/paths remain runtime-only.
- Do not guess `gizmo_id`, project IDs, or borrow the ordinary-chat route.
  Owner-context binary acquisition remains a future evidence-gated contract.
- Keep file-ID, interpreter/sandbox, Library, and future provider families
  discriminated in plan, audit, and terminal state.
- Live gate each family independently before enabling it generally.

### 3. Deep Research binaries and collisions

- Reconcile research-produced files, images, citations, and tool events without
  flattening canonical evidence.
- Preserve content-addressed binary names and explicit provenance when several
  research outputs use similar titles.
- Verify that legacy Markdown omissions are completely explained by canonical
  blocks and asset states.
- The current-branch destination-receipt slice is implemented and live-verified
  on a standard research-heavy chat. One produced DOCX reached Downloads and
  Obsidian under the same SHA-256 path; each note carries its destination's
  exact final manifest hash and one verified local archive link.
- Archive-bound Markdown now uses capture-scoped filenames and never overwrites
  an occupied path. Synthetic regressions cover identical display intent with
  distinct content paths, destination divergence, repeated capture writes, and
  equal bytes retained under distinct allowed MIME-derived targets.
- Ordinary append lookup also excludes every same-conversation note carrying a
  top-level archive-capture, manifest-hash, or presentation-mode marker. A later
  mutable export therefore cannot append to or overwrite an immutable snapshot.
- All-branches leaf notes and their index now consume strict destination-owned
  archive receipts. They preserve their prepared filenames, carry the exact
  final manifest hash, and expose only that destination's confirmed
  capture-level local attachment links. Missing or hostile receipt input blocks
  only the affected destination before presentation dispatch.
- A live File canary reconciled raw, manifest and canonical provenance; both its
  leaf and index contain the same exact manifest SHA-256 and the same resolving
  content-addressed DOCX link. The index points to the exact emitted leaf name,
  with no doubled capture suffix.
- A later two-destination canary repeated the same provenance checks in both
  Downloads and Obsidian. Their archive/DOCX bytes and hashes match; File and
  Obsidian leaf sizes differ only through the expected destination-specific
  long-message transform, and each exact serialization is budgeted separately.
- Canonical research evidence remains typed rather than flattened. The live
  sample retained citations, reasoning, code, execution output, tool roles and
  attachment blocks; projection regressions account explicitly for citation
  and Canvas omissions.
- Current and selected single-branch notes now replace only an exact
  destination-owned, fetched `sandbox:` occurrence. Every mismatch retains the
  provider link and verified appendix; raw/canonical evidence is unchanged.
- A fresh live legacy chat confirmed three same-title groups in one complete
  archive: two PDF records, five DOCX records, and three further DOCX records.
  All ten retain distinct opaque asset identities and canonical entries. Its
  raw owner context is unsupported or ambiguous, so acquisition correctly made
  no resolver calls and left every record `not-attempted` without SHA-256 or a
  local path. This closes the live identity/preservation collision gate, but not
  destination naming for multiple fetched same-title binaries and does not
  authorize a broader resolver route.

### 4. Real wide-branch stress

- Run selected-branch and all-branches export on a genuinely wide private graph.
- Measure picker responsiveness, sequential write volume, index correctness, and
  cancellation behavior.
- Add picker virtualization only if live evidence shows it is necessary.
- Introduce an aggregate all-branches work/write ceiling before exporting an
  unusually wide graph automatically.
- Implemented: one prepared validation/catalog session, O(1) ordinal lookup,
  parent-only path reconstruction, exact two-pass File/Obsidian byte accounting,
  terminal exact-name File receipts, per-destination failure isolation, and a
  trusted cooperative Stop control. Structural rejection precedes every write;
  byte rejection retains confirmed archive evidence but writes no branch view.
- Synthetic evidence now covers 12,000 depth, 400 shared-prefix leaves, 80-leaf
  task-yield cancellation, exact cap boundaries, settings drift, midnight
  filename stability, destination-specific transforms, unknown Downloads
  ownership, and index suppression.
- Live evidence: a one-leaf File bundle passed with exact branch/index filenames,
  a resolved index link, and hash-bound raw/manifest/canonical companions. The
  239-leaf private graph reached a usable picker in about 65 seconds; picker
  cancellation wrote nothing.
- The same live graph correctly refused `Export all branches` before any output
  at the 1 GiB expanded-source-work ceiling. Its existing matching canonical
  snapshot measures 2,285 nodes, 239 leaves, 68 branch points, 230,694 path
  visits, and 1,128,535,662 expanded source bytes (1.051 GiB). Do not raise the
  ceiling silently. Maintainer decision: keep the refusal, or review a 1.25 GiB
  bound and then run the complete File/Obsidian write/index reconciliation.
- Exact Markdown accounting now includes destination-finalized provenance and
  attachment-link decoration, guarded by filename/length/SHA parity between dry
  and write passes.
- Exact retained-byte accounting is implemented for each successfully finalized
  destination: its final raw/manifest/canonical trio plus every confirmed binary
  once, never once per branch. Initial representable seeds above 2 GiB reject
  before Markdown measurement. The remaining broader problem is a per-write
  ledger for raw/binary residue when a destination fails later finalization;
  this checkpoint is not a whole-operation pre-write disk cap.

### 5. Real staged capture above 16 MiB

- Verify a real provider raw response above the inline threshold through staged
  OPFS transport, not only synthetic fixtures.
- Reconcile raw/manifest/canonical hashes, UTF-8 chunk boundaries, cleanup,
  File/Obsidian release, and worker restart behavior.
- Keep the existing 64 MiB raw boundary until evidence justifies changing it.

### 6. Additional binary types

- Exercise currently available XLSX, PPTX, ZIP, text, audio, and video examples.
- Add a provider route only after identifying its exact live contract.
- Keep unsupported or unavailable files as honest retained references rather
  than silently dropping them.
- Generic ZIP is now live-confirmed through the existing page-owned/interpreter
  evidence route. Two content-addressed files (6,545 and 7,055 bytes) opened as
  readable seven-entry archives, matched canonical length/SHA/path evidence, and
  contained no Office package markers. Acquisition now requires exact
  `application/zip` plus a bounded ordinary-local-header or empty-EOCD prefix
  and minimum fixed-record length before hashing. This is not full archive
  integrity validation; split/SFX ZIP remains unsupported without evidence.
- The same live capture kept five PPTX and two text/plain references
  `not-attempted`. ZIP success does not authorize relabeling those records or
  claim Office-package support.
- A separate fresh ordinary-owner capture retained two `text/csv` references as
  distinct `not-attempted` assets while the evidence-backed active route fetched
  only four JPEG images. No CSV bytes, local paths, or SHA-256 claims were
  created. CSV therefore remains unsupported until an exact live resolver route
  is observed.

### 7. User-facing derived outputs

- The pure `liska-html/1` renderer and opt-in current/selected File delivery are
  implemented. HTML is derived only from a hash-verified canonical archive and
  carries a deterministic provenance receipt; it is never reconstructed from
  legacy Markdown.
- Destination-finalized asset binding is implemented for current/selected File
  snapshots. A real archived JPEG passed exact byte/path/hash reconciliation,
  rendered through a local content-addressed image reference, and retained an
  honest placeholder for its unbound sibling.
- The pure all-branches core is implemented: closed ordinal-derived branch/index
  artifact contracts plus one prepared rendering session validate graph and
  bindings once, render leaves without repeated whole-graph traversal, and
  accept only complete same-session facts for a deterministic local index. This
  is not yet delivery evidence.
- B2a background persistence is implemented but not yet invoked by the exporter:
  one closed leaf/index artifact can write HTML and then a locally built receipt
  with independent confirmed/unknown/not-dispatched outcomes, exact settings and
  sender admission, one-send transport and no retry/completeness claim.
- B2b canonical authorization is implemented but not yet invoked by the
  exporter: a target-free finalized File context authorizes canonical bytes once,
  prepares one B1 session and builds leaf/index artifacts on demand through the
  B2a seam without caching HTML or claiming delivery.
- Next HTML slice (B3): two-pass measurement/recreation, aggregate HTML
  work/write accounting, cancellation, unknown-write stop and independent
  Markdown/HTML bundle completion, followed by the explicit bootstrap hookup.
- Automatic PDF remains a separate transport/rendering decision after HTML
  bundle behavior is stable.
- Design image-aware append behavior for existing Obsidian notes.
- Add an explicit snapshot deduplicator; never replace immutable captures by
  default.
- Consider manual/automatic backup orchestration only after manual capture and
  recovery paths are boringly reliable.

### 8. Remaining hardening

- Repair current ChatGPT capture compatibility as a separate slice. Fresh live
  historical-image retries confirmed three honest pre-destination stops:
  A-strict can reject a newly observed opaque path, passive structured capture
  can time out after the page uses a different request family, and the DOM
  fallback currently finds no primary turn selectors on that UI. Do not weaken
  complete-graph claims or fold this provider drift into HTML asset binding.
  The timeout is specifically the 15-second no-claim timer for the legacy
  queryless singular request, not a payload/image timeout. First add value-free
  strict-replay mismatch categories, then inspect current live turn attributes;
  widen neither route equivalence nor DOM selectors without that evidence.
- Shared graph membership validation is now linear, ChatGPT sandbox-link parsing
  is bounded, and DeepSeek normalization has an explicit post-raw node ceiling.
- Settings-stable durable routing is implemented across first-party archive,
  binary, and Markdown writes. Every new write carries a detached, secret-free
  settings snapshot; background rejects drift or a newly disabled destination
  as `settings-changed` before dispatch. This is an admission-time guarantee,
  not atomic cancellation or fixed physical-vault identity.
- Staged settings mismatch can exact-abort only the named temporary stage after
  ordinary sender validation. Cleanup failures retain only the fixed
  archive/binary cleanup-deferred warning; arbitrary private errors do not cross
  the boundary.
- Operation-local all-branches write accounting is implemented for raw,
  manifest, canonical, and binary attempts. Confirmed and unknown bytes from
  every requested destination seed the physical budget; not-dispatched attempts
  charge zero. Receipts are not added twice and remain the sole authority for
  Markdown/index eligibility, provenance, links, fetched assets, and
  localization.
- Sink outcomes are exact opt-in evidence. Legacy durable callers and ordinary
  Markdown retain their old response shapes. Cleanup failure cannot erase a
  confirmed write, while malformed/incomplete/foreign ledger evidence blocks
  further Markdown instead of selecting receipt-only fallback.
- The automatic ledger consumer remains all-branches only. Current/selected and
  DeepSeek expose the optional seam but do not manufacture unused audit state;
  no persistence across browser/worker restart, retry, deletion, recovery, or
  net-disk claim is implied.
- Typed DOM history loading is now separate from archive completeness. Known
  partial Base/Gemini results cannot replace a longer exact same-conversation
  mutable Obsidian note, and an untrusted old count fails closed before image or
  Markdown writes. New partial notes, File/Clipboard, valid complete/unknown traffic,
  and immutable snapshots retain their earlier behavior. This is a count-based
  shrink guard, not proof of prefix alignment.
- Finish aggregate limits for branch materialization and destination writes.
- Re-run focused security/diff review at meaningful boundaries, not after every
  cosmetic change.
- Continue repository-wide triage and the untouched-provider upstream audit in
  the [security follow-up plan](security-todo.md).

### 8. Official export import and cross-format reconciliation

- Pure core implemented: stream a bounded official conversations array, select
  one exact provider ID, and retain only that object's original bytes with
  index/offset/source-length provenance. No neighboring conversation content is
  copied into the result.
- Official captures use an explicit file-slice source instead of a fabricated
  HTTP endpoint. Existing web and DeepSeek manifest bytes remain unchanged.
- Official parent-only graphs derive child links in parsed mapping order and
  disclose that derivation. Mixed explicit/derived links fail closed; metadata
  lineage never overrides node `parent`.
- Asset descriptors are preserved as metadata-only `not-attempted` records.
  This core does not search the export directory or infer binary ownership.
- Canonical refusal returns `raw-only` with the verified excerpt and manifest;
  it never upgrades a failed graph to a complete archive.
- Local evidence covers the real 109,346,038-byte export and one real branched
  conversation without logging content. See ADR-037 and STATUS.
- Pure compare-only core implemented: `liska-chatgpt-comparison/1` accepts one
  web and one official canonical snapshot of the same exact conversation,
  scopes every fact left/right, and reports exact-ID matched, source-only, and
  typed conflicting facts without copying conversation prose or merging inputs.
- A private content-free real pair exposed 200 web-only nodes/messages while all
  42 exact asset IDs matched. This is retention evidence, not proof of why the
  official export omitted those nodes or that either source is complete. See
  ADR-038 and STATUS.
- Do not merge canonical archives yet. Source refs currently name artifact IDs
  without capture IDs, so concatenating provenance across snapshots would be
  ambiguous. Do not infer equality from title, timestamp, filename, archive ID,
  or current-branch Markdown.
- Next slice: an explicit user-selected local flow for official import plus a
  durable bounded comparison artifact beside both unchanged source snapshots.
  Browser file picker, export ZIP discovery, external binary import, archive
  merge, and snapshot deduplication remain later explicit slices.

### 9. Adjacent provider: Dots chat export

- Treat Dots as a separate provider investigation, not as another ChatGPT URL or
  a DOM-selector variant.
- Confirmed false positive: two trusted clicks on `https://chatgpt.com/dots/home`
  produced separate 9,091-byte files that were identical after removing only
  generated ID/timestamps. They were labelled `source: chatgpt`, used a
  timestamp-derived identity, and contained only ten visible DOM messages (five
  user/five assistant) with no raw, manifest, canonical archive, or loss warning.
  This is not Dots support.
- First safety slice implemented: classify `/dots` and `/dots/*` before ordinary
  ChatGPT extraction, suppress both misleading ChatGPT controls, and prevent
  direct sync from reaching Base DOM fallback. An explicit Dots-specific user
  surface remains part of the real adapter; this guard does not claim support.
- First identify the authenticated page-owned conversation transport, raw graph
  or event model, current-thread identity, pagination, branches, tool content,
  media, and attachment families without reading unrelated Dots/account state.
- Probe design gate: do not add a generic same-origin request observer. Unknown
  path segments and query-key names can themselves disclose memory/persona or
  account data. Require one independently grounded conversation-history route
  grammar first; observe only that exact candidate in the selected top-frame
  document under one trusted, short-lived capability. No reload/disposable tab,
  request generation, header values/content-type, body, cookies/storage, or
  dynamic allowlist learning.
- Preserve one exact conversation-scoped raw artifact before designing the
  provider adapter; retain unknown event types instead of flattening them.
- Map verified Dots raw data into `liska-thread/1`, then reuse existing Markdown,
  branch, Downloads, and Obsidian layers only where their contracts really fit.
- Keep Dots memory/persona configuration, global activity, and unrelated dot
  conversations outside capture scope unless the user explicitly selects them.
- Evidence gate: synthetic fixtures from a sanitized live shape, one ordinary
  live current-chat capture, explicit loss diagnostics, and a separate
  attachment/branch assessment before enabling the provider generally.

## Deliberate non-goals without new evidence

- No broad cookie, storage, bearer, or device-header extraction.
- No automatic endpoint fallback, retry fan-out, or parallel active resolver
  workers.
- No hidden reusable authenticated browser daemon.
- No inferred branch, provider ID, Library relationship, or source-document link.

## ChatGPT phase exit criteria

The ChatGPT block is ready to call broadly complete when:

1. current, selected, and all-branch modes pass representative live graphs;
2. ordinary images, interpreter documents, Library/custom-GPT assets, and Deep
   Research files have explicit supported or unsupported contracts;
3. real staged capture above 16 MiB passes both durable destinations;
4. every omission is recoverable from raw/canonical evidence or carries an
   honest terminal reason;
5. full tests, coverage, build, lint, independent review, and compact live
   receipts are green.

## Exact next step

Finish the compare-only cross-format core PR, then add an explicit local delivery
flow: the user selects an official export and an existing web canonical snapshot,
the exact-ID comparator runs under its current hard ceilings, and a separate
content-free report is durably written beside both unchanged source snapshots.
Keep archive merge/deduplication, the 1 GiB source-work refusal, real staged

> 16 MiB gate, fetched same-title destination naming, custom-GPT/project
> binaries, and the archived Library WebP as separate evidence-gated work.
