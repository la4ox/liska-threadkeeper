# DES-004: Release Please + Husky + commitlint 統合設計

> **Superseded by ADR-029 (2026-08-12).** This document describes the inherited
> historical workflow, not Liska's active release process.

## 1. 概要

### 1.1 目的

Chrome Extension プロジェクトに自動リリース管理とコミットメッセージ検証を導入する。

### 1.2 導入するツール

| ツール             | 目的                                                    |
| ------------------ | ------------------------------------------------------- |
| **Release Please** | 自動バージョニング、CHANGELOG 生成、GitHub Release 作成 |
| **Husky**          | Git hooks 管理                                          |
| **commitlint**     | コミットメッセージ形式検証                              |

### 1.3 設計決定

| 項目           | 決定                             | 理由                                    |
| -------------- | -------------------------------- | --------------------------------------- |
| CHANGELOG 管理 | Release Please に移行            | 自動化による一貫性確保                  |
| リリース成果物 | ZIP を GitHub Release に添付     | Chrome Web Store 提出の手動フローを維持 |
| コミット検証   | Husky (ローカル) + CI (リモート) | 二重検証による確実性                    |

---

## 2. アーキテクチャ

### 2.1 ワークフロー図

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Developer Workflow                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Developer]                                                        │
│       │                                                             │
│       ▼                                                             │
│  git commit -m "✨ feat: add feature"                               │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────────┐                                                │
│  │ .husky/commit-msg│  ← Husky hook triggers                       │
│  │   commitlint    │                                                │
│  └────────┬────────┘                                                │
│           │                                                         │
│           ▼                                                         │
│      ❌ Invalid format? → Commit rejected                           │
│      ✅ Valid format? → Commit accepted                             │
│           │                                                         │
│           ▼                                                         │
│       git push                                                      │
│           │                                                         │
└───────────┼─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        GitHub Actions                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    CI Workflow (ci.yml)                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │   │
│  │  │commitlint│→ │  lint    │→ │  test    │→ │  build   │      │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Release Please Workflow (on main push)           │   │
│  │                                                               │   │
│  │  [Analyze Commits] → [Create/Update Release PR]               │   │
│  │                              │                                │   │
│  │                              ▼                                │   │
│  │                    ┌─────────────────┐                        │   │
│  │                    │  Release PR     │                        │   │
│  │                    │  - version bump │                        │   │
│  │                    │  - CHANGELOG    │                        │   │
│  │                    └────────┬────────┘                        │   │
│  │                             │                                 │   │
│  │                    [PR Merged]                                │   │
│  │                             │                                 │   │
│  │                             ▼                                 │   │
│  │  ┌──────────────────────────────────────────────────────┐     │   │
│  │  │              build-and-upload Job                     │     │   │
│  │  │  1. Checkout tag                                     │     │   │
│  │  │  2. npm ci && npm run build:zip                      │     │   │
│  │  │  3. Upload ZIP to GitHub Release                     │     │   │
│  │  └──────────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 バージョン同期

```
Release Please
     │
     ├─► package.json      (version: "X.Y.Z")
     │       └─► npm standard version field
     │
     └─► src/manifest.json (version: "X.Y.Z")
             └─► Chrome Extension version field
             └─► Configured via extra-files
```

---

## 3. ファイル構成

### 3.1 新規作成ファイル

```
project-root/
├── release-please-config.json      # Release Please 設定
├── .release-please-manifest.json   # バージョン追跡
├── commitlint.config.js            # commitlint 設定
├── .husky/
│   └── commit-msg                  # コミットフック
└── .github/workflows/
    └── release-please.yml          # リリースワークフロー
```

### 3.2 修正ファイル

```
├── package.json                    # deps + prepare script
└── .github/workflows/
    └── ci.yml                      # commitlint step 追加
```

---

## 4. 設定ファイル詳細

### 4.1 release-please-config.json

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "node",
  "packages": {
    ".": {
      "component": "gemini2obsidian",
      "changelog-path": "CHANGELOG.md",
      "include-component-in-tag": false,
      "extra-files": [
        "src/manifest.json"
      ]
    }
  },
  "changelog-sections": [
    { "type": "feat", "section": "Features" },
    { "type": "fix", "section": "Bug Fixes" },
    { "type": "perf", "section": "Performance Improvements" },
    { "type": "refactor", "section": "Code Refactoring" },
    { "type": "docs", "section": "Documentation" },
    { "type": "style", "section": "Styles" },
    { "type": "test", "section": "Tests" },
    { "type": "chore", "section": "Miscellaneous" }
  ],
  "pull-request-title-pattern": "chore(main): release ${version}",
  "include-v-in-tag": true,
  "bump-minor-pre-major": true,
  "bump-patch-for-minor-pre-major": true
}
```

**設定説明:**

| キー                   | 値                      | 説明                                        |
| ---------------------- | ----------------------- | ------------------------------------------- |
| `release-type`         | `node`                  | package.json のバージョンを更新             |
| `extra-files`          | `["src/manifest.json"]` | manifest.json も同時に更新                  |
| `include-v-in-tag`     | `true`                  | タグを `v1.0.0` 形式に                      |
| `bump-minor-pre-major` | `true`                  | v1.0.0 前は BREAKING CHANGE でも minor bump |

### 4.2 .release-please-manifest.json

```json
{
  ".": "0.6.2"
}
```

### 4.3 commitlint.config.js

```javascript
/**
 * commitlint configuration with emoji prefix support
 *
 * Format: "<emoji> <type>: <subject>"
 * Example: "✨ feat: add new feature"
 *
 * Supported emoji mappings:
 * ✨ feat     - New feature
 * 🐛 fix      - Bug fix
 * 📝 docs     - Documentation
 * 🎨 style    - Code style/formatting
 * ♻️  refactor - Code refactoring
 * ⚡️ perf     - Performance improvement
 * ✅ test     - Tests
 * 🔧 chore    - Build/maintenance
 * 🔒 security - Security fix
 */
export default {
  parserPreset: {
    parserOpts: {
      // Regex: emoji + space + type + optional(scope) + colon + space + subject
      headerPattern: /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\s+(\w+)(?:\(([^)]+)\))?:\s+(.+)$/u,
      headerCorrespondence: ['type', 'scope', 'subject'],
    },
  },
  rules: {
    'type-enum': [
      2,  // Error level
      'always',
      [
        'feat',      // New feature
        'fix',       // Bug fix
        'docs',      // Documentation
        'style',     // Code style
        'refactor',  // Refactoring
        'perf',      // Performance
        'test',      // Tests
        'chore',     // Maintenance
        'revert',    // Revert commit
        'build',     // Build system
        'ci',        // CI configuration
        'security',  // Security fix
        'ui',        // UI changes
        'release',   // Release
      ],
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 100],
  },
};
```

### 4.4 .husky/commit-msg

```bash
npx --no -- commitlint --edit ${1}
```

### 4.5 .github/workflows/release-please.yml

```yaml
name: Release Please

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
      version: ${{ steps.release.outputs.version }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  build-and-upload:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created }}
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.release-please.outputs.tag_name }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build and create ZIP
        run: npm run build:zip

      - name: Upload ZIP to release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ needs.release-please.outputs.tag_name }}
          files: gemini2obsidian-${{ needs.release-please.outputs.version }}.zip
```

### 4.6 .github/workflows/ci.yml (修正後)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    permissions:
      contents: read

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for commitlint

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Validate commit messages
        if: github.event_name == 'pull_request'
        run: npx commitlint --from ${{ github.event.pull_request.base.sha }} --to ${{ github.event.pull_request.head.sha }} --verbose

      - name: Run linter
        run: npm run lint

      - name: Check formatting
        run: npm run format:check

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Build
        run: npm run build
```

---

## 5. コミットメッセージ規約

### 5.1 フォーマット

```
<emoji> <type>(<scope>): <subject>

[optional body]

[optional footer]
```

### 5.2 対応する絵文字とタイプ

| 絵文字 | Type     | 説明               | バージョン影響 |
| ------ | -------- | ------------------ | -------------- |
| ✨     | feat     | 新機能             | minor ↑        |
| 🐛     | fix      | バグ修正           | patch ↑        |
| 📝     | docs     | ドキュメント       | -              |
| 🎨     | style    | コードスタイル     | -              |
| ♻️     | refactor | リファクタリング   | -              |
| ⚡️     | perf     | パフォーマンス改善 | patch ↑        |
| ✅     | test     | テスト             | -              |
| 🔧     | chore    | メンテナンス       | -              |
| 🔒     | security | セキュリティ修正   | patch ↑        |

### 5.3 例

```bash
# 新機能
✨ feat: add ChatGPT conversation extractor

# バグ修正
🐛 fix: resolve double .md extension issue

# ドキュメント
📝 docs: update README for new features

# スコープ付き
✨ feat(extractor): add support for artifacts
```

---

## 6. 実装手順

### Phase 1: Husky + commitlint

```bash
# 1. 依存パッケージインストール
npm install --save-dev @commitlint/cli husky

# 2. Husky 初期化
npx husky init

# 3. commit-msg フック作成
echo 'npx --no -- commitlint --edit ${1}' > .husky/commit-msg

# 4. commitlint.config.js 作成
# (上記内容をコピー)
```

### Phase 2: CI 更新

1. `.github/workflows/ci.yml` に commitlint ステップ追加
2. PR でテスト

### Phase 3: Release Please

1. 設定ファイル作成
2. ワークフロー作成
3. main に push してテスト

---

## 7. 検証方法

### 7.1 commitlint ローカル検証

```bash
# 失敗ケース
echo "bad message" | npx commitlint
# → Error: subject may not be empty

# 成功ケース
echo "✨ feat: add new feature" | npx commitlint
# → (no output = success)
```

### 7.2 Release Please 検証

1. Conventional Commit を main にマージ
2. Release Please PR が自動作成されることを確認
3. PR をマージ
4. 確認項目:
   - [ ] GitHub Release 作成
   - [ ] タグ作成 (v0.6.3 等)
   - [ ] ZIP ファイルが Release に添付
   - [ ] package.json バージョン更新
   - [ ] src/manifest.json バージョン更新

---

## 8. リスクと対策

| リスク                 | 影響             | 対策                             |
| ---------------------- | ---------------- | -------------------------------- |
| 絵文字パースエラー     | コミット拒否     | Unicode プロパティエスケープ使用 |
| manifest.json 更新失敗 | バージョン不整合 | extra-files 設定でテスト         |
| Husky スキップ         | 不正コミット混入 | CI で二重チェック                |

---

## 9. 参考資料

- [Release Please Documentation](https://github.com/googleapis/release-please)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [commitlint](https://commitlint.js.org/)
- [Husky](https://typicode.github.io/husky/)
- [Reference Blog Post](https://loiccoyle.com/posts/release_please/)
