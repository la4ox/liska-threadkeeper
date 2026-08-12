# Project status

## Confirmed working

- Repository: `la4ox/liska-threadkeeper`; upstream remains `sho7650/obsidian-AI-exporter`.
- Current branch: `codex/liska-first-release`, based on merged DeepSeek support at `0f215fa`.
- Product identity is `Liska — AI Threadkeeper`, version `3.0.0`; the major version preserves monotonic browser updates from upstream 2.7.13 and marks the independent product/privacy boundary. Release artifacts use `liska-threadkeeper-<version>.zip`. Original MIT attribution is preserved in `LICENSE` and `NOTICE.md`.
- File and clipboard exports work without Obsidian. Obsidian remains an optional output through Local REST API 4.1.3+ on exact loopback host `127.0.0.1`.
- DeepSeek signed-in exports use the same-origin history response, reconstruct the selected active branch, preserve Markdown, and optionally include Thinking. DOM/scroll fallback remains available.
- Live DeepSeek export was verified on a 2,803,334-byte conversation: 1,382 messages (691 user + 691 assistant), 690 reasoning blocks, correct first/last roles, and no alternation breaks. It completed in seconds without scrolling.
- Exports require a trusted user click. Programmatic page clicks cannot trigger file, clipboard, or authenticated Obsidian operations.
- Remote image fetch and offscreen clipboard response waits are bounded to five seconds.
- Append mode visibly warns when images in newly appended messages are skipped instead of silently reporting a complete save.
- `npm run build` and platform lint pass. ESLint has no errors and three pre-existing warnings outside this branch's changes.
- 1,553 tests pass across 75 files when the two known upstream Windows-environment E2E files are excluded. The focused first-release suite passes 242/242.

## Important limits and risks

- Liska exports the currently selected branch, not every alternative branch in the full conversation graph.
- Automatic scheduled backups are not implemented; every export starts from a real user click.
- DeepSeek images are not captured. The existing attachment pipeline is mainly Gemini-specific and bounded to 20 images, 10 MiB each, and 48 MiB combined base64 data per note.
- Append mode does not upload images into an existing note yet; it appends text and reports the skipped new images.
- DOM-only auto-scroll is intentionally bounded to five minutes. Provider markup changes can still require extractor maintenance.
- The optional upstream E2E authentication tooling stores reusable browser state in ignored local files and can expose an authenticated Chrome session on a loopback DevTools port while running. Do not use it casually or leave its daemon running.
- The current visual icon is the inherited purple crystal. A dedicated Liska icon is a separate design task.

## Artifacts

- Loadable unpacked extension: `dist/`
- DeepSeek history client/parser: `src/content/extractors/deepseek-api.ts`
- Privacy policy source: `docs/privacy.html`
- Current product and setup guide: `README.md`

## Next step

Review the first-release diff in its draft pull request, then load the rebuilt `dist/` in Comet and smoke-test one file export, one clipboard export, and (if desired) one Obsidian export before merging.
