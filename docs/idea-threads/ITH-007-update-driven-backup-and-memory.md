---
title: "ITH-007 — Update-driven backup before living memory"
type: idea-thread
permalink: ith-007-update-driven-backup-and-memory
tags: [idea-thread, backup, automation, discovery, memory]
thread_id: ITH-007
thread_state: growing
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-11-04
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

### E5 — Existing manifests support a catalog, but no current runtime supports a baseline

Current source inspection found one stable immutable directory shape and a
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

### E8 — Current ChatGPT and Claude evidence stops at conversation detail

A source-only audit found exact single-conversation capture paths and
timestamp-shaped detail fields for ChatGPT and Claude, but no repository-safe
account-list schema, account/workspace binding, pagination checkpoint, list-level
marker semantics, archive/deletion visibility or rate-limit contract for either
provider.

This absence does not prove that a provider lacks those surfaces. It proves only
that Liska cannot encode them as a trustworthy contract yet.

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

The next backup design starts with a read-only local catalog of existing
snapshots. A later opt-in baseline may enumerate and capture accessible chats
over multiple days under explicit per-provider budgets. Only after that may a
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
The next resumability slice is an inert work journal, not a claim that an
account baseline already exists. Provider enumeration and update markers wait
for one separately evidenced provider contract.

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

Liska may add a pure unwired Claude contract for the exact observed terminal
active-list shape. It may project only scope-qualified conversation identity and
an optional opaque `updated_at` token. Outcomes distinguish rejected,
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
user explicitly chooses backup organization as the next active slice. Met on
2026-11-04 after the bounded PDF checkpoint merged; the manifest-only catalog
is now active work.

### T4 — Run a resumable baseline before any daily scheduler

Inventory and export all accessible conversations slowly, with a durable cursor,
daily request/page budget, cooldown, pause, retry and honest deferred/error
states. The baseline may intentionally take several days.

Trigger: one provider's discovery/enumeration contract is reviewed and its
account-wide authority is explicitly enabled.

### T5 — Run one bounded read-only provider-list evidence pass

Inspect at most three foreground list requests for one explicitly chosen
provider, signed-in account and workspace/organization scope, or explicitly
`personal/no-workspace`. Retain only repository-safe schema aggregates, never
real titles, IDs, cursors, account identifiers or response bodies. Stop if the
visible account or scope is ambiguous or mismatched. A confirmed switch closes
the current sample; any later sample for the other scope gets its own cap and
checkpoint.

Trigger: the user explicitly names the provider, signed-in account and exact
workspace/organization or personal scope allowed for the experiment. ChatGPT is
recommended first but is not pre-authorized.

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

## Observations

- [hypothesis] H1: daily backup initially appeared equivalent to reopening every chat or keeping a fixed selection
- [evidence] E1: manual archive, reconciliation, presentation and analysis now have distinct authority boundaries
- [evidence] E2: reliable change discovery is provider-specific and cannot be inferred from title, order or elapsed time
- [evidence] E3: the desired ecosystem separates periodic official evidence, update-driven captures, reading views and later living memory #local-only
- [hypothesis] H2: local canonical cataloging can be designed before account-wide provider polling
- [evidence] E4: rapid bulk conversation reopening is an observed constraint, though no exact rate limit is claimed #local-only
- [evidence] E5: current code has immutable provider-neutral manifests but no durable baseline cursor, list adapter or scheduler #code
- [evidence] E6: installed manifest-only catalog rebuilt 121 real entries deterministically while all 495 selected source files remained byte-identical #live
- [evidence] E7: installed inert journal recovered the same 24 paused items after an extension reload and round-tripped its physical export byte for byte #live
- [evidence] E8: current ChatGPT and Claude code proves detail capture but no repository-safe account-list or update-marker contract #code
- [evidence] E9: the current default is each provider's visibly active main personal account; dormant backups stay out of scope #local-only
- [evidence] E10: one Claude reload emitted three active-list requests and proved only a 12-record terminal envelope with opaque markers #live
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
- [tail] T1: build resumable provider-specific update discovery after archive reliability is accepted
- [tail] T2: scope living memory independently after the archival layers have boring recovery
- [tail] T3: manifest-only local catalog is accepted; preserve its non-authorizing boundary when the resumability journal begins
- [tail] T4: run a multi-day budgeted baseline before enabling a daily scheduler
- [tail] T5: run a capped read-only provider-list evidence pass only after explicit provider/account/workspace authorization
- [tail] T6: add a scope-aware canonical directory layout only after stable binding and migration rules are reviewed
- [tail] T7: prove Claude pagination, archived visibility, marker semantics and request-level budgeting in later bounded experiments

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
