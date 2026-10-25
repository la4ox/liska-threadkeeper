# ADR-040: Atomic Obsidian reconciliation snapshots

## Status

Candidate. The direct extension-page writer and synthetic fault matrix are
implemented on top of ADR-039. The installed Obsidian Local REST API has been
updated to 5.5.2, and the production-core writer now has live positive,
create-only collision, readback and cancellation evidence.

## Context

ADR-039 creates an ordered immutable reconciliation delivery in memory and can
save it as one File ZIP. Obsidian should retain the same individual artifacts so
they remain inspectable and independently hashable, with the root manifest as a
completion record written only after every payload is verified.

The inherited archive writer performs GET-absence followed by unconditional
PUT. That refuses ordinary existing targets but cannot prove no-overwrite under
a concurrent writer. Obsidian Local REST API 5.5.0 added conditional writes:
`If-None-Match: *` makes PUT create-only, and a failed precondition returns 412
without writing. Earlier versions do not establish this property. See the
[official 5.5.0 release](https://github.com/coddingtonbear/obsidian-local-rest-api/releases/tag/5.5.0)
and [interactive API documentation](https://coddingtonbear.github.io/obsidian-local-rest-api/).

Sending up to 256 MiB through extension messaging would also cross the existing
message ceiling and add service-worker lifetime/staging complexity. The explicit
reconciliation page already owns the exact bytes and is the narrowest trusted
context for direct loopback delivery.

## Decision

1. Obsidian is a separate explicit destination on the reconciliation page and
   is off by default. Selecting files never contacts Obsidian. One trusted run
   prepares the bundle, then only a selected Obsidian destination reads strict
   stored settings and begins local delivery.
2. The page uses `getSettingsOrThrow`; it never receives settings from content
   scripts or sends the API key through runtime messages. URL validation admits
   only HTTP(S) with exact host `127.0.0.1`, no URL credentials, and a valid
   port. Requests omit ambient credentials and reject redirects.
3. An authenticated, bounded `GET /` must return the exact service identity,
   `authenticated: true`, and stable numeric `versions.self >= 5.5.0`. A 5.1.x,
   prerelease, malformed, oversized, unauthenticated, redirected, or unavailable
   response refuses the destination before any artifact-path request.
4. Every explicit run receives a fresh portable attempt ID. Paths are resolved
   once from the pinned operation timestamp and settings snapshot:
   `<vault template>/_liska-reconciliation/<conversationKey>/<bundleId>/<attemptId>/<fixed artifact path>`.
   No title, source filename/path, provider ID, or mutable setting enters routing.
5. Before the first write, the writer detaches and validates the complete
   normalized five-artifact or raw-only three-artifact delivery: fixed order and
   paths, root last, exact byte lengths/hashes, aggregate ceilings, bundle/root
   hash agreement, and exact root-manifest descriptors. Every target receives a
   redirect-refusing binary existence check whose response body is cancelled;
   any occupied target refuses all writes.
6. Artifacts are written sequentially with exact owned bytes and
   `If-None-Match: *`. A 412 is an atomic collision refusal, never an unknown
   successful write. Each accepted PUT is immediately read back through a
   redirect-refusing bounded binary reader and verified by exact length/SHA-256
   before its successor. The unchanged root manifest is dispatched last.
7. Receipts expose only fixed relative paths, opaque identities, durable state
   (`not-dispatched`, `unknown`, `confirmed`), and fixed failure codes. API key,
   loopback URL, vault folder, exception prose, and private payload values never
   enter the result.
8. A thrown/timeout PUT or failed/missing/mismatching readback leaves the current
   artifact `unknown`, stops every successor, and never retries or deletes.
   Earlier confirmed files remain. Root absence means incomplete; uncertainty
   after the final root PUT/readback is still partial, not committed success.
9. Cancellation is checked before and after server admission, each preflight,
   each write, and each readback. It stops future calls but cannot erase a write
   already accepted by Obsidian. The page must remain open; no background-
   survival or rollback claim is made.
10. File ZIP and Obsidian results remain destination-independent. When both are
    selected, one may be verified while the other is refused or unknown; the UI
    reports partial success rather than collapsing them into one boolean.

## Compatibility

Existing Obsidian methods, capture companion routes, ordinary Markdown append,
service-worker sender admission, and output settings retain their behavior. New
client methods are additive: bounded authenticated server versions, zero-body
existence checks, create-only binary PUT, and bounded binary readback. No new
browser permission, host, remote origin, or stored secret is introduced.

## Verification evidence

Tests cover strict root version/auth/service shape and byte cap; stable 5.5+
admission; 5.1/5.4/prerelease/malformed refusal before path access; exact
conditional headers, bodies, path encoding, timeout and 412 behavior;
redirect-refusing zero-allocation preflight; bounded readback; normalized/raw-
only order; all-target preflight before writes; exact bytes and root-last
readback; collisions; uncertainty at every PUT/readback position including the
root; cancellation before and between artifacts; pinned dates/settings/bytes;
malformed delivery/settings/limits; hostile accessors/proxies/hashes; duplicate
root keys; and absence of credentials, URL, vault path, or private text from
receipts.

Before the update, the installed unauthenticated root reported service
`Obsidian Local REST API`, self version `5.1.0`, and Obsidian `1.14.4`; the new
writer correctly refused it before any vault path was read or written. After
the update, both public and authenticated root reads reported self `5.5.2`, and
the authenticated response was admitted.

An exact-head local production-core canary used the same measured web canonical
and 109,346,038-byte official source as ADR-039. The real API confirmed a
normalized five-artifact snapshot totaling 2,516,236 bytes. Independent
filesystem verification matched all descriptor lengths and SHA-256 values, the
official source slice, canonical/comparison schemas, root hash/bundle ID and
root-last timestamp. A deliberate live race made preflight report absent while
the first conditional PUT targeted that existing snapshot; Local REST API
returned 412, Liska reported `collision`, issued no readback or successor write,
and left the original bytes unchanged. Cancellation after authenticated server
admission stopped before any artifact-path request and created no attempt
directory.

The exact extension build and reconciliation page were reloaded in Comet. The
browser controller cannot acquire `chrome-extension://`, so this evidence does
not claim a repeated native file-picker/result-rendering or mid-request page-
unload run. Those bindings remain covered by the integrated page tests; the
live claim is deliberately limited to preparation, writer, real server,
readback, atomic 412 and cancellation semantics.

## Follow-up

Keep Obsidian off by default. A future user-driven extension-page run may add
native file-picker/result-rendering and actual page-unload evidence, but must not
weaken or replace the verified direct writer contract. Revisit background
survival only as a separate design; this slice intentionally requires the page
to remain open.
