# ADR-054: Keep local snapshot verification outside capture journal v1

- Status: Accepted architectural boundary; documentation only
- Date: 2026-11-05
- Related: ADR-043, ADR-050, ADR-051, ADR-052, ADR-053, ITH-007

## Context

The post-PR #118 audit uses exact merged main `4c3ba7e` and the reviewed PR head
`ee2e34a`. The rebuildable manifest catalog and transactional inert journal are
implemented and installed-live accepted. The Claude terminal active-list
admission/comparator contract is implemented but remains pure and unwired. None
of those facts establishes a production account-wide baseline driver.

An apparently small next step would select one existing local snapshot, verify
it offline, then use journal `begin-attempt` / `settle-attempt` to record success.
That would change the meaning of the journal rather than merely exercise it:

- A v1 attempt reserves a capture identity for intended capture work, unique
  among that journal's attempts; it is not an existing-snapshot reference.
- Settling an attempt as `confirmed` makes its item `recorded`. That item is no
  longer eligible for a later `begin-attempt` in the same run.
- Journal admission retains the original catalog digest and one
  provider/conversation/key tuple, not a selected snapshot's exact manifest or
  existing capture identity. Several catalog captures collapse into one work
  item.
- Typed evidence references are bounded references, not independent integrity
  verification or proof that baseline capture took place.

Confirming local verification as a capture attempt could therefore mark future
capture work done without taking a new snapshot. Reusing an existing capture ID
would also confuse preserved archive identity with the reserved attempt identity.
Verifying an existing snapshot is not baseline capture.

## Decision

### Local verification does not mutate journal v1

Keep explicitly selected local snapshot verification outside
`liska-resumability-journal/1`. The existing preserve-only snapshot analyzer
keeps its own bounded contract and support limits. Do not add an offline
one-item journal begin/settle driver, expose execution controls or wire provider
transport as the next slice. No catalog, journal, manifest or canonical `/1`
schema changes are authorized here.

### Any future reattachment is pure, exact and separately reviewed

A later operation may reconnect explicitly selected local evidence to an
original catalog selection only under its own reviewed contract. It must require
all of:

1. The exact original catalog SHA-256, checked against the exact selected catalog
   bytes. A rebuilt or merely similar catalog with a different digest cannot
   replace the original binding.
2. Exact agreement on provider, provider conversation ID and versioned
   conversation key; title, path, time and "latest" heuristics grant no identity.
3. The selected catalog entry's exact manifest byte length and SHA-256, checked
   against the selected manifest bytes.
4. The exact existing capture identity from that entry and manifest, not a new
   attempt capture ID or the identity of another capture of the same conversation.

Ambiguous or conflicting evidence must fail closed. Matching does not attribute
legacy captures to the current account or invent the missing scope binding.

The operation must distinguish catalog/evidence attachment `matched` / `mismatch`
from the independent verification assessment: `verified`, `partial`,
`unverifiable` or `unsupported`, as applicable under its reviewed support
contract. A matched manifest is not proof that raw, canonical or asset bytes are
valid; an unsupported verifier is not evidence of an identity mismatch. These
are required distinctions for a future contract, not new output enums added to
the existing analyzer by this ADR.

Such an operation may consume detached explicitly selected bytes and a trusted
hash capability only. It has no journal transition or persistence, provider or
network access, capture-ID allocation, archive write, rename, deletion, migration
or other mutation authority. It cannot satisfy or remove future capture work.

### Production baseline execution needs its own semantics and authority

Before a production baseline driver is designed or wired, a separate reviewed
contract must establish persisted operation purpose and capture semantics. It
must distinguish verification of preserved evidence from a new capture, define
which exact evidence may settle that purpose, and keep one purpose's
success from suppressing another purpose's remaining work. Do not infer that
v1's generic typed references already provide this distinction.

The driver also requires provider-specific enumeration/scope/pagination,
visibility, marker and rate/budget evidence under ADR-052/053, plus the user's
separate explicit account-wide baseline authority. A scheduler remains a further
separate choice. A local selected catalog, inert journal or terminal list sample
does not grant any of those capabilities.

### Preserve Claude's opaque-token boundary

ADR-053 remains unchanged: the accepted terminal active-list shape is not an
account inventory. `same_token`, `different_token` and `incomparable` are exact
opaque-token comparisons, not `unchanged`, `changed`, `newer`, recoverability or
permission to skip capture. Pagination, archived/deleted/inaccessible visibility,
controlled marker behavior, scope switching and throttling remain separately
evidenced. Budgets count actual emitted requests, including refetches, not UI
actions; the first reload emitted three requests and exhausted its cap.

## Next choice and unfinished goal

The accepted catalog, inert journal and Claude structural contract are foundation
slices, not completion of update-driven backup. The full goal remains unfinished.
The next choice is a separately authorized bounded Claude evidence pass covering
pagination, archived visibility, marker/scope behavior or rate behavior with
actual request accounting, versus a later explicit account-wide baseline choice
after the required semantic and provider contracts are reviewed. Neither is
authorized by this documentation. Living semantic memory remains a later
independent layer, not the next implementation shortcut.

## Evidence and validation

- [PR #118](https://github.com/la4ox/liska-threadkeeper/pull/118) merged as
  [`4c3ba7e`](https://github.com/la4ox/liska-threadkeeper/commit/4c3ba7e28bcf50a2c011f4024beabfa41d3386e6)
  with exact reviewed head
  [`ee2e34a`](https://github.com/la4ox/liska-threadkeeper/commit/ee2e34adc2d125cba38a3e98c14e3e314f12b85c).
- [Journal attempt transitions at that main](https://github.com/la4ox/liska-threadkeeper/blob/4c3ba7e28bcf50a2c011f4024beabfa41d3386e6/src/resumability-journal/core/transitions.ts)
  reserve capture IDs and refuse `recorded` items;
  [snapshot outcome admission](https://github.com/la4ox/liska-threadkeeper/blob/4c3ba7e28bcf50a2c011f4024beabfa41d3386e6/src/resumability-journal/core/snapshot.ts)
  maps `confirmed` to `recorded`.
- [Catalog-to-journal admission at that main](https://github.com/la4ox/liska-threadkeeper/blob/4c3ba7e28bcf50a2c011f4024beabfa41d3386e6/src/resumability-journal/page/admission.ts)
  projects one identity per provider/conversation and retains the exact catalog
  digest, while [catalog entries](https://github.com/la4ox/liska-threadkeeper/blob/4c3ba7e28bcf50a2c011f4024beabfa41d3386e6/src/archive/catalog/contracts.ts)
  separately retain manifest length/digest and existing capture identity.
- [ADR-050](050-read-only-snapshot-catalog.md),
  [ADR-051](051-inert-resumability-journal.md) and
  [ADR-053](053-claude-terminal-list-observation.md) retain the accepted evidence
  and their non-authorizing limits;
  [ADR-043](043-snapshot-analysis-only.md) owns existing local verification.

This documentation-only boundary is checked with Idea-Threads validation,
documentation-link tests, changed-document formatting and `git diff --check`.
It adds no runtime behavior and performs no provider, browser or network action.
