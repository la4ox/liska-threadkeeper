# ADR-057: Bounded unbound ChatGPT conversation-list page observation

- Status: Accepted evidence checkpoint and pure unwired contract
- Date: 2026-11-06
- Base main: `e09278c35c5c033bd8a02e32c88487aae1272add`
- Scope: native ordinary conversation-list pages at inspected offsets 20, 40 and 60; no authenticated scope binding, terminal traversal or sync authority

## Context and request accounting

This separately authorized 2026-11-06 read-only research pass observed a native
conversation-bearing list while AI Exporter remained disabled. The matching
requests were initiated by a ChatGPT CDN bundle. No mutation was invoked; request
headers and cookies were not inspected or retained, no raw response was
persisted, and no real values were retained.

The broader read-only research had a self-imposed soft cap of six actual list
requests, not a user-imposed hard cap. Two ordinary-page requests at offsets 20
and 40 preceded a UI-scroll burst of six list routes, for eight actual list
requests total. Recording stopped after that burst. This is a real two-request
overshoot of the soft cap; broader user authorization does not make the count
six. A UI gesture or Stop button is not an enforceable request budget, because
one gesture may emit multiple requests. Stopping recording is not proof that
network activity stopped or that no additional requests occurred.

## Exact ordinary conversation-list subset

The observed ordinary requests were `GET 200` to exact path
`/backend-api/conversations`. The query keys and observed values were:

| Query key                     | Observed value        |
| ----------------------------- | --------------------- |
| `exclude_conversation_origin` | `tpp`                 |
| `expand`                      | `false`               |
| `hide_snorlax`                | `false`               |
| `is_archived`                 | `false`               |
| `is_starred`                  | `false`               |
| `limit`                       | `20`                  |
| `order`                       | `updated`             |
| `offset`                      | `0`, `20`, `40`, `60` |

The offset-0 request was observed, but its response was not inspected and is
unsupported by the structural contract below. Response bodies were inspected
only for offsets 20, 40 and 60. Each inspected envelope had the exact key set
`{items, limit, offset, total}`, integer `limit` and `offset` echoes, an
integer `total` field, and an `items` array of exactly 20 records.
The provider-reported totals were 41 at offset 20, 61 at offset 40 and 81 at
offset 60.

Those reported `total` values are uninterpreted provider metadata. Their
pattern is consistent with sentinel or lower-bound behavior, but that is only a
possible interpretation: no provider law, actual total, next offset,
completeness, or 81 unique conversations is established. No terminal ordinary
page was observed.

One record was inspected for field names and types only:

| Field                              | Observed type    |
| ---------------------------------- | ---------------- |
| `id`                               | UUID-like string |
| `title`                            | string           |
| `create_time`                      | ISO-like string  |
| `update_time`                      | ISO-like string  |
| `async_status`                     | `null`           |
| `blocked_urls`                     | array            |
| `context_scopes`                   | `null`           |
| `context_scopes_v2`                | object           |
| `conversation_origin`              | `null`           |
| `conversation_template_id`         | string           |
| `current_node`                     | `null`           |
| `gizmo_id`                         | string           |
| `is_archived`                      | boolean          |
| `is_do_not_remember`               | boolean          |
| `is_starred`                       | `null`           |
| `is_temporary_chat`                | boolean          |
| `latest_assistant_turn_created_at` | `null`           |
| `mapping`                          | `null`           |
| `memory_scope`                     | string           |
| `pinned_time`                      | `null`           |
| `safe_urls`                        | array            |
| `snippet`                          | `null`           |
| `sugar_item_id`                    | `null`           |
| `sugar_item_visible`               | boolean          |
| `summary_metadata`                 | `null`           |
| `trial_conversation_type`          | `null`           |
| `workspace_id`                     | `null`           |

This single sample does not prove that every record has this shape. No real
field values are retained.

The same final burst also emitted `GET 200` for a TPP ordinary-family request
shown as `/backend-api/conversations?conversation_origin=tpp...offset=0` and
for a per-gizmo request shaped as
`/backend-api/gizmos/{opaque}/conversations?limit=5&owned_only=false`.
Here `...` marks unread/unretained query detail, and `{opaque}` is a
placeholder, not a retained identifier. Neither response body was inspected.
No scope, family-union, overlap, deduplication or completeness semantics follow
from these requests.

## Decision

The evidence now justifies a structural parser for the exact inspected
nonterminal ordinary pages and materially advances provider-specific
conversation discovery. The separately bounded implementation contract is a
pure synchronous, unwired provider-local
`observeChatGptUnboundConversationListPage` with no comparator:

- Admit only the exact ordinary pages inspected at offsets 20, 40 and 60.
  Offset 0 was requested but its response remains unsupported.
- Project only bounded `id` and optional opaque `update_time` marker data,
  whose source is
  `chatgpt-backend-api-conversations.update_time/1`. Do not traverse
  unknown fields or retain titles, creation times, snippets, URLs, mappings or
  other record data.
- A conservative lowercase UUID spelling is an acceptance policy, not a
  provider guarantee. Reject duplicate IDs within a page.
- Return the versioned
  `chatgpt-conversation-list-page-observation/1` contract with
  `kind: observed_unbound_page`, `scopeBinding: unresolved` and
  `termination: unknown`. Preserve request offset/limit and a
  `reported: { limit, offset, total }` namespace. Its `total` is
  uninterpreted metadata, not a cursor or completeness signal.
- Return detached, frozen, deterministically sorted records. Use fixed
  rejected/unsupported outcomes, lowering-only limits and descriptor-safe input
  inspection. Expose no `nextOffset`, `hasMore` or completion claim.

There is no comparator because the observed page has no authenticated scope
binding. The optional opaque marker cannot support cross-observation equality or
change claims. This contract provides no scope binding, terminal traversal,
route-family union, baseline/capture authority or scheduler authority.

The implementation must remain pure and unwired: no network, browser, storage,
cursor traversal, runtime integration, importers, catalog, journal, capture,
export or scheduler. This evidence does not close any production workflow.
Do not reinterpret ADR-055's older name-only requests or ADR-056's sidebar
container evidence by analogy.

## Next evidence gate

Before using a marker to skip capture, a separately authorized experiment must
establish authenticated scope binding, exact terminal traversal and restart
behavior, duplicate/reorder/filter behavior, and marker behavior under
controlled changes. Until then, pages remain unbound and nonterminal, and the
backup goal, baseline authority and scheduler remain gated.

## Evidence and validation

- Local receipt `LISKA-CHATGPT-CONVERSATION-PAGE-EVIDENCE-20261106`; visibility:
  local-only; safe request grammar, field/type names and aggregate counts only.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  E16/E17/D11/T11 and the actual-request overshoot separately from ADR-055 and
  ADR-056.

The same slice implements the pure contract in
`src/update-discovery/chatgpt` with focused functional and architecture tests.
Targeted validation passes 2 files / 174 tests; the full repository coverage run
passes 308 files with one skipped and 11,098 tests with three skipped. Global
TypeScript, full lint (zero errors and the unchanged 55 warnings), full Prettier,
Idea-Threads validation, 77 documentation-link tests, dependency audit and the
guarded production build/ZIP all pass. Independent review reports no material
P1/P2 finding.

The built extension still contains no observation schema, marker-source or
function-name marker from this unwired module. Its generated inventory remains
65 files / 6,078,286 bytes; the 2,789,703-byte candidate ZIP has SHA-256
`867c999fa7e8a1b4e6acf4be3e190ece62c3ab5afad9dfc7fba9892aa761ffce`.
