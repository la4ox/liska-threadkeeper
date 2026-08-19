# Project status

## Confirmed working

- Repository: `la4ox/liska-threadkeeper`; upstream remains `sho7650/obsidian-AI-exporter`.
- Released baseline: `v3.0.0` at `539c1ae`; cleanup work continues from that tagged commit.
- Product identity is `Liska — AI Threadkeeper`, version `3.0.0`; the major version preserves monotonic browser updates from upstream 2.7.13 and marks the independent product/privacy boundary. Release artifacts use `liska-threadkeeper-<version>.zip`. Original MIT attribution is preserved in `LICENSE` and `NOTICE.md`.
- File and clipboard exports work without Obsidian. Obsidian remains an optional output through Local REST API 5.1.0 on exact loopback host `127.0.0.1`. HTTPS health, certificate, and bearer authentication were verified independently on port `27124`. Because Comet's extension service worker did not inherit the tab's self-signed-certificate exception, the browser integration uses the plugin's HTTP compatibility endpoint on `127.0.0.1:27123`. End-to-end DeepSeek sync produced a 2,854,272-byte note with frontmatter `message_count: 1408` and exactly 1,408 rendered role markers.
- DeepSeek signed-in exports use the same-origin history response, reconstruct the selected active branch, preserve Markdown, and optionally include Thinking. DOM/scroll fallback remains available.
- Live DeepSeek export was verified on a 2,803,334-byte conversation: 1,382 messages (691 user + 691 assistant), 690 reasoning blocks, correct first/last roles, and no alternation breaks. It completed in seconds without scrolling.
- Exports require a trusted user click. Programmatic page clicks cannot trigger file, clipboard, or authenticated Obsidian operations.
- Remote image fetch and offscreen clipboard response waits are bounded to five seconds.
- Append mode visibly warns when images in newly appended messages are skipped instead of silently reporting a complete save.
- The experimental `liska-capture/1` and `liska-thread/1` archive layers now preserve exact raw artifact bytes separately from a credential-free manifest, verify artifact and manifest SHA-256 provenance, validate/traverse complete branch graphs, and project either `currentNodeId` or an explicit leaf into the existing flat Markdown contract while reporting legacy omissions.
- ChatGPT's live web-history route was confirmed as `GET /backend-api/conversation/{conversationId}`. A local structural probe observed a direct `mapping` graph with a structural root, a current node, and sibling branches; no personal response body, title, conversation ID, cookie, header, or credential remains in the worktree or was committed. The pure normalizer consumes only hash-verified exact bytes, retains all graph nodes and ordered typed blocks, scrubs signed URLs and account/correlation identifiers from the canonical layer with diagnostics, and uses synthetic fixtures only.
- ChatGPT no-scroll capture is enabled for Chromium 111+ behind a trusted click and the narrow `scripting` permission. A marker-gated MAIN-world script runs at document start only in an inactive disposable conversation tab, observes the page-native exact GET response, clones only that response under a 16 MiB cap, and never reads or serializes request headers, cookies, account data, or unrelated traffic. Its control state remains closure-private; background receives an immutable primitive snapshot, re-verifies base64 and SHA-256 in extension context, and closes only the created tab.
- The ChatGPT bridge normalizes the complete captured graph transiently, projects the selected current branch through the existing Deep Research safety guard, and falls back to marked DOM/scroll extraction on any capture, integrity, normalization, or projection failure. No personal raw response is persisted. A live Comet smoke exported 28 current-branch messages (5 user + 23 assistant role markers) while only 5 turn elements were rendered in the DOM, wrote a 31,187-byte Obsidian note, emitted no fallback warning or capture failure code, and left zero marker tabs open.
- `npm run build` and platform lint pass. ESLint has no errors and three pre-existing warnings outside the first-release changes.
- The maintained test suite passes across 82 test files (1,694 tests) with 95.01% statement, 87.47% branch, 98.09% function, and 97.10% line coverage. Locale and placeholder parity, public-copy parity, local documentation links, archive layering, subsystem cycles, raw-byte provenance, strict ChatGPT runtime routing, document-start marker gating, page-primordial poisoning, late-tab cleanup, graph normalization, and current-branch projection are enforced.
- Draft PR [#7](https://github.com/la4ox/liska-threadkeeper/pull/7) publishes the ChatGPT archive checkpoint. Its CI passes with `actions/checkout@v7` and `actions/setup-node@v7`, both running on Node 24; the earlier Node 20 deprecation annotation is gone.

## Important limits and risks

- Obsidian browser sync currently sends the bearer over unencrypted HTTP on the local loopback interface because the extension service worker cannot use Comet's tab-scoped certificate exception. The Local REST API binding and Liska's privileged URL validation both restrict this route to exact host `127.0.0.1`; never expose or rebind it to a LAN or Internet interface. HTTPS remains enabled for clients that can explicitly trust the plugin certificate.
- ChatGPT no-scroll current-branch export is live-verified in Comet. DOM/scroll extraction remains a marked fallback for unsupported browsers, provider drift, unavailable document-start state, oversized payloads, and any failed integrity/normalization/projection check.
- A private real-chat corpus confirmed both strong structured successes and repeated fallbacks on heavier legacy, Canvas, and mixed-content conversations. When structured capture fails while auto-scroll is disabled, the downloaded Markdown contains only the currently rendered DOM subset and must be treated as partial. The current generic warning hides the stable failure code, so the exact failing stage is not yet known.
- The complete ChatGPT branch graph currently exists only in the transient canonical archive during a click-triggered export; the user-facing Markdown/Obsidian output still projects one selected current branch. Separate raw and canonical JSON downloads, branch selection, and all-branches presentation are not implemented yet.
- Legacy-projection warnings accurately count attachments and non-user/assistant messages that were present in the transient canonical graph, but the phrase “the canonical archive retains them” is not yet a durable-backup guarantee: that graph is discarded after the operation until canonical JSON download or local persistence is implemented.
- The first temporary-tab implementation bounds a single ChatGPT conversation response to 16 MiB and holds a base64 transfer transiently in memory. This is suitable for the first smoke test but is not the final large-archive storage design; larger captures need staged local persistence instead of silently raising or hiding the limit.
- Automatic scheduled backups are not implemented; every export starts from a real user click.
- DeepSeek images are not captured. The existing attachment pipeline is mainly Gemini-specific and bounded to 20 images, 10 MiB each, and 48 MiB combined base64 data per note.
- Append mode does not upload images into an existing note yet; it appends text and reports the skipped new images.
- DOM-only auto-scroll is intentionally bounded to five minutes. Provider markup changes can still require extractor maintenance.
- The inherited live-E2E authentication/daemon harness was removed. It stored reusable AI sessions and exposed authenticated Chrome through a loopback DevTools port, while providing no CI-backed guarantee for Liska on Windows. Offline extractor fixtures and snapshot tests remain.
- The current visual icon is the inherited purple crystal. A dedicated Liska icon is a separate design task.
- GitHub Pages is intentionally disabled. The privacy policy remains available from its tracked source file.
- Release Please is intentionally removed from the active workflow surface; releases are explicit maintainer actions documented in `docs/maintaining.md`.

## Artifacts

- Loadable unpacked extension: `dist/`
- DeepSeek history client/parser: `src/content/extractors/deepseek-api.ts`
- Privacy policy source: `docs/privacy.html`
- Current product and setup guide: `README.md`
- Documentation index: `docs/README.md`
- Maintainer and release guide: `docs/maintaining.md`
- Chat archive pipeline decision and phased plan: `docs/adr/031-loss-aware-archive-pipeline.md`
- Canonical archive core and schema: `src/archive/` and `src/archive/schema/liska-thread-1.schema.json`
- Credential-free raw capture primitives: `src/archive/capture.ts` and `src/content/capture/response.ts`
- ChatGPT verified-byte normalizer: `src/archive/normalizers/chatgpt.ts` and `src/archive/normalizers/chatgpt/`
- Disposable-tab capture primitive and strict runtime contract: `src/background/chatgpt-capture.ts` and `src/lib/chatgpt-capture-contract.ts`
- Marker-gated MAIN-world document-start observer: `src/content/capture/chatgpt-document-start.ts`
- ChatGPT content bridge and current-branch composition: `src/content/capture/chatgpt-current-branch.ts` and `src/content/extractors/chatgpt.ts`
- Synthetic ChatGPT raw fixture and end-to-end projection test: `test/fixtures/archive/chatgpt-raw/branching-mixed-content.json` and `test/content/chatgpt-archive-pipeline.test.ts`
- Canonical-to-legacy branch adapter: `src/content/archive-projection.ts`

## Next step

Keep PR #7 in draft. Surface the safe structured-capture failure code and an
explicit partial-DOM marker in user-visible diagnostics, then add separate
raw/canonical JSON downloads so projection omissions are durably recoverable.
Re-run the known successful and fallback corpus classes before merging or
treating this path as a backup feature.
