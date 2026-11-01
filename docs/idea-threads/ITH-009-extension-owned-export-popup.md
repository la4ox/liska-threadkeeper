---
title: "ITH-009 — Extension-owned export popup boundary"
type: idea-thread
permalink: ith-009-extension-owned-export-popup
tags: [idea-thread, ui, export-authority, security]
thread_id: ITH-009
thread_state: settled
privacy: repository-safe
opened: 2026-11-01
last_turn: 2026-11-01
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
