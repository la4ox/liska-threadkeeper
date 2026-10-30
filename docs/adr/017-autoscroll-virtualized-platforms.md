# ADR-017: Auto-scroll for virtualized platforms (Claude & ChatGPT)

- Status: Accepted — shipped in v2.1.0 (2026-07-07)
- Date: 2026-07-06
- Supersedes/extends: Gemini auto-scroll (`src/lib/scroll-manager.ts`)

## Context

Claude and ChatGPT extract only the most-recently-rendered subset of a long
conversation (reported: ChatGPT 5/13 messages, Claude 6/12). Gemini already has
an auto-scroll pass (`ensureAllElementsLoaded`) that scrolls its
`infinite-scroller` to the top and re-arms an edge-trigger until the turn **count**
stabilizes — it assumes turns **accumulate and stay** in the DOM.

Before designing a fix we verified the actual DOM behavior of both platforms
against live, authenticated sessions via the CDP daemon (`e2e-daemon`), because
the claude-in-chrome automation browser degraded both apps (ChatGPT → mobile-web
fallback `?mweb_fallback=1`; Claude → a `chat-stale-nav-*` state) and produced
false negatives.

## Findings (Phase 1 spike, 2026-07-06)

Measured on the daemon's real logged-in Chrome (`Chrome/150`):

**Both platforms use true DOM virtualization (windowing).** Only a small moving
window of turns is ever mounted; off-screen turns are **evicted**.

|                       | Claude                                                                                                                                        | ChatGPT (mweb proxy)                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Initial mounted       | 3 turns (at bottom)                                                                                                                           | 6 messages (at bottom)                                                    |
| After scrolling up    | grows to 5→7; `scrollHeight` 27310→30616                                                                                                      | 14 mounted at top                                                         |
| Scroll back to bottom | back to 3; earlier turns **evicted**                                                                                                          | back to 6; earlier 8 **evicted**                                          |
| Verdict               | **VIRTUALIZE**                                                                                                                                | **VIRTUALIZE**                                                            |
| Scroll container      | `div.overflow-y-auto.overflow-x-hidden.[scrollbar-gutter:stable].flex-1`                                                                      | `div[class*="scroll-gutter"]` (desktop selector TBD — see Open questions) |
| Stable per-turn id    | **`data-index`** on the row wrapper (monotonic; user=20, asst=21), alongside `data-test-render-count` / `data-sizer-excess` windowing markers | **`data-message-id`** / **`data-turn-id`** (uuid)                         |

Key consequence: **you can never hold all turns in the DOM at once.** Gemini's
count-based "scroll to top, then `extractMessages()` once" approach cannot work
here — by the time the top is loaded, the bottom turns are gone.

Scrolling **does** load earlier turns in a real authenticated session (the
earlier automation-browser "nothing loads" result was an artifact of the
degraded stale-nav state). Claude loads earlier turns via incremental
window-sized upward scroll; `scrollHeight` grows as history is measured in.

## Decision

Extract **incrementally while scrolling**, accumulating turns keyed by a stable
per-turn id, rather than scrolling first and extracting once.

1. Add an **accumulation loader** to `scroll-manager.ts` (dual-mode: keep the
   existing count-based path for Gemini; add an id-keyed accumulation path).
   Loop: scroll the container upward by ~one window, let the virtual list mount
   the newly-visible turns, extract + dedupe them into a `Map<id, Message>`,
   repeat until `scrollTop === 0` and no new ids appear for N stable iterations
   (or `SCROLL_TIMEOUT`).
2. Dedupe/order:
   - **Claude** — key by `data-index` (monotonic → also gives ordering and a
     completeness signal: contiguous from 0).
   - **ChatGPT** — key by `data-message-id`/`data-turn-id`; order by capture/DOM
     order; stop on stable-no-new-ids.
     _Superseded in part by [ADR-022](022-anchor-insertion-window-merge.md):_
     DOM-order stitching alone scrambles when the newest turns never evict
     (issue #353). Windows are now merged by anchor insertion, and ChatGPT also
     supplies the `conversation-turn-N` ordinal as `HarvestEntry.order`.
3. Expose the mechanism through a `getScrollConfig(): ScrollConfig | null` hook on
   `BaseExtractor` (default `null`). `BaseExtractor.extract()` runs the
   accumulation pass when a config is present. Gemini keeps its own `extract()`
   override (image capture) unchanged — no scope creep.
4. Gate behind the existing `enableAutoScroll` setting for both platforms; emit
   the existing "auto-scroll timed out / N loaded" warning on incomplete loads.

The dual-mode-defaulting-to-accumulation choice was confirmed with the user; the
spike proves accumulation is not merely safer but **required** for both
platforms.

## Consequences

- More invasive than Gemini's pre-pass: extraction interleaves with scrolling and
  must reconstruct full message content per window, then stitch. Assistant
  content on Claude (Extended Thinking, artifacts, tool blocks) must be captured
  correctly at each window.
- Robust to virtualization and future window-size changes.
- Testable with jsdom fixtures that simulate a windowed list (mount/evict rows by
  `data-index` on scroll), mirroring `createGeminiScrollableDOM`.

## ChatGPT scroll-container selector (resolved 2026-07-07)

First shipped as `.flex-1.flex-col[class*="overflow-y-auto"]`, which was wrong:
ChatGPT's **sidebar `<nav>`** also carries `flex-1 flex-col overflow-y-auto` and
sits earlier in the DOM, so `queryWithFallback` returned the nav (scrollTop 0) →
`accumulateWhileScrolling` saw scrollTop 0 and **skipped**, extracting only the
initially-mounted window (user-reported: no scrolling, no history). Confirmed
via a DevTools snippet in the user's real (non-mweb) Chrome:

- Sidebar `<nav>`: `overflow-y-auto`, scrollTop 0 — **decoy**.
- Thread scroller: `div[data-scroll-root]` with `not-print:overflow-y-auto`,
  scrollTop 4341/scrollHeight 10605, all 13 turns inside.

Fix: anchor on the semantic `[data-scroll-root]`; secondary
`[class*="not-print:overflow-y-auto"]` (the `not-print:` token is unique to the
thread scroller — the nav uses plain `overflow-y-auto`). Regression covered by a
decoy-nav fixture in `test/extractors/chatgpt-autoscroll.test.ts`.

## Paired turns and reversed scroll origin (2026-10-25 extension)

Upstream September evidence reported a second ChatGPT layout: one
`div[data-turn-key]` contains both the prompt and answer, while the semantic
timeline scroller uses `flex-direction: column-reverse`. In that layout
`scrollTop = 0` means newest/bottom and older content is reached through
negative values. Treating zero as oldest/top therefore skips the whole
accumulation pass.

Liska now normalizes ordinary and reversed containers through one `ScrollAxis`
whose public measure is distance from the oldest edge. Existing Claude and
legacy ChatGPT positive-axis behavior stays unchanged. ChatGPT additionally
requires a two-second visible rest at the oldest edge: a zero-range seed is not
declared complete while older pages can still appear, newly loaded history
restarts the settle, and a hidden document times out as runtime `partial`.

Current and legacy ChatGPT turn selectors are collected together and
priority-deduplicated by DOM overlap. A current pair emits prompt then answer;
legacy sections retain their global ordinal. Valid `data-turn-key` evidence
outranks late child message IDs so a streaming remount replaces stale content
instead of duplicating it. Keyless remount identity remains best-effort and is
acceptable only because every rendered fallback is explicitly marked partial.

The change is fallback-only. API-first complete graph capture, selected/replay
fail-closed behavior, raw/canonical archives, verified binary acquisition, and
destination receipts are outside this axis contract. Upstream blob-image
capture is not included.

## Claude completeness and scroll-root replacement (2026-10-30 extension)

A long authenticated Claude canary disproved the assumption that reaching a
locally stable top is sufficient. Its official export contains 154 messages,
while the installed DOM path first retained only 52 and called the pass
complete. Content-free live traversal then observed catalog maxima 31, 63, 95,
127 and 153 with 20%-viewport / 64px steps. The same messages receive new
`data-index` values after every prepend, so the earlier numeric key was not a
stable identity.

Claude therefore opts into all of the following while other providers keep the
shared numeric traversal defaults:

1. 20%-viewport / 64px steps with a 100ms poll and five seconds of continuous
   visible, geometry-stable rest at the oldest edge;
2. exact role-namespaced provider identity: one canonical UUID suffix on the
   strong user root or one exact assistant `UUID-hub-reply` key;
3. order proof as `data-index - currentCatalogMax`, with a pinned unchanged
   newest tail and bidirectional key/order maps across prepend epochs;
4. final exact coverage of `M + 1` stable keys over every integer order from
   `-M` through zero;
5. re-resolution through the same ordered scroll-root selector policy, with at
   most four connected-root replacements and a frozen conversation route;
6. one Claude-only static MAIN-world scroll-prime listener. The isolated caller
   permits two attempts per root, while the listener validates the exact
   top-frame Claude origin and semantic target and performs only synchronous
   page-owned `scrollBy`; it has no extension, storage, extraction or network
   authority.

Accumulated messages, exact empty-state evidence, ordering and the tool cache
survive a same-chat root replacement. Initial replacement is re-pinned;
mid-walk replacement is not. Cross-chat navigation aborts the export before any
destination write. Missing/disconnected replacements, replacement-budget
exhaustion, missing or conflicting UUID evidence, tail replacement, catalog
shrink, skipped order, unsupported renderability or fallback identity remain
sticky partial outcomes.

Claude uses one content-free button shape for both directions of a virtualized
gap. A marker before the first mounted indexed row blocks completion as possible
older history. The same marker between or after rows is a later-history gap and
does not. Claude briefly hides the older marker at the top of each current page
before prepending the next page; measured transitions were about three seconds.
If disappearance has not produced validated max growth, Liska therefore waits
five continuous seconds, resetting on reappearance, before ordinary top settle
can begin. This lets the final page terminate without weakening the transition
window.

Because smaller steps revisit persistent rows more often, Claude's tool
conversion uses a per-export exact-input cache. It includes candidate kind,
DOM order and ancestry, invalidates on any change, retains at most 16 MiB of
serialized UTF-8 input, and does not weaken the existing conversion budgets.

The packaged live canary started with messages 26–32 of a 32-row local catalog,
used no manual history click or CDP scroll prime, traversed to max 153 and wrote
154 messages (77+77). Download and Obsidian Markdown are byte-identical and no
`history-load-partial` remains. Completeness is still an observed DOM statement,
not an atomic snapshot guarantee; official-export reconciliation remains the
independent reference.

## Open questions

- **Live desktop ChatGPT end-to-end**: both automated Chromes force the mweb
  layout, so accumulation on desktop ChatGPT is verified only by unit tests + the
  desktop fixture, not a live automated run. Claude's live run (daemon) captured
  all 26 turns; ChatGPT relies on the user's manual smoke test.
  Partially narrowed by [ADR-022](022-anchor-insertion-window-merge.md): the
  mounted-window sequence of a real desktop session was recorded and is replayed
  as a unit test, which confirmed that desktop ChatGPT does evict mid-conversation
  turns while keeping the newest ones mounted.
- Exact stop-condition tuning (stable-iteration threshold, per-window scroll
  delta) per platform.
- The current paired CSS anchors and a real reversed-scroll pass could not be
  inspected through browser automation because host authority was denied. The
  implementation is therefore backed by upstream measurements plus synthetic
  fixtures, not a fresh raw-DOM/live-scroll claim.
