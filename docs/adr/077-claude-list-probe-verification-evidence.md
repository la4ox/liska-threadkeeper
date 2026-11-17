# ADR-077: Treat Claude reply verification as list-probe evidence, not identity

## Status

Accepted on 2026-11-18 after the first installed ADR-076 probe stopped before
network dispatch on the visible Anthropic verification banner. The corrected v2
contract remains unexecuted live pending review and a new action-time approval.

## Context

The reviewed `liska-claude-list-probe/1` build was installed from the exact
current `dist`, after retaining the prior installed build as a recoverable local
backup. One trusted click on a clean selected Claude `/chat/{uuid}` route
returned:

```text
status  = stopped
code    = auth-verification-required
GETs    = 0
pages   = 0
records = 0
scope   = unresolved
```

No provider request, detail capture, download or persistent write occurred.
This is useful lifecycle evidence: the trusted-click, exact popup sender,
selected route, installed build and pre-request stop all worked.

ADR-053 already observed that the same class of verification banner prevented
new Claude replies but did not prevent existing list reads. The banner therefore
does not by itself prove a list authentication failure. Actual `401`/`403`
responses remain the transport evidence for that stop.

Silently changing the already executed `/1` result shape would erase provenance.
The corrected contract must be a new version.

## Decision

### Version the corrected result as `/2`

Change the producer and exact validator to
`liska-claude-list-probe/2`. Add one mandatory exact-key boolean:
`verificationPresent`.

The validator rejects:

- `/1` results;
- missing or non-boolean verification facts;
- mixed/extra result keys;
- the retired `auth-verification-required` outcome code.

Popup rendering includes a localized yes/no verification observation alongside
status, code and bounded counts.

### Latch the banner as content-free evidence

The injected probe checks for the known organization-banner surface at bounded
checkpoints. Once seen, `verificationPresent` remains true even if the banner
later disappears during the run.

Banner presence:

- does not resolve or authenticate organization/workspace scope;
- does not create a fingerprint;
- does not stop active/archived list requests;
- does not authorize replies, detail capture, export or baseline work.

All scope flags remain false and the fingerprint remains null exactly as in the
names-only ADR-076 contract.

### Preserve transport-authentication stops

HTTP `401` or `403` still returns `auth-required` after one charged dispatch,
aborts the signal, cancels the unread body and prevents every later request.
`429`, deadline, navigation, document, status, media and schema behavior remains
unchanged.

The global lock, invocation-token navigation abort, cap-four serial dispatch,
absolute deadline and late-settlement ownership from ADR-076 remain intact.

## Compatibility and boundaries

Only the probe contract, injected/background implementation, popup/locales and
their focused tests change. Manifest, service-worker dispatch, messaging,
baseline catalog, ADR-053 observation code, provider owner, exports,
destinations and scheduler remain unchanged.

The installed `/1` receipt remains local regression provenance. V2 does not
retroactively reinterpret it.

## Rejected alternatives

- Ask the user to complete account verification before any list read: the first
  evidence question is read-only and historical provider behavior already
  separated list access from reply access.
- Ignore the live stop as a failed attempt: it proved zero-dispatch admission and
  exposed an overbroad policy.
- Continue emitting `/1` with another field: breaks exact contract provenance.
- Treat banner absence/presence as authenticated scope: it is a UI observation,
  not an organization/workspace identity proof.
- Weaken `401`/`403`: response status remains the hard authentication boundary.

## Evidence and validation

- Local content-free receipt
  `LISKA-CLAUDE-LIST-PROBE-V1-VERIFICATION-20261118` records the reviewed head,
  fixed stop code and zero counts only.
- V2 tests cover banner present at start, appearing mid-run and disappearing,
  banner absent, mandatory exact-key validation and rejection of `/1`/mixed
  shapes/retired outcome.
- With the banner present, two terminal list responses may be observed and the
  result ends `scope-unresolved` with `verificationPresent=true`.
- `401`/`403` with the banner present still stops after one dispatch and proves
  signal/body cancellation.
- The current parent focused/adjacent matrix passes 9 files / 310 tests. Full
  TypeScript, zero-warning lint for the probe modules, wiring lint with zero
  errors, Prettier and diff checks pass. Independent re-review reports ready.
- Broader build/audit, documentation validation and current-head GitHub gates
  remain for this branch.

## Next gate

After merge, replace the installed unpacked build from the verified `dist`, keep
the same clean selected Claude route and run v2 once after a fresh action-time
confirmation. A successful scope-unresolved result is still diagnostic evidence;
only exact observed header names and list/page facts may inform the next contract.
