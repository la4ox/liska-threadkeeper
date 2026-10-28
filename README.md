# Liska — AI Threadkeeper

> Bring every thread home. No thread left behind.

Liska is a local-first Chromium extension that turns AI conversations into clean Markdown. Export the currently selected thread from Gemini, Claude, ChatGPT, Perplexity, DeepSeek, or Gemini Notebook to a downloaded file, the clipboard, or an Obsidian vault.

[日本語](README.ja.md) · [Privacy policy](https://github.com/la4ox/liska-threadkeeper/blob/main/docs/privacy.html) · [MIT license](LICENSE)

## Why Liska

- **Loss-aware DeepSeek export:** signed-in conversations preserve the exact same-origin history response, normalize its complete graph into `liska-thread/1`, and render the active branch without scrolling through the page.
- **Fast ChatGPT export:** after a trusted click, an inactive disposable tab observes ChatGPT's page-native conversation response at document start and reconstructs the complete graph without scrolling. The default view follows the current branch; a local chooser can export one explicit branch or every leaf plus an index. A marked DOM fallback remains available for the default view.
- **Offline ChatGPT reconciliation:** a separate Archive Tools page compares an existing web canonical snapshot with the exact matching conversation in an official export, then saves one verifiable local ZIP without modifying either source.
- **Local outputs:** download Markdown, copy it, or write to Obsidian. Liska has no analytics, telemetry, account, or operated server.
- **Long-thread support:** the text pipeline accepts large notes up to 32 MiB of UTF-8; other supported sites can accumulate virtualized conversations with bounded auto-scroll.
- **Readable archives:** YAML frontmatter, citations, math, configurable callouts, thinking/tool content, question headings, and collision-safe filenames.
- **Literal citation boundaries:** provider titles, internal footnote markers, and HTTP(S) source destinations cannot create extra Markdown links, images, or embeds.
- **Safe derived Markdown:** structured provider text is parsed before the reading export. Automatic provider images, private/unsupported destinations, and Obsidian wikilinks/embeds remain visible but literal; only receipt-proven local ChatGPT attachment targets stay active. Raw and canonical archives remain exact.
- **Optional attachments:** supported generated images can be saved beside Markdown exports.
- **Intentional export:** page scripts cannot activate the export button programmatically; a real user click is required.

## Supported services

| Service         | Conversation export | Notes                                                               |
| --------------- | ------------------- | ------------------------------------------------------------------- |
| DeepSeek        | Yes                 | Complete structured graph; active branch view; optional Thinking    |
| Gemini          | Yes                 | Deep Research and generated images                                  |
| Claude          | Yes                 | Extended Thinking, artifacts, tool and search content               |
| ChatGPT         | Yes                 | Complete graph capture; current, selected, or every leaf plus index |
| Perplexity      | Yes                 | Regular threads and Deep Research                                   |
| Gemini Notebook | Yes                 | Chat citations as footnotes; legacy NotebookLM URLs supported       |

Supported page origins: `gemini.google.com`, `claude.ai`, `chatgpt.com`, `www.perplexity.ai`, `chat.deepseek.com`, `notebook.google.com`, and the legacy redirect `notebooklm.google.com`.

## Install from source

Liska is not published in the Chrome Web Store yet.

Building and loading the current source requires Chromium 111 or later.

```bash
git clone https://github.com/la4ox/liska-threadkeeper.git
cd liska-threadkeeper
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/`. In Comet or another Chromium browser, use its equivalent extensions page.

To update an already loaded unpacked copy with a verified rollback, use the
[maintainer installer](docs/maintaining.md#refresh-an-unpacked-local-copy). It
replaces only the explicitly named `dist` and never discovers or loads an
extension on its own.

## Use it

1. Open a supported AI conversation.
2. Click **Bring thread home** in the lower-right corner.
3. Liska writes to whichever outputs are enabled in its popup: **File**, **Clipboard**, and/or **Obsidian**.

File and clipboard export work without Obsidian or an API key.

### Compare a web snapshot with an official ChatGPT export

1. Open Liska's popup and choose **Archive Tools → Compare ChatGPT archives**.
2. Select an existing web `canonical/liska-thread-1.json` and either legacy `conversations.json` or all `conversations-NNN.json` shards from one uncompressed official export.
3. Choose a File ZIP, an Obsidian snapshot, or both. File opens Save As; Obsidian is an explicit opt-in.

Liska matches only the exact conversation ID declared by the web snapshot. Every selected shard is fully validated under one aggregate budget, including shards after the match; choose the complete shard set because Liska does not infer omitted files without the export manifest. A successful bundle contains the exact official excerpt, manifest, official canonical snapshot, content-free comparison report, and root bundle manifest. If official canonical normalization fails, Liska instead saves an explicitly marked raw-only recovery bundle. The selected files are read-only and never uploaded; choose their folder in **Save As** if you want the ZIP physically beside them. Obsidian delivery requires Local REST API 5.5.0 or later: every artifact uses atomic create-only PUT and exact binary readback, with the root manifest committed last.

### Optional Obsidian setup

1. Install and enable [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 4.1.3 or later.
2. Copy its API key into Liska's popup.
3. Keep the API URL on the exact loopback host, normally `http://127.0.0.1:27123`. HTTPS on `127.0.0.1` is supported when its certificate is trusted by the operating system.
4. Choose a vault path such as `AI/{platform}/{YYYY}/{MM}` and enable the Obsidian output.

The bearer key is stored in `chrome.storage.local`, is never exposed to supported pages, and is sent only to `127.0.0.1`.

## Important limits

- The main button exports the provider-selected current branch. ChatGPT also offers a local chooser for one explicit branch or every leaf plus an index.
- Automatic scheduled backups are not implemented yet; every export begins with a real click.
- Reconciliation accepts legacy `conversations.json` or an explicitly selected `conversations-NNN.json` shard set under a shared 2 GiB / 100,000-record budget. It can write one File ZIP through **Save As** and, with Local REST API 5.5.0 or later, a separate root-last verified Obsidian snapshot. Manifest/directory/ZIP discovery remains a separate follow-up.
- DeepSeek structured exports save raw/manifest/canonical companions beside durable Markdown outputs. Text, Markdown, the active branch, and optional Thinking are supported. With **Export images & attachments** enabled for File or Obsidian, Liska can fetch up to 20 passive files from exact current `signed_path` records in verified history, or from an exact file-service fetch that the current page already recorded in the newest bounded ResourceTiming tail and that uniquely matches a current raw file ID. In-band history wins. Liska never clicks a file card or calls `fetch_files`; a missing preview remains honestly unresolved. Raw is saved first, writes are destination-specific, and provider IDs/signed URLs stay out of manifest/canonical output.
- ChatGPT structured archives always retain attachment references and metadata. With **Export images & attachments** enabled, Liska can also acquire a bounded subset of ordinary-chat file-ID assets and interpreter/sandbox documents after the raw archive is durably saved. Active ordinary dispatch is limited to PNG/JPEG; GIF/WebP can only use the existing exact passive-observation path and have not passed the active live-evidence gate. Every asset remains honestly marked as `fetched`, `not-attempted`, or failed; custom-GPT/project and Calpico fallback routes are not supported yet.
- One exact Library-associated JPEG and one exact passive Library CSV in an ordinary ChatGPT conversation may each use a separate evidence-gated admission path. They are re-bound from committed raw immediately before the unchanged page-owned resolver and share the existing four active file-ID slots; `library_file_id`, filename, `source: local`, and pointer-only evidence never become request authority. CSV bytes are preserved exactly as a local download and are never parsed, formula-sanitized, rendered, or opened automatically. Library/gizmo/project/template identifiers stay raw-only; unsupported owner context and every other Library asset remain `not-attempted`.
- ChatGPT graph responses up to 16 MiB use the inline verified path. Larger responses up to 64 MiB use chunked extension-owned staging; this staged path is synthetic-live verified, while a real provider response above 16 MiB remains an explicit evidence gap.
- Optional tool/search output is rendered as literal fenced evidence. Provider-supplied links, images, raw HTML, Obsidian embeds, and message-like labels are not activated inside the exported note.
- Image export is bounded to 20 images, 10 MiB per image, and 48 MiB of combined base64 data per note.
- Append mode adds new text messages, but images in newly appended messages are skipped with a visible warning. A fresh file export can save supported images normally.
- Append identity uses invisible extension-owned HTML comments rather than visible role labels. A legacy note without either those markers or a valid `message_count` is refused without overwrite; export a fresh snapshot to migrate it safely.
- Auto-scroll is bounded to five minutes for DOM-only providers. When a provider changes its page structure, Liska fails with a warning instead of claiming a complete export.

## Privacy and security

Conversation parsing happens on the page already displaying the conversation. Liska sends no telemetry and has no cloud backend. Provider requests serve the supported AI origins and their attachment services; Obsidian uses only the loopback API. See the full [privacy policy](https://github.com/la4ox/liska-threadkeeper/blob/main/docs/privacy.html).

Gemini remote image requests accept only HTTPS `googleusercontent.com` sources (including its subdomains), without userinfo or nondefault ports. One authenticated, no-referrer, no-store fetch follows browser-managed redirects; the final response must remain on that CDN family or exact `lh3.google.com`, which is not a direct source. Fetch may send browser-managed cookies to the permitted CDN/redirect hosts, but Liska never reads or serializes cookie/request-header values or exposes them to the model, content script, or durable output. Prior live and retained evidence of anonymous 403 responses and session-dependent links justifies this browser-managed authentication. URL presence is reference evidence, not byte availability; a stale or failed link never becomes a fetched claim.

Intermediate redirect hops are not observable or validated per-hop: final-host acceptance is not a full egress proof. There is no retry or anonymous/authenticated fallback. The added exact host permission may require re-consent for packaged updates. One installed authenticated File+Obsidian canary retained the same 236,990-byte JPEG in both destinations with matching local links; packaged-update consent and intermediate-hop behavior remain separate gates.

Treat an unpacked browser extension like any local application: install from a revision you trust, inspect changes before updating, and keep the Obsidian API bound to loopback.

## Development

```bash
npm run lint
npm test
npm run build
```

The generated unpacked extension lives in `dist/`. Compatibility identifiers such as `g2o-*` remain internal so existing settings and note placeholders keep working across the fork.

Maintainers: see the [documentation index](docs/README.md), [maintenance and release guide](docs/maintaining.md), and [build comparison guide](docs/build-reproducibility.md).

## Origin and license

Liska is an independent MIT-licensed fork of [sho7650/obsidian-AI-exporter](https://github.com/sho7650/obsidian-AI-exporter). The original copyright and MIT license are preserved; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). The Liska project is not endorsed by the original author.

Contributions and bug reports are welcome in [this repository](https://github.com/la4ox/liska-threadkeeper).
