# ADR-055: ChatGPT list-name evidence without an executable route contract

- Status: Accepted evidence checkpoint; documentation only
- Date: 2026-11-05
- Base main: `070e6eb0b02f526f5d957964f6daaefebb8014f3`
- Scope: safe Network-name observations and local source attribution audit; no classifier, parser or runtime wiring

## Context

[ADR-052](052-provider-discovery-evidence-gate.md) requires provider-specific
evidence before discovery code. The user authorized one bounded ChatGPT list
observation with a cap of three actual list requests. This checkpoint records
only what the pass exposed; it does not extend that authority to another request
or response-body inspection.

The observation began with an already-open ChatGPT chat and DevTools opened.
Trigger causality was not isolated, and the page was not deliberately reloaded
for this pass. The Network table showed exactly three list-name requests on the
ChatGPT page, each with type `Fetch` and HTTP 200. Their names began
`conversations?`:

| Row | Safe visible Network-name evidence                                       |
| --- | ------------------------------------------------------------------------ |
| 1   | Fully visible name `conversations?limit=5&owned_only=false`              |
| 2   | Partially visible name containing `exclude_conversation_origin=tpp`      |
| 3   | Partially visible name containing `conversation_origin=tpp&expand=false` |

The latter two names were only partially visible; their complete query strings
were not read. Any ellipses used to describe those observations mean unread
query suffixes, never wildcard grammar or permission to accept arbitrary
parameters. Even the fully visible first name is a Network `Name`, not a
verified full request URL. `/backend-api/conversations` is a candidate
route-family inference from the ChatGPT context, not an observed exact path.
The request method was not inspected and remains unknown.

Recording stopped after the third matching list-name request. No fourth matching
request was observed before that stop. Stopping recording does not stop the
network and is not terminal-page, completeness or no-further-request proof.

No list row or request-details pane, response body or request headers was opened.
No real conversation ID, title, account data, body or header value is repository
evidence. No mutation or manual retry was invoked for this pass. Whether the
three requests were refetches or otherwise related remains unknown. HTTP 200
establishes the observed status only, not response schema or payload suitability.

## Attribution source audit

DevTools attributed the requests to installed AI Exporter `inject-web.js`. A
local source audit of the exact Comet-installed extension version 4.6.1 found a
pass-through observer:

- it stores the original `window.fetch` and observes `/backend-api/` requests;
- its ChatGPT callback retains `Authorization` and `chatgpt-`/`oai-` headers, then
  the wrapper returns the original fetch;
- the ChatGPT callback ignores URL, method and body, and intercepts no response
  body;
- a recursive literal search found no constructors for the candidate list route
  or observed list-query literals.

These header names describe audited code behavior, not opened request headers
or retained real values. The extension also has separate singular
detail/export fetch code; that does not establish list-request causality.
DevTools attribution therefore proves neither extension-created list requests
nor a page-native caller. The initiating caller remains unresolved.

Safe exact-byte provenance for that local audit:

| Artifact        |  Bytes | SHA-256                                                            |
| --------------- | -----: | ------------------------------------------------------------------ |
| `inject-web.js` | 20,827 | `58f665a30600940c888a351013ea8dfcbd4c31b3c9860e31a44eb211f9f9714f` |
| `manifest.json` |  4,975 | `20fd3c470cac68e965affeebbff9498084a81721558b7abf118c6cdb72f13f72` |

The audited manifest declares manifest version 3 and extension version 4.6.1.
Local absolute paths and the installed extension ID are unnecessary evidence and
are not retained here.

## Decision

Keep this as a docs-only route-evidence checkpoint, not an executable contract.
Do not add a request-shape classifier, parser, synthetic schema, runtime adapter
or consumer. A classifier at this point would encode lexical familiarity only:
the full URL/method/query grammar, response envelope, record types, stable
identity, pagination and marker contract are absent, and there is no consumer
that needs such a classification.

Do not infer meanings for `tpp`, `owned_only` or `expand`, relationships among
the three names, pagination, scope/account binding, ordering, ownership,
completeness, cursor, marker, deletion/archive visibility or response schema.
Provider-specific update discovery has not functionally advanced through this
observation.

[ADR-053](053-claude-terminal-list-observation.md) remains limited to Claude's
accepted pure terminal structural subset and opaque-token equality.
[ADR-054](054-local-verification-outside-capture-journal.md) still keeps local
verification outside capture journal v1. The catalog and journal remain
non-authorizing; account-wide baseline, provider execution and scheduler work
remain separately gated. Living semantic memory is still a later independent
layer.

## Next separately authorized evidence pass

A possible next step is a schema-observation pass with an explicitly chosen
provider, signed-in account and exact scope, its own actual-emitted-request cap
and stop conditions. Count client/provider refetches as actual requests, not UI
actions. Define in advance which request details and safe aggregate list
response structure may be inspected and which private values must not be
retained. Reading even aggregate response structure needs explicit permission:
the completed pass excluded bodies, so it cannot authorize opening them later.

That pass may establish only the subset actually observed. It must not assume
the candidate backend path or method, manufacture missing query suffixes, infer
schema from status, or treat recording stop as a provider terminal signal. This
ADR authorizes no further provider request or browser action.

## Evidence and validation

- Local receipt `LISKA-CHATGPT-LIST-NAMES-20261105`; visibility: local-only;
  repository-safe aggregate only.
- Local receipt `LISKA-AI-EXPORTER-461-SOURCE-AUDIT-20261105`; visibility:
  local-only; safe source behavior and exact-byte provenance only.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  the observation, attribution limits, decision and explicit schema-pass trigger.

Validate this docs-only slice with Idea-Threads validation, documentation-link
tests, changed-document Prettier and `git diff --check`. No source, test,
package, generated artifact, archive or runtime behavior changes here.
