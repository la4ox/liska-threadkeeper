---
title: "ITH-009 — Extension-owned export popup boundary"
type: idea-thread
permalink: ith-009-extension-owned-export-popup
tags: [idea-thread, ui, export-authority, security]
thread_id: ITH-009
thread_state: settled
privacy: repository-safe
opened: 2026-11-01
last_turn: 2026-11-02
---

# ITH-009 — Extension-owned export popup boundary

The compact page fox made export controls easy to find, but the long-term
export decision belongs on an extension-owned surface. This thread records the
adopted popup direction and keeps the static page-DOM finding within its actual
threat precondition.

## Thread

### H1 — A compact page launcher can own export intent

The fox was introduced as a small path to current-thread and branch actions.
Because the visible buttons required trusted input, it initially seemed
reasonable to keep the export decision in the provider page and add more
disclosure or styling around it.

### E1 — The existing fox is a page affordance, not an extension-owned surface

The compact-launcher checkpoint records a 44-by-44-pixel fox that reveals the
real export buttons, with Escape and focus behavior, and a live smoke that
revealed current-thread and branch actions without exporting. Those checks
validate the launcher interaction; they do not make provider-page DOM an
extension-owned authorization boundary.

### E2 — Static page-DOM redressing finding has a bounded precondition

Static Security Cloud finding `csf_5072816416f2eab1f2507059` identifies a
page-DOM redressing risk on supported provider pages. Its relevant precondition
is hostile or compromised code running in the provider page, which can affect
the page surface consumed by content-script UI. The finding does not establish
that ordinary chat text can execute code or trigger an export, and it is not a
runtime exploit demonstration.

### E3 — The browser action already provides an extension-owned popup route

Chrome documents `action.default_popup` as the toolbar-click popup surface and
`chrome.action.openPopup()` as an API available in Chrome 127+; Chrome 118–126
restricts that API to policy-installed extensions. The manifest advertises
minimum Chrome 111, so page-launch behavior must feature-detect the API and
retain a compact extension-owned window fallback rather than require an upgrade.

### E4 — Export choices and settings have different jobs

The export surface needs to present situational choices beside the explicit
export action. Persistent destination and behavior preferences belong in
Settings. Keeping Export first makes the extension popup the consistent entry
point while preserving settings as a second, separate surface.

### X1 — Add a warning that users must read before acting

A warning depends on attention but leaves the page-owned controls and their
authority unchanged. It also risks presenting ordinary chat text as if that
were the condition described by the static finding.

Revisit when: a separately evidenced, user-facing risk requires disclosure in
addition to—not instead of—the extension-owned action boundary.

### X2 — Rely on Shadow DOM alone

Shadow DOM can reduce style and markup collisions, but does not turn a
provider-page control into an extension-owned surface or prevent hostile page
code from interacting with page context.

Revisit when: a browser-provided isolation boundary, rather than DOM styling,
can be shown to own and authorize the export action.

### X3 — Make a full-height side panel the default export surface

A persistent side panel adds a larger, longer-lived interaction surface than
the adopted compact popup needs. It is not required to separate export intent
from provider-page DOM.

Revisit when: measured branch or progress workflows cannot fit the popup and a
side-panel design has its own verified browser-compatibility fallback.

### X4 — Force a browser upgrade for popup-launch API support

Raising the browser floor solely to use programmatic popup opening would deny a
working toolbar-popup or extension-page path to older supported browsers.

Revisit when: an independently reviewed security or platform requirement—not
this popup interaction—requires changing the supported browser floor.

### X5 — Keep direct export actions in provider-page DOM

Page-owned buttons, synthetic page actions, or an injected page control would
leave export intent exposed to the page-DOM boundary. The optional fox may only
open the extension popup (or its extension-owned fallback); it never exports,
selects a branch, or authorizes a capture.

Revisit when: never for this UI contract; export authorization remains on the
extension-owned surface.

### D1 — Adopt the extension-owned popup as the export entry point

The popup opens on an `Export` tab by default, with `Settings` second.
Situational export options live on Export beside the explicit action. An
optional warm page fox is launch-only. When programmatic popup opening is
unavailable, use the browser toolbar popup or a compact extension-owned
window fallback; do not force an upgrade or export directly from page DOM.

Evidence: E1, E2, E3, E4

### T1 — Specify popup lifecycle and one-shot capability binding

Bind one explicit export intent to the exact active tab and options, with a
single-use capability and defined popup close, cancellation, and stale-tab
behavior.

Trigger: before wiring popup actions to capture, when the action-to-background
contract is implemented.

### T2 — Place branch picker and Stop on the Export surface

Keep branch selection and active-export cancellation adjacent to the relevant
export flow without giving either control page-DOM authority.

Trigger: when the popup export flow supports branch selection or cancellable
all-branch capture.

### T3 — Decide whether the warm fox is enabled by default

Treat the page fox as optional and launch-only; decide its default visibility
independently of export authorization.

Trigger: after the popup flow is usable and a preference can be evaluated
without changing the action boundary.

### T4 — Feature-detect popup opening and preserve the extension-page fallback

Use `chrome.action.openPopup()` only when available and permitted; otherwise
open a compact extension-owned window. Keep the toolbar popup usable in both
cases.

Trigger: when the launcher-to-popup route is implemented across the declared
browser support range.

### T5 — Test ownership, lifecycle and fallback boundaries

Cover default-tab state, explicit export actions, cancellation, one-shot
binding, provider-page hostile DOM cases, ordinary chat-text non-authority, and
the toolbar/window fallback paths.

Trigger: alongside implementation and before claiming the popup boundary is
verified.

### E5 — Candidate realization separates page launch from export authority

The 2026-11-02 candidate removes provider-DOM current/branch actions, the page
branch picker and the page Stop card. Its synthetic redress substitute exercises
the genuine fox listener and finds only a request to open trusted UI, with no
export action nodes. Controller tests exercise one-shot intent claim, explicit
operation generations, exact owners, phase/destination/settings checks,
restart hydration, corrupt-state rejection and stale-generation cleanup.
Real-worker tests independently retain the gate while replacing only sinks.

The synthetic browser preview uses the real popup markup, styles and application
with content-free browser fixtures. Export first, branch text, all-branch choice,
running Stop, cancellation and Settings were visibly inspected at 380px width.
This does not establish installed-extension behavior, real provider acquisition,
or Chrome 111 fallback behavior. Sources: S8, S9, S10.

### D2 — Realize D1 with a worker-owned generation and a two-stage branch decision

An extension-owned action creates a 30-second one-shot pending intent. Content
claims it once; the worker binds a new generation to browser-supplied tab,
top-frame and document identity and the exact normalized provider route.
Current mode may export immediately; selected mode may prepare only until a
second extension-owned branch/all choice is validated against content's retained
catalog. No raw archive or branch catalog is persisted in session metadata.

The two-hour generation expires, is revoked by Stop/navigation/settings changes,
and cannot be borrowed by a stale continuation. Exact owned-stage abort remains
available after cancellation. Closing an accepted-start popup does not cancel;
closing the registered branch window does. The worker captures the source tab
before opening a fallback window. Its opaque UI URL is a lookup only; exact
registered extension tab/window identity is required too. No new broad
permission or browser-version increase is needed. Existing independent local
archive tools retain their own workflow.

Evidence: E2, E3, E4, E5, E6

### E6 — Installed ChatGPT preparation stays extension-owned and cancellable

The reviewed candidate build was installed byte-for-byte through the maintained
rollback updater, only Liska was reloaded, and the test ChatGPT tab was reloaded
once to replace its invalidated old content-script context. The toolbar popup
showed the exact conversation title/route and preserved Obsidian + File outputs;
the configured Local REST API connection test succeeded. The page fox opened
that popup and exposed no page current/branch/Stop authority.

`Choose branch…` entered an explicit no-save preparation phase, displayed Stop,
and opened one registered compact extension window containing a literal bounded
branch descriptor plus a separate all-branches action. No ordinal/all choice was
made. Stop cancelled preparation, a reopened toolbar popup retained the stopped
state, and fresh checks found no new browser-download, maintained-export or open
vault files. This installed receipt covers launch, preparation, branch-window
identity, Stop/cancel and reopen behavior; it does not claim durable current,
ordinal or all-branches output, or absent/rejected-`openPopup` compatibility.

Final independent review also reproduced a multi-surface race where an old
visible ordinal could be submitted with a newly observed operation/selection.
The repaired UI retires choices on either identity change, binds every listener
to the exact catalog response and ignores late old catalogs; replaying the old
listener now sends no choice.

Published-head review then found that retained terminal history and unreserved
pending claims could exceed the 64-operation hydration cap. The repaired
controller counts pending intents as reserved slots, reclaims only empty terminal
history, preserves live and cleanup-owning generations, and repairs legacy
overreservation newest-intent-first. A delayed two-tab reproduction now remains
at 64 claimed operations and survives worker restart.

A subsequent review found that successful explicit aborts deleted their archive
or binary stages without releasing controller ownership. Exact post-result
accounting now releases only the request's stage after confirmed success;
failure, unknown outcome and wrong ownership remain retryable and fail closed.

The first current-head CI run exposed a statement-coverage gap rather than a
behavioral failure. Deterministic controller lifecycle/refusal tests raised the
unchanged global gate to 95.01% and controller statements to 99.26%, without
altering production code or coverage thresholds.

Sources: S11

### T6 — Close the installed-runtime evidence gap

Run the reviewed candidate in the installed extension on a synthetic provider
conversation: current, selected ordinal, all, cancel, Stop and reopened status;
also verify absent/rejected openPopup fallback on the supported browser range.
Do not repeat a private export or modify browser settings merely for evidence.

Trigger: after independent candidate review and authorization of the specific
installed-browser test scope.

Partial evidence 2026-11-02: E6 closes the installed launch/preparation/cancel
and reopened-status portion without writing user data. Retain this tail for the
durable current/ordinal/all paths and an actual absent/rejected-`openPopup`
compatibility receipt.

## Observations

- [hypothesis] H1: trusted clicks and disclosure initially seemed sufficient to keep export intent in the compact page launcher
- [evidence] E1: the fox interaction smoke validated reveal and dismissal, not extension ownership of export intent
- [evidence] E2: static page-DOM redressing requires a hostile or compromised provider page; ordinary chat text is not the demonstrated precondition
- [evidence] E3: Chrome action popups are toolbar-owned, while programmatic opening has version and policy limits
- [evidence] E4: situational export choices belong beside export actions, separate from persistent settings
- [rejected] X1: warning-reading leaves page-owned action authority unchanged
- [rejected] X2: Shadow DOM styling alone does not establish an extension-owned authorization boundary
- [rejected] X3: a full-height side panel is unnecessary for the adopted compact export entry point
- [rejected] X4: forcing a browser upgrade solely for popup API support is unnecessary
- [rejected] X5: direct page-DOM export controls remain outside the adopted authority boundary
- [decision] D1: use an extension-owned popup with Export first, Settings second, and a launch-only optional fox
- [tail] T1: define popup lifecycle and one-shot capability binding
- [tail] T2: put branch selection and Stop in the export flow
- [tail] T3: decide the optional fox default separately
- [tail] T4: feature-detect openPopup and preserve an extension-owned fallback
- [tail] T5: test authorization, hostile-page, ordinary-text and fallback cases

- [evidence] E5: candidate tests separate launch-only provider DOM from worker-owned generations; synthetic render is not installed-provider proof
- [decision] D2: use one-shot claims, explicit generations and a second extension-owned branch decision, with registered fallback identity and owner-only cleanup
- [evidence] E6: the installed ChatGPT path kept launch, preparation, branch choice and Stop on registered extension surfaces and produced no output before cancellation
- [tail] T6: retain an explicit installed-runtime and older-Chromium fallback evidence gate

## Relations

- informed_by [[ith-002-layered-archive-truth]]
- relates_to [[ith-004-attachment-acquisition-authority]]
- informs [[ith-005-bounded-completeness-proof]]

## Source receipts

- S1 — [Compact Liska launcher checkpoint](../../STATUS.md#compact-liska-launcher-checkpoint)
- S2 — [Compact launcher current-main port checkpoint](../../STATUS.md#compact-launcher-current-main-port-checkpoint)
- S3 — [Extension manifest](../../src/manifest.json)
- S4 — [Popup page](../../src/popup/index.html) and [popup application](../../src/popup/app.ts)
- S5 — [Content UI entry](../../src/content/ui.ts) and [Liska launcher](../../src/content/liska-launcher.ts)
- S6 — [Chrome action API](https://developer.chrome.com/docs/extensions/reference/api/action/)
- S7 — local receipt `csf_5072816416f2eab1f2507059`; visibility: local-only; safe aggregate only
- S8 — [Operation controller](../../src/background/export-operation-controller.ts), [controller tests](../../test/background/export-operation-controller.test.ts) and [real-worker gate tests](../../test/background/export-operation-route.test.ts)
- S9 — [Content lifecycle tests](../../test/content/export-operation-client.test.ts), [launch-only redress substitute](../../test/content/ui.test.ts) and [popup tests](../../test/popup/export.test.ts)
- S10 — [Synthetic local browser preview](../../test/popup/export-preview.html); no provider data or live output APIs
- S11 — [Installed extension-owned export authority checkpoint](../security-todo.md#extension-owned-export-authority-local-checkpoint--2026-11-02); exact build inventory, rollback and content-free live aggregate retained there
