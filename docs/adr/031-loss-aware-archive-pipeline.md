# ADR-031: Separate Capture, Canonical Archive, and Presentation

## Status

Accepted as the architectural direction on 2026-08-13. The canonical wire
schema has now been validated against synthetic fixtures, multiple live
ChatGPT graph captures, and the first live DeepSeek canonical capture. It
remains versioned as experimental until official-export reconciliation tests
the same provider-neutral fields across another source format.

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

An exact raw JSON pointer identifies the evidence container, not necessarily a
single asset. One scalar text part can encode several distinct links, so source
references must be unique within each asset record but may be shared by assets
with different opaque IDs. Asset IDs and persisted bundle paths remain globally
unique. If optional asset enrichment still cannot produce a canonical manifest,
capture preserves the verified raw bytes with asset completeness `unknown` and
an explicit warning instead of discarding the conversation.

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

The following section records the now-completed **active metric-only** resolver
checkpoint that preceded bounded binary acquisition. After an
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
zero binary acquisition or staging, leaves every asset
`not-attempted`, and writes only a count-safe warning. Ordinary capture retains
the older byte-equality recapture and bounded same-origin signed-URL path with
browser-managed credentials that extension code never reads or serializes.
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

A pair of user-approved clicks on two real visible attachments independently
demonstrated a separate provider family rather than the file-ID resolver. Each
page action called
`GET /backend-api/conversation/{conversationId}/interpreter/download` with only
the query keys `message_id` and `sandbox_path`, received `200 application/json`,
then fetched a signed `/backend-api/estuary/content` URL and received `200` DOCX.
No query value, identifier, header, body, filename, or file content was emitted or
retained. The second helper response was confirmed as a fresh network response;
the signed DOCX responses were served from disk cache and completed without a
network failure. Neither action produced a Playwright download event or a new
`D:\Downloads` file, so physical persistence is not claimed. The repeated actual
contract therefore requires a discriminated acquisition plan: ordinary file-ID, interpreter
`message_id + sandbox_path`, and library-ID flows are not interchangeable. Any
interpreter plan must derive both transient values from exact committed-raw
pointers, bind them to the same conversation, and keep them out of durable
warnings/logs/manifests. The existing active file-ID probe remains evidence for
only its own family and must not be generalized to interpreter or library assets.

A third user-approved action selected the attachment row's hover-only `Скачать
файл` control rather than opening its preview. It repeated the interpreter helper
as a fresh `200 application/json`, fetched the signed estuary URL as a fresh `200
application/pdf`, and produced a browser download event. Exactly one new local
file appeared: 62,962 bytes, `%PDF-1.7`, SHA-256
`6939a1659d01e01e9948eed4b36724a95bd4248d3f2c184b8624b4740f3996a7`;
filename and document content were not read. This proves the complete
acquisition-mechanics chain for an ordinary-chat interpreter output. The planned
adapter may derive transient `message_id + sandbox_path` only from exact verified
raw pointers, resolve one signed URL inside the same-conversation trusted-click
boundary, discard all provider transport values, and feed verified bytes into the
existing content-addressed staged persistence. Preview and physical-download UI
controls share the resolver family but differ after signed content resolution.

A field-only reconciliation first found exact interpreter-shaped ledger records at
`/mapping/{node}/message/metadata/attachments/{i}`. A later fresh capture exposed
the second provider representation: a directly rendered assistant Markdown link
whose destination is `sandbox:/mnt/data/...`. The inventory accepts only these two
structural sources, binds each to the same-node `message.id`, and hashes the
message/path identity before it reaches the manifest. User/tool content, arbitrary
strings, image syntax, inline/fenced/indented code, malformed/double encoding, and
unsafe paths remain excluded. Multiple links in one text part receive distinct
opaque IDs and are re-matched by recomputing the same identity rather than by
persisting a filename or sandbox path. The transient result remains only
`{assetId,messageId,sandboxPath}`; conflicts are skipped, exact pairs deduplicate
deterministically, and the cap remains 20.

The separate transient gate is implemented, offline-verified, and live-verified. The existing
attachment toggle and trusted click authorize the standard-conversation adapter;
no new ambiguous setting is added. Only after at least one raw destination succeeds,
the adapter derives the plan from verified committed bytes, opens its own
`liska-interpreter-resolver=1` marker tab, pins command and reads to one document,
and issues sequential no-retry helper GETs. Captured native
`URLSearchParams.set` receives `message_id` and `sandbox_path` exactly once in that
order. The hook's published state is ordinal-only. Background verifies the bounded
JSON response bytes. It accepts the legacy exact `{download_url}` envelope or an
own-field success envelope whose status is `Success` or `success`; additional
descriptive fields are ignored and never cross the boundary. Legacy signed URLs
retain UUID `cid` binding. Current signed URLs use exact
`id,fn,cd,ts,p,cid,sig,v` grammar with numeric `cid`; their conversation binding is
instead established by the exact same-conversation helper route, pinned document,
and committed-raw message/path pair. Content revalidates a deterministic subset of
input asset IDs.
Interpreter candidates win same-asset conflicts and their signed bytes are fetched
immediately, before only remaining asset IDs enter the independent legacy resolver
plan. The content script uses one exact same-origin `credentials: include` GET with
`redirect: error`, `no-referrer`, and `no-store`; Chrome attaches eligible session
credentials without exposing them to extension code. Both families share one
20-attempt/128 MiB budget, then the content-addressed staged writer runs once.
The fresh DOCX canary persisted 38,620 bytes with matching manifest/canonical
length and SHA-256, valid DOCX ZIP structure, one fetched canonical asset, two
untouched previews, matching raw provenance, and zero marker tabs. Custom-GPT,
library-ID, Calpico, retry, and broad content scans remain unsupported.

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

A disabled-by-default setting still forces this one-shot replay directly as an
explicit experiment. In normal mode, passive capture now waits only 15 seconds for
the page to issue the graph request; only `conversation-request-timeout` permits
one automatic replay. A claimed request receives its own 180-second response
window and is never replayed. Probe and force-replay settings remain mutually
exclusive, with stale dual-true state canonicalized to probe-only. The eligible
source Request clone remains inside the MAIN-world closure. Browser-native
`Request` copies its Headers object opaquely into one exact same-origin singular
GET with source credentials, a fresh abort signal, `redirect: error`, and
`cache: no-store`. Each replay invocation dispatches at most once and never retries.
An explicit replay failure remains fail-closed; a failed automatic fallback may
still produce the existing honestly marked DOM current-branch export. Only the
singular 200 JSON response may be read under the 16 MiB cap.
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

The data-bearing route remains separate from the metric-only API. A pure plan is
rebuilt from reverified committed raw, resolves strength and ambiguity against
the full ledger, excludes every interpreter-owned identity, and emits only
single `{assetId, providerFileId}` transactions. Any unsupported nonempty direct
identity fails closed before a valid sibling or weaker pointer can be considered.
Passive matching keeps the full ledger until after winner selection, so an
already selected direct record cannot promote its pointer alias into a duplicate
download. Every selected identity is owned before dispatch and is never retried
passively, including after helper or binary-acquisition failure.

The helper uses only the page-observed four-query image recipe. A local static
interoperability review found that installed AI Exporter 4.6.0 uses the same
conversation and file-helper families but hydrates all mapping images with
`inline=true`, up to six concurrent workers, broad retained authorization/device
headers and silent per-image failure. It can also compress image outputs and
chooses the newest reachable leaf rather than provider `current_node`. These
choices explain speed and branch drift but do not meet Liska's archive boundary.
One exact same-identity A/B changed only Liska's `inline=false` to `inline=true`;
both modes returned the same `http-error`. The experimental build was rolled
back, so no mode fallback, broad credential path, or concurrency was added.

Instead, a content-level cap permits at most four distinct eligible ordinary
PNG/JPEG images while
each background/MAIN request remains single-item. Acquisition is sequential:
resolve one, immediately validate/acquire it through the shared 20-attempt and
128-MiB budget, then consider the next. The durable batch audit contains one to
four exact per-item metrics and safely aggregates known dispatches,
unknown-dispatch run failures, observed counts and allowlisted outcomes without
IDs, URLs, bodies or timestamps. Caller-owned audit objects, arrays, metrics and
outcome counts are snapshotted once from own data descriptors; aggregation uses
only those internal snapshots, preventing iterator, accessor, Proxy-get and
validation/use substitution.

The historical four-PNG canary selected and dispatched all four identities.
Three returned `http-error`; the fourth produced a verified 2,313,476-byte,
1448-by-1086 PNG whose opaque identity and SHA-256 exactly match the one PNG
older captures had fetched. The current 51,741-byte PDF also remained fetched.
Five archive files plus Markdown were byte-identical across Downloads and
Obsidian, and every temporary tab closed. This establishes historical
availability without inventing expiry for the three failed identities.

Those three failed identities were then reconciled to exact raw structure. They
were tool-role `metadata.attachments` named under provider-scoped
`/mnt/data/liska_pdf_render/page-N.png` or
`/mnt/data/liska_docx_render/page-N.png`, consistent with derived document
previews in that historical sample. An initial policy classified that exact
role/MIME/name shape as `declined` without proving a relationship to a source
PDF or DOCX.

A later security reconciliation rejected that inference. Provider-shaped names
are not structural derivation evidence: an isolated real PNG with the same
metadata would otherwise be silently excluded from every resolver and could
make asset completeness falsely `complete`. Raw inventory therefore never
auto-declines an attachment from role, MIME type, filename, adjacency or a
provider-key alias. Preview-shaped records remain ordinary `not-attempted`
assets with exact sourceRefs and are eligible for the same bounded acquisition
paths as other PNGs. This may spend an existing resolver slot on a historical
thumbnail, but it cannot silently omit an unproven binary and does not widen any
attempt, byte, retry or endpoint limit.

The generic `declined` state remains part of the archive contract for an
explicit user choice or a future policy backed by affirmative structural
evidence. Downstream acquisition and completeness semantics for such explicit
records are unchanged. The earlier canary that skipped three previews remains
dated evidence of the retired heuristic, not the current inventory behavior.

The fresh canary selected both of its eligible PNG identities and fetched both:
1,474,502 and 1,429,642 verified bytes, each 1122 by 1402. The first repeats the
earlier one-PNG hash; the second had previously remained `not-attempted`.
Raw/manifest/canonical plus both binaries and Markdown were byte-identical across
Downloads and Obsidian, with no marker tab left open. Automatic retry, endpoint
fallback, custom-GPT/Library-ID widening and concurrent workers still require
separate evidence.

JPEG activation reuses that exact route and the same four-slot content cap; it
does not add a second JPEG quota. Eligibility uses the inventory's canonical
MIME essence and the exact set `image/png | image/jpeg`. Standards-equivalent
case and parameters are normalized before planning; nonstandard aliases such as
`image/jpg`, GIF and WebP remain excluded. Before either active or passive winner selection,
the planner builds a whole-ledger deny set from every valid direct identity and
pointer present on a Library-bearing raw value. This prevents both a stronger
ordinary record and a weaker pointer alias from laundering the same Library
identity into the ordinary route. `source: local` alone is not evidence of
Library ownership. The same deny-only pass retains multi-ID and
unsupported-direct evidence before candidate matching, so an ambiguous strong
record cannot disappear and promote a separately inventoried pointer alias.

A live standard-conversation canary selected one of two JPEG records. Its audit
reported one dispatch and one observed resolver response with no failure. File
and Obsidian each retained byte-identical raw, manifest, canonical and JPEG
files. The 188,009-byte original was an 8-bit baseline SOF0 JPEG measuring 1015
by 1536; actual bytes, content-addressed `.jpg` path, length and SHA-256 match
both durable metadata layers. The other JPEG stayed `not-attempted`, so overall
asset completeness remained honestly `partial`. Credential-key and transient
transport scans of manifest/canonical were empty. A temporary generated-dist
trusted-click harness was removed after the canary and never entered source or
the packaged build.

### Library association is not acquisition authority

The next archive scan found no ordinary GIF and only one WebP record. That WebP
is pointerless metadata with explicit Library-ID evidence and no captured
binary, so it cannot justify widening the ordinary image planner.

Library evidence is classified in a separate pure pass over exact manifest
source refs. The result exposes only opaque ledger asset IDs as `associated` or
`ambiguous`; provider Library values never cross the function boundary.
Malformed or conflicting aliases, duplicate asset IDs, stale or duplicate raw
pointers and malformed conversation artifact IDs remain ambiguous. Empty
aliases and `source: local` alone prove no association. Shared Library values do
not merge distinct ledger assets. The classifier creates no request object,
endpoint, URL, attempt timestamp or terminal acquisition claim.

Exact Library, gizmo, project and conversation-template identifier aliases are
raw-only canonical privacy fields. Direct and nested values are omitted with a
fixed diagnostic anchored to the raw pointer. Root gizmo/template evidence is
reduced to `isCustomGpt: true` and `hasConversationTemplate: true`; it does not
claim that any attachment belongs to that context. Existing opaque asset IDs,
source refs, raw bytes and acquisition state remain unchanged.

Association alone still creates no request authority. A later live observation
established one narrower transport contract: in an ordinary conversation, one
exact Library-associated `image/jpeg` may use its direct attachment file ID
through the existing page-owned resolver. The planner re-reads committed raw,
requires a unique direct-ID winner across the whole ledger, gives interpreter
evidence precedence regardless of its dispatch cap, rejects custom-GPT/project/
template context and consumes one of the existing four active image slots.
`library_file_id`, filename, `source: local` and pointer-only evidence never
become request identifiers.

The production canary confirmed the full durable path. The browser-owned helper
and signed content GET returned the same 9,949 JPEG bytes as ChatGPT's preview
download, while a cookie-less fetch of the signed URL returned 403. Therefore
credentials and the transient signed URL remain inside the existing page-owned
boundary. Downloads and Obsidian retained byte-identical raw, manifest,
canonical and binary files; the aggregate audit records one Library JPEG and
three ordinary image attempts without provider values.

This does not establish general Library identity equivalence, Library PNG/WebP,
custom-GPT/project ownership, WebP structure validation or a new endpoint.
Those remain separately evidence-gated work.

### Owner routes are capture context, not attachment authority

Custom-GPT and project routes now have a separate content-free runtime contract.
Background derives an immutable route target only from the current sender tab:
standard `/c/<uuid>`, custom-GPT `/g/<slug>/c/<uuid>`, or project
`/g/g-p-<slug>/c/<uuid>`. The exact validated pathname stays in background;
only its fixed family crosses the capture response and binds the later
attachment context. Query, fragment, userinfo, encoded aliases, UUID mismatch,
case drift, and family changes fail closed. ChatGPT may canonicalize the
human-readable owner slug; that transition is accepted only for the same origin,
UUID, family, empty query, and exact extension-owned nonce/mode marker.

Route evidence and verified raw evidence are reconciled before optional work.
Only a standard route plus one valid owner-free direct or nested graph can
authorize existing attachment planners. Nonstandard routes, owner/template
fields, malformed aliases, dual/missing graphs, and unsupported wrapper evidence
preserve the immutable capture while producing no interpreter observation,
active/passive resolver, acquisition, binary staging, or resolver audit. Asset
records remain `not-attempted`, and each successful destination receives one
fixed policy warning in its manifest. Provider owner values remain raw-only;
route slugs and paths enter neither manifest, canonical JSON, nor Markdown.

Live evidence covers both sides of this boundary. A custom-GPT route preserved
a 41,929-byte raw capture and 11-node canonical graph. A project route preserved
a 2,609,652-byte raw capture, 132 nodes, and nine attachment references while
creating zero binary files or attempts; all nine assets remained
`not-attempted`, and one durable policy warning explains the omission. This is
an explicit archive-only support contract. It does not authorize custom-GPT or
project attachment downloads, infer owner IDs, or widen ordinary, Library, or
interpreter transports.

### Research-output notes consume destination receipts, not acquisition claims

The readable current-branch note now receives a separate finalized receipt for
each durable destination. The receipt is emitted only when that destination has
confirmed its binary writes and then persisted its final manifest and canonical
archive. Its exact allowlist is destination, opaque capture ID, opaque
conversation key, final manifest SHA-256, and content-addressed binary
descriptors (`sha256`, `relativePath`, MIME type and byte length). Accessors,
extra fields, provider IDs, filenames, URLs, source pointers, status strings,
unsafe MIME types, noncanonical paths and duplicate targets fail closed.

This makes Markdown destination-honest too. File and Obsidian are written
separately from their own receipts; Clipboard receives neither local archive
links nor a hash borrowed from another destination. Each durable note records
the exact `archive_capture_id` and `archive_manifest_sha256`, and appends generic
links only to binaries proven present below the same capture directory. Link
labels never reuse provider titles. Equal bytes may legitimately survive under
distinct allowlisted MIME-derived paths, while an exact duplicate target is
rejected.

Receipt-bound notes are immutable presentations. Their filenames include the
opaque capture suffix, Obsidian append mode is bypassed, and every occupied path
is treated as protected even when its conversation ID matches. Collision
resolution can therefore choose a fresh absent path but cannot silently replace
an earlier snapshot or user edit. The provider's original `sandbox:` link is
retained as historical text; the verified local archive link is additive until
a later identity-safe inline rewrite is designed. Canonical citation, tool,
execution and attachment blocks remain unchanged.

A live standard-chat research-output canary preserved 49 graph nodes and 48
messages, including 22 tool-role messages. Canonical output retained 12
citations, 20 execution outputs and 13 attachment blocks. One 45,036-byte DOCX
reached both File and Obsidian under the same SHA-256 content address; raw,
manifest, canonical and binary artifacts were byte-identical across those
destinations. Both capture-scoped notes carried the exact matching final
manifest hash, and their one local DOCX link resolved to an existing file whose
bytes matched the link's digest. Four older PNG attempts remained explicit
failures and nine references stayed `not-attempted`; no readable link was
created for either group.

Discovering every reference does not make `completeness.assets` complete. Until
all required binary acquisitions reach an evidenced terminal state, a
metadata-only required inventory remains `not-attempted` (or `partial` after a
mixed attempt); `complete` is reserved for a capture that satisfied its declared
asset-acquisition policy. Explicit policy-declined derived previews do not count
as required binaries.

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
- when the user explicitly selects Obsidian as a durable output, allow the raw,
  manifest, and canonical companions to travel only to the configured loopback
  Local REST API and verify their exact bytes after the write;
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

Multi-document HTML follows the same fail-before-write rule. Before any
presentation dispatch, one prepared plan measures every leaf and its index,
their deterministic receipts, and the exact extension-message envelopes. It
then recreates only one document at a time and releases that transient body
only after every measured field matches. Markdown and HTML consume one shared
physical-byte budget; HTML additionally counts both render passes as
homogeneous rendered-byte work. Planned writes include the HTML and receipt as
two distinct sink operations, so an oversized destination combination is
rejected explicitly instead of increasing a ceiling or dropping a requested
format. Unknown delivery never authorizes a retry or the final index.

HTML authorization uses destination-final evidence, not the extractor's
pre-write archive alone. All-branches extraction retains a target-free archive
context, while current/selected export retains its separate selected context.
After attachment reconciliation, only a confirmed File manifest/canonical pair
and File-confirmed fetched assets can produce the archive-level presentation
capability. Obsidian evidence and incomplete File outcomes cannot be borrowed.

The all-branches coordinator must bind that capability to the exact accepted
File receipt before rendering. The finalized manifest digest and archive byte
lengths, plus every content-addressed asset descriptor, are reconciled against
one detached evidence snapshot. Attachment mode never compares against or
rebuilds from the older pre-attachment companion. Canonical SHA-256 remains the
renderer authorization boundary because the current sink receipt carries the
canonical length rather than its digest.

Bootstrap must make the File HTML decision before any attachment/raw write and
carry that same decision through preparation and persistence. User-facing
completion stays format-specific: Markdown names every durable destination,
while multi-document HTML is always described as File-only. A completed archive
or Markdown bundle cannot make an incomplete requested HTML bundle appear
green; attachment and loss caveats remain authoritative.

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

Progress as of 2026-10-23: steps 1–6 are implemented and live-verified for
ChatGPT. Step 7 is partially implemented for ordinary-chat file-ID images,
interpreter/sandbox documents and one exact Library-associated JPEG with
explicit completeness diagnostics. Custom-GPT/project raw capture is
live-verified under an archive-only, zero-binary policy; their binary ownership,
other Library binary families, Calpico fallback, and general Deep Research
binary acquisition remain outside the current checkpoint. Step 8 is implemented and live-verified
for DeepSeek exact history bytes, complete graph normalization, current-branch
projection, and raw/manifest/canonical persistence. Step 9 remains a separate
future phase.

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
   The first bounded slice is implemented: exact non-delta history bytes retain
   all graph nodes and ordered text/Markdown/reasoning/unknown blocks, while the
   legacy view follows `current_message_id`. In-band DeepSeek `files` metadata
   is inventoried into opaque canonical attachment references. A fresh
   synthetic 93-byte text attachment established that a successful file record
   nested under a history `FILE` fragment can carry a sufficient relative
   `signed_path`: the page directly
   requested `https://files.deepseeksvc.com/api${signed_path}&ty=r` and received
   exact `200 application/octet-stream` bytes without a `fetch_files` call.
   Liska now admits only that exact bound grammar, saves raw first, performs
   credential-free bounded sequential GETs, hashes returned bytes itself, and
   finalizes manifest/canonical evidence separately per successful destination.
   Signed paths and provider IDs remain raw-only. Missing or expired paths remain
   unresolved unless the page has already exposed a matching passive observation;
   `fetch_files` is not used as a product fallback.
   A later canary showed that some successful legacy message-level records omit
   `signed_path`, while a page-native card preview still leaves the exact strict
   file-service GET in the current document's ResourceTiming buffer. After raw
   persistence, Liska may therefore inspect only the newest 512 resource entries,
   accept only `initiatorType=fetch`, and bind the exact URL `file_id` uniquely to
   current verified raw sourceRefs and its recomputed opaque asset ID. An in-band
   signed path wins. This passive fallback never clicks a card, clears timing,
   calls `fetch_files`, copies provider headers, or persists the observed URL.
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
