---
title: "ITH-008 — Dots evidence before provider adaptation"
type: idea-thread
permalink: ith-008-dots-evidence-before-adapter
tags: [idea-thread, dots, provider-adapter, privacy, evidence]
thread_id: ITH-008
thread_state: growing
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-10-31
---

# ITH-008 — Dots evidence before provider adaptation

Dots shares ChatGPT's origin but not its conversation model. This thread keeps
the route guard, bounded schema experiment and future raw-first adapter in one
legible line without turning diagnostic progress into an unsupported export
claim.

## Thread

### H1 — A shared ChatGPT origin implies a reusable ChatGPT exporter

The first implementation treated every admitted `chatgpt.com` page as the same
provider and reached the generic rendered-DOM fallback. Dots therefore looked
like a small ChatGPT variation even though its identity and history model had
not been established.

### E1 — Host-only routing produced stable-looking but false exports

Two trusted Dots exports contained only the rendered ten-message window, used a
timestamp identity and wrote no raw, manifest or canonical archive. After only
generated identity and timestamp fields were removed, the note bodies were
byte-identical. Route isolation now rejects `/dots` and `/dots/*` before
ordinary ChatGPT controls or DOM fallback.

This proves misclassification and the need for a separate provider boundary;
it does not reveal the Dots data contract.

### E2 — A bounded schema probe established only a narrow evidence surface

One trusted selected-tab observation established a small same-origin route
family. The implemented diagnostic admits only one room-metadata response and
its same-room messages response, projects fixed structural vocabulary and
discards provider values. It cannot write an archive, Obsidian note, Clipboard
payload or setting.

Installed runs proved marker cleanup and fixed refusals, but no committed live
schema projection exists. The most recent stable run returned one ambiguous
`timed-out` code that could have originated in either the MAIN observer or the
background polling loop. It therefore established neither request admission
nor response shape.

### E3 — Synthetic contracts do not establish the live provider schema

Existing tests prove route admission, finite observation, hostile-result
validation, cleanup and privacy properties against synthetic page shapes. They
do not establish active-room identity, pagination, message/event families,
ordering, edits, branches, attachments or history completeness in the live
provider.

### X1 — Keep Dots on generic ChatGPT or rendered-DOM fallback

A shared origin is not a shared provider contract, and a rendered window has no
stable identity or completeness proof. Reusing that path would recreate a
successful-looking partial export.

Revisit when: never as an ordinary ChatGPT fallback; only a Dots-owned adapter
may reuse lower archive or delivery layers whose contracts are independently
compatible.

### X2 — Implement raw capture from route names alone

Route presence does not establish whether a body contains conversation-local
history, persona, memory or unrelated account state. A speculative observer or
direct replay would widen privacy authority before current-conversation
identity and pagination were known.

Revisit when: one separately authorized bounded schema projection establishes
the exact live shape and supports a narrow conversation-scoped raw boundary.

### D1 — Separate timeout origin before requesting more live evidence

The immediate slice changes no observer authority and captures no additional
data. Current code reports `observer-timed-out` for the MAIN hard deadline and
`background-timed-out` for background polling exhaustion, while retaining the
old generic code only for version compatibility. A later live run is useful
only after this diagnostic is reviewed and installed.

Evidence: E1, E2, E3

### D2 — Build Dots as a raw-first separate provider only after evidence gates

The provider adapter remains deliberately unimplemented. Its first valid input
must be one explicitly selected conversation-scoped raw artifact with stable
room/thread identity, bounded pagination and explicit unknown/loss states.
Memory, persona, global activity, realtime/write surfaces and unrelated rooms
remain outside scope.

Evidence: E1, E2, E3

### T1 — Run one origin-specific schema canary

Use one already selected eligible Dots tab and one trusted popup action. Retain
only the fixed terminal code or the existing bounded schema projection, verify
marker cleanup and do not retry merely to force success.

Trigger: the timeout-origin candidate passes focused/full tests, review and an
installed-build check, followed by separate explicit live authorization.

### T2 — Define the conversation-scoped raw boundary

If the bounded projection succeeds, classify only the fields required for
current-room identity, messages and pagination. Preserve unknown event families
rather than flattening them, and derive synthetic fixtures from the verified
shape before implementation.

Trigger: one repository-safe schema receipt exists and its limits support a
narrow privacy review.

### T3 — Implement and prove the separate provider adapter

Write append-only raw, manifest and canonical snapshots before readable output.
Reuse Markdown, Download and Obsidian layers only where their existing contracts
fit; changed room identity, non-prefix history or missing pagination proof must
create a separate snapshot and explicit diagnostic.

Trigger: current-conversation identity, pagination, ordering and loss semantics
are evidenced and reviewed, followed by one ordinary live current-room canary.

## Observations

- [hypothesis] H1: a shared ChatGPT origin initially looked sufficient for exporter reuse
- [evidence] E1: host-only routing produced repeatable but partial ten-message Dots notes without archives #live
- [evidence] E2: the bounded schema probe established a narrow privacy boundary but no live schema contract #live
- [evidence] E3: synthetic lifecycle and privacy tests do not establish the provider's live message model #synthetic
- [rejected] X1: generic ChatGPT or rendered-DOM fallback cannot own Dots identity or completeness
- [rejected] X2: route names alone do not authorize raw body capture or replay
- [decision] D1: distinguish observer and background deadline origins before another live canary
- [decision] D2: keep Dots as a raw-first separate provider behind explicit evidence gates
- [tail] T1: run one reviewed origin-specific schema canary without automatic retry
- [tail] T2: define a narrow conversation-scoped raw boundary from successful schema evidence
- [tail] T3: implement append-only Dots export only after identity, pagination and loss contracts are proven

## Relations

- informed_by [[ith-002-layered-archive-truth]]
- informed_by [[ith-003-imperfect-sources-stay-separate]]
- depends_on [[ith-005-bounded-completeness-proof]]
- informs [[ith-007-update-driven-backup-and-memory]]

## Source receipts

- S1 — [Dots route-isolation checkpoint](../../STATUS.md#dots-route-isolation-checkpoint)
- S2 — [Adjacent provider: Dots chat export](../chatgpt-todo.md#9-adjacent-provider-dots-chat-export)
- S3 — [ADR-023: Multi-host platform registry](../adr/023-multi-host-platform-registry.md)
- S4 — tests `test/content/dots-schema-document-start.test.ts`, `test/background/dots-schema-probe.test.ts`, `test/lib/dots-schema-probe-contract.test.ts`
- S5 — [PR #69: bounded Dots transport schema probe](https://github.com/la4ox/liska-threadkeeper/pull/69)
