# Liska — AI Threadkeeper

> Bring every thread home. No thread left behind.

Liska is a local-first Chromium extension that turns AI conversations into clean Markdown. Export the currently selected thread from Gemini, Claude, ChatGPT, Perplexity, DeepSeek, or Gemini Notebook to a downloaded file, the clipboard, or an Obsidian vault.

[日本語](README.ja.md) · [Privacy policy](https://github.com/la4ox/liska-threadkeeper/blob/main/docs/privacy.html) · [MIT license](LICENSE)

## Why Liska

- **Fast DeepSeek export:** signed-in conversations use DeepSeek's same-origin history response and reconstruct the active branch without scrolling through the page.
- **Local outputs:** download Markdown, copy it, or write to Obsidian. Liska has no analytics, telemetry, account, or operated server.
- **Long-thread support:** the text pipeline accepts large notes up to 32 MiB of UTF-8; other supported sites can accumulate virtualized conversations with bounded auto-scroll.
- **Readable archives:** YAML frontmatter, citations, math, configurable callouts, thinking/tool content, question headings, and collision-safe filenames.
- **Optional attachments:** supported generated images can be saved beside Markdown exports.
- **Intentional export:** page scripts cannot activate the export button programmatically; a real user click is required.

## Supported services

| Service         | Conversation export | Notes                                                                 |
| --------------- | ------------------- | --------------------------------------------------------------------- |
| DeepSeek        | Yes                 | Active branch; same-origin API first, DOM fallback; optional Thinking |
| Gemini          | Yes                 | Deep Research and generated images                                    |
| Claude          | Yes                 | Extended Thinking, artifacts, tool and search content                 |
| ChatGPT         | Yes                 | Regular and custom GPT conversations                                  |
| Perplexity      | Yes                 | Regular threads and Deep Research                                     |
| Gemini Notebook | Yes                 | Chat citations as footnotes; legacy NotebookLM URLs supported         |

Supported page origins: `gemini.google.com`, `claude.ai`, `chatgpt.com`, `www.perplexity.ai`, `chat.deepseek.com`, `notebook.google.com`, and the legacy redirect `notebooklm.google.com`.

## Install from source

Liska is not published in the Chrome Web Store yet.

```bash
git clone https://github.com/la4ox/liska-threadkeeper.git
cd liska-threadkeeper
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/`. In Comet or another Chromium browser, use its equivalent extensions page.

## Use it

1. Open a supported AI conversation.
2. Click **Bring thread home** in the lower-right corner.
3. Liska writes to whichever outputs are enabled in its popup: **File**, **Clipboard**, and/or **Obsidian**.

File and clipboard export work without Obsidian or an API key.

### Optional Obsidian setup

1. Install and enable [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 4.1.3 or later.
2. Copy its API key into Liska's popup.
3. Keep the API URL on the exact loopback host, normally `http://127.0.0.1:27123`. HTTPS on `127.0.0.1` is supported when its certificate is trusted by the operating system.
4. Choose a vault path such as `AI/{platform}/{YYYY}/{MM}` and enable the Obsidian output.

The bearer key is stored in `chrome.storage.local`, is never exposed to supported pages, and is sent only to `127.0.0.1`.

## Important limits

- Liska exports the **currently selected branch**, not every alternative branch in a conversation graph.
- Automatic scheduled backups are not implemented yet; every export begins with a real click.
- DeepSeek images are not captured yet. Its text, Markdown, active branch, and optional Thinking are supported.
- Image export is bounded to 20 images, 10 MiB per image, and 48 MiB of combined base64 data per note.
- Append mode adds new text messages, but images in newly appended messages are skipped with a visible warning. A fresh file export can save supported images normally.
- Auto-scroll is bounded to five minutes for DOM-only providers. When a provider changes its page structure, Liska fails with a warning instead of claiming a complete export.

## Privacy and security

Conversation parsing happens on the page already displaying the conversation. Liska sends no telemetry and has no cloud backend. Network access is limited to supported AI origins, Google's image CDN for images already present in an exported conversation, and the loopback Obsidian API. See the full [privacy policy](https://github.com/la4ox/liska-threadkeeper/blob/main/docs/privacy.html).

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
