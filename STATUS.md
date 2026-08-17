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
- A reviewed temporary-tab capture primitive exists but is intentionally inert: it is not routed from the UI/service worker and the manifest does not yet request `scripting`. It creates only an inactive disposable ChatGPT tab, observes one exact same-origin JSON response without reading cookies or request headers, re-verifies base64 and SHA-256 in extension context, restores `fetch`, and closes only that tab.
- `npm run build` and platform lint pass. ESLint has no errors and three pre-existing warnings outside the first-release changes.
- The maintained test suite passes across 74 test files (1,611 tests) with 95.05% statement, 87.28% branch, 97.86% function, and 96.99% line coverage. Locale and placeholder parity, public-copy parity, local documentation links, archive layering, subsystem cycles, raw-byte provenance, ChatGPT graph normalization, and current-branch projection are enforced.

## Important limits and risks

- Obsidian browser sync currently sends the bearer over unencrypted HTTP on the local loopback interface because the extension service worker cannot use Comet's tab-scoped certificate exception. The Local REST API binding and Liska's privileged URL validation both restrict this route to exact host `127.0.0.1`; never expose or rebind it to a LAN or Internet interface. HTTPS remains enabled for clients that can explicitly trust the plugin certificate.
- The installed runtime still exports the currently selected DOM branch. The verified ChatGPT capture and normalizer modules are not connected to runtime messaging yet; no new browser permission has been added. Runtime integration requires an explicit decision to add Chrome's narrow `scripting` permission, followed by a safe live MV3 smoke test. DOM/scroll extraction remains the fallback.
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
- Inert disposable-tab capture primitive: `src/background/chatgpt-capture.ts`
- Synthetic ChatGPT raw fixture and end-to-end projection test: `test/fixtures/archive/chatgpt-raw/branching-mixed-content.json` and `test/content/chatgpt-archive-pipeline.test.ts`
- Canonical-to-legacy branch adapter: `src/content/archive-projection.ts`

## Next step

After explicit approval for the Chrome `scripting` permission, route the inert
temporary-tab primitive through strictly validated runtime messaging, construct
the `liska-capture/1` bundle, normalize it, and feed the current-node projection
into the existing Markdown/Obsidian pipeline with DOM extraction as a marked
partial fallback. Then perform one consented live MV3 smoke test without
persisting the response body, and add separate local raw/canonical JSON download
before treating the path as a backup feature.
