# ADR-052: Observe provider-list evidence before update-discovery code

- Status: Accepted evidence gate
- Date: 2026-11-04
- Scope: documentation only; no provider request, parser, fixture, storage or runtime wiring

## Context

ADR-050 established a rebuildable local manifest catalog. ADR-051 added a
durable paused journal without provider execution authority. The next roadmap
step needs one provider-specific enumeration and update-discovery contract before
an account baseline can be considered.

Current adapters do not provide that evidence. They capture one already selected
conversation at a time:

- ChatGPT uses exact single-conversation detail or opaque replay sources. Its
  normalizer can project timestamp-shaped detail fields, but the checked-in
  aliases and fixtures do not prove list availability or change-marker meaning.
- Claude uses an exact organization/conversation detail route. Its normalizer can
  project detail `updated_at`; current pagination evidence concerns virtualized
  messages inside one conversation, not an account conversation list.
- The existing capture manifest and catalog retain provider/conversation identity
  and capture time. Capture time is not a provider revision, and legacy manifests
  do not bind an account or workspace.

No checked-in evidence establishes an exact ChatGPT or Claude account-list
request/response grammar, account/workspace binding, cursor semantics,
pagination termination, list ordering, duplicate behavior, archive/deletion
visibility, rate-limit behavior or what a timestamp-shaped field covers.

## Decision

Provider discovery is split into three distinct contracts:

1. **Enumeration observation** describes one bounded account/workspace list read:
   its exact scope, request grammar, response envelope, pagination state and
   terminal evidence.
2. **Detail observation** describes one explicitly identified conversation body.
   Existing capture adapters remain in this layer.
3. **Update-discovery marker** defines which list-level value can justify a later
   detail read and exactly which material changes it is known to cover.

Evidence from one layer cannot silently authorize another. In particular:

- a detail `updated_at` is not a list-level discovery watermark;
- equal observed markers mean only `same-observed-marker`, not `unchanged`,
  `current` or `backed-up`;
- absence from one page is not deletion, archival or inaccessibility;
- a pagination token is not a durable checkpoint until restart and expiry
  behavior are observed;
- titles, order, elapsed local time and capture timestamps are not change signals;
- a small sample cannot prove account completeness, monotonicity or coverage of
  every edit, branch, attachment, title or archive operation.

No provider-specific parser, comparator, cursor type, fixture or runtime adapter
is admitted by this ADR. A synthetic guessed schema would turn uncertainty into
an executable contract and is therefore rejected.

## Evidence required before provider-specific implementation

For the exact provider and account/workspace scope, repository-safe evidence must
record the proven subset of:

1. account/workspace binding and identity-switch behavior;
2. exact read-only request grammar and response envelope;
3. stable conversation identity fields and format;
4. pagination or offset semantics, terminal evidence and page-size behavior;
5. cursor lifetime, restart behavior and expiry/failure representation;
6. ordering, duplicate and reorder behavior under repeated reads;
7. marker type, precision, equality and regression behavior;
8. which material changes are observed to advance the marker;
9. archived, deleted, hidden, inaccessible and filtered conversation visibility;
10. throttling and rate-limit signals plus safe stop behavior.

Unknown properties remain `unknown`. An implementation may support only the
subset actually evidenced; it must not infer the rest from provider similarity
or a field name.

## Proposed bounded next experiment

The experiment requires a separate explicit user choice naming the provider,
the signed-in account and the exact workspace/organization scope whose list
surface may be inspected. A personal surface must be identified explicitly as
`personal/no-workspace`. The visible account and scope are confirmed before the
first request but are not retained. ChatGPT is the recommended first candidate
because its existing single-conversation identity and capture path are already
mature; this recommendation is not authorization.

The proposed first pass is limited to at most three foreground, read-only list
requests:

1. the first list page;
2. one provider-declared next page, if present;
3. one repeat of the first page to compare envelope, ordering and marker shape.

The pass may inspect only schema field names/types, aggregate counts, identifier
format, marker format/precision, pagination-field presence, archive/status-field
presence and relevant response-header names. It must not retain real titles,
snippets, conversation IDs, account/workspace IDs, cursor values, transport
tokens or response bodies. Any later fixture must be explicitly synthetic and
contain no copied provider values.

The pass must not fetch conversation detail or bodies, open a sequence of chats,
mutate provider state, traverse beyond the request cap, retry automatically or
continue in the background. It stops on an authentication boundary, permission
prompt, ambiguous account/workspace identity, any account/workspace switch,
throttling/429, unexpected mutation, transport ambiguity or an envelope that
cannot be inspected without retaining private content.

This small pass can establish a candidate schema. It cannot by itself certify
marker monotonicity, complete ordering stability, cursor durability or
archive/deletion coverage; those require separately bounded evidence.

## Rejected alternatives

- A pure comparator over detail timestamps would improve terminology but would
  not discover unseen conversations or prove list completeness.
- Reusing capture time would conflate when Liska observed evidence with when the
  provider changed it.
- Reusing Dots or another provider's `cursor`/`has_more` field names would make a
  generic cursor contract from unrelated schema hints.
- A provider-neutral discovery interface before one proven provider would encode
  speculation and violate ADR-051.

## Consequences

- Provider discovery code remains absent until its input contract is observed.
- Catalog and journal schemas remain unchanged and non-authorizing.
- Account-wide baseline execution and scheduling remain disabled even after a
  schema experiment; they require a reviewed contract and a separate explicit
  user decision.
- The next implementation PR, if admitted, must remain provider-specific and
  pure before any transport, persistence or scheduler wiring is considered.

## Verification for this slice

This docs-only slice must pass Markdown formatting, repository documentation
link tests and deterministic Idea-Threads validation. It performs no provider,
browser or network interaction.
