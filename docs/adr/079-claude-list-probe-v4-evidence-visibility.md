# ADR-079: Make Claude list-probe v4 evidence visible and atomic

## Status

One reviewed v4 installation and confirmed click are recorded below. The
content-free result is `stopped / scope-unresolved`; there was no retry. The
next gate is a separately reviewed exact scope contract, not catalog admission
or a claim of account completeness.

## Context

The v3 live result was `stopped / scope-unresolved`: two requests, two pages and
twelve aggregate records, with scope unresolved. The popup did not show
page-level counts or candidate header names. A zero archived-mismatch count also
could not distinguish correct flags from missing or non-boolean flags. The
content-free aggregate therefore concealed which evidence had actually been
admitted on each page.

The next offline slice must make those facts inspectable without turning the
probe into identity, capture or baseline authority. Page admission must also be
atomic: a malformed late record must not leave partial counts or IDs behind.

## Decision

### Version the exact evidence contract as `/4`

The producer and validator use `liska-claude-list-probe/4` with per-page counts
for `record`, `validUuid`, `marker`, `archivedFlag` and `archivedMismatch`, plus
global `archivedFlag` evidence. They reconcile global and page aggregates
exactly, verify the exact producer order/prefix and recompute pagination facts.
Each page is admitted atomically; if a late record is malformed, that page
contributes no partial counters or IDs.

The producer and validator permit only `stopped` results with scope unresolved
and a null fingerprint. Candidate header names remain names-only evidence, not
proof of scope. No header values or record content enter the result.

### Show compact evidence in the popup

The popup renders the validated evidence card inside its scroll area, using
`textContent`. It is not a sticky overlay. The card exposes page-level and
global evidence without adding another authority boundary.

## Compatibility and boundaries

V4 adds no requests, endpoints, retries, header-value reads, IDs, content,
persistence, catalog or owner wiring, capture/export path, or scheduler
authority. Existing provider request and lifecycle bounds remain unchanged.
Unresolved scope means the evidence cannot establish authenticated
account/workspace membership or authorize a baseline.

## Rejected alternatives

- Keep `/3` and change only the popup: insufficient; a zero mismatch count
  cannot establish that archive flags were present and boolean.
- Guess header values or construct a fingerprint: candidate names do not prove
  authenticated scope, and values are outside this evidence contract.
- Treat selected-chat membership as scope proof: selection does not bind list
  records to an authenticated account or workspace.
- Wire the result into the catalog: scope, partition and completeness remain
  unresolved, so catalog admission would overstate the evidence.

## Evidence and validation

- The reviewed producer head `87310e556f1ab986c577dad2f0ce8336a304a925`, merged
  as `34901bc3b52d7163212ac24755629a953e4606b9`, was installed after exact
  relative-file SHA-256 reconciliation. The prior v3 installation remains
  intact as rollback `dist-backup-codex-20261120-claude-list-probe-v3`.
- One confirmed click, with no retry, returned `stopped / scope-unresolved`,
  verification `true`, and route evidence `multiple-consistent`: 2 requests,
  2 pages and 12 records. Active offset 0 was terminal with 12 records, 12
  valid UUIDs, 12 bounded markers, 12/12 boolean archive flags and 0 archive
  mismatches. Archived offset 0 was terminal with zero records and zero counts.
  Duplicate count and cross-partition overlap were both 0.
- Pagination was not exercised and no continuation was observed pending. The
  only candidate header names observed were `anthropic-organization-id` and
  `anthropic-workspace-id`; names alone are not scope proof. No IDs, marker
  values, header values, body/content, catalog or persistence facts were
  retained in this documentation.
- This run does not establish account completeness, general pagination,
  archival deletion coverage, or authenticated personal account/workspace
  scope. Exact route evidence remains local-only.
- The current offline implementation evidence is four focused files / 219 tests
  and sixteen adjacent files / 590 tests passing. TypeScript, Prettier, Idea
  Threads 9/37 and documentation links 99/99 pass. Project lint has zero errors
  and the unchanged 55 warnings; the production-only dependency audit reports
  zero vulnerabilities.
- An earlier pre-review full 369-file suite attempt reached 12,523 passing and
  three skipped tests but one unrelated native owner-lifecycle
  `missing-observer` scenario exceeded its five-second JSON-receipt window under
  parallel load. The exact scenario then passed 1/1 and its complete file passed
  65/65 in isolated reruns. Current-head CI remains the full-suite gate after the
  final validator tightening.
- Production build and ZIP pass: `dist` has 65 files / 6,121,311 bytes; the
  2,800,776-byte ZIP has SHA-256
  `5fcf4aa6252b6ecd9ab7484c6644fab2c6a20f7c9c453adc55f0e82fc26c2896`.
- Independent source review reports ready with no material findings.
- A synthetic 380px popup visual smoke passed. This is not installed or live
  acceptance.
- The content-free live receipt is local-only:
  `LISKA-CLAUDE-LIST-PROBE-V4-PAGE-EVIDENCE-20261120`.

## Next gate

Any next scope work requires a separate reviewed exact scope contract. It may
read only the two observed exact header names above and must prove value
grammar, cross-page consistency, route-organization match, a privacy-preserving
fingerprint and a manual personal-scope boundary. Do not implement that contract
here or infer authenticated account/workspace membership from names. Until then,
do not claim account completeness, general pagination or archival deletion
coverage, and do not admit these records to a catalog or baseline.
