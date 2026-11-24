# ADR-083: One explicit Claude personal-context collection into the paused owner

Status: implemented; reviewed-install and live acceptance pending.

## Decision

**Collect Claude backup catalog** is a separate Archive Tools action. The one
trusted click asserts that the currently visible Claude chat is the intended
personal context. It is neither proof of identity nor a stored preference.
There is no new manifest permission, separate extension page, offscreen worker,
scheduler, detail read or download. The unchanged [diagnostic /5](080-claude-list-probe-v5-header-pair-observation.md)
still cannot return a catalog. Ordinary exports, snapshot catalog and journal
are not consumers.

During the trusted click the exact popup queries its active tab. It sends only
the action and a closed, ephemeral source: tab ID, window ID and exact chat
URL. If the popup closes before selection resolves, nothing is sent. The
worker installs listeners and compares the live selection against that source;
it cannot choose a replacement. A changed tab or route stops before owner
preflight or network. The source is not a scope or a catalog. A dedicated
response path rejects extra fields, including other workflows' transport
tags. Closing the popup after dispatch does not cancel collection.

One operation set excludes overlapping /5 and /6. Pin the top-frame document,
latch tab navigation/activation and focus loss, then recheck selection, URL
and pin around each handoff. The click binds a route, not a pre-existing
document ID or unseen navigation history before listener installation. A token-owned
marker cancels outstanding page work even if the URL returns to its origin.
Fail closed on a missing lifecycle API, source change, late result or
non-confirmed owner state. Only one valid top-frame result with a document ID
different from the existing pin establishes `document-replaced`.
`source-verification-unavailable` means the worker or isolated page could not
verify the source: examples include no focused window, a failed pinned RPC, a
hidden document, and missing or foreign token state. Hiding the page during a
body read cancels that read; becoming visible again does not undo the stop.
The token-owned signal carries its first reason, so a deadline or verification
stop never sets a navigation flag. Only an observed URL mismatch or a sticky
navigation signal for this invocation establishes page-side `navigation-changed`.
Both boundaries allow only the legal dispatch/page stages 0/0, 1/0, 1/1, 2/1
and 2/2. After confirmed commit the owner retention remains confirmed and an
unavailable final check is reported separately.

1. Open and read the [ADR-082 owner](082-claude-account-baseline-owner-v1.md).
   A previously seeded, corrupt, incompatible or unreadable owner stops the
   action before either list request. Never clear or rebind it.
2. Reconcile only the three [existing exact route hints](078-claude-list-probe-route-hints.md).
   In one isolated invocation issue active, then archived, limit 30, offset
   zero, strong consistency. Same-origin credentialed GET; reject redirect,
   non-200, non-JSON, over 512 KiB, invalid UTF-8 or JSON. Require exact route
   organization and project workspace envelope on both replies, and compare
   the actual pair including on the empty archive. Require a terminal active
   page of unique lowercase IDs with false archived flags and optional
   bounded markers. The clicked chat UUID must occur in that active page.
   Otherwise stop with `selected-chat-not-in-active-list`: no archive request,
   hash or write. Require a terminal empty archive. Never follow continuation.
3. Strip titles, conversation content and all unrelated fields in the page.
   Only the private minimal projection crosses the pinned scripting return.
   Snapshot it, add the fixed manual assertion, and run [ADR-081 admission](081-claude-account-catalog-admission.md)
   with extension-origin UTF-8/SHA-256. One 20-second absolute deadline covers
   preflight, both requests and body reads, admission and owner creation.
   An expired or interrupted hash cannot hand off. Request native cancellation
   at that deadline; pending native terminal settlement can outlast it. Use a
   fresh 128-bit random collection label once. No automatic retry.
4. Only native complete (created or exact already-created for this invocation)
   confirms retention. Native abort, conflict and unknown are not success.
   If complete wins cancellation, retain that truth with a fixed **stopped**
   code; normal **saved** also requires final context and deadline checks.
   Only observed context change maps to `committed-context-changed`. A deadline
   during verification or handle close maps to `committed-verification-deadline`;
   a missing document, browser/API failure or rejected close maps to
   `committed-verification-unavailable`. Neither says the write was late or lost.
   Pending work and cancellation
   keep the lock until settled.

## Evidence and limits

The public schema is `liska-claude-account-collector/6`: fixed status/code,
confirmed dispatch/page/target/marker counts, terminal active, terminal-empty
archive, pair matched, retention, and constant false completeness/execution
and zero detail/download counts. Counts indicate evidence received from the
pinned page; if a result is lost, zero confirmed counts need not mean zero
attempted reads. An already-seeded stop confirms no new write by this click.
Only the request carries the clicked source. No URL or identifier, raw
scope pair, target/marker, digest, collection label, error prose or owner
envelope reaches the public response, UI or logs. The source is not stored;
the conversation ID can appear in the paused owner only as an independently
observed active target. Both response validators enforce the same exhaustive
code/stage table; a transport failure cannot claim two completed pages.
The sole durable inventory is the canonical paused owner envelope.

[Synthetic controller and page tests](../../test/background/claude-account-collector.test.ts)
exercise collection, private projection, native-owner contract and lifecycle
without provider access. The production build also extracts and runs the
**emitted** isolated function with two synthetic responses and no browser or
network. This is not installed evidence or a live backup.

The user has authorized the full current-personal Claude backup. T33 remains
open: exact-head CI, Code and Security Review, reconcile the installed build,
then one informed current-personal click that commits a real catalog. Only
then consider a separately reviewed owner-bound detail/File capture, followed
by bounded manual batches. Catalog retention is not delivery, authority to
resume, or proof that the account is complete.
