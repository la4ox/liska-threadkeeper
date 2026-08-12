# Project status

## Confirmed working

- Branch: `codex/deepseek-export` in the `la4ox/obsidian-AI-exporter` fork.
- DeepSeek is registered for `https://chat.deepseek.com/*`.
- The extractor supports `/a/chat/s/{id}` and `/share/{id}`, sanitizes assistant HTML, optionally includes visible Thinking content, and accumulates virtualized turns with auto-scroll.
- Export scope is the currently selected/rendered branch. Alternative branches absent from the DOM are not exported.
- `npm run build` succeeds.
- 1,532 tests pass when the two upstream Windows-environment E2E test files are excluded. The focused DeepSeek/platform/store suite passes 120/120.
- Platform lint and ESLint complete with no errors (three pre-existing warnings outside the DeepSeek code).

## Important limits

- DeepSeek selectors are covered by deterministic DOM tests but have not yet been exercised against the user's live signed-in DeepSeek page in Comet.
- Full branch-graph export and automatic periodic backups are separate features and are not part of this branch.
- The separate upstream security review found hardening work worth addressing, but those unrelated changes are intentionally not mixed into the DeepSeek feature branch.

## Artifacts

- Loadable unpacked extension: `dist/`
- DeepSeek implementation: `src/content/extractors/deepseek.ts`
- DeepSeek selector contract: `src/content/extractors/selectors/deepseek.ts`

## Next step

Load `dist/` as an unpacked extension in Comet and verify one real DeepSeek conversation before configuring Obsidian output.
