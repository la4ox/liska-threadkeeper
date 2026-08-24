# ADR-031: Separate Capture, Canonical Archive, and Presentation

## Status

Accepted as the architectural direction on 2026-08-13. The canonical wire
schema remains experimental until it is validated against real and synthetic
ChatGPT graph fixtures.

## Context

Liska currently extracts a selected conversation path into a flat
`ConversationData.messages` array and immediately turns that array into a
Markdown note. That is sufficient for the existing user-visible export, but it
cannot represent a full branch graph, empty structural nodes, ordered tool and
reasoning blocks, general attachments, Canvas history, or unknown provider
fields without losing information.

The local `chat-archive-reader` demonstrates that ChatGPT exports require the
complete `mapping`, including `parent`, `children`, `current_node`, hidden
messages, system and tool nodes, attachments, and provider-specific content
types. It can navigate the graph, but its normalized message model still
flattens structured content into text before Markdown export.

A separate AI Exporter sample inspected during this decision contained 23 flat
message rows with 73 ordered text blocks and 7 attachment blocks. Its Markdown
projection preserved all 73 text blocks but omitted all 7 attachments, message
IDs, model fields, and some timestamps. The JSON contained no parent, child,
current-node, or branch fields. This confirms that a third-party "JSON export"
is not necessarily raw or lossless.

A later field-name-only probe of locally saved ChatGPT raw captures found three
coexisting attachment families: `sediment:` pointers, older `file-service:`
pointers, and metadata-only records that retain an opaque provider ID but no
ready download URL. Message text, attachment names, identifiers, and transport
values were not emitted by the probe. This rules out a single guessed URL
template and makes acquisition state part of the evidence rather than an
implementation detail.

The long-term product may grow beyond a browser export button into a modular
local archive, renderer, synchronization tool, bridge, and scheduler. Those
roles need explicit boundaries before the ChatGPT no-scroll path is added.

## Decision

Every web-provider path will be split into three stages:

1. **Capture** stores source-specific raw artifacts from one conversation.
2. **Normalize** deterministically derives a versioned Liska archive graph.
3. **Present and deliver** derives Markdown, HTML, PDF, Obsidian notes,
   clipboard content, bridge briefs, or future formats from the canonical graph.

Presentation code must not parse provider responses. Provider capture code must
not format Markdown or call Obsidian. Normalizers must remain pure enough to run
against saved raw fixtures without a signed-in browser.

### 1. Raw capture layer

A capture is an immutable, local snapshot of the data available for one
conversation at one moment. It may contain multiple artifacts rather than one
assumed response:

```text
captures/<capture-id>/
  manifest.json
  responses/conversation.json
  responses/other-provider-payload.json
  assets/<provider-or-content-addressed-name>
```

The first browser implementation may download these as separate files. A ZIP or
directory bundle is a packaging decision, not part of the semantic contract.

The capture manifest records:

- provider, conversation ID, capture ID, timestamp, and capture method;
- artifact media type, byte length, SHA-256 digest, and source endpoint name;
- discovered asset references, exact raw pointers, attempt timestamps, and
  explicit states: not-attempted, fetched, unavailable, declined, expired, or
  failed;
- completeness claims, warnings, and observed unknown content types.

When possible, response bodies are retained byte-for-byte and hashed before
parsing. Raw snapshots are never overwritten; a later capture creates a new
capture ID.

Asset states are intentionally not interchangeable:

- **not-attempted** means Liska discovered the reference but made no network
  request;
- **declined** means an explicit user or bounded policy choice skipped it;
- **unavailable** means no safe acquisition route is known or the provider
  explicitly reports the object unavailable;
- **expired** is used only when provider evidence identifies an expired
  temporary transport, not as a guess for every 403/404 response;
- **failed** records an attempted acquisition whose result is not known to be
  permanent;
- **fetched** requires exact local bytes, media type, length, and SHA-256.

The runtime capture bundle must carry the exact bytes for every asset marked
`fetched`; shape validation compares the full manifest record and byte length,
then integrity validation recomputes SHA-256 before normalization.

A separate provider-neutral binary persistence route is now implemented as a
dormant destination primitive. Content sends independently canonical 512 KiB
base64 chunks, the extension-owned offscreen document stages them in OPFS,
and finalization rechecks exact length and SHA-256 before one content-addressed
file is offered independently to Downloads and Obsidian. Clipboard is excluded;
active/macro-capable media types are rejected; existing destination paths are
never overwritten; and cleanup targets only the exact random stage ID. The
first slice intentionally bounds one asset to 64 MiB because Obsidian upload
and readback still materialize one file at a time. A later fully streaming path
may raise that bound without changing the archive contract.

Downloads cleanup cannot depend on one service-worker closure. Before starting
a binary File download, Liska persists a bounded provisional ownership record
containing only the random stage ID, extension-owned Blob URL, timestamp, and a
temporarily null Downloads ID. Chrome's callback atomically fills that ID. A
top-level Downloads listener and browser-startup reconciliation can therefore
exact-release or exact-abort the stage after MV3 suspension/restart. The live
worker retains an in-memory ownership marker across File and Obsidian siblings
so a fast File terminal event cannot revoke the Blob while Obsidian still reads
it; a restarted worker naturally has no such marker and recovers the durable
record. No archive content or provider identifier enters this registry.

A Comet live smoke confirmed the destination primitive with a fixed six-byte
synthetic asset. Downloads retained the exact bytes and content hash while
Obsidian was offline and reported a separate fixed preflight failure; a fresh
capture after Local REST API resumed wrote byte-identical content-addressed
files to both durable destinations. The smoke made no provider request and did
not read conversation content. Deliberate worker-suspension recovery remains a
synthetic lifecycle test rather than a forced interruption of a live browser.

The initial ChatGPT JSON companion writer still rejects runtime asset bytes.
The destination-honest image-export path uses a separate binary-aware finalizer
only after raw and binary destination outcomes exist, so the ordinary capture
route still cannot publish a premature fetched manifest/canonical claim.

The first page-owned acquisition boundary is explicit and remains disabled in
the default structured capture. The image-export path may opt in only after raw
persistence succeeds. For the opaque replay route, a separate marker-gated tab
then observes the exact eligible page-owned plural request without reading its
body. ChatGPT defers attachment rendering in hidden documents, so this trusted
click briefly foregrounds the observer tab and exact-closes it afterward. It
dispatches zero singular graph requests. A dedicated hard eight-second window
starts immediately before the eligible source fetch because cached UI state may
issue a resolver before the source Response settles. Observations are published
only after both source `200 JSON` validation and window expiry, in either order.
At most 32 resolver responses of at most 64 KiB each are cloned. Request header
values, cookies, request and plural-response bodies, browser storage, DOM, and
authentication middleware are never read. Background revalidates the resolver
bytes and only an opaque, domain-separated key plus a strictly allowlisted
transient signed estuary URL cross back to the content script. Literal
URL/path/raw-query grammar prevents normalization from widening this boundary.
The route grammar follows current public frontend source rather than prefix
guessing: legacy `/backend-api/files/download/{file_id}` accepts only the exact
two-key conversation/inline query or the exact three-key variant whose context
scope equals the same conversation; automatic cache resolution may instead use
exact query-free `/backend-api/calpico/chatgpt/files/{file_id}`. Calpico has no
request-level conversation field, so its result is usable only after background
validates the signed URL's conversation and content re-matches the opaque file
key against a unique pointer in committed raw.

Pure matcher and credentialless acquisition helpers bind those opaque keys to
exact ledger source pointers and fetch only the already signed asset URL with
omitted credentials, disabled redirects, passive MIME allowlisting, timeouts,
per-asset limits, attempt limits, and a cumulative read-work budget. Every
bounded body read consumes that budget even if later hash or asset validation
rejects the bytes.

The integrated orchestration is gated by the existing
`Export images & attachments` setting and at least one durable destination. The
historical setting currently defaults on, but every export still requires a
trusted user click. The pipeline first commits the original raw
artifact and carries forward only raw-successful destinations. A zero-asset
ledger skips resolver observation. In opaque replay mode the post-persistence
observer is the only resolver route; failure never falls back to the legacy raw
recapture. Each safe resolver key must uniquely match a provider identifier at
an exact ledger pointer in the reverified committed raw before acquisition can
start. This is committed-raw identifier correlation, not a claim that the
plural response is byte-equal to the hidden full-graph replay. Ordinary capture
retains the older byte-equality recapture path. Verified bytes are acquired once
and staged to all surviving destinations. Each destination then receives its
own manifest/canonical pair: `fetched` requires an exact matching descriptor and
successful write there; every other state is recorded without a dangling local
path. Raw is never rewritten, signed URLs/provider IDs remain transient, and
all-branches presentation proceeds only for destinations whose companion pair
completed. This order is covered offline and awaits one trusted-click live
smoke with real ChatGPT attachments.

ChatGPT's newer virtualized UI may request only
`/backend-api/conversations/{conversationId}?include_has_versions=true&num_turns=10`
and never issue the legacy full-graph request observed by the original capture
bridge. A disabled-by-default metadata-only `A-strict` probe now tests whether
that plural request can serve as an opaque authorization template without
crossing the credential boundary. The page closure uses captured
Request accessors/`Request.prototype.clone` as the native brand check, requires
the exact raw path/query, and classifies only absent, ordinary empty, or exact
signal-only `RequestInit` without reading property values. It reads only the
non-secret credentials mode, boolean result of `Headers.has('authorization')`,
source status, and JSON media type. It neither reads a response body nor
dispatches the singular request; its exact result structurally fixes
`singularDispatchCount` to zero. Live cold/warm runs returned
`eligible-init-empty` twice.

A separate, disabled-by-default one-shot replay is therefore available as an
explicit experiment. Probe and replay settings are mutually exclusive, with
stale dual-true state canonicalized to probe-only. The eligible source Request
clone remains inside the MAIN-world closure. Browser-native `Request` copies
its Headers object opaquely into one exact same-origin singular GET with source
credentials, a fresh abort signal, `redirect: error`, and `cache: no-store`.
The captured previous fetch is called exactly once; there is no retry or DOM
fallback. Only the singular 200 JSON response may be read under the 16 MiB cap.
Page and background independently enforce exact shape, canonical base64,
length, SHA-256, conversation binding, deadline, abort, and cleanup before the
existing raw/manifest/canonical pipeline accepts the artifact. The active path
is live-verified on a File-only stress capture: raw SHA-256/length matched its
manifest, raw and canonical retained the same 1,083-node graph/current node,
and no marker tab, DOM fallback, credential text, or signed transport value
remained. Attachment acquisition stayed disabled; all 64 discovered references
remained explicitly `not-attempted`. The later replay attachment path now uses
the separate post-persistence zero-dispatch observer described above and is
offline-tested, but its page-owned resolver behavior still requires a live
smoke. Explicit bearer, cookie, device-ID, source-body, DOM, or header-value
extraction remains forbidden even as a fallback.

The first live cold/warm-equivalent smoke of that observer completed twice on
an older seven-reference conversation because a controller timeout obscured a
successful first click and prompted one retry. Both immutable captures retained
identical verified raw bytes, complete graph claims, seven `not-attempted`
assets, no binary/local claims, no durable signed transport values, and no
leftover marker tab. No page-owned resolver was observed. This proves bounded
failure behavior and honest persistence for that sample, not working binary
acquisition. A short conversation with one recent visibly loadable attachment
is the only remaining useful positive smoke; another empty bounded result must
stop the experiment without widening the privacy boundary.

A second live sample with 17 raw/canonical references also produced empty
background, foreground, and eight-second pre-dispatch observer outcomes. Its raw
held eight `sediment:` pointers and no signed URL, while the active page
structurally displayed one estuary image. A credential-free scan of the current
public React Router manifest and conversation modules showed that timing was not
the only gap: current `Vbt` can add a same-conversation context-scope query and
automatic file cache uses the Calpico endpoint above. The expanded exact grammar
is covered for every allowed ordering and adjacent rejection; its live result
also remained empty despite an observed foreground marker lifecycle. Passive
`window.fetch` observation is therefore exhausted for the current runtime. No
further path/window widening is permitted. A future active resolver replay must
be treated as a distinct threat boundary: bounded provider IDs may come only
from reverified committed raw, and exact resolver Requests may copy the eligible
source Headers object only opaquely inside MAIN world with fixed dispatch/work
budgets, no header-value extraction, no retry, independent response validation,
transient-only signed URLs, and a separate live smoke.

Discovering every reference does not make `completeness.assets` complete. Until
all selected binary acquisitions reach an evidenced terminal state, a
metadata-only inventory remains `not-attempted` (or `partial` after a mixed
attempt); `complete` is reserved for a capture that actually satisfied its
declared asset-acquisition policy.

The manifest maps an asset to one or more exact raw pointers. Signed URLs and
provider transport pointers may be used transiently to derive an opaque digest,
but are never persisted as canonical identifiers. Filename/size similarity is
not sufficient to merge two records automatically.

Retrying an old or partially available attachment never mutates the earlier
manifest. A later trusted attempt creates a new capture (or a future explicit
enrichment artifact) that links back to the earlier evidence by hash. This
keeps “missing then, available now” and “available then, missing now” as
observable history instead of whichever state happened to be written last.

The raw boundary is deliberately narrow:

- capture only conversation-scoped responses and assets, not the entire page or
  unrelated account state;
- never store cookies, Authorization headers, browser storage, bearer tokens, or
  request credentials;
- treat signed and temporary asset URLs as sensitive source data;
- keep raw output local and do not send it to Obsidian, clipboard, Drive, or any
  other destination by default;
- use an exact provider-host allowlist and require a trusted user action.

An API response is preferred because it can preserve the graph without virtual
scrolling. A DOM fallback remains valid, but its manifest must identify the
capture as `dom-derived` and must not claim unseen branches or nodes are
complete. Saving the whole application HTML is not the fallback default because
it can include unrelated interface and account data.

### 2. Canonical Liska archive layer

The canonical archive is derived data and can always be regenerated from its
referenced raw capture with the same normalizer version. Its working schema is
named `liska-thread/1`.

The provider-neutral envelope contains these conceptual sections:

```json
{
  "schema": "liska-thread/1",
  "archiveId": "chatgpt:<conversation-id>",
  "inputs": [
    {
      "captureId": "...",
      "manifestSha256": "...",
      "normalizer": "chatgpt-web/1"
    }
  ],
  "conversation": {
    "id": "...",
    "title": "...",
    "provider": "chatgpt",
    "url": "https://chatgpt.com/c/...",
    "currentNodeId": "..."
  },
  "graph": {
    "rootIds": ["..."],
    "nodes": {}
  },
  "assets": {},
  "diagnostics": {},
  "extensions": {}
}
```

Each graph node has a stable ID, optional parent ID, ordered child IDs, optional
message, and source references. Empty nodes remain valid structural nodes.
Parent and child links are both retained and checked for consistency.

Each message preserves:

- provider message ID, author role and name, recipient and channel;
- create and update timestamps, status, model, and visibility metadata;
- an **ordered** array of typed blocks rather than one flattened string;
- references to assets, citations, Canvas events, and tool calls/results;
- provider IDs and JSON Pointers back to the raw artifact.

The initial block vocabulary may include text, Markdown, HTML, code, reasoning,
tool call, tool result, execution output, citation, quote, attachment reference,
Canvas event, error, and unknown. Raw HTML remains inert data; escaping and
sanitization happen only in renderers.

Known provider-only fields live under namespaced extensions such as
`extensions.openai`. Unknown structures are not silently converted to a string:
the canonical node records their source type and raw reference, with a bounded
JSON value only when it is safe and useful to retain outside the raw layer.

The canonical schema will not copy every provider's spelling. Instead it keeps
stable semantics plus a crosswalk:

```json
{
  "sourceRefs": [
    {
      "format": "chatgpt.web.history",
      "kind": "message",
      "id": "provider-id",
      "rawPointer": "/mapping/provider-node-id/message"
    }
  ]
}
```

This permits a later official-export importer to map its own IDs and fields to
the same archive without pretending that web responses and official exports
have identical shapes.

Canonical assets are addressed by stable archive IDs and, after download,
content hashes. Signed URLs are not canonical identifiers. The asset manifest
preserves filename, MIME type, size, dimensions, source references, local
artifact reference, and acquisition state without embedding large base64
payloads in the main JSON.

### 3. Presentation and destination layer

Renderers consume only validated canonical archives. Initial graph views are:

- current or explicitly selected leaf as one linear conversation;
- every leaf as a separate document with shared ancestry identified;
- a graph index that links branches and their generated files;
- later, a single branching document if it remains readable.

The branch-view sequence keeps the existing current-branch export as the
one-click default. Its first working slice adds a local chooser whose selected
view targets exactly one declared leaf. Its second working slice writes one
all-branches index plus one complete root-to-leaf Markdown document per
declared leaf. Raw, manifest, and canonical artifacts remain once per capture
and durable destination rather than being copied into every presentation. A
missing `currentNodeId` does not prevent deterministic all-leaf enumeration.
The branch catalog stores only each leaf's target, counts, and unique suffix;
the shared root path is reconstructed lazily while one leaf is rendered and
written. This keeps a long common prefix from being multiplied in memory for
wide voice-chat trees.

Branch selection remains local and happens only after the trusted capture has
produced a validated canonical graph. Provider node identifiers are internal
selection capabilities; all-branch filenames, links, and frontmatter use an
opaque capture identity and the platform origin instead of provider
conversation identifiers. Capture-scoped names prevent selected/all-branch
views from silently overwriting another snapshot. The multi-document mode is
available only to durable File and Obsidian destinations. Clipboard remains a
single-document destination and reports that it skipped an all-branches bundle
instead of flattening or silently truncating it. An index is written to a
destination only after every intended leaf file was confirmed there; otherwise
the user gets a partial-bundle warning and the complete canonical archive stays
the recovery source.

Append, merge, automatic deduplication, and a monolithic branching Markdown
document remain separate later decisions. The initial implementation favors
complete, inspectable snapshots over implicit mutation.

Markdown, HTML, and future PDF are presentation formats, not backup sources.
PDF should normally be produced from the HTML presentation layer. Obsidian,
download, and clipboard are destinations; they do not own extraction logic.
Obsidian Local REST API is therefore optional and is never required to create a
raw or canonical local export.

Future bridge briefs, daily maps, project contexts, and model-assisted summaries
also belong to this derived layer. They must carry provenance pointers back to
canonical message and node IDs. Model output may propose summaries or links but
must never mutate raw captures or silently rewrite the canonical archive.

## Module boundaries

The exact directory layout may evolve, but the dependency direction is fixed:

```text
provider capture adapters
          |
          v
raw capture manifest + artifacts
          |
          v
provider normalizers --> canonical schema + graph validation
                                  |
                                  v
                     selectors / diff / merge
                                  |
                                  v
                     renderers and bridge views
                                  |
                                  v
                 download / clipboard / Obsidian
```

The intended product modules are:

- **Liska Capture**: privileged browser adapters and DOM fallbacks;
- **Liska Archive Core**: schema, validation, graph traversal, diff, and later
  snapshot materialization;
- **Liska Views**: Markdown, HTML/PDF, graph indexes, and bridge artifacts;
- **Liska Destinations**: download, clipboard, Obsidian, and future local stores;
- **Liska Orchestration**: optional scheduler/daemon and diagnostics, added only
  after manual capture is reliable.

Core normalization and rendering should be ordinary deterministic TypeScript,
independent of Chrome APIs. Browser privileges stay at the capture and
destination edges.

Large conversations must not require simultaneous in-memory copies of raw JSON,
canonical JSON, Markdown, and base64 assets. The storage boundary must allow
chunked or staged persistence before archive bundles grow beyond the current
extension-message limits. OPFS is a transient private staging boundary, not a
fourth archive destination: verified bytes leave it only for a user-selected
durable output, and stale exact stages are eligible for bounded cleanup on a
later staged begin.

## ChatGPT-first implementation plan

1. Define TypeScript types, JSON Schema, graph validators, and small synthetic
   fixtures for old/new ChatGPT graph variants.
2. Add a trusted-click, same-origin ChatGPT capture path that first saves the
   exact conversation response and capture manifest. Verify the live endpoint
   rather than hard-coding an assumed route from memory.
3. Implement a pure ChatGPT raw-to-`liska-thread/1` normalizer. Preserve every
   node, link, ordered block, known metadata field, and raw pointer.
4. Add JSON download as an output independent of Obsidian.
5. Render the current branch from the canonical graph and compare it with the
   existing DOM Markdown output. Keep the DOM extractor as a marked partial
   fallback.
6. Add selected-branch, every-leaf, and graph-index export modes.
7. Acquire and package attachments with explicit completeness diagnostics; then
   cover tool/system nodes, reasoning, citations, Canvas, and Deep Research.
8. Move DeepSeek onto the same canonical core after ChatGPT proves the schema.
9. Add official-export importers and cross-format reconciliation later, using
   source IDs and raw pointers instead of field-name guesses.

PDF, automatic scheduling, a local daemon, archive merging, Bridge/Ariadne
integration, and other providers are intentionally deferred until the first six
steps establish a loss-aware ChatGPT path.

## Verification contract

No personal raw conversation is committed as a fixture. Real captures are
validated locally, then reduced to synthetic or deliberately redacted cases.

For each provider fixture, tests must prove:

- raw artifact hash and manifest consistency;
- absence of request credentials in persisted artifacts and logs;
- exact node count and preservation of source IDs;
- valid roots, current node, parent/child symmetry, and cycle diagnostics;
- ordered block preservation, including interleaved reasoning and tool content;
- explicit retention/reference of unknown content types;
- attachment acquisition states with no silent omission;
- deterministic canonical JSON for the same input and normalizer version;
- correct selected-path rendering and all-branch enumeration;
- safe Markdown/HTML escaping at the rendering boundary.

Live smoke validation must include at least one long ChatGPT conversation with
branches and attachments. Tool/system messages, Canvas, and Deep Research need
separate fixtures because one conversation may not contain every format.

## Consequences

- Liska can preserve information that no current Markdown renderer displays.
- New renderers and destinations do not require another provider scrape.
- Saved raw snapshots can be re-normalized when provider formats or Liska's
  schema evolve.
- Official exports and live web captures can later be reconciled through stable
  source references without forcing identical provider schemas.
- The implementation initially becomes more explicit and produces more than one
  artifact, but format changes and partial captures become observable instead of
  silently destructive.

## Deferred TODO: explicit snapshot deduplication

- [ ] Add a separate, user-invoked archive analysis/deduplication action. The
      default capture path remains append-only: it never overwrites or silently
      deletes an earlier raw, manifest, canonical, or partial snapshot.
- [ ] Show an exact preview before cleanup: snapshots considered equivalent,
      evidence that would remain, estimated space recovered, and every path selected
      for removal. Any deletion requires a distinct confirmation.
- [ ] Preserve at minimum the first capture, latest verified capture, meaningful
      graph-change checkpoints, and partial/failure evidence useful for diagnosing
      provider drift or normalizer regressions.
