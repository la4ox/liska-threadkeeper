# ADR-076: Inspect Claude list evidence through one bounded trusted probe

## Status

Accepted on 2026-11-18 for offline implementation and review. Native browser
execution remains a separate user-confirmed acceptance step. The probe observes
content-free active/archived list structure only; it does not enumerate a
durable baseline, capture conversation details or claim account completeness.

## Context

ADR-075 introduced an active-only, incomplete Claude account catalog from the
exact historical ADR-053 terminal-page evidence. A full current-personal-account
baseline still needs current facts about:

- active and archived list behavior;
- whether either partition reports another page;
- the actual continuation grammar and terminal behavior;
- current organization/workspace identity-header names;
- whether the selected visible page remains stable throughout the observation.

The old observation came from a page reload that emitted three requests before
the cap could stop them. Repeating UI gestures cannot enforce an emitted-request
budget. A new diagnostic therefore owns its exact requests directly.

Exact organization/workspace header spellings were deliberately not retained in
ADR-053. Guessing them from words such as `org`, `organization` or `workspace`
could turn unrelated count/combined headers into false identity evidence. This
first probe must collect candidate names only and leave scope unresolved.

## Decision

### Add one trusted popup action

Add `Inspect Claude lists` to the extension popup. Only a real trusted user
click can send the exact `probeClaudeLists` message. Startup, a synthetic click,
content scripts, copied popup URLs and unrelated extension pages cannot start
the probe.

The background accepts only the exact popup sender and the currently selected
top-frame URL matching `https://claude.ai/chat/{uuid}`. Existing `scripting` and
Claude host permissions are sufficient; the manifest receives no new
permission.

The popup and settings actions share busy state. Dots diagnostics, settings
save/test and Claude list inspection cannot overlap.

### Pin one document and one invocation

The background lifecycle is:

1. identify the exact selected Claude tab and route;
2. execute a no-request ISOLATED-world preflight and obtain its document ID;
3. bind one private invocation token;
4. execute the probe pinned to that exact document;
5. perform a pinned no-request postflight;
6. recheck selected tab/route and release the global lock.

A sticky `tabs.onUpdated` latch records any target-tab URL change, including an
A→B→A transition. Once the document ID is known, navigation sends a
document-pinned ISOLATED marker into the same world. The marker is bound to the
invocation token, latches navigation inside the running probe and aborts its
active fetch/body. The injected code checks that latch before every dispatch and
after every await. A bounded second marker attempt closes the marker-before-run
race.

The background may report its own timeout before a late `executeScript` settles,
but it keeps the global lock and marker listener until the underlying probe and
marker executions actually settle. Late rejection is consumed; a second run
cannot overlap the first.

### Count requests before serial dispatch

The hard total budget is four provider GET dispatches, concurrency one:

1. active, `offset=0`, `limit=30`, `consistency=strong`;
2. archived, `offset=0`, same grammar;
3. only when a first page reports `has_more=true`, one `offset=30`
   continuation hypothesis for that partition;
4. the equivalent hypothesis for the other partition only if budget remains.

`offset+30` is labelled a hypothesis, not an admitted pagination contract. If a
continuation still reports `has_more=true`, the result remains unfinished. A
short or terminal page does not prove account completeness.

Requests use same-origin credentials, no-store cache, redirect refusal, JSON
acceptance, one absolute deadline and a 512 KiB body ceiling. Every dispatch is
charged before fetch. There are no retries, compensation calls, detail requests,
downloads, provider mutations, list UI gestures, page reloads, scrolling,
attachment reads or fallback routes.

Any unread response body is aborted/cancelled on status, redirect, media,
navigation, size, deadline or schema failure. A fetch that settles after the
deadline is also cancelled.

### Keep scope evidence names-only

The injected function may return at most eight bounded lowercase header names
whose tokens look relevant to organization/workspace investigation. It never
reads or returns those header values for identity resolution in this version.

All four scope flags remain false and the fingerprint remains null. The probe
continues its bounded active/archived evidence collection under the single
page-derived route organization and finishes `scope-unresolved` unless an
independent error occurs. That outcome grants no catalog or baseline authority.

Later code may recognize exact identity-header schemas only after this live
diagnostic establishes their spellings and semantics. It must not default a
missing workspace to organization or personal scope.

### Return a closed content-free result

The result contains only:

- fixed schema/status/code values;
- dispatch, page, record, valid-UUID, marker, duplicate, overlap and archived-
  mismatch counts;
- per-page partition, offset, `hasMore` and terminal booleans;
- pagination exercised/hypothesis/unfinished flags;
- unresolved scope flags, null fingerprint and bounded relevant header names.

It excludes request URLs, conversation IDs, marker values, titles, summaries,
bodies, header values, account/organization/workspace values, arbitrary errors
and provider payloads. Background validates and detaches this exact shape before
the popup receives it.

## Compatibility and boundaries

ADR-053 and ADR-075 runtime boundaries remain unchanged: the new diagnostic does
not import the frozen update-discovery module or the baseline catalog. No
snapshot catalog, journal, owner, capture, export, destination, download,
storage, retry or scheduler path is reachable from the probe core.

The ordinary export-operation generation and messaging transport remain
unchanged. The probe has its own exact action validation and popup sender gate;
it cannot fabricate an export generation or write outputs.

## Rejected alternatives

- Reload Claude and observe incidental traffic: one gesture already emitted
  three requests and cannot enforce a budget.
- Open list/archived UI or scroll: couples evidence to changing UI behavior and
  can burst requests.
- Call the ordinary extractor: it can enter DOM fallback and detail-capture
  authority.
- Resolve scope from fuzzy header names: combined/count headers can falsely
  satisfy both axes.
- Return IDs or marker values for convenience: this diagnostic only establishes
  transport grammar and aggregate evidence.
- Release the lock on background timeout: a late injected function could overlap
  a second run.
- Reject only after A→B→A returns: the running request must be aborted and later
  dispatches prevented.
- Persist the result now: durable enumeration semantics depend on live evidence
  that this probe is designed to collect.

## Evidence and validation

- Focused tests cover trusted versus synthetic clicks, exact popup sender and
  message shapes, selected route/top frame/document pinning, global lock,
  absolute deadlines, serial cap-four dispatch, active/archived pages,
  continuation hypotheses, budget exhaustion, status/media/schema/body failures,
  unread-body cancellation and content-free validation.
- A controller-plus-injected regression performs A→B→A during the first pending
  fetch, proves its `AbortSignal` is aborted, proves fetch count remains one,
  observes `navigation-changed`, verifies marker-state cleanup and retains the
  lock through late marker settlement.
- Ambiguous combined/count/multiple header names remain names-only evidence;
  tests prove no header value read, scope resolution or fingerprint.
- The current parent focused/adjacent matrix passes 9 files / 304 tests. Full
  TypeScript, scoped zero-warning lint for the new modules, wiring lint with zero
  errors, Prettier and diff checks pass. Independent review found and closed
  timeout/lock, response-cancellation, fuzzy-scope and sticky-navigation gaps and
  now reports ready.
- Broader build/audit, production-marker scan, documentation validation and
  current-head GitHub gates remain for this branch.

## Next gate

After offline acceptance, reload the installed unpacked extension only after an
action-time confirmation, select the intended signed-in Claude chat and click
the trusted popup action once. Interpret the content-free result narrowly:

- admitted header names may inform the next exact scope contract;
- active/archived terminal pages may inform the enumeration source;
- any `has_more` chain is evidence only for the exact observed offsets;
- unresolved scope, budget exhaustion or any stop code prevents durable catalog
  admission.

No detail capture or File write occurs in that live gate.
