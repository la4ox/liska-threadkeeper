---
title: "ITH-001 — Claude isolated Artifact capture"
type: idea-thread
permalink: ith-001-claude-isolated-artifact-capture
tags: [idea-thread, claude, artifacts, privacy, archival]
thread_id: ITH-001
thread_state: settled
privacy: repository-safe
opened: 2026-10-30
last_turn: 2026-10-31
---

# ITH-001 — Claude isolated Artifact capture

Current Claude document Artifacts cross an origin boundary that the historical
top-document extractor does not. This thread preserves why Liska first records
the omission honestly and what must be proven before it asks for broader frame
access.

## Thread

### H1 — The current Artifact can become a bounded companion

A visible document Artifact is represented by one same-origin Claude wrapper,
one isolated provider frame, and a nested `srcdoc` document with a recognizable
editor root. A narrowly scoped extension bridge may therefore be able to return
one sanitized, content-addressed companion on an explicit export gesture.

This is a feasibility hypothesis, not a capture claim. The observed `srcdoc`
could be an initial snapshot that lags later edits or version switches.

### E1 — Transcript export is healthy while the Artifact is omitted

Two authenticated live canaries completed without changing either chat. A
two-message ordinary chat and a 22-message Artifact-bearing chat each produced
byte-identical Download and Obsidian Markdown copies. The second file retained
all 22 role records, while several distinctive document-only headings were
absent. The ordinary Claude transcript path therefore works; the visible
Artifact body is a separate omitted source.

This does not prove every history shape, Artifact type, attachment, tool block,
or destination.

A later 154-message canary confirmed that this qualification matters: the
Artifact-bearing 22-message transcript remains valid evidence for its own shape,
but long virtualized-history completeness required stable role+UUID identity,
tail-relative ordering, a bounded MAIN-world scroll prime, root-remount guards
and directional history-marker handling. The installed final pass retained all
154 messages without `history-load-partial`, and Download/Obsidian were
byte-identical. This proves the transcript traversal only; it does not turn the
still-omitted isolated Artifact body into captured content.

### E2 — The new boundary is structural, not a missing upstream selector

The current top document contains a visible `iframe` whose source path contains
`/code/artifact/`. Its same-origin wrapper contains one isolated frame under a
`*.frame.claudeusercontent.com` origin. That frame in turn carries a bounded
`srcdoc` document with one `.tiptap.ProseMirror` editor in the observed case.
The old `#markdown-artifact` selectors match zero nodes.

The structure was recorded without retaining conversation text, titles, URLs,
IDs, frame payloads, or content hashes. It establishes a cross-origin boundary,
not freshness or general Artifact compatibility.

### E3 — Upstream 2.14.15 has the same blind spot

The fresh upstream comparison found the October Claude transcript, tool, scroll,
and collapsed-content fixes already represented and strengthened locally. Both
upstream and Liska still query the top document for the legacy Artifact element;
neither has frame messaging, frame-wide injection, or an Artifact-origin host
permission to port.

### E4 — Installed omission evidence survives both destinations

The exact installed candidate retained all 22 transcript records, displayed one
fixed content-free warning, and wrote byte-identical Download and Obsidian notes
with schema 1 and `claude-artifact-content-omitted`. The owned diagnostic fields
contained neither the Artifact title nor its provider origin. No chat message or
document edit was performed.

This proves the adopted diagnostic path on one current document Artifact. It
does not prove other Artifact types, closed-panel variants, permission behavior,
or companion acquisition.

### X1 — Grant wildcard frame access and trust `srcdoc` immediately

This looked attractive because the document bytes are already present in the
isolated frame and the measured example is modest. It is rejected for the first
slice because permission alone does not prove that `srcdoc` equals the latest
editor state. Saving a stale document with a success claim would replace an
obvious omission with a subtler one.

Revisit when: a synthetic live document is edited and version-switched, and the
rendered editor state repeatedly reconciles with a bounded, inertly parsed
`srcdoc` snapshot.

### X2 — Keep exporting the transcript without a durable signal

The transcript is useful, but a transient toast or no warning at all leaves the
saved file looking complete. That contradicts Liska's loss-aware archive
contract and makes later reconciliation unable to distinguish absence from
omission.

Revisit when: never for a recognized visible unsupported Artifact; the durable
diagnostic is part of the adopted contract.

### D1 — Ship durable omission evidence before capture authority

The first slice keeps ordinary transcript export, detects the recognized visible
Artifact frame without reading it, and records one stable loss diagnostic in the
saved note plus one content-free completion warning. Hidden, inert, or otherwise
dismissed frames do not warn. No new host permission, network request, frame
message, destination, or companion schema is added.

Evidence: E1, E2, E3, E4

### T1 — Optional one-document Artifact bridge

After freshness is proven, consider an optional host permission limited to the
Artifact frame origin pattern. An extension-internal broker should bind one
explicit user gesture to one tab, conversation, Artifact candidate, frame,
destination set, nonce, and short expiry. The bridge returns only bounded
content and fixed diagnostics; it receives no Obsidian secret or generic
network/write authority.

Trigger: the edit/version freshness experiment passes and a packaged-browser
test proves permission denial/revocation, loaded-frame targeting, navigation
races, replay rejection, bounded parsing, malicious markup handling, and zero
unexpected resource requests.

### T2 — Companion delivery and reconciliation

A captured Artifact should remain a separate content-addressed companion while
the transcript is retained. Success must be per destination, and unsupported
embeds, media, formatting, oversize input, or ambiguous frame selection must be
explicit losses rather than truncation.

Trigger: T1 is accepted and the companion can be written to both Download and
Obsidian with honest partial-destination receipts.

## Observations

- [hypothesis] H1: one explicit, bounded document companion may be recoverable from the isolated frame
- [evidence] E1: ordinary, Artifact-bearing and long virtualized transcripts saved identically to both destinations while document-only Artifact content remained absent #live
- [evidence] E2: the current Artifact is a nested cross-origin frame and the legacy top-document selector has zero matches #live
- [evidence] E3: upstream 2.14.15 has no frame bridge or permission solution to port
- [evidence] E4: the installed candidate persisted the content-free omission code to byte-identical Download and Obsidian notes #live
- [rejected] X1: wildcard access plus unverified `srcdoc` freshness could archive stale content as success
- [rejected] X2: silent transcript-only export violates the loss-aware contract
- [decision] D1: persist a content-free omission diagnostic before expanding authority
- [tail] T1: prove freshness and packaged-browser security before an optional frame bridge
- [tail] T2: retain transcript and deliver a content-addressed Artifact companion with per-destination honesty

## Relations

- relates_to [[ith-002-layered-archive-truth]]
- relates_to [[ith-004-attachment-acquisition-authority]]
- relates_to [[ith-005-bounded-completeness-proof]]

## Source receipts

- S1 — [Claude October DOM checkpoint](../../STATUS.md#claude-october-dom-compatibility-checkpoint)
- S2 — [Upstream 2.14.15 audit](../upstream-2.14.15-audit.md)
- S3 — `src/content/extractors/selectors/claude.ts`, `src/content/extractors/claude.ts`, and their focused tests
- S4 — local receipt `CLAUDE-LIVE-20261030-A`; visibility: local-only; safe aggregate only
- S5 — local receipt `CLAUDE-LIVE-20261030-B`; visibility: local-only; safe aggregate only
