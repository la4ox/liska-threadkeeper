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
- The experimental `liska-thread/1` archive core now has strict TypeScript types, an executable draft-2020-12 JSON Schema, deterministic graph validation/traversal, and synthetic fixtures for branching, detached cycles, and broken links. A compatibility adapter projects either `currentNodeId` or an explicit leaf into the existing flat Markdown contract while reporting unsupported legacy omissions. This core is not connected to live ChatGPT capture yet.
- `npm run build` and platform lint pass. ESLint has no errors and three pre-existing warnings outside the first-release changes.
- The maintained test suite passes across 68 test files (1,516 tests) with 95.12% statement and 85.95% branch coverage. Locale and placeholder parity, public-copy parity, local documentation links, archive layering, and subsystem cycles are enforced in CI.

## Important limits and risks

- Obsidian browser sync currently sends the bearer over unencrypted HTTP on the local loopback interface because the extension service worker cannot use Comet's tab-scoped certificate exception. The Local REST API binding and Liska's privileged URL validation both restrict this route to exact host `127.0.0.1`; never expose or rebind it to a LAN or Internet interface. HTTPS remains enabled for clients that can explicitly trust the plugin certificate.
- The installed runtime still exports the currently selected DOM branch. The new archive core can retain and enumerate all branches, but a live ChatGPT raw capture/normalizer has not been connected to it yet.
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
- Canonical-to-legacy branch adapter: `src/content/archive-projection.ts`

## Next step

Verify ChatGPT's live same-origin conversation endpoint and capture its exact
response into a credential-free raw artifact plus manifest. Then implement the
pure ChatGPT raw-to-`liska-thread/1` normalizer against synthetic/redacted
fixtures and connect the current-branch adapter, keeping the DOM extractor as
an explicitly partial compatibility fallback.
