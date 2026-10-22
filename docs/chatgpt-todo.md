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
- policy-declined document-render previews that retain provenance without being
  misreported as missing user images.

Every new slice must preserve raw bytes, append-only capture history, explicit
terminal states, and the existing no-credential-export boundary.

## Priority queue

### 1. Ordinary image families

- Add evidence-gated support for `image/jpeg`, then GIF/WebP where live raw shapes
  and helper behavior actually match supported routes.
- Keep derived previews and ordinary images distinct before resolver dispatch.
- Preserve original bytes; do not introduce compression as an archival default.
- Live gate: fresh and historical examples, exact PNG/JPEG signatures,
  length/SHA-256/path reconciliation, byte-identical Downloads/Obsidian copies,
  and no leftover temporary tabs.

### 2. Special ChatGPT attachment families

- Classify and implement Library-ID assets separately.
- Derive custom-GPT/project context only from exact committed-raw evidence; never
  guess `gizmo_id` or broaden the ordinary-chat route.
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

### 4. Real wide-branch stress

- Run selected-branch and all-branches export on a genuinely wide private graph.
- Measure picker responsiveness, sequential write volume, index correctness, and
  cancellation behavior.
- Add picker virtualization only if live evidence shows it is necessary.
- Introduce an aggregate all-branches work/write ceiling before exporting an
  unusually wide graph automatically.

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

- Add shared structural work budgets to recursive ChatGPT/DeepSeek normalization.
- Finish aggregate limits for branch materialization and destination writes.
- Re-run focused security/diff review at meaningful boundaries, not after every
  cosmetic change.

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

Start with the existing fresh ordinary-chat fixture containing unresolved JPEG
ledger records. Determine its structural source shapes and whether the proven
ordinary image helper returns original JPEG bytes. Do not widen MIME eligibility
before that evidence.
