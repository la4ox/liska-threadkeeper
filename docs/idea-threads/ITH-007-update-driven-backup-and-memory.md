---
title: "ITH-007 — Update-driven backup before living memory"
type: idea-thread
permalink: ith-007-update-driven-backup-and-memory
tags: [idea-thread, backup, automation, discovery, memory]
thread_id: ITH-007
thread_state: growing
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-11-07
---

# ITH-007 — Update-driven backup before living memory

The project is moving from manual export toward a local archive ecosystem, but
daily backup discovery and living semantic memory are different systems. This
thread keeps the intended order and the trigger for reopening automation work.

## Thread

### H1 — Daily backup means reopening every chat or maintaining a fixed list

A scheduler could revisit every known conversation each day, or export only a
configured subset. Both approaches are easy to describe and reuse the existing
manual capture gesture.

### E1 — Manual archive and recovery layers now have distinct contracts

Liska can preserve append-only raw/manifest/canonical snapshots, derive readable
views, compare official and web evidence and analyze snapshot relations without
mutation. Those pieces make a future scheduler conceivable while also showing
that capture, reconciliation, presentation and cleanup have different authority.

This is architectural readiness, not proof that unattended provider discovery
or long-running recovery is implemented.

### E2 — Providers do not share one reliable change signal

Title, list order, page presence and local elapsed time cannot prove that a chat
changed. Reopening every conversation merely to find out can be expensive and
provider-hostile. Each provider needs a bounded index or history signal such as
a revision, update timestamp, cursor or equivalent evidence, plus rate limits
and honest missed/deferred states.

### E3 — The desired ecosystem was clarified as four separate layers

Project discussions converged on periodic official exports as cold external
evidence, daily Liska captures only for conversations with observed updates,
the existing readable archive/reader layer and a later separate living-memory
project. “Selected chats” was explicitly corrected to “chats where updates
appeared.”

### H2 — Canonical archive organization can precede account-wide automation

The local archive can first gain a deterministic catalog, provider/conversation
identity map and append-only snapshot layout without yet polling a provider or
opening any conversation. That separates recovery and inventory design from
network authority.

### E4 — Rapidly reopening many chats is already an observed product constraint

The user explicitly retained the concern that ChatGPT does not tolerate many
conversation pages being opened and exported in a short interval. This does not
establish an exact rate limit, but it rules out an unbounded all-chats loop as a
safe default and reinforces the need for cooldown, budgets and resumability.

### E5 — The pre-catalog audit found manifests but no baseline runtime

Source inspection before ADR-050 found one stable immutable directory shape and a
provider-neutral capture manifest, but no durable conversation inventory,
account-wide list adapter, provider cursor, daily budget or scheduler. Existing
24-hour staging/recovery records and session export controllers own transient
delivery, not multi-day backup work.

The existing snapshot analyzer reads every selected byte and intentionally
certifies only a small current-writer ChatGPT subset. Reusing it as a large
archive database would conflate declared metadata, exact-byte verification and
backup admission. A manifest-only catalog can instead inventory explicit local
evidence while saying exactly which bytes it did not read.

### E6 — The real manifest-only catalog is deterministic and leaves the archive unchanged

The installed page admitted a real 495-file archive root containing 121
manifests while binding body reads only for exact lowercase `manifest.json`.
It rendered 121 unique valid entries and four unassociated files. The saved
128,309-byte catalog matched an independent production-core rebuild byte for
byte; all 495 source hashes/counts/bytes matched their pre-run inventory.

This proves one explicit selected local root and current manifest schema. It
does not prove body integrity, account completeness, recapture admission or a
provider list/update marker.

### E7 — The inert journal survives an extension restart without gaining execution authority

The installed private page admitted the accepted catalog as 24 unique valid
conversation items, created one revision-0 paused journal with zero attempts,
and recovered the same paused journal after an extension reload closed its page.
Its 7,366-byte private export decoded and re-encoded byte for byte through the
production core.

This proves durable local bookkeeping and restart recovery for one explicit
catalog. It does not enumerate an account, contact a provider, capture a chat,
schedule work or prove that any conversation is still accessible.

### E8 — Before the list experiment, ChatGPT and Claude evidence stopped at detail

The ADR-052 source-only audit found exact single-conversation capture paths and
timestamp-shaped detail fields for ChatGPT and Claude, but no repository-safe
account-list schema, account/workspace binding, pagination checkpoint, list-level
marker semantics, archive/deletion visibility or rate-limit contract for either
provider.

This absence does not prove that a provider lacks those surfaces. It proves only
that Liska could not yet encode them as a trustworthy contract. E10 and ADR-053
later admitted only Claude's observed terminal structural subset, not a complete
discovery or marker contract.

### E9 — The current account topology has one active personal target per provider

The user described one routinely used main account and one normally dormant
backup account per provider, with personal scopes and no workspaces. The chosen
default is the visibly active main account in `personal/no-workspace`; backup
accounts remain out of scope unless explicitly selected.

This is a local operating preference, not provider account-binding evidence.
If a backup account is later used, it may own a separate sibling scope rather
than being rejected or merged into the main account.

### E10 — A bounded Claude pass established one terminal active-list shape

One authorized foreground reload emitted three actual same-route list requests,
not one. The observed organization/workspace-bound active-list request used
limit 30, offset 0 and strong consistency. Its JSON envelope contained `data`
and `has_more`; the sampled personal scope returned 12 records and
`has_more=false`. Records exposed stable identity and timestamp-shaped fields
plus status/presentation metadata.

No real values were retained. The pass did not observe pagination, archived
visibility, response equality, marker semantics, deletion behavior or rate
limits. It therefore supports only terminal structural admission and opaque
token equality.

### E11 — The post-PR #118 audit separates verification from new capture work

Exact merged main `4c3ba7e`, containing reviewed head `ee2e34a`, has the accepted
manifest catalog, transactional inert journal and pure unwired Claude terminal
contract. Journal admission collapses existing captures into one
provider/conversation/key item with the original catalog digest. A new attempt
reserves its own capture identity; settling it `confirmed` makes the item
`recorded` and ineligible for another attempt in the same run.

Verifying an existing selected snapshot through begin/settle would therefore
mark capture work done without making a new capture. Typed evidence references
do not correct that semantic mismatch. The audit establishes this boundary, not
a baseline driver, account completeness or further Claude behavior.

### E12 — ChatGPT exposed three list names, not a route or schema contract

One separately authorized observation on 2026-11-05 found exactly three Network
list-name requests with type `Fetch`, HTTP 200 and names beginning
`conversations?`. The fully visible name was
`conversations?limit=5&owned_only=false`; two partial names contained
`exclude_conversation_origin=tpp` and `conversation_origin=tpp&expand=false`.
Their unread query suffixes are not wildcard grammar. Full URL and method were
not inspected; `/backend-api/conversations` is only a candidate route-family
inference from ChatGPT context.

The pass began with an already-open chat and DevTools opened, without deliberate
reload or isolated trigger causality. Recording stopped after the third matching
request; no fourth was observed before stop. Recording stop is neither network
stop nor terminal/completeness proof. No list row/details, response body or
request headers was opened; no real IDs, titles, account data or header values
are repository evidence, and no mutation or manual retry was invoked for the pass.
HTTP 200 does not prove payload suitability. Query meanings, route relations,
scope/account binding, ordering, ownership, completeness, identity, pagination,
cursor, marker, deletion/archive visibility and response schema remain unknown.

### E13 — Source attribution identifies an observer, not the list initiator

DevTools attributed the requests to AI Exporter `inject-web.js`. Local audit of
the exact Comet-installed version 4.6.1 found a wrapper that stores original
`window.fetch`, observes `/backend-api/` requests and returns the original fetch.
Its ChatGPT callback retains `Authorization` and `chatgpt-`/`oai-` headers but
ignores URL/method/body and intercepts no response body. Those are code-level
header names, not inspected request headers or retained real values. Recursive
literal search found no candidate list-route or observed query constructors.
Separate singular detail/export fetch code does not establish list causality.

This proves neither extension-created list requests nor a page-native caller.
ADR-055 records exact byte lengths and SHA-256 for the audited script and
manifest, manifest version 3 and extension version 4.6.1, without local absolute
paths or the extension ID. The initiating caller remains unresolved.

### E14 — An isolated native sidebar trigger exposed a gizmo-container schema

The separately authorized 2026-11-06 schema pass began after the user disabled
AI Exporter and one reload removed its loaded fetch wrapper. DevTools recording
started empty and active. Reload emitted no relevant sidebar list because docked
DevTools collapsed the sidebar; opening it once was the isolated trigger.
Exactly two matching native `Fetch` requests were emitted, both `GET` 200
initiated by a ChatGPT CDN bundle. Their exact path was
`/backend-api/gizmos/snorlax/sidebar`, with query keys/values
`conversations_per_gizmo=0`, opaque `cursor`, `limit=20`, `owned_only=false`.
The two request cursors differed; neither value was retained.

Both observed responses had keys `{items, cursor}`. The first-observed items
array contained exactly 20 with a string top cursor; the second contained
exactly 1 with a null top cursor. Every visible item summary had keys
`{gizmo, conversations}`, with nested conversations `{items: [], cursor: null}`
under explicit `conversations_per_gizmo=0`. Both requests already had cursors;
the initial boundary and exact response-to-request cursor handoff equality are
unproved. These are not established initial/final account pages or 21 unique
records, and empty nested arrays do not prove gizmos lack conversations.

Recording stopped at budget 2/3. The third allowed request was deliberately
unused because scrolling Recent could emit multiple refetches and overshoot the
cap. Recording stop is not network-stop or completeness proof. No headers,
cookies, raw response body or real identity values were persisted. E14 is
distinct from E12/E13: it neither identifies the older `conversations?` names as
this route nor retroactively resolves their attribution ambiguity.

### E15 — A gizmo wrapper does not establish conversation identity or scope

One gizmo wrapper in the second-observed null-cursor response was transiently
expanded only for keys/types: `files` and `tools` arrays; nested `gizmo` object
containing `id` and `organization_id` strings; `has_tpp_conversation` and
`is_space_backing` booleans; `product_features` object;
`project_connector_scope_limits` and `project_file_limits` null. Real values
were not retained, and this sample does not prove every wrapper has this shape.

Gizmo ID is not conversation identity; `organization_id` is not authenticated
account/workspace binding. No stability, format, coverage or scope semantics
were proved. E14/E15 establish native sidebar/gizmo-container evidence, not a
conversation-bearing list, conversation record ID/type/format, actual list-level
marker or scope binding. They do not materially advance conversation discovery.

### E16 — Native ordinary pages expose a bounded conversation-list structure

In a separately authorized 2026-11-06 read-only pass, AI Exporter remained
disabled and the matching requests were initiated by a ChatGPT CDN bundle. The
ordinary route was `GET 200 /backend-api/conversations` with the observed
query constants `exclude_conversation_origin=tpp`,
`expand=false`, `hide_snorlax=false`, `is_archived=false`,
`is_starred=false`, `limit=20` and `order=updated`. Requests at
offsets 0, 20, 40 and 60 were observed. Only response bodies at offsets 20, 40
and 60 were inspected; each had exact envelope keys `{items, limit, offset, total}`,
integer `limit`/`offset` echoes, integer `total` and 20 items. Reported totals were 41, 61 and 81,
respectively. These values are uninterpreted provider metadata, not proof of
actual total, continuation, completeness or unique-record count. Offset 0 has
no admitted response shape, and no terminal ordinary page was observed.

One record was inspected for keys/types only. Its `id` was UUID-like and its
`update_time` ISO-like; the exact one-sample field/type inventory is in
ADR-057. This does not establish every record's shape. The same final burst also
emitted a TPP ordinary-family request and a per-gizmo conversations request,
but neither body was inspected; no route-family union, deduplication or scope
semantics follow. No headers, cookies, raw response or real values were
retained.

### E17 — A UI-scroll burst exceeded the self-imposed request soft cap

Two earlier ordinary-page requests at offsets 20 and 40 preceded one UI-scroll
burst of six list routes: eight actual list requests total against a
self-imposed soft cap of six. The user had authorized broader read-only research,
so this was not a breach of a user-imposed hard cap; it was still a two-request
overshoot that must remain visible. Recording stopped after the burst. One UI
gesture or Stop button cannot enforce a request budget when it may emit several
requests.

### E18 — Existing destination receipts cannot settle new-capture purpose

The accepted journal v1 has generic typed evidence references but no persisted
purpose. Its confirmed outcome makes an item recorded, so reusing it for local
verification or an under-specified receipt could suppress intended capture work.
The current ChatGPT destination receipt records destination, capture ID, a legacy
bare conversation digest, manifest digest, archive byte lengths and assets, but
not operation/attempt/provider/conversation identity, versioned provider-aware
key, catalog selection, purpose, completeness or assurance basis.

File output confirms terminal completion and exact requested relative path
without reading bytes back. Obsidian writes and then reads each artifact back for
byte-length and SHA-256 comparison. Neither evidence basis may be silently
promoted to or collapsed into the other, and no existing receipt alone proves a
new capture settled.

### E19 — A pure new-capture relation can be exact without gaining authority

The isolated `liska-new-capture-operation/1` and
`liska-new-capture-evidence/1` contracts require explicit purpose, immutable
operation/attempt/capture and provider/conversation/catalog binding, canonical
all-of destinations and a strict declared-inventory policy. Each destination
independently binds its manifest and artifacts under either File path-confirmed
delivery or Obsidian byte readback.

The pure assessor returns only `consistent`, `insufficient`, `conflict` or
`rejected` over bounded detached data. `consistent` deliberately means internal
relation consistency only: it authenticates no producer, current durability,
freshness or account completeness and performs no settlement, persistence,
execution, dispatch or retry. Journal v1, runtime, storage, UI and build wiring
remain unchanged.

### E20 — Current sinks already had exact facts that legacy receipts discarded

File archive and binary writes succeed only after terminal download and exact
requested-path confirmation; they do not read downloaded bytes back. Obsidian
writes then performs bounded binary readback, exact length comparison and
SHA-256 comparison. The legacy ChatGPT destination receipt and generic durable
write accounting retained neither assurance basis nor the exact per-artifact
observation.

The current destination builder also holds exact raw/manifest/canonical
commitments and the full destination-specific manifest inventory. Therefore the
missing evidence is a producer-result loss, not a need for another provider or
account request.

### E21 — Exact producer receipts can adapt only pre-admitted work

The additive `liska-chatgpt-producer-evidence/1` receipt now retains real File or
Obsidian sink observations, exact destination commitments, completeness and the
full asset inventory without replacing the legacy receipt. Raw facts are kept
from the early raw write; archive commitments and binary results are detached
before later awaits can mutate them.

The pure unwired adapter independently verifies the legacy routing digest and
the provider-aware catalog key, then projects only receipts carrying an explicit
pre-write operation/attempt/catalog/reserved-capture intent. Manual and legacy
receipts stay insufficient or unsupported. No journal persistence, settlement,
baseline or scheduler follows.

### E22 — Ordinary capture requested provider data before identity reservation

The existing ChatGPT capture accepted an injectable capture-ID factory but
invoked it only while building the manifest, after the provider response. This
was sufficient for manual export tests but did not establish that a future
catalog-bound operation and reserved capture identity existed before dispatch.

Catalog admission already preserved exact canonical bytes and projected stable
provider/conversation/versioned-key identity. The missing layer was a bounded
handoff from that evidence into the real capture path, not another provider
experiment.

### E23 — A frozen handoff now reaches the real capture before the request

The accepted catalog admission is now shared as a data-only core. A pure
`prepareChatGptNewCapture` operation copies and hashes exact catalog bytes,
requires full-triple ChatGPT membership, verifies the provider-aware key and
builds one deeply frozen operation/producer-intent pair with a strict reserved
capture ID.

The unwired `capturePreparedChatGpt` executor revalidates that pair before the
request and runs the real capture/normalizer/inventory with the reserved ID. The
full offline path retains the same identity through manifest, companion and
producer receipt. Real asset inventory remains `not-attempted`, so the adapter
correctly stays insufficient rather than inventing completeness.

### E24 — Journal v1 cannot safely gain purpose persistence in place

The accepted v1 database requires version 1 and exactly one index-free
`journals` store; its upgrade path accepts only an empty version-0 database.
Adding a v2 store or upgrading that database would make the v1 reader reject its
own schema. V1 also lacks purpose, operation, catalog and destination semantics,
so its dispatch token cannot be promoted into purpose authority.

A separate database and record schema are therefore required to preserve v1
bytes, imports and behavior while adding durable single-operation reservation.

### E25 — Separate v2 storage commits reservation and retains assessment without settlement

The new `liska-resumability-journal/2` store atomically reserves unique
operation/attempt/capture identity, releases session-private tokens only after
IDB commit, preserves exact producer receipts and recomputed adapter results and
recovers in-flight work to unknown without retry. `consistent` moves only to
`awaiting-resolution`; no success or settlement state exists.

One constructor-owned hash authority prevents write/read divergence. Exact
control-transition projection preserves pause/restart/abandon capacity at the
8-MiB boundary. A native Chromium smoke verified reserve, claim, fresh-handle
reopen, explicit restart recovery, evidence commit and second reopen in a unique
test database that was then removed.

### E26 — A reusable currentness check and producer defaults could start hidden effects

The committed v2 token was reusable and `checkCurrent` was a snapshot separated
from the actual ChatGPT request by identity-hash awaits. A same-operation caller
could therefore attempt multiple requests, while a pre-hash check could become
stale before the effect boundary.

The existing attachment producer also defaults missing dependencies to legacy
recapture, authenticated global fetch and runtime binary persistence. Injecting
only final archive writes would not create an offline or bounded coordinator.

### E27 — One-use inline execution now retains facts and never settles them

The v2 store now burns a token once and invokes the generic request callback in
the same synchronous continuation as its final session fence. The unwired
coordinator uses the real inline capture/normalizer and a real producer mode that
preserves asset-bearing inventory as `not-attempted` while invoking no resolver,
fetch or binary sink.

Structured outcomes retain request/capture/producer/receipt/evidence facts
independently. Cancellation prevents future effects but never claims to undo a
started request. Evidence is attempted once; failed or uncertain commit keeps
facts in memory and triggers no retry. A committed assessment is labelled
`evidence-recorded`, not successful or settled.

### E28 — Legacy stage helpers and companion-wide sinks hid ownership

The manual staged path read, created and aborted archive stages through ambient
runtime messaging. The legacy archive sink also owned every stage in a supplied
companion and removed unselected stages after a raw-only write. An unwired
coordinator could therefore neither prove stage cleanup nor safely retain an
unselected canonical stage reference.

Attachment acquisition would magnify this gap by adding resolver, fetch, binary
stage and destination effects before ownership was explicit.

### E29 — Explicit leases now preserve selected transfer and cleanup facts

The staged coordinator now accepts a complete injected stage port and
request-returned leases bound to exact execution identity and artifact
commitment. The real capture and destination builder use only that port. Selected
stages transfer synchronously to a narrow sink; unselected stages remain
execution-owned and release exactly once after started work drains.

Cleanup outcome is independent from capture and write facts, and live staged
references are removed from returned material after cleanup. Asset acquisition
remains disabled. Real staged raw above 16 MiB and injected canonical staging
paths pass offline without touching extension runtime.

### E30 — A late stop fence still needs a durable interruption attempt

First-head review found one staged cancellation race after every destination
write had completed. If cancellation arrived during the evidence pre-CAS read,
the coordinator correctly prevented the receipt CAS but returned without
attempting the separate interruption transition. Durable state could therefore
remain active and `in-flight` after execution and external writes had ended.

The fixed path keeps the no-new-effect fence and then attempts
`execution-cancelled` through the existing independent uncertainty transition.
Failure or unknown outcome remains honest and is never retried or compensated.

### E31 — Broad attachment defaults were incompatible with isolated execution

The established manual producer can use omitted dependencies to invoke legacy
raw recapture, global fetch and runtime binary staging. Enabling acquisition by
removing the coordinator's disabled flag would therefore bypass the explicit
ownership boundary from E29 rather than extend it.

### E32 — One complete ordinary direct PNG bundle closes the offline effect chain

The staged coordinator now accepts one exact `ordinary-direct-png/1` bundle with
mandatory resolver observation, browser-managed fetch, single-binary sink and
strict limits. It runs the real whole-ledger matcher and acquisition verifier,
then existing destination reconciliation and producer/evidence paths. Omitted
or partial capabilities start no attachment effect.

The policy remains unwired from production. Deny-only interpreter ownership and
normalized unknown/not-dispatched sink facts prevent ambiguous evidence from
becoming ordinary authority or fetched assurance. Attachment facts remain
best-effort runtime output; no spool, retry or settlement follows.

### E33 — Single-operation v2 records did not form a resumable baseline

After E32, Liska could prepare, persist and execute one explicit operation, but
there was no immutable multi-item plan or conservative answer to “what remains
untouched?” Journal v1 lacks new-capture purpose and destination assurance; v2
retains at most 16 immutable operations and has no settlement, retry, deletion
or plan store. Extending either schema before atomic ownership and retention are
decided would conflate separate facts.

### E34 — Explicit catalog planning now stops before authority

ADR-065 adds an unwired pure plan/checkpoint/projection core. Exact canonical
catalog bytes plus a nonempty explicit subset produce deterministic plan bytes
and a separately reverified digest. Checkpoints start and restart paused, retain
bounded immutable links/charges/time/window/cooldown observations and never
refund or retry a touched item.

Projection requires a claimed complete detached v2 snapshot and replays its
evidence. Foreign, missing or orphan operations stop conservatively. Every next
decision remains `executionAuthorized: false`; even `consistent` evidence and
`no-unattempted-items` are not completion or settlement.

### E35 — Separate databases could not make plan charge and reservation atomic

The pure checkpoint could observe an existing v2 operation, but persisting its
link/charge and independently reserving in the existing v2 database left a crash
window. Upgrading v2 could provide one transaction but would make old rollback
code fail its exact version/schema open. A second plan-only database would still
leave two commits, while a new combined owner could preserve both earlier
namespaces and own future baseline reservations atomically.

### E36 — One rollback-isolated owner now commits the first reservation atomically

ADR-066 adds a fixed two-store database containing one exact catalog/plan/
checkpoint envelope and its canonical v2-format reserved records. Every mutation
rescans and byte-CASes both complete inventories; the checkpoint link, slot
charge, observation and operation insert commit or abort together. Opening an
existing owner requires explicit paused recovery.

Timeout, close and versionchange request abort and wait for a terminal
transaction event; a refused abort may still end in an observed commit or abort,
while only a missing terminal event remains unknown. A refused or already-
committed schema-upgrade abort is separately `open-outcome-unknown`. Operation
control headroom is validated before insert and on every read. The owner exposes
no dispatch token or provider effect, so its first reserved record intentionally
blocks the next candidate until a future evidence/runner adapter exists.

### E37 — Concrete store coupling blocked owner-backed execution

The accepted coordinator used only five persistence methods but required a
concrete `PurposePersistenceStore` instance and recognized only its error type.
The durable owner could not safely borrow that store: it owns another database,
checkpoint observations and session fences. Owner lifecycle states were also
rejected by reservation-only admission, and uncertain owner commits would have
collapsed to generic write failure.

### E38 — One branded store port now preserves owner lifecycle and evidence

ADR-067 extracts exactly the five coordinator methods behind a frozen branded
port. The legacy wrapper preserves native v2 behavior; the owner-bound port
atomically updates operation bytes and the latest checkpoint observation for
claim, interruption, pause/restart and factual evidence. Tokens are minted only
after claim commit, burned before consume awaits and invalidated by stop/session
events.

Awaiting-resolution evidence may expose another untouched item, but no method
automatically reserves or executes it. Exact phase/control headroom and read
admission cover claim, mandatory interruption/recovery and late evidence through
safe-integer limits. Already-paused recovery preserves bytes without restoring
tokens or dispatch authority.

### E39 — Production closure authority would make native acceptance ambiguous

The real owner-backed coordinator import closure reaches dormant extension
messaging, export-scope defaults, a manifest permission probe and default runtime
binary persistence. None is selected by the synthetic scenario, but packaging
them unchanged would make a supposedly isolated browser test depend on ambient
extension authority and leave accidental invocation observable only after the
fact.

### E40 — One exact zero-permission harness now compiles the real execution path

ADR-068 adds a direct opt-in MV3 Options-page build with empty permissions and
host permissions, network-denying CSP and counted throwing runtime sentinels.
Four ambient seams are replaced only after exact normalized source-hash checks;
drift, missing/duplicate replacement or any sentinel call fails closed.

The compiled real owner, branded port and coordinator pass an offline browser
simulation for staged selected-byte verification, awaiting-resolution evidence,
explicit second reservation, database close/reopen semantics, paused recovery,
in-flight restart to unknown, stale-authority denial and exact test-database
cleanup. The fixed receipt contains only row statuses and capped integers.
This does not yet prove installed Comet CSP, physical IndexedDB or native timer
scheduling; that one visible run remains open.

### E41 — The isolated owner path now passes one visible installed Comet run

The exact generated directory was loaded as a separate unpacked extension after
explicit user confirmation. Comet reported no special permissions and no
additional site access. Its Options tab stayed visible through one run: overall
PASS, all 14 fixed rows PASS, 842 ms elapsed and 146 ms maximum scheduling gap.

The receipt records three refused foreign/wrong-version database operations,
four exact opens, two exact deletes, one staged transfer with independent
selected-byte verification, paused reopen recovery, in-flight restart to
unknown and zero post-recovery request/sink growth. Network and denied-ambient
counts stayed zero. This proves native CSP, IndexedDB and timer behavior only for
the synthetic harness; it does not accept provider access or real File/Obsidian
delivery.

### X1 — Reopen every chat daily or confuse a fixed list with change discovery

This scales requests with archive size rather than actual changes and can still
miss provider edits or forks. It also turns absence of a successful visit into a
false no-change claim.

Revisit when: only as a clearly labelled manual catch-up mode with an explicit
budget, not as the default discovery contract.

### X2 — Collapse official exports, daily snapshots, readable views and memory

One mutable store would look simpler, but later inference or cleanup could
silently rewrite primary evidence. It would also make the memory index necessary
for reading or recovering the archive.

Revisit when: never for ownership; layers may integrate through references and
rebuildable indexes while retaining separate authority.

### X3 — Promote detail timestamps into discovery watermarks

Building an unwired comparator over `updated_at` would be easy, but detail-field
presence does not prove list availability, marker monotonicity, material-change
coverage or account completeness. A synthetic list parser would preserve the
same guess in a more authoritative form.

Revisit when: one bounded provider-list experiment establishes the exact source,
scope and semantics of the compared marker.

### D1 — Keep the four layers separate and defer automation

The current direction is periodic official-export evidence, update-driven daily
Liska snapshots, derived reading views and only then a separate living-memory
layer. Backup automation stays paused until manual capture, recovery and
reconciliation are boringly reliable and a provider-specific discovery design
is explicitly opened.

Evidence: E1, E2, E3

### D2 — Sequence backup as catalog, slow baseline, then update discovery

The backup sequence starts with the now-accepted read-only local catalog of
existing snapshots and inert journal. A later opt-in baseline may enumerate and
capture accessible chats over multiple days under explicit per-provider budgets.
Only after that may a
daily service poll bounded provider index/history metadata and capture chats
with observed changes. Providers without a trustworthy marker remain deferred
or manual rather than producing a false no-change claim.

Evidence: E1, E2, E4

### D3 — Make the first catalog rebuildable, manifest-only and non-authorizing

The first active backup slice reads only explicitly selected `manifest.json`
files plus file path/size metadata. It emits a deterministic private catalog
with stable provider/capture identities, declared completeness, metadata-only
presence facts and fixed issues. It retains no source locator in the exported
JSON, performs no persistent cache write and grants no recapture authority.

Exact raw/canonical/asset verification remains a separate stronger operation.
The accepted second slice is an inert work journal, not a claim that an account
baseline already exists. Provider enumeration and update markers still require
sufficient separately evidenced provider contracts; local verification remains
outside that capture journal under D8.

Evidence: E2, E5, E6

Decision record: ADR-050

### D4 — Put an inert resumability ledger between the catalog and provider execution

Durable state is now a separate pure journal plus dedicated extension-origin
IndexedDB. Catalog selection can create only a paused run. Restarted running work
would become unknown, and no transition is retried automatically. The private
page exposes selection, paused creation, reload and export only; provider
enumeration, execution and scheduling require a later contract.

Evidence: E5, E7

Decision record: ADR-051

### D5 — Require provider-list evidence before discovery code

Enumeration observations, detail observations and update-discovery markers are
separate contracts. No executable provider discovery module is added until one
provider's list surface is observed under an explicit request cap and the proven
subset is recorded. Unknown properties remain unknown; equal markers never mean
that a conversation is fully unchanged or backed up.

Evidence: E2, E5, E8

Decision record: ADR-052

### D7 — Admit one Claude terminal list page without sync conclusions

Liska now has an accepted pure unwired Claude contract for the exact observed
terminal active-list shape. It projects only scope-qualified conversation
identity and an optional opaque `updated_at` token. Outcomes distinguish rejected,
unsupported and observed structure; marker comparison is limited to
`same_token`, `different_token` or `incomparable` and never authorizes skipping
capture.

Evidence: E8, E10

Decision record: ADR-053

### D6 — Namespace future captures by a verified provider scope

After stable provider/account/workspace binding is evidenced, a future canonical
layout may use a versioned scope key between provider and conversation. Display
names or emails do not own identity; optional human aliases stay in a separate
private registry. Existing captures without account binding remain
`unbound/legacy` and are not silently reassigned.

Evidence: E3, E8, E9

Decision record: ADR-052

### D8 — Keep selected-snapshot verification outside capture journal v1

Do not add an offline one-item journal begin/settle driver or provider wiring.
Any future pure reattachment requires the exact original catalog digest,
provider/conversation/key, exact manifest length/digest and existing capture
identity. It must separate `matched`/`mismatch` from independent
`verified`/`partial`/`unverifiable`/`unsupported` assessments and have no journal,
provider, network or archive mutation authority.

A production baseline needs separately reviewed persisted operation purpose and
capture semantics so verification cannot consume capture work, sufficient
provider evidence and explicit account-wide authority. ADR-053's opaque-token
limitations remain unchanged. The full backup goal is not complete, and semantic
memory remains a later independent layer.

Evidence: E6, E7, E10, E11

Decision record: ADR-054

### D9 — Keep ChatGPT list-name evidence non-executable

Record ADR-055 as a docs-only route-evidence checkpoint. A request-shape
classifier would encode lexical familiarity only: full URL/method/query grammar,
response envelope, record types, stable identity, pagination and marker contract
are absent, and there is no consumer. Add no classifier, parser or runtime.
Provider-specific update discovery has not functionally advanced through E12.
ADR-052/053/054 and their authority boundaries remain unchanged; the journal
stays inert, baseline authority stays gated and semantic memory remains later.

Evidence: E12, E13

Decision record: ADR-055

### D10 — Keep native sidebar container evidence docs-only without a parser

Record ADR-056 without parser, classifier or runtime. A tiny structural envelope
parser is technically possible, but without a diagnostic consumer it is unused
evidence scaffolding rather than backup progress. A future separately justified
diagnostic consumer could admit a strictly bounded gizmo-envelope parser, still
without conversation-discovery authority.

Preserve ADR-055's name-only history and unresolved caller attribution. The
catalog, inert journal, schemas and runtime remain unchanged. ADR-052/053/054
retain their authority boundaries; baseline and scheduler work stay gated and
semantic memory stays later.

Evidence: E14, E15

Decision record: ADR-056

### D11 — Admit bounded unbound ChatGPT page structure, not a change signal

The exact inspected nonterminal ordinary pages at offsets 20, 40 and 60 justify
a pure synchronous, unwired provider-local structural projector and materially
advance provider-specific conversation discovery. Its contract admits only
bounded `id` and optional opaque `update_time` marker data, identifies
the source as `chatgpt-backend-api-conversations.update_time/1`, rejects
duplicate IDs, and returns detached frozen sorted records with unresolved
`scopeBinding` and unknown termination. The conservative lowercase UUID
spelling is an acceptance policy, not a provider guarantee. Reported
`total` remains uninterpreted metadata; no continuation or completion field
is derived.

No comparator is justified while scope is unresolved. No cross-observation
equality/change, scope binding, terminal traversal, route-family union,
baseline/capture authority, scheduler or production closure follows. The
projector remains pure and unwired, with no network/browser/storage, cursor
traversal, runtime, importer, catalog, journal, capture or export integration.

Evidence: E16, E17

Decision record: ADR-057

### D12 — Isolate new-capture semantics before persistence or execution

Adopt the pure unwired operation/evidence relation in ADR-058 as the semantic
boundary for one future `new-capture` purpose. Require all requested destinations
and preserve the exact distinction between File terminal-path confirmation and
Obsidian byte readback. Missing evidence is insufficient, present contradictions
are conflicts and malformed present identity or commitments are rejected.

Do not reinterpret existing receipts as sufficient, change journal v1, add a
decoder/migration, persist the new contract or wire any producer, provider,
capture, archive, UI, baseline or scheduler. This resolves contract meaning but
not the persisted-purpose requirement from ADR-054; production authority remains
gated.

Evidence: E11, E18, E19

Decision record: ADR-058

### D13 — Retain real producer facts before adding purpose persistence

Adopt ADR-059's additive factual receipt and unwired ChatGPT adapter. Preserve
the exact distinction between File terminal path confirmation and Obsidian byte
readback, keep destination manifests independent and never reconstruct raw
delivery from later finalization.

Allow a purpose-consistent projection only when immutable intent was supplied
before the first write and both legacy-routing and provider-aware identity hashes
match their independent recipes. Ordinary manual exports may expose factual
receipts but cannot acquire operation, attempt or catalog meaning after capture.

Evidence: E18, E19, E20, E21

Decision record: ADR-059

### D14 — Separate pure admission from one unwired prepared capture

Adopt ADR-060's exact canonical catalog handoff and real single-capture executor.
The operation and producer intent share one admitted source of truth, the
reserved ID exists before the provider request and no default runtime bridge,
alternate normalizer, retry or persistence is available to this executor.

Do not use journal v1's dispatch token or derive operation meaning from
`runId`/`itemId`. This handoff proves effect ordering but not durable uniqueness
or restart-safe dispatch authority. Preserve real `not-attempted` asset
semantics and the resulting insufficient assessment.

Evidence: E19, E21, E22, E23

Decision record: ADR-060

### D15 — Keep purpose persistence separate, commit-gated and unresolved

Adopt ADR-061's separate v2 database and one-operation journal. Preserve v1
source and storage exactly. Require atomic retained identity uniqueness,
transaction-complete token issuance, exact full-snapshot CAS, session-private
currentness and explicit restart recovery.

Retain factual receipts and adapter results but never map any assessment to
settlement or retry. Use one store-owned hash authority and reserve exact space
for every required later control transition. Treat browser-local commit as
bookkeeping, not permanent archive durability or exactly-once execution.

Evidence: E19, E21, E23, E24, E25

Decision record: ADR-061

### D16 — Consume one token at the effect boundary and preserve every known fact

Adopt ADR-062's one-shot inline/no-acquisition coordinator. Require store-owned
token consumption with the final fence and request invocation in one synchronous
continuation. Derive destinations and intent only from the prepared operation,
reject staged transport before stage runtime and keep manual staged behavior
unchanged.

Return independent claim, request, capture, producer and evidence-persistence
facts. Do not discard late receipts when a later write fails, and do not retry or
compensate after an uncertain transaction. Preserve asset-bearing inventory as
not attempted rather than reaching hidden network defaults.

Evidence: E21, E23, E25, E26, E27

Decision record: ADR-062

### D17 — Make staged ownership explicit before enabling acquisition

Adopt ADR-063's staged capability/lease and selected-artifact sink contract.
Bind leases to exact execution identity and commitment, transfer only selected
stages at sink invocation and never release a possibly dispatched lease. Release
execution-owned stages once and retain deferred/unknown cleanup separately from
capture and archive facts.

Keep acquisition disabled and late facts best-effort runtime for this unwired
stage. Do not treat temporary stages or download cleanup records as a durable
purpose-evidence spool.

Evidence: E27, E28, E29

Decision record: ADR-063

### D18 — Pair every cancelled effect fence with an interruption transition

When staged cancellation wins before a new evidence effect starts, preserve the
fence and attempt the independent durable cancellation transition before
returning. Do not convert an uncertain transition into success, and do not
restart, compensate or duplicate destination writes.

Evidence: E27, E29, E30

Decision record: ADR-063

### D19 — Prove one complete attachment family offline before live wiring

Adopt ADR-064's staged-only ordinary direct PNG capability contract. Require
every effect capability before claim, one attempt, full-ledger identity denial,
real bounded byte verification and exact destination facts. Preserve manual
defaults outside the coordinator and keep all live/provider/baseline authority
behind later explicit gates.

Evidence: E29, E31, E32

Decision record: ADR-064

### D20 — Separate multi-item planning from durable operation ownership

Adopt ADR-065's exact explicit-selected plan and data-only checkpoint before any
baseline runner. The planner may explain one untouched candidate or a fixed stop
reason, but cannot reserve, dispatch, settle or retry. V2 remains the sole owner
of operation state; a future durable baseline owner must atomically bind plan
item, slot charge and reservation instead of composing two independent writes.

Evidence: E11, E24, E25, E33, E34

Decision record: ADR-065

### D21 — Keep durable baseline ownership in a rollback-isolated atomic domain

Adopt ADR-066's new fixed database rather than upgrading v2 or coordinating two
independent stores. One owner retains exact plan/checkpoint/catalog bytes and at
most 16 owned v2-format reservations. Reservation atomically binds item, charge,
observation and operation, but grants no dispatch or retry authority.

Preserve existing v1/v2 databases, reject foreign/corrupt/partial state, and
require fresh read-only reconciliation after uncertain commit. Do not add
multiple owners, deletion or automatic database rotation before retention and
operation-runner ownership are separately designed.

Evidence: E25, E33, E34, E35, E36

Decision record: ADR-066

### D22 — Reuse one coordinator through an exact execution-store port

Adopt ADR-067's five-method port rather than a second coordinator or an owner
subclass of the native v2 store. BaselineOwner remains the sole database/session
authority and binds each port to one immutable reservation plus caller clock.
Every lifecycle mutation updates operation and checkpoint evidence atomically.

Preserve the cross-handle transaction-to-provider-start race as an explicit
at-most-one-capability limitation. Keep error mapping closed so uncertain commits
never trigger compensation or retry. Do not promote awaiting-resolution to
settlement or auto-reserve the next item.

Evidence: E27, E29, E35, E36, E37, E38

Decision record: ADR-067

### D23 — Keep native owner acceptance in a separate zero-permission extension

Adopt ADR-068's direct opt-in test build rather than loading the production
extension or copying a miniature owner/coordinator. Compile the real logic, pin
and deny only exact ambient defaults, permit one guarded random test database,
and require a visible bounded fixed-content receipt with exact cleanup.

File and Obsidian observations remain explicitly in-memory simulations. The
harness adds no provider, destination, account, runner or scheduler authority;
the installed native PASS and any later manual provider binding remain separate
gates.

Evidence: E38, E39, E40, E41

Decision record: ADR-068

### T1 — Design provider-specific update discovery

The first automation slice needs a resumable baseline inventory, then one
reviewed discovery contract per provider with request/page budgets, cooldown,
backoff, cursor, observed change evidence, pause, catch-up and honest error or
missed-run states.

Trigger: archive reliability is accepted and the user explicitly opens the
backup-discovery design.

### T2 — Open living memory as its own later project

Memory may surface themes, links, unfinished threads and semantic recall, but it
must index stable evidence and remain rebuildable.

Trigger: the first three layers have reliable recovery and reconciliation, and
the user separately defines the memory product's privacy and interaction scope.

### T3 — Design the local canonical snapshot catalog

Define stable provider/conversation keys, immutable capture identities,
directory and index rules, recovery receipts and rebuild-from-files behavior
without granting network or mutation authority.

Trigger: the current multi-format presentation checkpoint is complete, or the
user explicitly chooses backup organization as the next active slice. Fulfilled
on 2026-11-04 after the bounded PDF checkpoint merged: the manifest-only catalog
is accepted and installed-live verified, followed by the accepted inert journal.
Their non-authorizing boundaries remain in force.

### T4 — Run a resumable baseline before any daily scheduler

Inventory and export all accessible conversations slowly, with a durable cursor,
daily request/page budget, cooldown, pause, retry and honest deferred/error
states. The baseline may intentionally take several days.

Trigger: persisted operation purpose/capture semantics and one provider's
discovery/enumeration contract are reviewed, then account-wide authority is
explicitly enabled. Local verification cannot satisfy this trigger.

### T5 — Run one bounded read-only provider-list evidence pass

Inspect at most three foreground list requests for one explicitly chosen
provider, signed-in account and workspace/organization scope, or explicitly
`personal/no-workspace`. Retain only repository-safe schema aggregates, never
real titles, IDs, cursors, account identifiers or response bodies. Stop if the
visible account or scope is ambiguous or mismatched. A confirmed switch closes
the current sample; any later sample for the other scope gets its own cap and
checkpoint.

Trigger: the user explicitly names the provider, signed-in account and exact
workspace/organization or personal scope allowed for the experiment. The first
Claude pass was authorized and fulfilled on 2026-11-05 (E10); the initial ChatGPT
recommendation was not authorization. A later separately authorized ChatGPT pass
observed names only (E12), not schema. Any future pass is separate and must count
actual emitted requests, including refetches, within its own cap; reading safe
aggregate response structure requires explicit body-inspection permission.

### T6 — Implement a scope-aware canonical directory layout

Introduce `provider/scope-key/conversation-key/capture-id` only after the chosen
provider supplies a proven stable scope identity and migration/rollback rules
for legacy evidence are separately reviewed. Multiple accounts/workspaces may
live as sibling scope roots without sharing cursors or histories.

Trigger: one provider-specific scope binding is accepted and a non-destructive
layout/migration ADR is approved.

### T7 — Prove Claude pagination and marker semantics separately

Investigate `has_more=true`, nonzero offset, archived visibility, repeated-body
equality, scope switching, rate limits and marker response to controlled material
changes without expanding the terminal observation contract by analogy.

Trigger: the user explicitly authorizes a new bounded experiment whose
request-level cap can account for client/provider refetches.

### T8 — Choose further Claude evidence or a later account-wide baseline gate

Continue, if separately authorized, with bounded Claude pagination, archived
visibility, controlled marker/scope behavior or rate-behavior evidence using
actual emitted-request accounting. The alternative later branch is an explicit
account-wide baseline decision after persisted purpose/capture semantics and
sufficient provider contracts are reviewed, not an offline verification driver.

Trigger: the user chooses and authorizes one bounded evidence experiment or,
after the required reviews, explicitly grants account-wide baseline authority.
Until then the journal stays inert, the backup goal stays unfinished and living
semantic memory stays later.

### T9 — Authorize a bounded ChatGPT schema-observation pass separately

A later pass may inspect explicitly permitted request details and safe aggregate
list response structure, without retaining real values. It must choose the
provider, signed-in account and exact scope, count actual emitted requests
including refetches, and define its own cap and stop conditions. Candidate path,
method, full query, envelope/record types, identity, pagination and marker remain
unproven until observed; no meanings follow from `tpp`, `owned_only` or `expand`.

Trigger: the user explicitly authorizes that bounded scope and inspection,
including safe aggregate response structure. The completed name-only pass
excluded bodies and grants no permission to open them later. No further provider
request is authorized by this thread.

Fulfilled in a limited, separately authorized schema pass on 2026-11-06 (E14/E15):
only the exact native sidebar/gizmo-container subset was observed, not a
conversation-bearing list. This does not complete conversation discovery or
reinterpret the name-only pass. T10 is a new authorization gate, not permission
to spend the unused third request.

### T10 — Observe a native conversation-bearing list under a new bounded plan

The next ChatGPT evidence must come from a native conversation-bearing list
response with exact visible account/scope, actual request grammar, conversation
identity field/type/format, pagination fields and an actual list-level marker.
Count actual emitted requests including refetches, define stop conditions and
retain only the explicitly permitted safe schema aggregates. Unknown or absent
evidence stays unknown or absent; the observed gizmo ID and organization field
cannot fill those gaps.

Trigger: the user separately authorizes that bounded scope and response
inspection. Do not manually change `conversations_per_gizmo`, guess a route or
scroll Recent under the old cap. The completed schema pass grants no further
provider request, baseline or scheduler authority.

Fulfilled only as a limited evidence pass on 2026-11-06 (E16/E17): ordinary
conversation-bearing pages, request grammar, bounded record identity and an
optional update-time field were observed. Authenticated scope binding, terminal
traversal, marker behavior and the other T10 requirements remain open; the
unbound projector in D11 is not a discovery or sync authority. The UI-scroll
burst exceeded the self-imposed soft cap by two actual requests, so future
experiments must budget emitted requests rather than gestures.

### T11 — Establish authenticated scope, terminal traversal and marker behavior

Before using any marker to skip capture, establish authenticated scope binding,
exact terminal traversal and restart behavior, duplicate/reorder/filter
behavior, and marker behavior under controlled changes. Keep the ordinary,
TPP and per-gizmo families separate unless observed evidence proves their
relationships. A nonterminal page or provider-reported total is not
completeness evidence.

Trigger: a separately authorized bounded experiment establishes these
provider-specific facts and request-level budgeting. Until then, no comparator,
skip decision, account baseline or scheduler is authorized.

### T12 — Adapt exact producers and persistence without changing journal v1

Design a separately reviewed producer/admission adapter that derives the
provider-aware conversation key and maps current destination receipts into the
new evidence contract without overstating File assurance. Then design a new
persistence version that stores purpose and assessment evidence while keeping
journal v1 byte- and meaning-stable and preventing one purpose from consuming
another purpose's work.

Trigger: exact current producers can emit every required binding and assurance,
one provider has sufficient authenticated scope/traversal evidence, and the user
explicitly chooses the next persistence or account-wide baseline slice. No
driver or scheduler follows from the pure contract alone.

Partially fulfilled on 2026-11-06 by E20/E21 and D13: exact current ChatGPT
producer facts and an unwired adapter now exist. Purpose-aware persistence and
the pre-capture admission/execution handoff remain open; journal v1 is unchanged.

### T13 — Hand admitted identity to capture before any provider request

Design a separately reviewed handoff that starts from an exact selected catalog,
creates operation/attempt identity, reserves the capture ID and passes immutable
intent into capture before the request and first durable write. Only a later
purpose-aware persistence version may retain assessment/settlement state.

Trigger: one provider has sufficient authenticated scope/traversal evidence and
the user explicitly authorizes the admission/execution slice. This does not
authorize an account-wide baseline or scheduler.

Fulfilled as an unwired single-capture acceptance gate on 2026-11-06 by E22/E23
and D14. Durable reservation, current-token validation and settlement remain
open under T14.

### T14 — Persist purpose-aware reservation before dispatch

Design a new persistence version that atomically stores purpose, operation,
attempt, reserved capture and exact catalog identity before any dispatch. Define
pause/restart validation, crash/retry behavior and assessment retention without
mapping `consistent` directly to automatic settlement. Keep journal v1 readable
and byte/meaning stable.

Trigger: the persistence/recovery contract is separately reviewed and the user
explicitly authorizes that local storage slice. Provider scope and account-wide
baseline authority remain separate later decisions.

Fulfilled as an unwired browser-local persistence gate on 2026-11-06 by E24/E25
and D15. Actual request ownership and current-token consumption remain open under
T15; no baseline authority follows.

### T15 — Connect committed currentness to the actual request boundary

Design a single-operation execution coordinator that exclusively owns one
committed v2 reservation, consumes current session authority at the real provider
effect boundary and defines pause/cancel races plus evidence-persistence failure
handling. A pre-request snapshot check alone is not a lock across later awaits.

Trigger: coordinator ownership and crash semantics are separately reviewed and
the user explicitly authorizes local execution wiring. Provider scope and
account-wide baseline authority remain separate gates.

Fulfilled for one unwired inline/no-acquisition operation on 2026-11-06 by
E26/E27 and D16. Staged capture, attachment acquisition and crash-durable late
facts remain open under T16; no live provider or baseline authority follows.

### T16 — Own staged/acquisition effects and decide late-fact durability

Design explicit owners for staged capture handles, resolver/acquisition routes
and binary sinks without fallback to global runtime/network capabilities. Decide
whether raw/producer facts that cannot reach v2 evidence persistence require a
separate crash-durable spool or remain best-effort runtime output.

Trigger: staged/acquisition cleanup and late-fact recovery semantics are
separately reviewed and the user explicitly authorizes that local execution
slice. Provider scope and account-wide baseline authority remain later gates.

Partially fulfilled on 2026-11-07 by E28/E29/E30/E31/E32 and D17/D18/D19: staged
capture/archive ownership is explicit, stopped evidence effects retain an
independent interruption attempt, runtime-best-effort late-fact policy is
adopted for unwired work and one ordinary direct PNG family has a complete
offline capability proof. Live capability wiring remains open under T18.

### T17 — Enable one explicit attachment acquisition family

Add one named resolver family with an all-or-nothing capability bundle:
resolver, bounded acquisition and binary sink. Missing capabilities must fail
before dispatch; omission must never fall back to recapture, global fetch or
runtime messaging. Apply stop and reserved-destination guards to every effect.

Trigger: one family and its ownership/cleanup contract are separately reviewed
and the user authorizes that local offline acquisition slice. Provider scope and
account-wide baseline authority remain later gates.

Fulfilled offline on 2026-11-07 by E31/E32 and D19 for exactly one
`ordinary-direct-png/1` attempt. No live capability provider or installed byte
acceptance follows.

### T18 — Bind one live capability provider without widening the family

Provide the exact resolver/fetch/single-binary capabilities required by ADR-064
without exposing general runtime messaging or optional fallbacks. Prove useful
current-provider eligibility and one physical destination outcome separately.

Trigger: the user explicitly authorizes one bounded installed acceptance plan.
Until then no production import, UI switch, provider request, baseline or
scheduler authority is added.

### T19 — Design durable baseline-plan ownership and atomic reservation

Choose storage evolution, capacity/retention and an atomic protocol that relates
one plan item, reservation-slot charge and v2 operation before dispatch. Preserve
unknown commit outcomes without blind retry, and recover every active plan as
paused. Do not duplicate v2 phases into a second mutable ledger.

Trigger: the pure ADR-065 core is accepted and the user explicitly authorizes a
durable local planning slice. Provider traversal, live baseline execution and a
daily scheduler remain separate gates.

Fulfilled locally on 2026-11-07 by E35/E36 and D21 for one retained owner and one
atomic ChatGPT reservation path. Dispatch/evidence progression remains open.

### T20 — Connect the owned reservation to execution and evidence atomically

Provide a store adapter that can claim/consume one baseline-owned reserved
operation, run the existing coordinator and retain resulting v2 evidence plus
the matching checkpoint observation without split-brain or automatic retry.
Unknown provider/storage outcomes must fence the owner and require explicit
resolution; consistent evidence is still not settlement.

Trigger: ADR-066 is accepted and the user explicitly authorizes an unwired
runner/evidence slice. Provider enumeration, multi-day live baseline and the
daily scheduler remain later gates.

Fulfilled offline on 2026-11-07 by E37/E38 and D22 for one explicitly invoked
owner-backed operation. Native-browser and provider binding remain open.

### T21 — Accept owner-backed execution natively before a manual provider runner

Exercise the owner database, branded port and existing coordinator in a native
browser using synthetic injected request/stage/sink capabilities. Verify physical
close/reopen, paused recovery, final-effect fences and exact evidence bytes
without touching an account or production database.

Trigger: ADR-067 is accepted and the user authorizes one installed synthetic
acceptance harness. A later manual provider runner still requires explicit scope,
capabilities and request budgets; no scheduler follows.

Fulfilled on 2026-11-07 by E39/E40/E41 and D23. The exact unpacked build passed
one user-confirmed, continuously visible installed-Comet run without provider,
destination or production-database authority.

### T22 — Design one manual provider-bound baseline operation

After native synthetic acceptance, define one explicit provider page, capture
capability bundle, account/scope evidence, request budget, stop conditions and
receipt boundary for a single baseline-owned operation. Preserve manual launch,
paused recovery and no automatic continuation.

Trigger: T21 has an installed native PASS and the user separately authorizes the
provider, account scope and bounded live request.

The native precondition is now satisfied by E41. This tail remains unopened
until that separate provider/account/request authorization is given.

## Observations

- [hypothesis] H1: daily backup initially appeared equivalent to reopening every chat or keeping a fixed selection
- [evidence] E1: manual archive, reconciliation, presentation and analysis now have distinct authority boundaries
- [evidence] E2: reliable change discovery is provider-specific and cannot be inferred from title, order or elapsed time
- [evidence] E3: the desired ecosystem separates periodic official evidence, update-driven captures, reading views and later living memory #local-only
- [hypothesis] H2: local canonical cataloging can be designed before account-wide provider polling
- [evidence] E4: rapid bulk conversation reopening is an observed constraint, though no exact rate limit is claimed #local-only
- [evidence] E5: the pre-catalog audit found immutable provider-neutral manifests but no durable baseline cursor, list adapter or scheduler #code
- [evidence] E6: installed manifest-only catalog rebuilt 121 real entries deterministically while all 495 selected source files remained byte-identical #live
- [evidence] E7: installed inert journal recovered the same 24 paused items after an extension reload and round-tripped its physical export byte for byte #live
- [evidence] E8: the pre-experiment audit proved detail capture but no account-list contract; E10 later admitted only Claude's terminal structural subset #code
- [evidence] E9: the current default is each provider's visibly active main personal account; dormant backups stay out of scope #local-only
- [evidence] E10: one Claude reload emitted three active-list requests and proved only a 12-record terminal envelope with opaque markers #live
- [evidence] E11: exact post-PR118 main makes confirmed attempts recorded/ineligible, so verifying an existing snapshot is not new capture work #code
- [evidence] E12: three ChatGPT Fetch names/statuses exhausted the cap; method, full path and schema were uninspected, and recording stop proves no completeness #live
- [evidence] E13: exact AI Exporter 4.6.1 source is a pass-through observer, so DevTools attribution identifies neither list construction nor the initiating caller #code
- [evidence] E14: after disabling AI Exporter/reloading, one isolated sidebar opening emitted two native GET 200 gizmo-container requests at budget 2/3; 20/string and 1/null envelopes prove neither account boundaries nor 21 unique records #live
- [evidence] E15: one expanded gizmo wrapper exposed only keys/types; gizmo and organization strings establish neither conversation identity nor scope binding, while nested empty conversations under an explicit zero setting prove no absence #live
- [evidence] E16: native ordinary ChatGPT pages exposed an exact bounded nonterminal envelope and one record's field/types; reported totals are uninterpreted and scope/termination remain unknown #live
- [evidence] E17: two ordinary requests preceded a six-route UI burst, totaling eight against a self-imposed soft cap of six and showing gestures cannot enforce request budgets #live
- [evidence] E18: journal v1 and current ChatGPT destination receipts lack purpose-complete new-capture settlement evidence, and File path confirmation is not Obsidian byte readback #code
- [evidence] E19: pure versioned new-capture operation/evidence relations now classify detached supplied facts without persistence, settlement or execution authority #code
- [evidence] E20: current File and Obsidian sinks already proved distinct per-artifact facts that legacy receipts and generic accounting discarded #code
- [evidence] E21: additive exact ChatGPT producer receipts and an unwired adapter preserve real sink facts but require pre-write intent for purpose consistency #code
- [evidence] E22: ordinary ChatGPT capture allocated identity after the provider response, leaving pre-dispatch reservation unproved #code
- [evidence] E23: exact canonical catalog admission now prepares frozen identity before one real injected capture; real asset inventory remains honestly insufficient #code
- [evidence] E24: v1's exact one-store database and missing purpose semantics prohibit an in-place persistence upgrade #code
- [evidence] E25: separate v2 IndexedDB commits single-operation reservation and retained assessment without settlement; native Chromium close/reopen/recovery passed #live
- [evidence] E26: reusable currentness and hidden producer defaults left request duplication and unintended recapture/fetch/runtime effects possible #code
- [evidence] E27: store-owned one-use consumption now gates one inline request; no-acquisition producer and structured outcomes retain facts without settlement/retry #code
- [evidence] E28: ambient stage helpers and companion-wide sink cleanup left staged ownership implicit and unsafe for retained coordinator outcomes #code
- [evidence] E29: execution-bound staged leases, selected transfer and explicit cleanup now drive the real offline capture/archive path without acquisition #code
- [evidence] E30: first-head review found and closed a late cancellation race between the evidence pre-CAS read and its effect-start fence #code
- [evidence] E31: broad manual attachment omissions could recapture raw, use global fetch or invoke runtime binary staging and therefore were not isolated execution authority #code
- [evidence] E32: one complete ordinary direct PNG bundle now proves the offline resolver-to-receipt chain while production remains unwired #code
- [evidence] E33: catalog plus independent v2 records still lacked a bounded multi-item plan and conservative remaining-work projection #code
- [evidence] E34: exact explicit-catalog plan/checkpoint/decision core now explains offline progress while every result denies execution authority #code
- [evidence] E35: separate plan and v2 database writes could not atomically bind one item charge to one reservation without a crash gap #code
- [evidence] E36: one rollback-isolated two-store owner now commits exact checkpoint and reserved operation bytes atomically without dispatch authority #code
- [evidence] E37: concrete native-store and error coupling prevented the durable owner from reusing the accepted coordinator safely #code
- [evidence] E38: one branded five-method port now drives owner-backed claim/effects/evidence while atomically preserving latest checkpoint observations #code
- [evidence] E39: dormant messaging, scope, manifest and binary defaults made an unchanged production import closure too broad for isolated native acceptance #code
- [evidence] E40: an exact zero-permission MV3 harness now compiles the real owner/coordinator path and passes offline browser simulation; installed native timing remains open #synthetic
- [evidence] E41: one visible installed Comet run passed all 14 fixed rows with exact cleanup and zero network/ambient calls; provider and real destinations remain untested #live
- [rejected] X1: a full daily reopen or fixed list is not a trustworthy default change detector
- [rejected] X2: collapsing archive evidence and living memory would give inference silent rewrite authority
- [rejected] X3: detail timestamps and synthetic list schemas are not trustworthy discovery watermarks
- [decision] D1: preserve four separate layers and pause automation until explicit discovery design
- [decision] D2: sequence future backup as local catalog, slow resumable baseline and provider-specific update polling
- [decision] D3: start with a rebuildable manifest-only catalog that grants no provider, persistence or mutation authority
- [decision] D4: place a paused, restart-safe journal between catalog evidence and any future provider execution
- [decision] D5: require bounded provider-list evidence before writing provider discovery code
- [decision] D6: namespace future captures by a verified provider scope while leaving unbound legacy evidence unassigned
- [decision] D7: admit the exact Claude terminal list shape and compare opaque tokens without sync authority
- [decision] D8: keep local verification outside journal v1; future reattachment is pure and exact, while a baseline needs purpose/capture semantics and explicit authority
- [decision] D9: retain ChatGPT name evidence as docs only; lexical familiarity without grammar/schema or a consumer admits no classifier, parser or runtime
- [decision] D10: retain exact native sidebar container evidence as docs only; no unused parser/classifier/runtime, and conversation discovery plus baseline/scheduler authority remain gated
- [decision] D11: admit a pure unbound projector for exact inspected nonterminal ordinary pages only; no comparator, scope binding, terminal traversal or sync authority
- [decision] D12: adopt a pure all-of new-capture purpose/evidence relation while leaving journal v1, persistence, producers and production authority unchanged
- [decision] D13: retain exact current producer observations and adapt only explicitly pre-admitted work; manual/legacy captures remain non-authorizing
- [decision] D14: separate exact catalog-bound admission from one unwired real capture; do not treat the handoff as durable dispatch authority
- [decision] D15: keep purpose persistence in a separate commit-gated v2 store; retain evidence and uncertainty without settlement, retry or v1 mutation
- [decision] D16: consume one session token at the request boundary, run only explicit inline/no-acquisition effects and preserve every known fact independently
- [decision] D17: make staged lease ownership and selected sink transfer explicit before any attachment acquisition capability is enabled
- [decision] D18: pair every cancelled evidence effect fence with an independent durable interruption attempt before returning
- [decision] D19: prove one complete attachment family offline through mandatory capabilities before considering live wiring
- [decision] D20: keep multi-item planning separate from v2 operation ownership until an atomic durable protocol is designed
- [decision] D21: persist one baseline owner and its reservations in a new rollback-isolated atomic database domain
- [decision] D22: reuse one coordinator through an exact branded store port while keeping BaselineOwner the sole token and transaction authority
- [decision] D23: accept native owner execution only through a separate exact zero-permission harness with pinned ambient denials and content-free receipts
- [tail] T1: build resumable provider-specific update discovery after archive reliability is accepted
- [tail] T2: scope living memory independently after the archival layers have boring recovery
- [tail] T3: the catalog and subsequent inert journal are accepted and installed-live verified; preserve both non-authorizing boundaries
- [tail] T4: run a multi-day budgeted baseline before enabling a daily scheduler
- [tail] T5: first Claude schema and later ChatGPT name-only passes are fulfilled within different inspection bounds; future scope/caps and response-body inspection need explicit authority
- [tail] T6: add a scope-aware canonical directory layout only after stable binding and migration rules are reviewed
- [tail] T7: prove Claude pagination, archived visibility, marker semantics and request-level budgeting in later bounded experiments
- [tail] T8: choose separately authorized Claude evidence or a later explicitly authorized account-wide baseline after semantic/provider review; backup remains unfinished
- [tail] T9: a separately authorized schema pass was fulfilled only for native sidebar/gizmo containers on 2026-11-06; conversation-list evidence and further requests remain gated
- [tail] T10: limited separately authorized native conversation-list pass observed ordinary nonterminal pages, identity and marker field; authenticated scope and marker behavior remain open
- [tail] T11: establish authenticated scope, terminal/restart, duplicate/reorder/filter and controlled marker behavior before any skip decision or baseline/scheduler authority
- [tail] T12: separately adapt exact producers and purpose-aware persistence after evidence and user authority, without mutating journal v1
- [tail] T13: pass catalog-bound operation/attempt/reserved-capture intent into capture before requests, then design purpose-aware persistence separately
- [tail] T14: atomically persist purpose-aware reservation and define restart/retry/settlement semantics without changing journal v1
- [tail] T15: connect committed session currentness to the actual provider request under one separately reviewed execution owner
- [tail] T16: add explicit staged/acquisition ownership and decide whether unpersisted late facts need crash-durable spooling
- [tail] T17: enable one named resolver/acquisition/binary family with complete explicit capabilities and no fallback effects
- [tail] T18: bind and live-accept the exact ordinary direct PNG capabilities separately without widening provider authority
- [tail] T19: design durable baseline-plan storage and atomic charge+operation reservation before any runner
- [tail] T20: connect one baseline-owned reservation to coordinator execution and retained evidence without implicit settlement or retry
- [tail] T21: fulfilled by one visible installed native PASS without provider or destination authority
- [tail] T22: after native PASS, design one separately authorized provider-bound baseline operation with explicit scope and request budget

## Relations

- informed_by [[ith-002-layered-archive-truth]]
- informed_by [[ith-003-imperfect-sources-stay-separate]]
- informed_by [[ith-004-attachment-acquisition-authority]]
- informed_by [[ith-005-bounded-completeness-proof]]
- informed_by [[ith-006-preserve-before-deduplicate]]

## Source receipts

- S1 — [ChatGPT follow-up plan: user-facing derived outputs](../chatgpt-todo.md#7-user-facing-derived-outputs)
- S2 — [ADR-031: Separate Capture, Canonical Archive, and Presentation](../adr/031-loss-aware-archive-pipeline.md)
- S3 — [ADR-043: Exact-byte snapshot analysis with no mutation authority](../adr/043-snapshot-analysis-only.md)
- S4 — local receipt `LISKA-CHAT-SYNTHESIS-20261031-BACKUP`; visibility: local-only; safe aggregate only
- S5 — local receipt `LISKA-BACKUP-SEQUENCING-20261103`; visibility: local-only; safe aggregate only
- S6 — [ADR-050: Rebuildable manifest catalog before baseline automation](../adr/050-read-only-snapshot-catalog.md)
- S7 — local receipt `LISKA-SNAPSHOT-CATALOG-LIVE-20261104`; visibility: local-only; safe aggregate only
- S8 — [ADR-051: Durable inert resumability journal before provider execution](../adr/051-inert-resumability-journal.md)
- S9 — local receipt `LISKA-RESUMABILITY-JOURNAL-LIVE-20261104`; visibility: local-only; safe aggregate only
- S10 — [ADR-052: Observe provider-list evidence before update-discovery code](../adr/052-provider-discovery-evidence-gate.md)
- S11 — local receipt `LISKA-PROVIDER-DISCOVERY-GATE-20261104`; visibility: local-only; safe aggregate only
- S12 — local receipt `LISKA-SCOPE-DEFAULT-20261104`; visibility: local-only; safe aggregate only
- S13 — [ADR-053: Claude terminal active-list observation without sync authority](../adr/053-claude-terminal-list-observation.md)
- S14 — local receipt `LISKA-CLAUDE-LIST-EVIDENCE-20261105`; visibility: local-only; safe aggregate only
- S15 — [ADR-054: Keep local snapshot verification outside capture journal v1](../adr/054-local-verification-outside-capture-journal.md)
- S16 — [PR #118](https://github.com/la4ox/liska-threadkeeper/pull/118), merged main `4c3ba7e`, exact reviewed head `ee2e34a`
- S17 — [ADR-055: ChatGPT list-name evidence without an executable route contract](../adr/055-chatgpt-list-route-evidence.md), base main `070e6eb0b02f526f5d957964f6daaefebb8014f3`
- S18 — local receipt `LISKA-CHATGPT-LIST-NAMES-20261105`; visibility: local-only; safe aggregate only
- S19 — local receipt `LISKA-AI-EXPORTER-461-SOURCE-AUDIT-20261105`; visibility: local-only; safe code behavior and byte provenance only
- S20 — [ADR-056: Native ChatGPT sidebar container evidence without conversation discovery](../adr/056-chatgpt-native-sidebar-evidence.md), base main `4fc0942480fa7eb35b6fcd989ac42ec684cea663`
- S21 — local receipt `LISKA-CHATGPT-NATIVE-SIDEBAR-SCHEMA-20261106`; visibility: local-only; safe trigger, request grammar and envelope aggregates only
- S22 — local receipt `LISKA-CHATGPT-GIZMO-WRAPPER-SCHEMA-20261106`; visibility: local-only; one-wrapper field/type observation and identity limits only
- S23 — [ADR-057: Bounded unbound ChatGPT conversation-list page observation](../adr/057-chatgpt-unbound-conversation-page-observation.md), base main `e09278c35c5c033bd8a02e32c88487aae1272add`
- S24 — local receipt `LISKA-CHATGPT-CONVERSATION-PAGE-EVIDENCE-20261106`; visibility: local-only; safe request grammar, field/type names and aggregate counts only
- S25 — [ADR-058: Isolate new-capture purpose and evidence before journal persistence](../adr/058-new-capture-purpose-evidence-contract.md), base main `b3ce405c74cdf03c228235fbe90350d1c9918ee4`
- S26 — [PR #123](https://github.com/la4ox/liska-threadkeeper/pull/123), merged main `9a83e6d`, exact reviewed head `ec78f36`
- S27 — [ADR-059: Retain exact ChatGPT producer evidence before purpose persistence](../adr/059-chatgpt-producer-evidence-adapter.md), base main `9a83e6d5b84df7f41dfd1fb547665f84db679a49`
- S28 — [PR #124](https://github.com/la4ox/liska-threadkeeper/pull/124), merged main `b3f6c9d`, exact reviewed head `ef3616d`
- S29 — [ADR-060: Prepare catalog-bound ChatGPT capture before the provider request](../adr/060-catalog-bound-chatgpt-capture-handoff.md), base main `b3f6c9deba1781c0ba235f48177e6ef2a7aa5b2e`
- S30 — [PR #125](https://github.com/la4ox/liska-threadkeeper/pull/125), merged main `94af6fe`, exact reviewed head `23700e0`
- S31 — [ADR-061: Persist purpose-aware single-capture state in a separate v2 journal](../adr/061-purpose-aware-persistence-v2.md), base main `94af6fe90f495cc2fee2b426a028c1da719c8b1c`
- S32 — local receipt `LISKA-PURPOSE-V2-NATIVE-IDB-20261106`; visibility: local-only; safe lifecycle/revision/assessment aggregate only
- S33 — [PR #126](https://github.com/la4ox/liska-threadkeeper/pull/126), merged main `a370036`, exact reviewed head `40eff55`
- S34 — [ADR-062: Coordinate one inline ChatGPT capture without retry or hidden effects](../adr/062-single-operation-execution-coordinator.md), base main `a370036d8e57672b968b1bd60bba0646818a7e30`
- S35 — [PR #127](https://github.com/la4ox/liska-threadkeeper/pull/127), merged main `39914cf`, exact reviewed head `a313f1a`
- S36 — [ADR-063: Make staged ChatGPT capture ownership explicit before acquisition](../adr/063-explicit-staged-capture-ownership.md), base main `39914cfe23c1752b1b3b5c7350faa603aeba8273`
- S37 — [ADR-064: Admit one ordinary direct PNG family through explicit offline capabilities](../adr/064-explicit-ordinary-direct-png-acquisition.md), base main `c22aed4cb18b1311033533cd4e1c75a9ce825be1`
- S38 — [ADR-065: Plan an explicit selected baseline without execution authority](../adr/065-explicit-baseline-plan-core.md), base main `61d644396b6f10c1c36089a355ff5240b80cc6cf`
- S39 — [ADR-066: Persist one baseline owner and reserve atomically without dispatch](../adr/066-durable-baseline-owner-atomic-reservation.md), base main `de13928e5cc097301487ad5a3cbba611fb268842`
- S40 — [ADR-067: Bind the durable baseline owner to the existing coordinator](../adr/067-baseline-owner-execution-store-port.md), base main `da517ea7c8fd089f2ed6f19e1f5e30b2021fa951`
- S41 — [ADR-068: Accept owner-backed execution through an isolated native harness](../adr/068-isolated-baseline-owner-native-harness.md), base main `ab41408fef2cd990174cf4ac56b98a04b33061c1`
- S42 — local receipt `LISKA-BASELINE-OWNER-NATIVE-20261107`; visibility: local-only; all 14 fixed rows PASS, 842 ms elapsed, 146 ms max gap, zero network/ambient calls
