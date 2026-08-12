# Project status

## Confirmed working

- Branch: `codex/deepseek-export` in the `la4ox/obsidian-AI-exporter` fork.
- DeepSeek is registered for `https://chat.deepseek.com/*`.
- Signed-in `/a/chat/s/{id}` exports use DeepSeek's same-origin `history_messages` response first, without scrolling. The page-local bearer is used only for that request and is not logged, persisted, or sent to the background worker.
- The fast path reconstructs only the selected branch from `chat_session.current_message_id` through `parent_id`, rejects incomplete cache deltas and broken graphs, preserves API Markdown, and optionally includes Thinking content.
- `/share/{id}`, missing/expired auth, schema drift, HTTP failure, and incomplete responses fall back to the existing rendered-DOM extractor. User-controlled auto-scroll remains available for that fallback.
- `npm run build` succeeds.
- 1,541 tests pass when the two upstream Windows-environment E2E test files are excluded. The focused DeepSeek/Markdown suite passes 172/172, including a synthetic 600-message active branch, fail-closed malformed-parent cases, and raw-tag escaping for API reasoning.
- Platform lint and ESLint complete with no errors (three pre-existing warnings outside the DeepSeek code).

## Important limits

- The original live Comet export was confirmed incomplete: it contained 161 messages and began with an assistant response whose parent user message was missing after the five-minute DOM-scroll timeout.
- The rebuilt fast path is covered by deterministic API/DOM tests but still needs one live retry against that same signed-in DeepSeek chat in Comet.
- Export intentionally contains the currently selected branch, not every alternative branch. Automatic periodic backups remain a separate feature.
- The separate upstream security review found hardening work worth addressing, but those unrelated changes are intentionally not mixed into the DeepSeek feature branch.

## Artifacts

- Loadable unpacked extension: `dist/`
- DeepSeek history client/parser: `src/content/extractors/deepseek-api.ts`
- DeepSeek implementation: `src/content/extractors/deepseek.ts`
- DeepSeek selector contract: `src/content/extractors/selectors/deepseek.ts`

## Next step

Reload the already unpacked `dist/` extension in Comet and retry the same long DeepSeek conversation. Confirm that the page no longer scrolls and that the export begins with a user message.
