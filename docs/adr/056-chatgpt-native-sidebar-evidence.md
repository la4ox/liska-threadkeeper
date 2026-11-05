# ADR-056: Native ChatGPT sidebar container evidence without conversation discovery

- Status: Accepted evidence checkpoint; documentation only
- Date: 2026-11-06
- Base main: `4fc0942480fa7eb35b6fcd989ac42ec684cea663`
- Scope: isolated native sidebar trigger, exact observed request grammar and safe aggregate gizmo-container schema; no parser, classifier or runtime

## Context and isolation

[ADR-055](055-chatgpt-list-route-evidence.md) preserved a prior name-only pass:
three `conversations?` Network names, no inspected method, full URL or response
body, and unresolved caller attribution through AI Exporter's fetch observer.
The user separately authorized this bounded schema pass on 2026-11-06. Its
evidence belongs to a different observed route and does not retroactively
identify ADR-055's requests or resolve their initiating caller.

The user disabled AI Exporter. One reload removed its already-loaded fetch
wrapper. DevTools Network recording started with an empty log and recording
active. That reload did not emit the relevant native sidebar lists: docked
DevTools had collapsed the sidebar. Opening the sidebar once was the isolated
trigger for the matching requests below.

Exactly two matching native `Fetch` requests were emitted against a cap of
three actual requests. Both were `GET`, HTTP 200, initiated by a ChatGPT CDN
bundle. Recording then stopped at budget **2/3**; no third request was provoked.
The third allowed request was deliberately unused because scrolling Recent
could emit multiple refetches and overshoot the cap. Recording stop does not
stop the network or prove that no later request occurred.

## Exact observed request subset

Both requests used exact path `/backend-api/gizmos/snorlax/sidebar` with the
following observed query keys and values:

| Query key                 | Observed value                                 |
| ------------------------- | ---------------------------------------------- |
| `conversations_per_gizmo` | `0`                                            |
| `cursor`                  | Opaque string; the two request values differed |
| `limit`                   | `20`                                           |
| `owned_only`              | `false`                                        |

No cursor value is retained. Both requests already had cursors, so the initial
boundary is unknown. Exact equality between a response cursor and a subsequent
request cursor was not retained or proved. This records only the request subset
actually observed, not an allowlist for additional parameters, other values,
manual replay or a guessed route. No query meaning follows from its name.

## Safe aggregate response structure

The observed responses had the same top-level key set `{items, cursor}`:

| Observation     | `items` type and exact length | Top-level `cursor` type/value |
| --------------- | ----------------------------- | ----------------------------- |
| First observed  | Array, exactly 20             | String; value not retained    |
| Second observed | Array, exactly 1              | `null`                        |

These are first- and second-observed responses, not established initial/final
account pages. The counts do not establish 21 unique records, a proven cursor
handoff, complete account coverage or network completeness. A null cursor is an
observed field value for this container response, not proof of a complete
conversation inventory.

Every visible item summary had keys `{gizmo, conversations}`. The nested
`conversations` object had shape `{items: [], cursor: null}` under the explicit
request setting `conversations_per_gizmo=0`. Empty nested arrays therefore do
not prove that the gizmos have no conversations. No conversation-bearing list
or conversation record identity was observed.

One gizmo wrapper in the second-observed, null-cursor response was transiently
expanded only for keys and types:

| Wrapper field                    | Observed type or nested shape                             |
| -------------------------------- | --------------------------------------------------------- |
| `files`                          | Array                                                     |
| `gizmo`                          | Object containing `id`: string, `organization_id`: string |
| `has_tpp_conversation`           | Boolean                                                   |
| `is_space_backing`               | Boolean                                                   |
| `product_features`               | Object                                                    |
| `project_connector_scope_limits` | `null`                                                    |
| `project_file_limits`            | `null`                                                    |
| `tools`                          | Array                                                     |

This one-wrapper observation does not establish the shape of every wrapper.
Real values were not retained. A gizmo ID is not conversation identity, and
`organization_id` is not an authenticated account/workspace binding. No ID
stability, format, coverage or scope semantics were proved. Boolean field names
and values do not supply a list-level change marker or their own behavioral
contract.

No headers, cookies, raw response bodies or real identity values were persisted.
Only safe field names, types, query constants and aggregate counts are retained
here; opaque cursors and identity values are excluded.

## Decision

Keep this as exact native sidebar/gizmo-container evidence, documentation only.
It does not materially advance conversation discovery: no conversation record
ID/type/format, authenticated scope binding, actual list-level marker or
conversation-bearing list was observed.

A tiny structural parser for this envelope is technically possible, but without
a diagnostic consumer it would be unused evidence scaffolding, not backup
progress. Add no parser, request classifier, synthetic discovery contract or
runtime adapter. A future separately justified diagnostic consumer could admit
a strictly bounded gizmo-envelope parser; that would still not establish
conversation enumeration or update discovery.

Preserve ADR-055's name-only history and attribution ambiguity. Do not reinterpret
its `conversations?` names as this route or use this isolated native trigger to
resolve the earlier pass by analogy. [ADR-052](052-provider-discovery-evidence-gate.md),
[ADR-053](053-claude-terminal-list-observation.md) and
[ADR-054](054-local-verification-outside-capture-journal.md) retain their existing
boundaries. Catalog, capture journal, schemas and runtime are unchanged; the
journal stays inert. Account-wide baseline and scheduler authority remain gated,
and semantic memory remains a later independent layer.

## Next separately authorized gate

Observe one native conversation-bearing list response under a separately
authorized bounded plan. The plan must name the exact visible account and scope,
count actual emitted requests including refetches, define stop conditions and
explicitly permit only the required safe aggregate response inspection. It must
establish the actual request grammar, conversation identity field/type/format,
pagination fields and actual list-level marker without retaining private values.
Unknown or absent evidence stays unknown or absent rather than being invented.

Do not manually change `conversations_per_gizmo`, guess a conversation route or
scroll Recent under the unused part of this pass's cap. The completed pass grants
no further provider request or browser action. It supplies neither an account
baseline nor scheduler authority.

## Evidence and validation

- Local receipt `LISKA-CHATGPT-NATIVE-SIDEBAR-SCHEMA-20261106`; visibility:
  local-only; safe trigger, request grammar and envelope aggregates only.
- Local receipt `LISKA-CHATGPT-GIZMO-WRAPPER-SCHEMA-20261106`; visibility:
  local-only; one-wrapper field/type observation and identity limits only.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  E14/E15/D10/T10 and the fulfilled, limited schema-pass trigger separately from
  ADR-055's older evidence.

Validate this docs-only slice with Idea-Threads validation, documentation-link
tests, changed-document Prettier and `git diff --check`. No source, test, package,
generated artifact, archive, catalog/journal schema or runtime changes here.
