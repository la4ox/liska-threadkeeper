---
title: "ITH-005 — Bounded completeness proof for large and virtualized histories"
type: idea-thread
permalink: ith-005-bounded-completeness-proof
tags: [idea-thread, completeness, virtualization, resource-bounds, providers]
thread_id: ITH-005
thread_state: settled
privacy: repository-safe
opened: 2026-10-31
last_turn: 2026-10-31
---

# ITH-005 — Bounded completeness proof for large and virtualized histories

Provider pages render windows, remount roots and expose graphs larger than one
browser message or one in-memory traversal. This thread preserves why
“complete” became a provider- and mode-specific proof rather than a success
toast.

## Thread

### H1 — Reaching the visible end of a page proves a complete conversation

Scrolling until movement stops and collecting every visible user/assistant row
looks like a natural completeness test. Early exports and fallbacks treated a
successful rendered pass as stronger evidence than it was.

### E1 — Rendered DOM success retained only a window of real histories

Long live chats produced apparently successful Markdown containing only a small
visible subset. Window order, overlap and shifting coordinates also defeated
simple suffix or screen-position merging. Anchor-aware accumulation improved
the fallback, while ChatGPT later gained a narrower page-owned exact graph
capture that does not depend on rendered row count.

### E2 — Large graphs broke arbitrary traversal and transport assumptions

Real evidence forced iterative graph walks, explicit node/branch/work budgets,
staged transport and honest refusal. One all-branches case exceeded the fixed
source-work bound and stopped rather than quietly omitting leaves. Synthetic
staging and parser-heavy tests establish their measured paths only; they do not
substitute for a real unpadded provider response above the inline boundary.

### E3 — Claude required stable identity, order and tail proofs

A partial virtualized Claude history could previously look complete. The final
implementation uses stable role-qualified UUID identity, relative ordering,
tail proof, directional history markers, bounded MAIN-world priming and root
remount guards. A cold installed canary retained 154 message boundaries,
including the inert empty assistant boundary, with no `history-load-partial` and
byte-identical Download/Obsidian output.

This proves that measured transcript traversal, not isolated Artifact-body
capture or atomicity against a concurrently edited chat.

### E4 — Claude exact-detail capture closed one no-scroll linear checkpoint

Claude's authenticated page exposes one exact same-origin conversation-detail
response. Liska now preserves those bytes before interpretation, builds a
provider-specific canonical graph, projects the declared current leaf and keeps
the virtualized DOM path as fallback. One installed four-message canary wrote
raw, manifest, canonical and Markdown to both File and Obsidian without any DOM
scroll; every corresponding byte hash matched across destinations.

The evidence stays deliberately partial. The manifest records graph, messages
and branches as `unknown`, attachment bytes as `not-attempted`, and direct-text
fallback diagnostics where the web response does not expose the richer content
blocks observed in official exports. The canary does not prove alternate-branch
coverage, thinking/tool/Artifact completeness or attachment acquisition.

### X1 — Use coordinates, visible counts or one generic scroll rule

Virtual rows move, overlap, disappear and can reuse similar marker shapes.
Provider and layout changes turn those signals into false completion or false
ordering.

Revisit when: never as a cross-provider proof; coordinates may remain bounded
local hints inside a provider contract but cannot own completeness.

### X2 — Raise a resource limit after one refusal or synthetic success

A higher number may make one sample pass while expanding memory, write and
recovery risk. Synthetic bytes or canonical size do not prove the native raw
provider path.

Revisit when: the exact real workload, destination behavior and recovery costs
are measured and the product value justifies a reviewed bound change.

### D1 — Scope every completeness claim to an evidenced provider mode

Complete capture requires stable identity or exact source bytes, deterministic
topology/order reconstruction, bounded work and an explicit terminal proof.
Missing proof remains partial, raw-only, unknown or refused; one provider's
success does not upgrade another provider, mode, content family or size class.

Evidence: E1, E2, E3, E4

### T1 — Close the real staged-response gate

The activated replay path still needs a natural unpadded raw response above the
inline threshold through File and Obsidian, with exact chunk/hash facts,
terminal cleanup and worker-restart evidence.

Trigger: a retained real sample crosses the threshold and the exact installed
path can be exercised without synthetic padding or widened privacy authority.

### T2 — Revisit wide-graph ceilings only as a product decision

A larger all-branches work limit may be useful, but it changes physical work and
recovery obligations rather than merely fixing a constant.

Trigger: a representative real graph needs the increase and a separately
reviewed bound passes File/Obsidian measurement, cancellation and reconciliation.

### T3 — Extend Claude structured proof beyond the linear web-detail checkpoint

The ordinary no-scroll source contract and destination receipts are now proven,
but the provider response has not exposed an alternate branch in the available
live or official-export corpus. The official reader package also retains richer
thinking, tool, image and document blocks than the measured web-detail response.
Keep completeness `unknown` and DOM traversal available until branch topology,
richer block families and attachment-bearing responses receive their own live
proof; do not promote this checkpoint into a full-graph claim.

Trigger: a real Claude conversation with alternate descendants or a new
attachment/content family can be exercised through the exact detail route and
reconciled against the visible transcript plus available official-export
evidence without extracting credentials or sending a message.

## Observations

- [hypothesis] H1: reaching the rendered end initially appeared to prove complete conversation capture
- [evidence] E1: real virtualized histories produced successful-looking but partial DOM exports and unstable row ordering #live
- [evidence] E2: large real graphs forced iterative traversal, staged transport, explicit budgets and honest refusal
- [evidence] E3: stable identity, order, tail and remount proofs closed one 154-message Claude transcript canary #live
- [evidence] E4: exact Claude detail bytes closed one installed linear no-scroll capture while branch and richer-content scope stayed unknown #live
- [rejected] X1: coordinates, visible counts and one generic scroll rule cannot own cross-provider completeness
- [rejected] X2: a refusal or synthetic pass does not by itself authorize raising a production bound
- [decision] D1: scope completeness to the exact provider, mode, content family, size class and terminal proof
- [tail] T1: prove a real unpadded staged response through both durable destinations and recovery
- [tail] T2: change wide-graph ceilings only after representative product and resource evidence
- [tail] T3: extend the proven linear Claude detail path to real branch and richer-content evidence before any completeness upgrade

## Relations

- informed_by [[ith-002-layered-archive-truth]]
- informed_by [[ith-004-attachment-acquisition-authority]]
- relates_to [[ith-001-claude-isolated-artifact-capture]]
- informs [[ith-007-update-driven-backup-and-memory]]

## Source receipts

- S1 — [ADR-017: Auto-scroll for virtualized chat platforms](../adr/017-autoscroll-virtualized-platforms.md)
- S2 — [ADR-022: Anchor insertion for virtualized scroll windows](../adr/022-anchor-insertion-window-merge.md)
- S3 — [ADR-032: Staged large ChatGPT capture](../adr/032-staged-large-chatgpt-capture.md)
- S4 — [Claude virtual-history completeness checkpoint](../../STATUS.md#claude-virtual-history-completeness-and-root-remount-checkpoint)
- S5 — [PR #86: prove complete virtualized Claude history](https://github.com/la4ox/liska-threadkeeper/pull/86)
- S6 — local receipt `LISKA-CHAT-SYNTHESIS-20261031-COMPLETENESS`; visibility: local-only; safe aggregate only
- S7 — [Claude exact-detail structured capture checkpoint](../../STATUS.md#claude-exact-detail-structured-capture-checkpoint)
- S8 — tests `test/archive/claude-normalizer.test.ts`, `test/content/claude-api-archive.test.ts`, `test/extractors/claude-api-first.test.ts`, `test/background/claude-archive-transport.test.ts`
