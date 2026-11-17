# ADR-075: Separate Claude account inventory from captured-snapshot truth

## Status

Accepted on 2026-11-18 for the first pure, unwired contract slice of an
explicitly authorized full backup attempt for the user's current personal Claude
account. This ADR admits only a scope-bound inventory of already observed active
conversation identities. It does not yet enumerate, persist, capture or claim
complete account coverage.

## Context

The catalog, journal/3, provider owner/2 lifecycle and native acceptance gates
through ADR-074 make one provider-bound operation possible. The user then chose
a broader outcome: attempt a full current-personal-account Claude backup,
resumably over multiple manual iterations, while keeping the daily scheduler a
later decision.

Two accepted boundaries prevent honest implementation by merely raising a
batch limit:

1. `liska-snapshot-catalog/1` contains identities derived from valid existing
   capture manifests. A never-captured Claude conversation has no such manifest,
   so fabricating one to authorize its first capture would reverse provenance.
2. Provider owner/2 reconstructs that snapshot-derived plan and retains at most
   16 operations and 128 observations. It is an accepted single-plan lifecycle
   owner, not an unbounded account inventory/cursor store.

ADR-053 supplies one useful but narrow source: an exact terminal active-list
page observed at `limit=30`, `offset=0`, `archived=false`, with twelve records in
the historical live sample. It explicitly does not prove archived visibility,
later-page grammar, restart-stable pagination, account completeness or marker
freshness semantics.

## Decision

### Add a separate pure account-inventory catalog contract

Introduce an import-isolated `src/claude-baseline/` module with the versioned
schema `liska-claude-account-baseline-catalog/1`.

The contract accepts only:

- the exact detached structural shape already produced by ADR-053's
  `claude-list-page-observation/1` parser;
- a separate manual-personal-scope attestation carrying the same existing
  opaque scope key and explicit resolved organization/workspace bindings.

The old update-discovery module remains frozen and unwired. The new module does
not import it, even type-only. Tests pass a real ADR-053 parser result and run an
independent TypeScript compiler check proving exact bidirectional structural
compatibility. A negative drift control proves that this check fails when the
shape changes.

### Retain only bounded provider-neutral identity facts

The catalog contains:

- fixed provider `claude`;
- the existing versioned opaque scope key;
- evidence class `manual-personal-scope`;
- targets sorted by exact conversation ID;
- the existing opaque marker source/token when present.

It never retains account email, raw organization/workspace values, titles,
summaries, settings, response bodies, URLs, transport headers, credentials or
arbitrary provider fields. Duplicate or malformed identities, foreign marker
sources, mismatched/unresolved scope and over-limit data are rejected or marked
unsupported with fixed outcomes.

Inputs are defensively read as bounded own plain data. Getters, inherited data,
symbols, sparse arrays, exotic prototypes and lowered-limit violations fail
closed. Published output is detached, deterministically ordered and deeply
frozen; caller objects remain untouched.

### Make incompleteness part of the schema

Every catalog produced by this slice has exactly:

```text
coverage.active   = terminal-observed
coverage.archived = unobserved
accountComplete   = false
```

An empty, short, 12-record or full 30-record terminal active page never becomes
a complete-account claim. Missing markers stay missing; they are not replaced
with timestamps, recency or capture evidence. Marker equality grants no skip or
sync authority.

The manual attestation is evidence of the user's selected visible context, not
cryptographic authentication. The next live probe must still bind response
organization/workspace evidence to the same ephemeral page context before this
catalog can seed durable baseline work.

### Keep the slice pure and unwired

The new module has no network, browser, storage, clock, timer, journal, capture,
export, destination, retry, cursor, scheduler or UI authority. It has no
production/configuration/manifest consumer. No canonical byte encoder or
physical store is added in this slice; the later account-baseline owner will
define its own bounded serialization and cursor transaction boundary.

## Compatibility and boundaries

ADR-053 and its tests remain unchanged. Existing snapshot catalogs, manifests,
journal versions, provider plan/checkpoint/owner databases and accepted native
harnesses remain byte- and meaning-unchanged.

This decision does not authorize a provider request by itself. The user's full
backup authorization opens the staged roadmap, but replacing the installed
extension and starting the first live enumeration probe still require the
normal action-time handoff.

Successful capture of known conversations may begin before archived coverage is
proven, but the report must keep “delivered over the proven target set” separate
from “complete account backup.” Attachments remain inventory-only until their
own acquisition capability is admitted.

## Rejected alternatives

- Fabricate capture manifests for newly listed chats: reverses source
  provenance and gives discovery data archive authority.
- Widen `liska-snapshot-catalog/1`: changes the meaning of an accepted captured-
  evidence catalog.
- Reuse provider owner/2 as an account runner: its source catalog and lifetime
  limits are intentionally different.
- Import or relax ADR-053's frozen module boundary: erases the distinction
  between historical evidence and the new baseline source.
- Treat active terminal as account terminal: archived and pagination coverage
  remain unobserved.
- Parse or order `updated_at`: the retained marker is opaque and has no proven
  freshness semantics.
- Delay all known-chat backups until archive proof exists: useful captured
  evidence need not wait for a stronger completeness claim.

## Evidence and validation

- The new slice consists only of self-contained source, focused tests and one
  architecture guard; no existing tracked source or configuration file changes.
- Focused new tests cover valid ADR-053 output, missing markers, deterministic
  ordering, duplicate/malformed identity, scope mismatch and unresolved scope,
  exotic data, getters, symbols, sparse arrays, lowered limits, privacy,
  detachment, deep freezing and explicit non-completeness.
- A runtime TypeScript compiler-program test checks exact bidirectional
  compatibility with the real ADR-053 types and includes a deliberately drifted
  TS2322 negative control.
- The architecture guard pins every module/import and proves zero network,
  browser, storage, journal, capture, export, scheduler, UI, build, package,
  manifest or production consumer.
- Current focused, regression, TypeScript, scoped zero-warning ESLint, Prettier
  and whitespace results are recorded in STATUS for this branch.
- Current-head GitHub CI, Code Review and Security Review remain acceptance
  gates.

## Next gates

1. Add a user-clicked, request-counted Claude list probe. The first pass is
   limited to serial active/archived list reads and safe aggregate evidence;
   pagination remains unproven unless a real nonterminal-to-terminal chain is
   observed.
2. After that evidence, add a fresh rollback-isolated Claude account-baseline
   owner with atomic page/cursor/item commits and finite capacity stops.
3. Bind sequential detail capture and File-only raw/manifest/canonical delivery,
   then accept the storage/lifecycle path natively.
4. Run manual iterations, initially two chats and then bounded groups, until the
   proven target set is exhausted. No daily scheduler follows automatically.
