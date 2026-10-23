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
  with no doubled capture suffix. Fresh Obsidian vault reconciliation remains a
  later live gate for this specific all-branches presentation slice.
- Canonical research evidence remains typed rather than flattened. The live
  sample retained citations, reasoning, code, execution output, tool roles and
  attachment blocks; projection regressions account explicitly for citation
  and Canvas omissions.
- Still open in the presentation layer: identity-safe replacement (rather than
  additive retention) of provider `sandbox:` links and a live chat containing
  multiple same-title produced files. None authorizes a broader resolver route.

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
  and write passes. Exact physical accounting for destination-divergent finalized
  companions and acquired binary bytes remains a separate bounded follow-up.

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

### 7. User-facing derived outputs

- Render canonical archives to HTML/PDF after capture fidelity is stable.
- Design image-aware append behavior for existing Obsidian notes.
- Add an explicit snapshot deduplicator; never replace immutable captures by
  default.
- Consider manual/automatic backup orchestration only after manual capture and
  recovery paths are boringly reliable.

### 8. Remaining hardening

- Shared graph membership validation is now linear, ChatGPT sandbox-link parsing
  is bounded, and DeepSeek normalization has an explicit post-raw node ceiling.
- Finish aggregate limits for branch materialization and destination writes.
- Re-run focused security/diff review at meaningful boundaries, not after every
  cosmetic change.
- Continue repository-wide triage and the untouched-provider upstream audit in
  the [security follow-up plan](security-todo.md).

### 9. Adjacent provider: Dots chat export

- Treat Dots as a separate provider investigation, not as another ChatGPT URL or
  a DOM-selector variant.
- First identify the authenticated page-owned conversation transport, raw graph
  or event model, current-thread identity, pagination, branches, tool content,
  media, and attachment families without reading unrelated Dots/account state.
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

Validate and merge the all-branch receipt checkpoint from pull request 18 on top
of the landed PR 16 and 17 work, then retarget and merge the already reviewed
physical-budget checkpoint. The 1 GiB source-work limit remains a deliberate
refusal for the measured 1.051 GiB graph; only a separately reviewed limit change
may authorize that full 239-leaf run. Continue with sandbox-link localization
after the stack is linear again. Keep custom-GPT/project binaries and the sole
archived Library WebP separately evidence-gated.
