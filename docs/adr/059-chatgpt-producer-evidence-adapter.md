# ADR-059: Retain exact ChatGPT producer evidence before purpose persistence

- Status: Accepted additive producer evidence and unwired adapter
- Date: 2026-11-06
- Base main: `9a83e6d5b84df7f41dfd1fb547665f84db679a49`
- Related: ADR-031, ADR-043, ADR-050, ADR-051, ADR-054, ADR-058, ITH-004, ITH-007

## Context

ADR-058 defined exact `new-capture` operation and evidence relations but kept
them pure and unwired. The current ChatGPT producer already performed stronger
destination checks than its legacy receipt retained:

- File succeeded only after a terminal browser download and exact requested
  archive path match, without reading downloaded bytes back.
- Obsidian succeeded only after bounded binary readback, exact byte-length
  comparison and SHA-256 comparison.

Those sink facts were then collapsed into destination success plus optional
generic write accounting. The legacy `ChatGptDestinationArchiveReceipt` also
dropped raw/canonical hashes, non-fetched asset inventory, completeness and
operation/admission binding. Reinterpreting it as purpose-complete evidence
would invent facts.

Manual capture also allocates its capture ID during capture. It has no selected
catalog digest or journal attempt identity, so a completed manual export cannot
be assigned a pre-admitted purpose after the fact.

## Decision

### Preserve destination observations at the existing sinks

Add an optional exact sink observation to current archive and binary output
results:

- File records `browser-download-complete-path-confirmed` with the exact safe
  archive-relative path only after the identified download is terminal and the
  requested path matches. It never claims byte readback.
- Obsidian records `byte-readback-sha256` with the actually measured readback
  byte length and SHA-256 only after both match the expected commitment.

No new download, API call, readback, retry or permission is added. Existing
success/error behavior remains unchanged; the new field is additive.

### Add a factual producer receipt separate from the legacy receipt

Introduce `liska-chatgpt-producer-evidence/1`. One receipt represents one exact
destination and retains:

- provider, conversation and capture identity;
- the legacy routing digest as routing-only data;
- the original all-of requested destination set and this receipt's destination;
- optional intent supplied before any write;
- exact raw, manifest and canonical commitments;
- the exact destination manifest's completeness and complete asset inventory,
  including asset IDs, terminal states and commitments where available;
- exact raw, binary, manifest and canonical sink observations.

The existing legacy receipt and its consumers remain unchanged. Destination
manifests remain independent: File and Obsidian may legitimately retain
different manifest/canonical commitments after destination-specific asset
outcomes.

Raw observations are captured immediately after the earlier raw write and
cannot be reconstructed from later finalization. Binary results are detached and
frozen as soon as persistence returns. Both destination inventories are
reconciled before the first destination-builder await. Archive commitments are
snapshotted before dispatch and reused for confirmed, unknown and thrown paths.
These boundaries prevent late caller mutation from being promoted into producer
evidence.

### Adapt only an explicit pre-admitted operation

Add the pure, unwired `adaptChatGptProducerEvidence` adapter. It accepts an
already admitted operation, up to two factual receipts and an injected SHA-256
capability. Before relation assessment it independently verifies:

1. the catalog identity key as
   `SHA256(UTF8(JSON.stringify(['liska-conversation-key/1', provider, conversationId])))`;
2. the legacy routing digest as `SHA256(UTF8(conversationId))`.

The two digests are never substituted, prefixed or inferred from each other.
Every receipt must match the reserved capture, operation, attempt, catalog,
provider, conversation and required destination set. The adapter then projects
the destination-specific factual receipt into the ADR-058 relation contract.

A receipt without pre-write intent remains factual but cannot produce a
purpose-complete binding. Manual and legacy captures therefore assess as
insufficient or unsupported, never consistent. `consistent` remains only an
internal relation over detached supplied facts; it is not producer
authentication, persistence, settlement or current durability proof.

## Boundaries

- The adapter has no production/runtime consumer, browser or storage capability.
- Journal v1, journal transitions, IndexedDB, catalog schema and UI are
  unchanged.
- No account enumeration, provider discovery, baseline execution, scheduling,
  settlement or retry authority is added.
- Ordinary manual export behavior remains valid and gains factual receipts only;
  it does not gain an operation/attempt/catalog binding.
- Operation write accounting remains accounting and is not repurposed as
  provenance evidence.

## Next gate

Design a separate admission/execution handoff that selects an exact catalog,
creates the new operation and attempt, reserves the capture ID before the
provider request and passes that immutable intent into the existing capture
producer. Only after that handoff is accepted may a new purpose-aware persistence
version store an assessment or drive settlement. Journal v1 remains unchanged.

Provider scope, terminal traversal, marker behavior, request budgeting and the
user's explicit account-wide baseline decision remain separate gates. A daily
scheduler remains later still.

## Evidence and validation

- Exact sink observations are implemented on the existing inline/staged archive
  and binary File/Obsidian paths and exercised through synthetic Chrome and
  Obsidian endpoints; no live provider action was needed.
- The integration suite traverses current persistence, binary staging,
  destination finalization, factual receipt construction and the unwired
  adapter, including all-destination success, partial and failed assets, missing
  raw evidence, distinct destination manifests, destination failure, manual and
  legacy insufficiency, identity/commitment conflicts and late mutation.
- Focused parent validation passes 12 files / 424 tests. The full coverage run
  passes 311 files with one skipped and 11,268 tests with three skipped: 95.18%
  statements, 91.81% branches, 98.31% functions and 97.42% lines.
- Global TypeScript, full lint with zero errors and the unchanged 55 warnings,
  full Prettier, Idea-Threads validation at 9 threads / 37 relations,
  documentation links at 79/79, production dependency audit with zero
  vulnerabilities and the guarded production build/ZIP pass.
- Independent review found one async snapshot P2; pre-await archive and binary
  snapshots plus regression tests resolved it. Delta review reports ready with
  no material finding.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  E20/E21/D13/T13 and the remaining admission/persistence/provider authority
  gates.

The production closure intentionally contains the factual producer schema in
one content bundle and the two sink-assurance markers in the content and service
worker bundles. It contains zero matches for `adaptChatGptProducerEvidence` and
both ADR-058 purpose schema strings, proving that the adapter and purpose
assessment remain unwired. Generated `dist` is 65 files / 6,086,099 bytes. The
2,791,772-byte candidate ZIP has SHA-256
`9408a5a82fd3552d74563cd7a105de025167d804633c78711867693f6ece9acd`.

Current-head GitHub CI, Code Review and Security Review remain acceptance gates
for this branch.
