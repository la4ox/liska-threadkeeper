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

- Port the small structured signal from upstream `7b9532c`, including the
  Gemini correction from `c2edc47`.
- Propagate an explicit truncated flag through base and Gemini extraction,
  rendered note metadata, same-conversation identity probes, and both ordinary
  Obsidian save paths.
- Refuse a shorter overwrite only when the existing note has a usable
  `message_count`; absence of trustworthy prior count must remain an explicit
  limitation, not fabricated certainty.
- Preserve immutable archive/branch snapshots and ensure an explicit refusal
  cannot fall through into the ordinary overwrite path.

### 3. Selector-derived readiness and Gemini title

- Derive provider readiness from each provider's owned selectors rather than the
  inline bootstrap literal. Include DeepSeek and Liska's raw-first ChatGPT
  selectors rather than copying upstream's narrower provider map.
- Consider Gemini document-title naming separately. Before enabling it, verify
  append on/off and existing-note reuse because changed titles affect filenames.

### 4. Later bounded product slices

- Configurable scroll deadlines plus honest stop reasons, adapted to Liska's
  existing scroll engines and all seven providers.
- Configurable frontmatter tag templates, including exact settings transport and
  routing-snapshot serialization.
- Pure writer/reader seam and tracked-source control-byte tests where they add
  coverage without restoring the removed E2E infrastructure.

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
