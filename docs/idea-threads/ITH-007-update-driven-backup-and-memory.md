---
title: "ITH-007 — Update-driven backup before living memory"
type: idea-thread
permalink: ith-007-update-driven-backup-and-memory
tags: [idea-thread, backup, automation, discovery, memory]
thread_id: ITH-007
thread_state: growing
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-11-06
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
- [tail] T1: build resumable provider-specific update discovery after archive reliability is accepted
- [tail] T2: scope living memory independently after the archival layers have boring recovery
- [tail] T3: the catalog and subsequent inert journal are accepted and installed-live verified; preserve both non-authorizing boundaries
- [tail] T4: run a multi-day budgeted baseline before enabling a daily scheduler
- [tail] T5: first Claude schema and later ChatGPT name-only passes are fulfilled within different inspection bounds; future scope/caps and response-body inspection need explicit authority
- [tail] T6: add a scope-aware canonical directory layout only after stable binding and migration rules are reviewed
- [tail] T7: prove Claude pagination, archived visibility, marker semantics and request-level budgeting in later bounded experiments
- [tail] T8: choose separately authorized Claude evidence or a later explicitly authorized account-wide baseline after semantic/provider review; backup remains unfinished
- [tail] T9: a separately authorized schema pass was fulfilled only for native sidebar/gizmo containers on 2026-11-06; conversation-list evidence and further requests remain gated
- [tail] T10: separately authorize a bounded native conversation-bearing list observation with exact visible scope, request grammar, identity field/type/format, pagination and an actual list-level marker; no guessed route or query mutation

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
