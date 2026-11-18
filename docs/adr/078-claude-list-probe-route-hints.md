# ADR-078: Resolve Claude list routing from exact non-secret page hints

## Status

Accepted on 2026-11-18 after the first installed v2 probe passed reply-
verification admission but stopped before network because no organization route
could be resolved from current resource timing. V3 remains unexecuted live
pending review and a new action-time confirmation.

## Context

The reviewed v2 build was installed with exact file-hash reconciliation and run
once from the same clean selected Claude chat. It returned:

```text
status              = stopped
code                = route-organization-unresolved
GETs                = 0
pages               = 0
records             = 0
scope               = unresolved
verificationPresent = true
```

No provider request or output occurred. The result proved that v2 correctly
continued past the verification banner and then failed closed at the next
missing prerequisite.

Resource timing is ephemeral and can be empty after extension or browser
reload. The accepted ordinary Claude detail path already uses two additional
non-secret current-page hints: an exact verification link bound to the current
conversation and the exact named `ccd-sync-org` storage key.

Raw organization IDs remain routing inputs inside the provider page. They need
not cross the injected boundary. Conflicting hints must stop before request.

## Decision

### Version the route-evidence result as `/3`

Change the exact result schema to `liska-claude-list-probe/3` and add one
mandatory closed `routeOrganizationEvidence` field:

- `resource-timing`;
- `verification-link`;
- `named-storage`;
- `multiple-consistent`;
- `unresolved`.

The validator rejects `/1`, `/2`, missing or foreign evidence values, mixed
shapes and extra keys. Popup output includes the localized route-evidence class.
No raw route value is returned.

### Reconcile three exact in-page sources

The self-contained ISOLATED-world resolver may collect:

1. bounded recent resource entries matching only the exact Claude organization
   list route or exact current-conversation detail route;
2. an exact `https://portal.anthropic.com/verify` link whose
   `return_to=claude`, `return_path` equals the selected current chat and `org`
   is one canonical UUID;
3. exactly one `localStorage.getItem('ccd-sync-org')` value matching the same
   canonical UUID policy.

The resolver never enumerates storage, reads another key or imports the ordinary
extractor at runtime.

Every authority-bearing verification-link query key (`org`, `return_to`,
`return_path`) must occur exactly once. Duplicate values are rejected even when
identical; missing, malformed, wrong-origin and wrong-route links add no hint.

All available accepted hints are collected without source precedence:

- one unique ID permits requests;
- multiple agreeing source classes report `multiple-consistent`;
- conflicting IDs or no accepted source report `unresolved` and zero requests.

### Preserve every v2 boundary

The route source changes no scope meaning. Organization/workspace scope remains
names-only unresolved, all scope flags false and fingerprint null. Verification
stays a boolean observation. `401`/`403`, cap four, deadlines, response
cancellation, document/invocation pinning, sticky navigation abort, lock
ownership and content-free output remain unchanged.

## Compatibility and boundaries

Only the probe contract/implementation, popup/locales and focused tests change.
Manifest, messaging, service-worker dispatch, baseline catalog, ADR-053,
provider owner, capture/export/destination and scheduler paths remain unchanged.

The v1 and v2 live receipts remain local immutable provenance and are rejected
as producer result schemas by v3.

## Rejected alternatives

- Reload Claude to repopulate resource timing: reloads can emit uncontrolled
  requests and would defeat the bounded probe.
- Default to a visible account or URL UUID: conversation identity is not an
  organization route.
- Read all storage keys: the accepted helper needs one exact named non-secret
  route hint only.
- Prefer one source when another disagrees: conflicts are evidence to stop.
- Accept duplicate query parameters by taking the first value: hidden ambiguity
  could authorize a foreign route.
- Return the organization ID for debugging: the aggregate result needs only the
  evidence class.

## Evidence and validation

- Local receipt `LISKA-CLAUDE-LIST-PROBE-V2-ROUTE-UNRESOLVED-20261118` retains
  only reviewed head, v2 schema, fixed stop code, zero counts, unresolved scope
  and verification presence.
- Tests cover resource-only, verification-link-only, storage-only and agreeing-
  source success; conflicting sources and no source stop before fetch.
- Storage tests prove exactly one named `getItem` and no enumeration or unrelated
  key access.
- Verification-link tests cover exact admission plus malformed, wrong origin,
  wrong route, missing `org` and duplicate `org`/`return_to`/`return_path`
  rejection, including identical duplicate values.
- Privacy tests prove raw organization IDs never enter the detached result.
- The current parent focused/adjacent matrix passes 9 files / 326 tests. Full
  TypeScript, strict probe lint, wiring lint, Prettier and diff checks pass.
  Independent review found and closed duplicate-query ambiguity and reports
  ready.
- Broader build/audit, documentation validation and current-head GitHub gates
  remain for this branch.

## Next gate

After merge, install the reviewed v3 build from exact `dist`, retain the previous
installed build as rollback, and run one newly confirmed trusted probe from the
same clean selected Claude chat. Any unresolved/conflicting route evidence still
stops before network. If route evidence resolves, the result may finally contain
active/archived page counts and candidate header names, but scope and baseline
admission remain separate later decisions.
