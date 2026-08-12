# Project status

## Confirmed working

- Branch: `codex/deepseek-export` in the `la4ox/obsidian-AI-exporter` fork.
- DeepSeek is registered for `https://chat.deepseek.com/*`.
- Signed-in `/a/chat/s/{id}` exports use DeepSeek's same-origin `history_messages` response first, without scrolling. The page-local bearer is used only for that request and is not logged, persisted, or sent to the background worker.
- The fast path reconstructs only the selected branch from `chat_session.current_message_id` through `parent_id`, rejects incomplete cache deltas and broken graphs, preserves API Markdown, and optionally includes Thinking content.
- `/share/{id}`, missing/expired auth, schema drift, HTTP failure, and incomplete responses fall back to the existing rendered-DOM extractor. User-controlled auto-scroll remains available for that fallback.
- Text notes up to 32 MiB of UTF-8 are accepted, with a separate 60 MiB serialized-message guard below Chrome's 64 MiB boundary. The former 1 MiB character cap was too brittle for very large multilingual chats. Malformed worker responses can no longer expose a secondary `results.map` UI error, and unexpected failures now name the stage that failed.
- `npm run build` succeeds.
- 1,546 tests pass when the two upstream Windows-environment E2E test files are excluded. The focused content/background/DeepSeek/Markdown suite passes 177/177, including a synthetic 600-message active branch, fail-closed malformed-parent cases, raw-tag escaping for API reasoning, a 1.2-million-character note, UTF-8 byte accounting, and malformed background responses.
- Platform lint and ESLint complete with no errors (three pre-existing warnings outside the DeepSeek code).

## Important limits

- The original live Comet export was confirmed incomplete: it contained 161 messages and began with an assistant response whose parent user message was missing after the five-minute DOM-scroll timeout.
- The rebuilt fast path is covered by deterministic API/DOM tests but still needs one live retry against that same signed-in DeepSeek chat in Comet.
- DeepSeek text/Markdown export is implemented, but provider images are not yet captured into local attachment files. The existing image-capture pipeline is Gemini-specific and remains bounded to 20 images, 10 MiB per image, and 48 MiB combined base64 data per note.
- Export intentionally contains the currently selected branch, not every alternative branch. Automatic periodic backups remain a separate feature.
- The separate upstream security review found hardening work worth addressing, but those unrelated changes are intentionally not mixed into the DeepSeek feature branch.

## Artifacts

- Loadable unpacked extension: `dist/`
- DeepSeek history client/parser: `src/content/extractors/deepseek-api.ts`
- DeepSeek implementation: `src/content/extractors/deepseek.ts`
- DeepSeek selector contract: `src/content/extractors/selectors/deepseek.ts`

## Next step

Reload the freshly rebuilt `dist/` extension in Comet and retry the same long DeepSeek conversation. Confirm that it exports 619 messages without scrolling or a `results.map` error and begins with a user message.
