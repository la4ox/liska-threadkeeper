# Liska — AI Threadkeeper

> Bring every thread home. No thread left behind.

Liska は、AI との会話を読みやすい Markdown としてローカルに保存する Chromium 拡張機能です。Gemini、Claude、ChatGPT、Perplexity、DeepSeek、Gemini Notebook で現在選択されているスレッドを、ファイル、クリップボード、または Obsidian vault に書き出せます。

[English](README.md) · [プライバシーポリシー](https://github.com/la4ox/liska-threadkeeper/blob/main/docs/privacy.html) · [MIT License](LICENSE)

## 主な特徴

- **高速な DeepSeek 書き出し:** ログイン中の会話では同一オリジンの履歴レスポンスから現在の分岐を復元し、ページ全体のスクロールを避けます。
- **ローカル出力:** Markdown ダウンロード、クリップボード、Obsidian に対応。解析、テレメトリ、Liska 独自のサーバーはありません。
- **長い会話:** 最大 32 MiB（UTF-8）のテキストノートを処理し、他の対応サイトでは仮想化された会話を制限付き自動スクロールで収集します。
- **整理された記録:** YAML フロントマター、引用、数式、コールアウト、Thinking／ツール内容、質問見出し、衝突しないファイル名。
- **意図した操作だけ:** ページのスクリプトによる自動クリックでは書き出せず、実際のユーザー操作が必要です。

## 対応サービス

Gemini、Claude、ChatGPT、Perplexity、DeepSeek、Gemini Notebook（旧 NotebookLM URL を含む）に対応します。DeepSeek は現在選択中の分岐、Markdown、オプションの Thinking を保存します。

対応ページ: `gemini.google.com`、`claude.ai`、`chatgpt.com`、`www.perplexity.ai`、`chat.deepseek.com`、`notebook.google.com`、旧リダイレクトの `notebooklm.google.com`。

## ソースからインストール

Liska はまだ Chrome ウェブストアでは公開されていません。

```bash
git clone https://github.com/la4ox/liska-threadkeeper.git
cd liska-threadkeeper
npm install
npm run build
```

`chrome://extensions` を開き、デベロッパーモードを有効にして **パッケージ化されていない拡張機能を読み込む** から `dist/` を選択します。

## 使い方

1. 対応している AI の会話を開きます。
2. 右下の **スレッドを書き出す** ボタンをクリックします。
3. ポップアップで有効にした **ファイル**、**クリップボード**、**Obsidian** に保存されます。

ファイルとクリップボードは、Obsidian や API キーなしで利用できます。

### Obsidian（オプション）

1. [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 4.1.3 以降をインストールして有効にします。
2. API キーを Liska のポップアップに入力します。
3. API URL はローカルループバック（通常 `http://127.0.0.1:27123`）のまま使用します。
4. `AI/{platform}/{YYYY}/{MM}` などの保存先を選び、Obsidian 出力を有効にします。

API キーは `chrome.storage.local` にのみ保存され、対応 AI ページには公開されず、`127.0.0.1` 以外には送信されません。

## 現在の制限

- 会話グラフ全体ではなく、**現在選択されている分岐**を書き出します。
- 自動スケジュールバックアップはまだありません。各書き出しは実際のクリックから始まります。
- DeepSeek の画像取得は未対応です。テキスト、Markdown、現在の分岐、Thinking は対応済みです。
- 追記モードでは新しいテキストを追加できますが、新しいメッセージ内の画像は警告を表示してスキップします。
- DOM ベースの自動スクロールは最大 5 分です。

## プライバシー

会話は、それを表示しているページ上で処理されます。Liska はテレメトリやクラウドバックエンドを持ちません。ネットワークアクセスは、対応 AI サービス、会話内の画像を取得する Google の画像 CDN、ローカルの Obsidian API に限定されます。詳しくは[プライバシーポリシー](https://github.com/la4ox/liska-threadkeeper/blob/main/docs/privacy.html)をご覧ください。

## 開発

```bash
npm run lint
npm test
npm run build
```

## 出自とライセンス

Liska は [sho7650/obsidian-AI-exporter](https://github.com/sho7650/obsidian-AI-exporter) を基にした独立した MIT ライセンスのフォークです。元の著作権表示とライセンスは保持されています。[LICENSE](LICENSE) と [NOTICE.md](NOTICE.md) を参照してください。元の作者による推奨・公認を意味するものではありません。
