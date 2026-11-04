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
- [rejected] X1: a full daily reopen or fixed list is not a trustworthy default change detector
- [rejected] X2: collapsing archive evidence and living memory would give inference silent rewrite authority
- [decision] D1: preserve four separate layers and pause automation until explicit discovery design
- [decision] D2: sequence future backup as local catalog, slow resumable baseline and provider-specific update polling
- [decision] D3: start with a rebuildable manifest-only catalog that grants no provider, persistence or mutation authority
- [decision] D4: place a paused, restart-safe journal between catalog evidence and any future provider execution
- [tail] T1: build resumable provider-specific update discovery after archive reliability is accepted
- [tail] T2: scope living memory independently after the archival layers have boring recovery
- [tail] T3: manifest-only local catalog is accepted; preserve its non-authorizing boundary when the resumability journal begins
- [tail] T4: run a multi-day budgeted baseline before enabling a daily scheduler

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
