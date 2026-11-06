# ADR-060: Prepare catalog-bound ChatGPT capture before the provider request

- Status: Accepted pure admission and unwired single-capture executor
- Date: 2026-11-06
- Base main: `b3f6c9deba1781c0ba235f48177e6ef2a7aa5b2e`
- Related: ADR-050, ADR-051, ADR-054, ADR-058, ADR-059, ITH-007

## Context

ADR-059 preserves exact destination evidence and can adapt it to the ADR-058
purpose contract when an immutable operation intent already existed before the
write. The ordinary ChatGPT capture path did not provide that ordering: it
requested provider data first and allocated its capture ID later while building
the manifest.

A future baseline must instead select exact catalog evidence, create operation
and attempt identity and reserve a capture ID before the provider request. The
handoff must then reach the real capture and producer without silently falling
back to runtime messaging or generating a replacement identity.

Journal v1 cannot own this handoff. Its dispatch token is a revision fence over
run/item/attempt/capture fields and explicitly requires persistence before
dispatch, but it has no purpose, operation identity, catalog binding or required
destination set. Deriving new semantics from `runId` or `itemId` would invent
authority and would still not prove durable reservation.

## Decision

### Share exact canonical catalog admission

Extract the existing data-only catalog admission into
`src/archive/catalog/admission.ts`. The private journal page keeps the same
public `admitCatalog` behavior and File/crypto helpers, while the shared core:

- copies and bounds the selected bytes;
- requires the current strict encoder to reproduce those bytes exactly;
- projects only valid provider/conversation/versioned-key identities;
- hashes the exact canonical bytes through an injected capability.

The exact provider-aware key input also becomes one shared pure recipe used by
catalog construction, producer adaptation and the new handoff. The legacy
`SHA256(conversationId)` routing digest remains separate.

### Prepare one immutable ChatGPT operation before effects

`prepareChatGptNewCapture` accepts exact canonical catalog bytes, an explicitly
selected full identity triple, operation/attempt/reserved-capture IDs, a
nonempty required destination set and injected hash/cancellation dependencies.
Before returning it:

1. snapshots caller-owned bytes, request data and dependency references before
   the first await;
2. validates the strict ChatGPT conversation and capture-ID contracts;
3. admits and hashes the exact canonical catalog;
4. requires exact full-triple membership for the ChatGPT selection;
5. independently verifies the provider-aware key recipe;
6. builds the ADR-058 operation and derives the producer intent from that one
   admitted operation;
7. returns the deeply frozen pair.

The injected hash receives an owned byte copy. Mutation, throwing, invalid
digests and cancellation fail before capture. A final synchronous cancellation
check after the last awaited key hash closes the microtask window before the
sole successful return.

This object reserves identity within one immutable handoff. It does not prove
global uniqueness, durable persistence or dispatch authority.

### Execute only the prepared single capture

`capturePreparedChatGpt` is an unwired effectful executor, distinct from pure
admission. It requires an injected request function and accepts only an optional
clock; callers cannot supply a replacement normalizer, ID allocator, resolver
observer or default runtime bridge.

Immediately before the request it re-admits and compares the frozen operation
and intent, independently verifies the provider-aware key and captures the
dependency references. It calls the real `captureChatGptArchive` and passes a
closure returning the reserved capture ID. The real normalizer and inventory
remain in use. The result must retain the selected provider/conversation and
reserved ID across manifest, companion, archive and asset-export context.

The wrapper performs one request, adds no retry or cleanup, writes no destination
and returns the original immutable operation/intent alongside the capture. It
does not assess, persist or settle anything. Ordinary manual capture remains
unchanged.

## Honest completeness boundary

The real current ChatGPT inventory records asset discovery as
`not-attempted`, including a zero-asset capture. Therefore the full offline
catalog-admission → real capture/normalizer → factual producer receipt → adapter
integration correctly assesses `insufficient` with incomplete asset inventory.
This PR proves exact identity transfer and effect ordering; it does not
manufacture strict completeness.

## Boundaries

- `JournalDispatchToken`, journal v1, core transitions and IndexedDB are
  unchanged and unused.
- The handoff and executor have no production entrypoint, page, extractor, UI,
  background, build or manifest consumer.
- No live provider request, destination write, account discovery, baseline,
  scheduler, settlement or retry authority is added.
- The executor is not capability-free: it can run the injected single capture
  and preserve existing staged cleanup. Pure admission and effectful execution
  remain separate modules.
- The operation/intent reservation is not durable and cannot survive a restart
  as dispatch authority.

## Next gate

Design a new purpose-aware persistence version that atomically records purpose,
operation, attempt, reserved capture and catalog identity before any dispatch.
It must define current-token validation after pause/restart, crash and retry
semantics, and storage of assessments without turning `consistent` directly
into automatic settlement. Journal v1 remains readable and unchanged.

Provider scope, terminal traversal, marker behavior, request budgeting and the
user's explicit account-wide baseline decision remain later gates. The daily
scheduler remains separate still.

## Evidence and validation

- Focused parent validation passes 13 files / 433 tests, including exact catalog
  admission/page compatibility, purpose and producer contracts, real manual and
  staged ChatGPT capture, the full offline handoff integration and architecture
  closure. The full coverage run passes 312 files with one skipped and 11,310
  tests with three skipped: 95.19% statements, 91.82% branches, 98.31%
  functions and 97.43% lines. The new handoff module reports 98.11% statements,
  97.43% branches, 100% functions and 98.03% lines.
- Global TypeScript, full lint with zero errors and the unchanged 55 warnings,
  full Prettier, Idea-Threads validation at 9 threads / 37 relations,
  documentation links at 80/80, production dependency audit with zero
  vulnerabilities and the guarded production build/ZIP pass.
- Independent review found one late-cancellation microtask P2. A final
  post-hash signal check and real prepare-to-executor zero-request regression
  resolved it; delta review reports ready.
- The integration test uses the real catalog admission, capture, normalizer,
  factual receipt producer and adapter with synthetic provider/sink
  dependencies. It makes no live account request.
- [ITH-007](../idea-threads/ITH-007-update-driven-backup-and-memory.md) preserves
  E22/E23/D14/T14 and the remaining persistence/provider/baseline authority
  gates.

The production closure contains zero matches for the admission, executor and
prepared-handoff symbols, the handoff path and the ADR-058 operation schema.
Generated `dist` is 65 files / 6,086,237 bytes. The 2,791,807-byte candidate ZIP
has SHA-256
`ade0dd52169c1e4aeadbd0f7f812102ab4c2242046d0d98ccc6b4dd7a721b7cc`.

Current-head GitHub CI, Code Review and Security Review remain acceptance gates
for this branch.
