# Liska — AI Threadkeeper

> Bring every thread home. No thread left behind.

Liska は、AI との会話を読みやすい Markdown としてローカルに保存する Chromium 拡張機能です。Gemini、Claude、ChatGPT、Perplexity、DeepSeek、Gemini Notebook で現在選択されているスレッドを、ファイル、クリップボード、または Obsidian vault に書き出せます。

[English](README.md) · [プライバシーポリシー](https://github.com/la4ox/liska-threadkeeper/blob/main/docs/privacy.html) · [MIT License](LICENSE)

## 主な特徴

- **情報を失わない DeepSeek 書き出し:** ログイン中の会話では同一オリジンの履歴レスポンスを正確に保存し、完全なグラフを `liska-thread/1` に正規化して、ページ全体をスクロールせずに現在の分岐を描画します。
- **高速な ChatGPT 書き出し:** 実際のクリック後、非アクティブな一時タブが document start から ChatGPT 自身の会話レスポンスを監視し、ページをスクロールせずに会話グラフ全体を復元します。既定では現在の分岐を使い、ローカル選択画面から特定の分岐、または全 leaf と索引も書き出せます。既定表示には明示的な DOM フォールバックも残ります。
- **オフライン ChatGPT 照合:** Archive Tools の専用ページで既存の Web 正規スナップショットと公式エクスポート内の完全一致する会話を比較し、どちらのソースも変更せずに検証可能なローカル ZIP を保存します。
- **ローカル出力:** Markdown ダウンロード、クリップボード、Obsidian に対応。解析、テレメトリ、Liska 独自のサーバーはありません。
- **長い会話:** 最大 32 MiB（UTF-8）のテキストノートを処理し、他の対応サイトでは仮想化された会話を制限付き自動スクロールで収集します。
- **整理された記録:** YAML フロントマター、引用、数式、コールアウト、Thinking／ツール内容、質問見出し、衝突しないファイル名。
- **添付画像（オプション）:** 対応している生成画像を Markdown と同じ場所に保存できます。
- **意図した操作だけ:** ページのスクリプトによる自動クリックでは書き出せず、実際のユーザー操作が必要です。

## 対応サービス

Gemini、Claude、ChatGPT、Perplexity、DeepSeek、Gemini Notebook（旧 NotebookLM URL を含む）に対応します。DeepSeek は構造化された会話グラフ全体を raw／manifest／canonical companion として保存し、現在選択中の分岐、Markdown、オプションの Thinking を描画します。ChatGPT は通常／カスタム GPT のグラフ全体をスクロールなしで取得し、現在の分岐、選択した分岐、または全 leaf と索引を書き出せます。既定表示の取得に失敗した場合は警告付き DOM フォールバックを使用します。

対応ページ: `gemini.google.com`、`claude.ai`、`chatgpt.com`、`www.perplexity.ai`、`chat.deepseek.com`、`notebook.google.com`、旧リダイレクトの `notebooklm.google.com`。

## ソースからインストール

Liska はまだ Chrome ウェブストアでは公開されていません。

現在のソースをビルドして読み込むには Chromium 111 以降が必要です。

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

### Web スナップショットと ChatGPT 公式エクスポートを比較

1. Liska のポップアップから **Archive Tools → ChatGPT アーカイブを比較** を開きます。
2. 既存の Web `canonical/liska-thread-1.json` と、展開済み公式エクスポートの旧 `conversations.json`、または全 `conversations-NNN.json` shard を選択します。shard 化された v1 エクスポートでは、宣言された shard 名を読み込み前に確認するため、`export_manifest.json` を別に選択できます。
3. ファイル ZIP、Obsidian スナップショット、または両方を選択します。ファイルは「名前を付けて保存」を開き、Obsidian は明示的な opt-in です。

Liska は Web スナップショットが宣言する正確な会話 ID だけを照合します。一致後の shard を含む選択済み shard 全体を1つの合計 budget で検証します。任意で別に選択した v1 export manifest は、2 MiB の上限内でソース読み込み前にローカル解析されます。Liska は論理 `conversations.json` の shard 宣言だけを取り出し、明示的に選択した canonical shard basename と完全一致することを要求します。無関係な manifest inventory、raw manifest bytes、ファイル名、パスは保持も保存もしません。この admission は shard 内容の真正性や provider export 自体の完全性を証明しません。manifest を選択しない場合、省略 shard は推測されません。成功したバンドルには公式の正確な抜粋、Liska capture manifest、公式 canonical、内容を直接含まない比較レポート、ルート manifest が入ります。公式 canonical の正規化に失敗した場合は、明示的な raw-only 復旧バンドルを保存します。選択したファイルは読み取り専用で、アップロードされません。同じフォルダーに置く場合は **名前を付けて保存** でその場所を選択してください。Obsidian 出力には Local REST API 5.5.0 以降が必要で、各 artifact を atomic create-only PUT とバイナリ読み戻しで検証し、ルート manifest を最後に確定します。

### Obsidian（オプション）

1. [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 4.1.3 以降をインストールして有効にします。
2. API キーを Liska のポップアップに入力します。
3. API URL はローカルループバック（通常 `http://127.0.0.1:27123`）のまま使用します。
4. `AI/{platform}/{YYYY}/{MM}` などの保存先を選び、Obsidian 出力を有効にします。

API キーは `chrome.storage.local` にのみ保存され、対応 AI ページには公開されず、`127.0.0.1` 以外には送信されません。

## 現在の制限

- メインボタンはプロバイダーが選択した現在の分岐を書き出します。ChatGPT では、ローカル選択画面から特定の分岐、または全 leaf と索引も書き出せます。
- 自動スケジュールバックアップはまだありません。各書き出しは実際のクリックから始まります。
- 照合機能は旧 `conversations.json`、または明示的に選択した `conversations-NNN.json` shard セットを、共有 2 GiB／100,000-record budget で処理します。任意で別に選択した v1 `export_manifest.json` は 2 MiB に制限され、宣言された canonical shard 名だけを確認し、保存されません。**名前を付けて保存** で1つの File ZIP を出力でき、Local REST API 5.5.0 以降ではルート manifest を最後に検証する独立した Obsidian スナップショットも保存できます。manifest／directory／ZIP の自動検出は別の今後の対応です。
- DeepSeek の構造化書き出しは、永続的な Markdown 出力の横に raw／manifest／canonical companion を保存します。テキスト、Markdown、現在の分岐、任意の Thinking に対応します。**画像と添付ファイルをエクスポート**を有効にし、出力先に File または Obsidian を選ぶと、Liska は検証済み履歴内の現在の正確な `signed_path`、または最新の上限付き ResourceTiming tail にページが記録した file-service fetch のうち現在の raw file ID に一意に対応するものから、最大 20 件の passive file を取得できます。履歴内の情報を優先します。Liska は file card をクリックせず、`fetch_files` も呼び出しません。preview がない場合は未解決として正確に残します。raw を最初に保存し、書き込みは出力先ごとに管理され、provider ID と signed URL は manifest／canonical に残りません。
- ChatGPT の構造化アーカイブは、添付ファイルの参照とメタデータを常に保持します。**画像と添付ファイルをエクスポート**を有効にすると、raw アーカイブの保存後に、通常チャットの image/file-ID asset と interpreter/sandbox document のうち対応するものを上限付きで取得できます。各 asset は `fetched`、`not-attempted`、または失敗として正確に記録されます。custom-GPT、Library-ID、Calpico fallback はまだ対応していません。
- 16 MiB 以下の ChatGPT graph response は検証済みの inline path を使用します。16 MiB を超え 64 MiB 以下の response は extension-owned staging を使って分割転送されます。この staged path は synthetic live test 済みですが、16 MiB を超える実際の provider response はまだ明示的な検証課題です。
- 画像の書き出しは 20 枚まで、1 枚あたり 10 MiB、1 ノートあたり base64 データ合計 48 MiB に制限されます。
- 追記モードは、boundary 検証済みの新しい message tail だけを追加します。画像エクスポートが有効で Local REST API 5.5.0 以降の場合、その新しい tail にある standalone の active placeholder だけを、full SHA の content-addressed／create-only asset として Obsidian に保存し、note を変更する前に exact readback で検証します。過去メッセージの画像は backfill しません。必要な画像が欠落、曖昧、衝突、または未検証なら、壊れた link を書かず note append 全体を拒否します。画像エクスポート無効時は従来どおり text-only で placeholder を除去します。note PUT 前の失敗では再試行用の content-addressed asset が未参照のまま残る場合があります。不確実な PUT の後は既に参照済みの可能性があり、exact readback が最終 body を証明しない限り note は outcome-unknown のままです。Liska は retained asset を自動削除せず、外部 writer に対する compare-and-swap 安全性も主張しません。
- DOM ベースの自動スクロールは最大 5 分です。

## プライバシー

会話は、それを表示しているページ上で処理されます。Liska はテレメトリやクラウドバックエンドを持ちません。ネットワークアクセスは、対応 AI サービス、会話内の画像を取得する Google の画像 CDN、ローカルの Obsidian API に限定されます。詳しくは[プライバシーポリシー](https://github.com/la4ox/liska-threadkeeper/blob/main/docs/privacy.html)をご覧ください。

## 開発

```bash
npm run lint
npm test
npm run build
```

メンテナー向け情報は、[ドキュメント一覧](docs/README.md)、[メンテナンス／リリース手順](docs/maintaining.md)、[ビルド比較ガイド](docs/build-reproducibility.md)を参照してください。

## 出自とライセンス

Liska は [sho7650/obsidian-AI-exporter](https://github.com/sho7650/obsidian-AI-exporter) を基にした独立した MIT ライセンスのフォークです。元の著作権表示とライセンスは保持されています。[LICENSE](LICENSE) と [NOTICE.md](NOTICE.md) を参照してください。元の作者による推奨・公認を意味するものではありません。
