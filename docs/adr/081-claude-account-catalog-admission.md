# ADR-081: Validate a Claude account catalog projection for one collector invocation

## Status

Accepted on 2026-11-24 for an offline, production-unwired core. The user
reconfirmed the end goal: a full current-personal Claude backup through normal
Liska, including provider reads and File downloads in resumable batches. The
core takes no live action and grants no execution authority.

## Context

[ADR-080](080-claude-list-probe-v5-header-pair-observation.md) observed a
consistent route-matching organization/workspace header pair, one terminal
active page and one terminal empty archived page. The installed `/5` receipt is
deliberately content-free: it retains neither the raw pair nor the active IDs
and markers. Its owner-token fingerprint was ephemeral and only linked pages
within that diagnostic run.

Composing a reviewed `/5` receipt with an independently prepared list of
targets was rejected. Matching counts, terminal flags or a second manual
confirmation cannot show that independently sourced identities belong to the
scope seen by `/5`. Another wrapper would add ceremony without adding the
missing evidence. The list and scope must be acquired together.

## Decision

Add `admitClaudeAccountCatalog` inside the existing import-isolated
[`claude-baseline`](../../src/claude-baseline/index.ts) module. It accepts one
closed in-memory projection intended to come from a single future collector
invocation:

- The exact lowercase route organization UUID and the exact pair of own
  `anthropic-organization-id` and `anthropic-workspace-id` values. The
  organization must match the route exactly; the workspace must match the
  case-sensitive project envelope `[A-Za-z0-9._~-]{1,128}`. No trimming,
  default, alias or fallback is allowed.
- The explicit `manual-same-visible-personal-context` attestation. It records
  a manual choice, not authentication, ownership or provider workspace
  semantics.
- One active `{offset, body: {data, has_more}}` page at offset 0 with
  `has_more: false` and at most 30 projected records. Each record has a unique
  exact lowercase `uuid`, `is_archived: false` and at most one optional
  nonempty `updated_at` string of up to 256 code units. Markers are opaque.
- One archived page with the same closed envelope, offset 0, `has_more: false`
  and an empty `data` array. Continuation, later offsets and a nonempty
  archive are unsupported.

The future live collector must own both responses and verify that the same
exact raw pair accompanied both, including the empty archived page. Its
manual gesture, pinned document, route, responses and projection must all
belong to that invocation. The pure core checks a closed input shape; it
cannot authenticate a fabricated object, prove that the literal manual
assertion came from a gesture, or recover provenance from receipts. Its public
evidence therefore says only `caller-projected`; the future `/6` layer owns the
stronger live claim.
Real response-body bytes and extra provider fields never enter the core: the
collector must validate transport and project only the admitted fields.

### Derive a stable pseudonym within the collector boundary

An explicit injected SHA-256 dependency receives the JSON serialization of
this exact ordered array and hashes its UTF-8 bytes:

```text
[
  "liska-claude-account-catalog-scope/1",
  "https://claude.ai",
  "anthropic-organization-id", <unmodified organization value>,
  "anthropic-workspace-id", <unmodified workspace value>
]
```

The 32-byte result is rendered as `claude-list-scope/1:<64 lowercase hex>`.
Unlike `/5`, this domain contains no owner token, so subsequent observations
with the same exact pair can correlate to the same local scope. This stability
is intentional and makes the key a pseudonym, not anonymization, an HMAC,
authentication, proof of provider semantics or evidence that the provider will
keep the pair stable. Treat the scope key as linkable local inventory data;
do not use it as a public identifier. The injected hash must be trusted and
must not log or retain its preimage. The core emits no raw pair, preimage,
`/5` fingerprint, URL, title, body or arbitrary field of its own. A record
identity or marker exactly equal to either raw value is refused rather than
echoed as a target. Otherwise UUIDs and opaque `updated_at` markers are accepted
from the closed caller projection; the core does not claim to inspect marker
substrings for provider-controlled aliases.

### Preserve the catalog and authority boundaries

Reuse the existing pure `/1` enumerator with a detached observation and
matching manual scope projection. The catalog still contains only `claude`,
the opaque key, `manual-personal-scope`, sorted IDs and optional opaque
markers. Its coverage remains active terminal, archived unobserved and
`accountComplete: false`. The companion versioned admission result records
only the provided-pair derivation, caller-projected manual assertion, active
terminal projection and archived terminal-empty projection, with both
`accountComplete` and `executionAuthorized` fixed to `false`. A single empty
response does not replace the catalog's unchanged archive-coverage meaning or
prove complete archive/history/deletion visibility.

Inputs must be closed own plain data; getters, unknown fields, exotic
prototypes, symbols, sparse arrays and over-limit data fail closed. Outputs
are detached, deterministic and deeply frozen with fixed failure codes.
There is no new capture manifest, scheduler, cursor, owner, storage, network,
UI, production consumer or ambient hash dependency. `/5`, its popup,
service-worker, manifest, storage and live behavior remain unchanged.

## Evidence and next gates

Focused synthetic tests exercise exact key serialization, stability and
sensitivity to each header value, catalog/evidence reconciliation, hard and
lowered bounds, detachment, no authority, and fail-closed data and digest
handling. The architecture guard pins imports and the absence of production
consumers. These tests prove only the core, not an installed collector or
provider behavior.

Focused Claude baseline, boundary and documentation-link coverage passes 7
files / 247 tests. TypeScript, scoped zero-warning ESLint, Prettier, Idea Threads
and diff checks pass. The full repository run completed 12,653 tests with three
skips and one load-sensitive native-harness `missing-observer` timeout; the exact
scenario passed 1/1 and its full file passed 65/65 in isolated reruns. Full lint
passes with zero errors and the unchanged 55 warnings. Production build/package
passes, and its 65-file / 6,125,112-byte `dist` is byte-identical to the installed
reviewed `/5` build because this module remains outside production closure.

The next gate is a storage-only rollback-isolated account-baseline owner that
can atomically retain one admitted paused catalog with finite capacity and
truthful transaction outcomes. It must be accepted before another live list
read. Then a reviewed, explicitly user-started `/6` collector retains the
existing transport and request bounds, checks pair equality plus route/document
currentness on both replies, admits inside that invocation, and commits through
the owner before publishing success. Cancellation, timeout and late digest or
transaction completion remain fenced; installed verification must disclose
neither raw pair nor target data. Only after that gate may one owner-bound detail
capture and File delivery precede resumable manual batches. A report must
distinguish delivery over proven targets from full-account completeness. No
daily scheduler follows automatically.
