# Provider and upstream follow-up plan

This plan tracks provider/common improvements that are independent from the
raw-first ChatGPT roadmap in [`chatgpt-todo.md`](chatgpt-todo.md). Confirmed
implementation and validation receipts remain in [`STATUS.md`](../STATUS.md).

## Audited upstream baseline

- Liska `origin/main` was compared with upstream AI Exporter `2.14.9` at
  `244df7f` (merge base `b96bfc5`). The histories have diverged substantially;
  a wholesale merge would overwrite Liska privacy, archive, and provider work.
- ChatGPT DOM/image changes are reference fixtures only. They must not replace
  Liska's exact graph capture, branch selection, destination receipts, or
  loss-aware asset pipeline.
- Perplexity fallback fixes, nested code fences/message counting, strict save
  responses, settings-read failure handling, and modern build ranges are already
  independently implemented or stricter in Liska. Do not re-port them.
- Preserve local-only API-key storage, trusted-click boundaries, canonical
  base64 validation, Markdown/citation escaping, and the deliberately removed
  maintainer E2E daemon/auth/notifier stack.

## Priority queue

### 1. Claude thread and October DOM compatibility

- Implemented on `codex/claude-compat` in two reviewable commits:
  thread-only scrolling/collapsed visibility, then mixed legacy/October answer
  and tool extraction.
- The semantic thread root wins; class fallback requires indexed conversation
  rows. Inert collapsed content is retained only below a real row, while hidden
  rows and enclosing dismissed panels remain excluded.
- Assistant and user roots are priority-unioned and containment-deduplicated so
  mixed DOM variants do not disappear under shared first-match semantics.
- Answer chrome, TurnStatus/thinking, and positively proven legacy status
  headers are removed only on a detached clone before both Markdown and HTML
  fallback. Ordinary `.row-start-1` layout remains visible.
- October content-block tool rows contribute only their own label; richer legacy
  query/result/Markdown extraction remains intact. Repeated equal labels remain
  distinct operations and no expander is clicked.
- Still required: one user-selected, content-minimized live Claude canary. The
  synthetic fixtures do not prove current rollout structure, mounting latency,
  or old fallback ambiguity.

### 2. Truncated DOM overwrite guard

- Implemented on `codex/truncation-guard` with the small structured signal from
  upstream `7b9532c` and the Gemini correction identified in `c2edc47`.
- Base and Gemini extraction propagate a runtime-only truncated flag exactly
  for a detected DOM deadline. The worker validates it, while generated
  Markdown and frontmatter remain unchanged.
- Append and ordinary Obsidian replacement now refuse a smaller truncated
  capture only for a proven mutable same-conversation note with one trustworthy
  prior `message_count`. The refusal returns directly and cannot fall through
  into overwrite or collision allocation.
- Missing, malformed, continued, duplicate, list, fractional, negative, or
  unsafe prior counts allow the save with a fixed protection-unavailable
  warning. Immutable archive/branch snapshots, foreign collisions, complete
  captures, File, and Clipboard preserve their previous behavior.
- Exact-tree validation passes 169 files / 5,179 tests; build, lint, formatting,
  diff checks, and independent review pass. Remaining boundary: this detects
  loader-deadline truncation, not arbitrary provider omission or concurrent
  vault mutation. No live provider/vault claim is attached to this checkpoint.

### 3. Selector-derived readiness and Gemini title

- Selector-derived readiness is implemented on `codex/provider-readiness`.
  The exhaustive map uses each provider's owned primary group, includes
  DeepSeek, and covers both Gemini Notebook hosts through the registry. The
  bootstrap duplicate literal and its broad/dead variants are gone.
- Readiness remains only a UI-injection hint: ChatGPT and DeepSeek are still
  structured-first, initialization performs no capture, and the 100 ms debounce
  plus unconditional 10-second escape are unchanged. Six GitHub P2s across
  three heads closed cross-provider matches, current/legacy fallback omissions,
  and Claude sidebar/rowless ambiguity. Bootstrap now queries the current
  platform's complete supported readiness surface; Perplexity's legacy query is
  single-sourced outside its live selector contract, Gemini root fallback is
  included, and Claude rowless identities require `.conversation-thread`.
  Thirty-four failing-before-fix regressions cover the follow-ups and the final
  independent review is clean. Exact-tree validation passes 171 files / 5,299
  tests; build, lint, formatting, and diff checks pass. No live-provider claim
  is made.
- Gemini document-title naming remains a separate evidence-gated change. It
  affects new filename slugs and append-off duplication even though append-on
  lookup remains ID-based. Before enabling it, verify a named chat, an unnamed
  chat, and SPA navigation title timing against current Gemini, then recheck
  both filename schemes and collision behavior.

### 4. Later bounded product slices

- Typed scroll stop reasons are implemented on `codex/scroll-stop-reasons` for
  both existing engines. Idle stalls and the five-minute safety cap now produce
  different content-free logs and warnings; only those typed deadlines mark a
  capture truncated. Bottom seeding and delayed iterations share the absolute
  cap. Exact-tree validation passes 172 files / 5,277 tests and independent
  review is clean; no live hidden-tab claim is made.
- Configurable deadlines are implemented on `codex/scroll-deadline-settings`
  while preserving the shipped 15-second idle default and hard 300-second
  ceiling. Popup/worker bounds are idle 5–300 and maximum 30–300 seconds; old
  saved settings normalize without migration, malformed direct inputs remain
  capped, and both fields participate in guarded routing snapshots. Common Base
  plumbing calls provider-only hooks without changing ChatGPT/DeepSeek
  structured-first overrides. Exact-tree validation passes 173 files / 5,360
  tests and final independent review is clean; live popup/provider behavior is
  not claimed.
- Bounded frontmatter tag templates are implemented on `codex/tag-templates`.
  Historical conversation/research defaults remain byte-compatible; users may
  choose canonical Unicode/nested literals and exact `{platform}` expansion.
  Stored and worker arrays, popup input, operation freezes, routing snapshots,
  branches/stubs/indexes, Deep Research, append preservation, and secret
  separation have explicit coverage. Exact-tree validation passes 174 files /
  5,487 tests and final review is clean. Comet installation/reload, live field
  rendering/defaults, and full-tab sender rejection are verified without a
  settings write; actual transient-popup save/reopen and real
  File/Clipboard/Obsidian exports remain the evidence gate.
- Pure writer/reader and tracked-source text contracts are implemented on
  `codex/text-contracts` without changing production code or restoring the
  removed E2E infrastructure. The real `conversationToNote` path is decoded by
  an independent test-local CommonMark oracle across nested/partial/long fences,
  all message formats, flattening thresholds, LF/CRLF, counts, and every tail
  offset. A tracked-only `git ls-files -z` scanner covers explicit text types in
  `src`, `test`, and `scripts`, rejects hidden C0 bytes without echoing source
  content, rejects linked/reparse path components before opening a file, and
  never walks untracked/private artifacts. Full validation passes 175 test files
  / 5,511 tests; build, lint, formatting, and diff checks pass.

### 5. Compact floating Liska launcher

- Implemented on `codex/compact-launcher` as a separate visual/interaction
  slice. One 44 px circular local SVG fox occupies the existing bottom-right
  home position; the real `Bring thread home` and optional ChatGPT
  `Choose branch` buttons expand inward on desktop and stack above on narrow
  viewports. No manifest permission, remote asset, or exported page resource is
  added.
- Hover is only an enhancement. Trusted tap/click, keyboard focus, and Escape
  share one singleton shell with `aria-expanded`, `aria-busy`, hidden/inert
  collapsed actions, reduced-motion rules, safe-area bounds, and a generic busy
  spinner. Existing button IDs, returned elements, trusted-click rejection,
  callbacks, bootstrap paths, branch picker, toasts, and the independent
  all-branches stop control remain intact; the launcher never synthesizes an
  export action.
- Independent review found and closed two real interaction edges: loading after
  a focused action initially left the panel expanded, and replacing a clicked
  icon with the spinner detached `event.target` before bubbling. The final path
  collapses only after the original trusted callback starts and resolves the
  owned action from immutable `composedPath()`; tests reproduce descendant
  removal in browser propagation order.
- Synthetic Chromium verifies desktop EN, 360 px JA, 280 px EN, focus/Escape,
  loading, and narrow stacking. A neutral live Comet/ChatGPT page at 110% zoom
  verifies the installed collapsed fox, trusted reveal of both actions, and
  Escape collapse without starting an export. Full validation passes 175 test
  files / 5,523 tests; TypeScript/build, source/platform lint, formatting, and
  diff checks pass with only the two unrelated existing lint warnings.
- Still open: live layout gates for Claude, Gemini/Deep Research, Perplexity,
  DeepSeek, and both Notebook hosts; physical touch, actual safe-area hardware,
  assistive-technology announcements, and a real loading export. The launcher
  never copies filenames or detailed errors, but the inherited body-level toast
  can still contain supplied error text; that existing provider-DOM privacy
  surface is a separate audit rather than a claim of this UI slice.

## Explicitly deferred

- Persistent sync badge until partial archives, branch exports, cancellation,
  and per-destination receipts have a truthful status adapter. It may say “last
  sync”, never “up to date”, and must not expose filenames/errors into provider
  page DOM by default.
- Configurable note limit as a replacement for Liska's existing 32 MiB UTF-8
  body and 60 MiB message hard bounds. A later soft cap may only narrow them.
- `lh3.google.com` permission expansion until a Gemini image redirect failure is
  reproduced; if added, keep it redirect-only rather than a general source.
- Knip enforcement, all-warning lint policy, and the upstream maintainer E2E
  daemon/auth/notifier stack.
- Upstream ADR-044 HTML gate as code: it is design-only in `2.14.9` and has no
  shipped implementation to cherry-pick.

## Exact next step

Run a content-minimized live Claude gate selected by the user, reconcile the
result with legacy and October fixtures, then checkpoint the Claude slice after
the ledger PR is merged into `main`. If live DOM contradicts the synthetic
contract, preserve both variants or fail soft; do not silently replace legacy
tool detail with label-only output.
