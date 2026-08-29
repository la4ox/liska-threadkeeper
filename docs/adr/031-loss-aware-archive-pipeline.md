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
persistence succeeds. Its first opaque-replay implementation was a separate
marker-gated passive observer: it read no plural source body or header value,
dispatched zero graph requests, and bounded response clones to 32 × 64 KiB.
Background validated base64, SHA-256, JSON, signed-URL conversation binding, and
exact raw-pointer correlation before a transient URL could cross to content.
Foreground, early-window, and both public route grammars all completed safely
but observed no resolver in representative live samples. Passive observation is
therefore a closed experiment; its exact code remains as evidence, not as the
current opaque-replay route.

The next checkpoint is a separate **active metric-only** resolver. After an
original raw companion is durably written and reverified, a pure plan inventories
at most 20 unique IDs deterministically from exact attachment-ledger pointers,
while the live diagnostic selects only the first. Content bridge, message
validation, background runtime/reader, response contract, and MAIN command each
independently reject more than one diagnostic ID. The one ID crosses once as a
transient `executeScript` argument—never in fragment/history, warnings, logs,
archives, or results. A document-start closure retains an exact
eligible native plural Request clone's Headers and credentials opaquely, checks
only authorization membership, credentials mode, source status, and JSON media
type, and never reads the source body. It waits for both source validation and a
one-shot command, in either order. The command and every poll are pinned to one
`documentId`, and the closure rechecks the exact armed href immediately before
accepting IDs. MAIN world is still page-controlled: the nonce is not a secret,
so a page may pre-empt the command and affect availability. That residual is
accepted only for this disabled metric experiment and must not be described as
an isolation guarantee.

For the one selected ordinal the closure constructs exactly one same-origin
request: `GET /backend-api/files/download/{file_id}` with
`download_intent=true` and `check_context_scopes_for_conversation_id` bound to
the same conversation. Preview-only `conversation_id + inline=true` is a
separate provider mode and is not combined with the download query. The closure
copies the opaque source Headers/credentials into a native
Request, uses a fresh AbortController, `redirect: error`, `cache: no-store`, a
per-ID timeout, one non-extendable deadline, and no retry, Calpico route, or route
switching. Pre-fetch setup failure terminates before dispatch as
`hook-state-failed`. Only the actual fetch try may emit `fetch-rejected`; a
Response whose bounded clone/body/hash processing fails may emit
`response-processing-rejected`; only background validation of an observed `200
JSON` capture may emit `payload-integrity-rejected`, `download-url-missing`, or
`download-url-binding-rejected`. Active and shared passive parsers require an own
top-level `status === "Success"` plus a string `download_url`. Other terminal
outcomes are `observed`, `http-error`, `non-json`, `oversized`, `timed-out`, and
`not-dispatched`. The body is at most 64 KiB. Background treats MAIN output as
hostile, revalidates exact shape, ordinal mapping, canonical base64, length,
SHA-256, JSON, Success envelope, and signed-URL conversation binding, then
discards IDs, bodies, URLs, and the batch timestamp before durable audit
construction. MAIN cannot originate the three background-only outcomes.

The integrated orchestration is gated by the existing
`Export images & attachments` setting and at least one durable destination; every
export still requires a trusted click. Raw is committed first and only
raw-successful destinations continue. A zero-asset ledger skips resolver work.
In opaque replay mode this checkpoint is deliberately probe-only: it performs
zero credentialless acquisition or binary staging, leaves every asset
`not-attempted`, and writes only a count-safe warning. Ordinary capture retains
the older byte-equality recapture and bounded credentialless signed-URL path.
Only a positive live metric smoke plus fresh review may connect the active route
to that existing acquisition layer. Raw is never rewritten, and signed URLs or
provider IDs never enter manifest, canonical, Markdown, warning, or runtime asset
records.

The first trusted-click active smoke established the lifecycle and durable
privacy half of this boundary but lost the ephemeral count. A stale pre-reload
click stopped before settings read and produced no marker or files. After a page
reload, one real click opened and closed exactly one active marker tab, wrote
Markdown plus raw/manifest/canonical, and wrote zero binaries. Raw length and
SHA-256 matched the manifest; all 17 manifest/canonical asset records remained
`not-attempted` with no local or attempted evidence; structural durable scans
found no provider-ID/auth keys, resolver bodies, transport pointers, signed URLs,
or signed-query values. The short warning toast expired before it was sampled, so
this is not evidence that any resolver response was observed. The count-safe
warning is therefore emitted both to local console as `[G2O] ... observed N/M`
and to the final destination manifest. The value is reconstructed from validated
integer counts rather than accepting page text; invalid or over-cap metrics fail
finalization. Neither surface contains an ID, URL, response body, or conversation
content. One fresh smoke after reload must read that exact manifest metric once,
without retry.

That fresh capture returned the durable count exactly once: `observed 0/16`.
It again wrote Markdown plus raw/manifest/canonical and zero binaries; raw matched
manifest length/SHA-256; all 17 assets stayed `not-attempted`; durable structural
scans again found no resolver/auth/provider keys, transport pointers, signed
URLs, or signed-query values. This proves correct settings, verified raw, a
16-ID plan, and zero validated responses at the content boundary. Metric v1 did
not persist failure code, dispatch count, or outcome histogram, so the evidence
cannot distinguish a safe early runtime failure from 16 dispatched requests with
zero valid responses. The current build must not be repeated or treated as a
conclusive route failure. Any final diagnostic run first requires an expanded
count-safe audit with no IDs, URLs, bodies, or credential values; Calpico
fallback, route widening, source-body/DOM capture, and header-value extraction
remain forbidden.

The replacement audit keeps the same network boundary and changes only the
aggregate evidence that survives into the local manifest. A completed resolver
batch is reduced to `requested`, `dispatched`, `observed`, and a histogram over
the seven already allowlisted outcome codes. If the background returns before a
complete batch metric exists, the manifest records `dispatched=unknown`,
`outcomes=unavailable`, and the exact allowlisted failure code instead of
inventing zero dispatches. The user-facing warning remains short. The durable
line is reconstructed from numbers and enums after exact-key, bound, total,
observed-count, and `not-dispatched = requested - dispatched` validation. It
cannot contain provider IDs, URLs, timestamps, header values, response bodies,
or conversation content. Acquisition and binary staging remain physically
disabled.

The one approved audit-v2 live run completed with the exact aggregate
`requested=16`, `dispatched=16`, `observed=0`, `rejected=16`, every other
outcome zero, and `failure=none`. The output contained only Markdown plus the
three archive JSON companions and no binaries. Raw matched the manifest length
and SHA-256; all 17 manifest assets stayed `not-attempted` with no attempted or
local evidence. This proves that the one-shot command and every dispatch ran; it
was not an early lifecycle or settings failure. No response passed the safe
acceptance boundary. That broad 16-ID build is closed and must not be repeated,
connected to acquisition, widened, or given a fallback.

The user's endpoint-specific authorization hypothesis motivates one narrower
stage-only follow-up. Generic `rejected` is removed in favor of the three
origin-owned codes above, and every live boundary is reduced to one deterministic
ID while the offline inventory remains capped at 20. The durable histogram still
contains only allowlisted counts; it cannot represent an ID, URL, status, header
value, body, timestamp, exception text, or chat content. A fresh review found one
setup/fetch attribution defect before live use: Request-construction failure now
terminates as `hook-state-failed` before `dispatchCount` changes, so
`fetch-rejected` is reserved for the actual fetch call and ordinal invariants stay
valid. Offline tests, full coverage gate, lint, build, and bundle inspection pass.

The one user-approved live result was `requested=1`, `dispatched=1`,
`observed=0`, and `payload-validation-rejected=1`, with every other outcome zero
and `failure=none`. ChatGPT therefore returned a `200 JSON` Response through the
actual fetch path, and page-side bounded clone/body/hash processing completed;
only background payload validation rejected it. The output contained Markdown
plus exactly three capture JSON files and no binaries. Raw matched the manifest
length and SHA-256; all 17 assets stayed `not-attempted` with no attempted/local
evidence; the marker tab exact-closed. This rules out fetch-level missing
authorization, but an endpoint-specific authorization/error envelope encoded as
`200 JSON` remains possible. Without retaining body/schema/value data, the
remaining aggregate possibilities are a missing or changed `download_url` shape
or a signed URL that fails exact conversation binding. No automatic retry is
allowed; any value-free payload subreason requires a new explicit decision.

A later neutral-page inspection of 57 already loaded public ChatGPT scripts—no
conversation route, private response, storage, cookie, or header read—found that
the current `SendIfAvailable` helper keeps preview mode (`conversation_id` plus
`inline=true`) separate from explicit download mode (`download_intent=true` plus
`check_context_scopes_for_conversation_id`). Liska's rejected request had combined
those modes. The public consumer requires `status === "Success"` before reading
top-level `download_url`; `file_not_found` and `file_expired` are explicit errors.
The corrected local build now uses the exact download query, requires that
Success envelope in active and shared passive parsers, and exposes only the three
value-free background subreasons above. A reviewer caught and rechecked the
missing-status protocol gap before live use. Optional `gizmo_id` remains
underived, so this default route does not claim custom-GPT attachment coverage.
The one approved corrected-build smoke returned `requested=1`, `dispatched=1`,
`observed=0`, and `download-url-missing=1`, with every other outcome zero and
`failure=none`. Exact download-mode therefore fetched a response whose bytes
passed page processing and background integrity checks, but no acceptable own
`status === "Success"` plus string `download_url` envelope remained. The
value-free outcome intentionally does not distinguish `Retry`, `file_not_found`,
`file_expired`, another non-success status, malformed JSON, or a protocol-violating
Success without URL. The deterministic first ledger ID is not freshness-ranked,
so an old unavailable attachment remains plausible; this run does not disprove
the corrected route for a known-fresh ordinary-chat file. Output contained
Markdown plus exactly three capture JSON files and no binaries. Raw matched the
manifest length/SHA-256; all 17 assets remained `not-attempted` with no
attempted/local evidence; the marker tab exact-closed. No automatic retry is
allowed. Any next live step requires a value-free allowlisted envelope category
and an explicitly known-fresh non-Gizmo fixture, or the live route stops in favor
of offline hydration.

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
remained explicitly `not-attempted`. Replay-mode attachment discovery now uses
the post-persistence active metric-only checkpoint described above. It is
offline-tested but still requires its first live smoke. Explicit bearer, cookie,
device-ID, source-body, DOM, or header-value extraction remains forbidden even
as a fallback.

The first live cold/warm-equivalent smoke of that observer completed twice on
an older seven-reference conversation because a controller timeout obscured a
successful first click and prompted one retry. Both immutable captures retained
identical verified raw bytes, complete graph claims, seven `not-attempted`
assets, no binary/local claims, no durable signed transport values, and no
leftover marker tab. No page-owned resolver was observed. This proves bounded
failure behavior and honest persistence for that sample, not working binary
acquisition. This passive experiment is now closed.

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
further path/window widening is permitted. The implemented active metric-only
resolver is a distinct threat boundary: bounded provider IDs come only from
reverified committed raw, exact resolver Requests copy eligible source Headers
only opaquely inside MAIN world, dispatch/work budgets are fixed, and there is no
header-value extraction, retry, or persisted signed URL. Its next evidence must
be one short trusted-click smoke with a visibly loadable attachment; an empty
result stops the route rather than triggering a fallback.

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
