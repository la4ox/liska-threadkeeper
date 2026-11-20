# ADR-080: Observe Claude list header-pair scope within one probe run

## Status

Accepted for the exact installed live `/5` acceptance documented below. The
reviewed producer head `fa5ea83` is an ancestor of docs base main `1719fff`, and
its installation was reconciled by exact relative-file SHA-256. One explicitly
confirmed click with no retry completed the exact-head/live gate. This does not
establish semantic or personal scope, catalog admission, or baseline authority.

## Context

One v4 live click established the exact candidate header names
`anthropic-organization-id` and `anthropic-workspace-id`, but retained neither
value nor semantics. Header names alone did not bind the list pages to the
selected route or establish a personal account/workspace scope. The next offline
contract must read only that exact pair after all existing transport gates,
validate a route-bound organization and a bounded workspace admission envelope,
and compare the unmodified pair across pages without allowing it to escape the
pinned invocation.

This is still an evidence-only probe. It does not infer Claude provider grammar
or identity from an admitted workspace string, and it does not convert an
observed project scope into a manual personal-scope attestation or catalog key.

## Decision

### Read and validate only the exact pair

After the existing transport gates pass, `/5` reads only the values of the exact
lowercase names `anthropic-organization-id` and
`anthropic-workspace-id`. The organization must be an exact lowercase UUID and
must exactly equal the organization ID already selected from the route. The
workspace value must match the case-sensitive project admission envelope
`[A-Za-z0-9._~-]{1,128}`. That envelope is explicitly project-bound; it is not a
claim about Claude's provider grammar or workspace identity semantics.

Do not trim either value, supply a default, use a fallback, or substitute the
organization value for the workspace. Missing, invalid, changed, or
unavailable-pair conditions fail closed with fixed header/pair diagnostics.

### Bind raw page pairs and a fingerprint to one invocation

The exact raw header pair is authoritative for comparison. The first valid page
seeds it; every later page must compare equal, including an empty archived page.
Page-derived body evidence, counts, ID deltas, the raw pair, and its fingerprint
commit atomically. No partial page evidence is admitted.

Inside the pinned invocation only, compute SHA-256 over the JSON array
`["liska-claude-list-probe-scope-run/1", ownerToken, "https://claude.ai", exact
labels/values]`, where `ownerToken` is fresh for each invocation and the exact
labels/values are the two header names and their unmodified values. The encoded
fingerprint uses the prefix
`claude-probe-scope-run-v1-sha256:`. The digest supports linkage only among
pages in this one run. It is not an HMAC, anonymization, authentication proof,
cross-run key, or catalog key. Never render, persist, export, or place it in a
receipt; never render or retain the raw pair outside the pinned invocation.

Crypto awaits remain inside existing deadline and navigation fences. A late
completion after either fence is side-effect free. Do not add fallback, retry,
or budget.

### Define the only positive scope result

`/5` requires a same-run fingerprint on every admitted page. Global scope has
the fixed shape `{observed, fingerprint, relevantHeaderNames}`. A positive result
is allowed only with `code: "scope-observed"`, an exhausted page schedule, no
pending continuation, and equal fingerprints on every page. Every negative
result has `observed: false` and `fingerprint: null`; the probe's top-level
status remains `stopped` in all cases. New header, pair-comparison, and crypto
failures use fixed codes, not reflected error text or values.

The localized popup may show only whether the exact header pair was observed or
not observed and must warn that account completeness is unproved. No digest,
owner token, or raw header value may appear in DOM text, attributes, accessibility
labels, title, logs, or copy output.

## Compatibility and authority boundaries

This slice adds no endpoint, request, permission, persistence, catalog or owner
authority, capture/export path, or scheduler authority. Manual personal-scope
attestation and the catalog key remain separate. A positive same-run pair
observation does not itself establish a personal account or authorize catalog
admission, baseline execution, capture, export, or automation.

## Rejected alternatives

- Fuzzy aliases, fallback header-name lookup or application-level normalization:
  the v4 evidence admits only two exact field names. Native Fetch header lookup
  and exposed values retain their standard HTTP normalization semantics.
- Treat a type-only extra probe as semantic proof: an observed type or shape
  alone would not establish the required route-bound pair.
- Require a UUID-shaped workspace value: that would invent provider grammar;
  use only the fixed project admission envelope.
- Hash a stable pair without a fresh per-invocation owner token: a deterministic
  cross-run digest would permit unintended linkage.
- Render or persist the digest: it would extend linkability beyond the one run
  and add an unneeded durable or UI surface.
- Bridge a positive observation into the catalog: manual personal-scope
  attestation and catalog key remain independent.

## Evidence and validation

- V4 live evidence `E56` established the exact candidate header names, with no
  retained values or semantics.
- Focused core/popup/architecture tests pass 274/274; adjacent coverage passes
  16 files / 590 tests. TypeScript, scoped lint, Prettier, and diff checks pass.
- Project lint has zero errors and the unchanged 55 warnings; the production
  dependency audit reports zero vulnerabilities. Production build/ZIP pass:
  `dist` has 65 files / 6,125,112 bytes and the ZIP is 2,801,704 bytes.
- English/Japanese validation is an isolated static smoke only; no runtime
  locale test is claimed.
- Independent code and senior reviews report ready. The exact-head/live gate
  was completed for the reviewed producer head `fa5ea83`, an ancestor of docs
  base main `1719fff`. The installed relative files matched by SHA-256
  reconciliation; rollback `dist-backup-codex-20261120-claude-list-probe-v4`
  remains available.
- One user-confirmed click with no retry returned `stopped / scope-observed`;
  verification was true and route evidence was `multiple-consistent`. The run
  made two requests across two pages and observed twelve records. Active offset
  0 was terminal: 12 records, 12 valid UUIDs, 12 markers, 12/12 boolean archive
  flags and zero mismatches. Archived offset 0 was terminal with zero
  records/counts. Duplicates and cross-partition overlap were zero. Pagination
  was not exercised and no continuation was observed pending.
- The exact header pair `anthropic-organization-id` and
  `anthropic-workspace-id` was observed consistently in this diagnostic. A
  run-scoped fingerprint existed internally, but neither it nor raw header
  values were rendered in UI/output, read from the receipt, or retained there.
  The git-ignored local receipt `LISKA-CLAUDE-LIST-PROBE-V5-HEADER-PAIR-20261120`
  is content-free and private-route-free.

## Next gate

The one-click exact-head/live gate is complete. The next gate is a separately
reviewed semantic/personal-scope/catalog bridge. This observation does not prove
account completeness, general pagination, deletion or archived-history
completeness, provider workspace semantics, authenticated personal scope, or
stable cross-run identity. It does not admit the catalog, authorize a baseline,
capture/export, or scheduler authority; no baseline runs automatically.
