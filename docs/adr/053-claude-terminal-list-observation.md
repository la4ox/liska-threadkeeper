# ADR-053: Claude terminal active-list observation without sync authority

- Status: Accepted for a pure unwired contract
- Date: 2026-11-05
- Scope: structural admission and opaque token comparison only

## Context

ADR-052 requires provider-list evidence before update-discovery code. The user
authorized one bounded foreground experiment against the visibly active Claude
main account and its personal scope. No backup account, conversation body,
mutation, pagination action or provider write was used.

One page reload produced three actual list requests before the observation cap
could stop them. All three used the same route and returned HTTP 200. This proves
that one UI action is not one provider request and that future budgets must count
emitted requests, including client/provider refetches.

The safe aggregate retained from the observation is:

- method `GET`;
- provider route `chat_conversations_v2` under an organization-bound API path;
- query `limit=30`, `offset=0`, `archived=false`, `consistency=strong`;
- response headers contained both organization and workspace identity fields;
- JSON envelope keys `data` and `has_more`;
- one observed terminal sample contained 12 records and `has_more=false`;
- record keys included `uuid`, `created_at`, `updated_at`, `name`, `summary`,
  `is_archived`, `is_starred`, `is_temporary`, `is_multiplayer`, `model`,
  `platform`, `project`, `settings` and `workspace_upgraded`.

No real organization/workspace value, conversation ID, title, summary, marker,
cursor, response body or transport token is retained in this repository.

## What the observation does not establish

The pass did not observe:

- `has_more=true` or any page after `offset=0`;
- `archived=true` or archived/deleted/inaccessible visibility;
- a cursor, offset stability, snapshot isolation or pagination restart;
- marker monotonicity, regression meaning or which material changes advance it;
- equality of the three response bodies;
- duplicate records inside one response;
- scope switching during a request;
- rate-limit headers or throttling behavior.

The verification banner prevented generating new Claude responses, but it did
not prevent reading the existing list. That fact does not expand the contract.

## Decision

Add a provider-specific pure module that recognizes only this observed terminal
active-list page. The module remains disconnected from all transport and runtime
paths.

### Admission outcomes

Admission distinguishes three fixed outcomes:

1. `rejected` — malformed or unsafe input, invalid envelope,
   malformed/duplicate identity or exceeded bound;
2. `unsupported` — structurally understandable but unobserved method, route,
   status, identity spelling or capability such as unresolved scope,
   `has_more=true`, nonzero offset, a different limit, archived listing or
   different consistency mode;
3. `observed_page` — exact admitted terminal page under the observed policy.

`observed_page` means only that this response reported no further page. It does
not mean complete account inventory, current backup, recoverability or deletion
coverage.

### Scope binding

The caller supplies a pre-resolved versioned scope key and explicit evidence
that both organization and workspace identities were resolved. Raw identity
values do not enter the module or output. Missing or ambiguous scope is
`unsupported`, not a personal-scope default.

### Record projection

Admission reads only bounded own descriptors needed for identity and marker:

- exact lowercase UUID is the deliberately conservative conversation identity
  policy;
- `updated_at`, when present as a bounded nonempty string, is retained as an
  opaque token with a fixed source label;
- names, summaries, settings, model, project and all unknown fields are neither
  traversed nor retained.

Duplicate conversation IDs reject the page. Admitted records are detached,
deeply frozen and deterministically ordered by conversation ID; provider list
order receives no authority.

### Token comparison

Comparison requires the same scope key, conversation ID and fixed marker source:

- exact string equality returns `same_token`;
- unequal strings return `different_token`;
- missing marker or identity/source mismatch returns `incomparable` with a fixed
  reason.

Tokens are never parsed or ordered as dates. `same_token` does not mean
`unchanged`; `different_token` does not mean `changed` or `newer`. Neither
outcome authorizes skipping detail capture, exporting, journal mutation or any
provider request.

## Authority boundary

The module has no fetch/transport callback, URL authority, Chrome API, storage,
clock, timer, runtime messaging, cursor state, retry/backoff, scheduler, UI,
catalog/journal mutation, capture/export decision or destination access. It is
not wired into an entrypoint.

No `/1` catalog, journal, manifest or canonical schema changes.

## Limits

Hard bounds cover records per page, object keys inspected and UUID/token/scope
code units. Together they place an absolute bound on the small projected output;
there is no separate encoded-output format or size contract in this slice.
Callers may lower but never raise the limits. Unknown field values are not read
while enforcing key-count and plain-own-data requirements.

## Rejected alternatives

- Treating the three same-route responses as one request would undercount actual
  provider traffic.
- Comparing response sizes or assuming repeated routes had identical bodies
  would invent evidence not retained by the pass.
- Naming outcomes `unchanged`, `changed`, `newer`, `complete` or `current` would
  grant sync authority the observation does not support.
- Implementing offset advancement from an unobserved `has_more=true` page would
  turn a query parameter into pagination semantics.
- Persisting names, summaries, settings or real scope values is unnecessary for
  structural admission and would cross the privacy boundary.

## Acceptance gates

1. Synthetic tests cover the exact observed route/envelope and every rejected or
   unsupported variant.
2. Descriptor-safe validation never invokes getters, `toJSON` or inherited
   values and never retains unrelated fields.
3. Duplicate identities, exotic prototypes, symbols, sparse arrays and every
   lowered limit fail closed with fixed outcomes.
4. Marker tests prove exact opaque equality only and forbid date ordering or sync
   claims.
5. Architecture tests prove zero imports or references to network, browser,
   storage, journal/catalog mutation, capture/export, cursor or scheduler paths.
6. Repository documentation records the observed request overshoot and the
   remaining unknowns without private values.

## Deferred evidence

A later separately authorized pass may investigate `has_more=true`, nonzero
offset, archived visibility, repeat-body equality, marker behavior after a
controlled material change, scope switching and rate limits. Until then the
terminal page cannot drive a baseline or daily update decision.
