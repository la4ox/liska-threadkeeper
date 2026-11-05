# ADR-058: Isolate new-capture purpose and evidence before journal persistence

- Status: Accepted pure unwired semantic contract
- Date: 2026-11-06
- Base main: `b3ce405c74cdf03c228235fbe90350d1c9918ee4`
- Related: ADR-031, ADR-043, ADR-050, ADR-051, ADR-052, ADR-054, ADR-057, ITH-007

## Context

The rebuildable catalog and `liska-resumability-journal/1` are accepted inert
foundations. ADR-054 established that verification of preserved evidence is not
new capture work: journal v1 has no persisted purpose, a confirmed attempt makes
its item recorded, and generic typed evidence references do not prove that a new
capture was produced or durably delivered.

The existing ChatGPT destination receipt cannot fill that semantic gap by
reinterpretation. It is provider-specific and records a destination, capture ID,
legacy bare conversation digest, manifest digest, archive byte lengths and asset
descriptors. It does not bind operation and attempt identity, provider and
provider conversation identity, the versioned provider-aware conversation key,
catalog selection, purpose, declared completeness or the assurance basis for a
durable write. No existing receipt by itself is sufficient to settle new-capture
work.

The two current destinations also expose materially different assurance:

- File output can observe one terminal browser download and the exact requested
  relative path for each artifact. It does not read the downloaded bytes back.
- Obsidian output writes an exact artifact path and reads the body back through
  the Local REST API, comparing byte length and SHA-256.

Collapsing those facts into one generic "written" flag would overstate File
evidence or discard Obsidian's stronger readback evidence.

## Decision

### Add one explicit new-capture operation contract

Introduce the isolated schema `liska-new-capture-operation/1`. Admission requires
all of the following without inference or migration:

- exact purpose `new-capture`;
- immutable operation, attempt and reserved capture identities;
- provider, provider conversation ID and a structurally valid
  `liska-conversation-key/1:<sha256>` key;
- exact selected catalog SHA-256;
- a nonempty, duplicate-free all-of destination set in canonical order;
- the strict completeness policy
  `complete-graph-messages-branches-and-asset-inventory-all-assets-fetched-and-delivered/1`.

The contract validates the versioned key spelling but deliberately does not
claim to recompute its digest from provider identity. That derivation belongs to
the later reviewed producer/admission adapter.

### Assess detached evidence without settling work

Introduce `liska-new-capture-evidence/1` and a pure relation assessment with only
four outcomes:

- `consistent`: every supplied required identity, destination, commitment,
  completeness declaration and assurance relation is internally consistent;
- `insufficient`: required evidence is absent or explicitly incomplete;
- `conflict`: present valid evidence contradicts the operation or another
  required relation;
- `rejected`: operation/evidence data or configured limits are malformed or
  exceed the lowering-only hard bounds.

Every required destination must independently bind the full operation identity,
its own manifest and declared artifact inventory. File assurance is exactly
`browser-download-complete-path-confirmed`; Obsidian assurance is exactly
`byte-readback-sha256`. Neither assurance can substitute for the other. The
strict policy requires complete graph, message, branch and asset-inventory
declarations, every listed asset fetched, and every declared artifact delivered
under the destination's assurance.

Missing envelopes and optional sections remain representable so incomplete
evidence can be classified as `insufficient`. A present identity or artifact
commitment must be structurally exact; malformed partial records are rejected
rather than filled from another record.

### Keep the meaning of `consistent` deliberately narrow

`consistent` is not producer authentication, provider freshness, account
completeness, proof that bytes still exist, proof that manifest contents match
their digest, settlement, persistence, execution authority, dispatch authority
or retry authority. It is only a deterministic relation over detached supplied
data. File path confirmation remains explicitly weaker than byte readback.

Inputs are copied through bounded own-data descriptors, dangerous or accessor
properties are rejected without invocation, outputs are detached and deeply
frozen, and assessment codes are fixed and deterministically sorted. Transparent
Proxy behavior remains outside the own-data guarantee. Exceptions thrown during
Proxy or native inspection are normalized to fixed rejection codes.

### Leave journal v1 and production surfaces unchanged

The new module is pure and unwired. It has no browser, provider, clock, storage,
network, capture, archive, IndexedDB, UI, build-entry or scheduler capability.
There is no decoder, migration or persistence adapter. No runtime source imports
it, and `liska-resumability-journal/1` keeps its exact bytes and meaning.

This decision resolves the semantic shape of one future purpose; it does not yet
provide the persisted operation-purpose semantics required by ADR-054.

## Next gate

Before journal persistence or any baseline driver is considered, separately
review:

1. a producer/admission adapter that derives the provider-aware conversation key
   and emits these exact bindings and destination evidence from current capture
   receipts without overstating File assurance;
2. a persistence version that stores purpose and assessment evidence without
   changing journal v1 or allowing one purpose to consume another purpose's work;
3. sufficient provider scope, terminal traversal, marker and request-budget
   evidence under ADR-052/057;
4. the user's separate explicit account-wide baseline authority.

The scheduler remains a later decision after a resumable baseline. No provider,
browser or account-wide action is authorized by this ADR.

## Evidence and validation

- Source audit of `src/lib/chatgpt-archive-receipt.ts`, the ChatGPT destination
  receipt builder, File terminal-path confirmation and Obsidian verified writes
  on base main `b3ce405`.
- Pure contract implementation under `src/resumability-journal/purpose` with
  focused relation, malformed-data, bound and architecture tests.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  E18/E19/D12/T12 and the remaining persistence/provider/authority gates.

Targeted validation passes the purpose, architecture, existing journal-core and
IndexedDB suites at 4 files / 304 tests. The full coverage run passes 310 files
with one skipped and 11,213 tests with three skipped: 95.17% statements, 91.77%
branches, 98.27% functions and 97.41% lines. The new purpose module reports
98.35% statements, 96.56% branches, 100% functions and 99.66% lines.

Global TypeScript, full lint with zero errors and the unchanged 55 warnings,
full Prettier, Idea-Threads validation at 9 threads / 37 relations,
documentation links at 78/78, production dependency audit, guarded production
build/ZIP and independent review all pass. The production closure has zero
matches for both schema strings, the assessment function and the strict-policy
string. Generated `dist` remains 65 files / 6,078,286 bytes. The
2,789,703-byte candidate ZIP has SHA-256
`eac4275202139606a92b712aa0896561e514714985247d98cf672d8eee2ed1ff`.
