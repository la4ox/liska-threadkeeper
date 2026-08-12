# Project status

## Confirmed working

- Repository: `la4ox/liska-threadkeeper`; upstream remains `sho7650/obsidian-AI-exporter`.
- Released baseline: `v3.0.0` at `539c1ae`; cleanup work continues from that tagged commit.
- Product identity is `Liska — AI Threadkeeper`, version `3.0.0`; the major version preserves monotonic browser updates from upstream 2.7.13 and marks the independent product/privacy boundary. Release artifacts use `liska-threadkeeper-<version>.zip`. Original MIT attribution is preserved in `LICENSE` and `NOTICE.md`.
- File and clipboard exports work without Obsidian. Obsidian remains an optional output through Local REST API 4.1.3+ on exact loopback host `127.0.0.1`.
- DeepSeek signed-in exports use the same-origin history response, reconstruct the selected active branch, preserve Markdown, and optionally include Thinking. DOM/scroll fallback remains available.
- Live DeepSeek export was verified on a 2,803,334-byte conversation: 1,382 messages (691 user + 691 assistant), 690 reasoning blocks, correct first/last roles, and no alternation breaks. It completed in seconds without scrolling.
- Exports require a trusted user click. Programmatic page clicks cannot trigger file, clipboard, or authenticated Obsidian operations.
- Remote image fetch and offscreen clipboard response waits are bounded to five seconds.
- Append mode visibly warns when images in newly appended messages are skipped instead of silently reporting a complete save.
- `npm run build` and platform lint pass. ESLint has no errors and three pre-existing warnings outside the first-release changes.
- The maintained suite passes 1,438 tests across 63 files with 95.08% statement and 85.04% branch coverage.

## Important limits and risks

- Liska exports the currently selected branch, not every alternative branch in the full conversation graph.
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
- Maintainer and release guide: `docs/maintaining.md`

## Next step

Finish the active documentation/localization cleanup, then start the ChatGPT no-scroll history prototype from the cleaned `main` baseline.
