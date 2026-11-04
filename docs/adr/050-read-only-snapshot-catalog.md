# ADR-050: Rebuildable manifest catalog before baseline automation

- Status: Accepted; implemented and installed-live verified
- Date: 2026-11-04
- Related: ADR-031, ADR-043, ITH-003, ITH-005, ITH-006, ITH-007

## Context

Liska already writes immutable capture directories containing a provider-neutral
`liska-capture/1` manifest, raw artifacts, optional fetched assets and an
optional canonical archive. It can also compare a small explicit set of
ChatGPT snapshots by reading and hashing every selected byte. Neither facility
is a local archive catalog: the writer receipts are operation evidence, while
the analyzer is pair-oriented, current-writer/ChatGPT-specific and deliberately
bounded to sixteen complete byte inventories.

The later backup roadmap needs to know which snapshots already exist before it
can plan a slow baseline. That inventory must not silently acquire filesystem,
provider, scheduler or mutation authority, and it must not describe declared
manifest metadata as independently verified bytes.

## Decision

The first backup-foundation slice is a separate pure manifest catalog plus one
extension-owned page.

1. A user explicitly selects one local archive root through a trusted directory
   picker. Liska receives only that native `FileList`; it does not remember a
   directory handle, scan outside the selection or open any provider page.
2. The page snapshots safe relative paths and byte lengths for every selected
   file before its first await. It binds and reads only files named
   `manifest.json`. Raw responses, canonical JSON, assets and presentation files
   are never read or hashed by this slice.
3. A new browser-independent catalog API accepts detached selected-file
   metadata plus detached manifest bytes. It has no file reader, browser,
   storage, clock, network, destination or mutation capability.
4. Every entry distinguishes manifest validity, completeness declared inside
   that manifest, metadata-only presence and declared-size agreement for
   selected artifacts/assets, and metadata-only presence of
   `canonical/liska-thread-1.json`, whose content and integrity remain
   unverified.
5. The catalog retains provider, provider conversation ID, capture ID/time,
   capture method, exact manifest digest/length, fixed aggregate facts and fixed
   issue codes. It excludes titles, message text, free-form warnings,
   endpoints, source pointers, URLs, transport values, filenames, root-relative
   locators and native exception prose.
6. A versioned conversation grouping key hashes an unambiguous encoding of
   `(provider, conversationId)`. The hash provides namespacing, not anonymity.
   Stable provider identifiers remain in the private catalog because later
   explicit work admission requires them. Legacy manifests have no account
   binding, so the catalog makes no account-completeness claim.
7. Identical manifest copies may collapse only with an explicit occurrence
   count and compatible metadata facts. Distinct manifests for the same
   provider/conversation/capture identity remain separate and receive a visible
   conflict code. No entry is last-write-wins and no existing directory is
   renamed.
8. Ordering and JSON encoding are deterministic and contain no scan timestamp.
   The same selected evidence produces identical bytes regardless of picker
   order. Source-relative locators exist only in page-owned session state and
   are absent from the encoded catalog.
9. The catalog remains in memory until a fresh trusted click explicitly saves
   `liska-snapshot-catalog.json`. Browser terminal success, failure and unknown
   outcomes remain distinct and never trigger an automatic retry. The UI warns
   that identifiers are private, hashing is not anonymization and source files
   are unchanged.

## Authority boundary

This catalog is metadata-only inventory evidence. It is not raw/canonical/asset
integrity verification, proof that a declared-complete capture is recoverable,
proof that all local or provider conversations were selected, a persistent
archive database, admission to recapture a conversation, a provider list,
update marker, baseline runner, daily scheduler or mutation authority.

The existing exact-byte snapshot analyzer remains unchanged for its stronger,
smaller comparison contract.

## Limits

The pure core hard ceilings are 100,000 selected file descriptors, 10,000
manifests, 1 MiB per manifest, 64 MiB of manifest bytes, 1,024 path code units,
10,000 records per manifest, 100,000 records total, bounded strict-JSON and hash
work, and 16 MiB encoded output. Callers may lower but never raise them.

The installed page deliberately lowers that boundary to 4,096 selected files,
128 manifests, 256 KiB per manifest, 8 MiB of manifest bytes, 512-character
paths, 1 TiB metadata per file, 8 TiB selected metadata total and 1 MiB output.
Selected-file byte lengths are metadata only; raw/canonical/asset bodies remain
unread.

## Next slices

A later resumability slice may add a dedicated extension-origin journal for
explicitly admitted work. It must commit attempt intent before any side effect,
recover an interrupted `running` attempt as `unknown`, reject stale callbacks,
restart paused and retain no conversation bodies or transport secrets. The
journal is not the backup and cannot claim an account baseline without a
reviewed provider enumeration adapter.

Provider enumeration and update detection are separate capabilities. No current
provider adapter proves both. One provider contract must first establish exact
account/workspace binding, pagination termination, reorder/duplicate behavior,
cursor expiry, inaccessible/deleted visibility, rate-limit semantics and what
its change marker covers. Account-wide execution and a scheduler remain disabled
until the user separately authorizes them.

## Acceptance gates

1. Pure contract tests cover picker-order determinism, cross-provider ID
   collisions, identical copies, conflicting capture identities, malformed and
   unsupported manifests, missing/size-mismatched/extra files, canonical
   presence and every independent limit.
2. Input admission snapshots plain own data, detached native bytes and an
   isolated hash capability; observable accessors/exotic receivers fail closed.
   Portable JavaScript cannot identify a fully transparent Proxy and does not
   claim to do so.
3. Architecture tests prove that the core and page have no provider capture,
   runtime messaging, network, storage, destination write or source-mutation
   path, and that non-manifest `File.arrayBuffer()` is never called.
4. The page proves whole-selection preflight before sequential manifest reads,
   honest progress/cancellation, stale-result rejection and exact terminal
   download states without retry.
5. Installed acceptance selects a real archive root, rebuilds and saves the
   catalog, independently confirms deterministic bytes and verifies that every
   selected source file remains unchanged.

## Installed acceptance

Installed Comet selected the real `D:\Downloads\_liska-archive` root containing
495 files / 858,148,168 bytes and 121 exact lowercase manifests / 1,360,745
manifest bytes. The page rendered 121 unique valid manifest entries and four
unassociated selected files, then saved a 128,309-byte private JSON catalog with
SHA-256 `f3dc0fe282bc8957bb8a8c2c24d42e925a7323b47f266fbdc4405e97707b1f64`.

An independent Node oracle re-enumerated the root, read only those 121 manifest
bodies, rebuilt the catalog through the production core and matched the saved
bytes exactly. The encoded catalog contained no locator/content keys checked by
the acceptance. A complete pre/post content inventory of all 495 selected
source files retained the same aggregate SHA-256
`f5faaab3c0521655d09d770685447f78711e3b4dd3edd86539979b8766a26006`;
count and total bytes also remained unchanged.
