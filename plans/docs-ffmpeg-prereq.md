# docs: ffmpeg prerequisite + setup-mulmoclaude dependency check

Tracks: [#1049](https://github.com/receptron/mulmoclaude/issues/1049) — 依存欠落 UX 整備 umbrella。

## Umbrella 全体像 (#1049)

`#1049` のコメントで整理された PR 分割。**この plan は umbrella 全体を一覧したうえで、PR #1367 がカバーする範囲だけを切り出して扱う。**

| ID        | 内容                                                                               | この PR                                                      | 別 PR           |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------- |
| **PR-A**  | README に Prerequisites を明記 (ffmpeg / Docker / claude CLI / Node)               | ✅ #1367                                                     |                 |
| **PR-1a** | bundled system skill の配布機構 (`--plugin-dir` + `discoverSkills` 拡張)           |                                                              | ⏳              |
| **PR-1b** | `/setup-prerequisites` skill 本体 (依存欠落チェック汎用フレーム)                   |                                                              | ⏳ — PR-1a 依存 |
| **PR-1c** | Settings タブの依存欠落表示 (Gemini タブ横展開)                                    |                                                              | ⏳              |
| **PR-1d** | `npx` 利用者向けブラウザ onboarding                                                |                                                              | ⏳              |
| **PR-1e** | `yarn dev` 開発者向け onboarding skill                                             | 🟡 一部 (`setup-mulmoclaude` の dependency check 拡張で先行) | 残りは ⏳       |
| **PR-2**  | 各失敗経路 (動画 / PDF / 画像 / MCP / ブリッジ / scheduler) の Web UI 表面化 audit |                                                              | ⏳              |
| **PR-3**  | `UserFacingError` 型導入 (`message` / `cause` / `remediation` / `docsUrl`)         |                                                              | ⏳              |

## PR #1367 のスコープ

PR-A の完成版 + PR-1e の最小版だけを束ねて先出しする。**配布機構 (PR-1a) に依存しないので、umbrella の他 PR を待たずにマージできる。**

### Why this slice first

- ffmpeg 不在は **無言失敗** で、ユーザが原因に辿り着けない（issue 本文の症状）
- README と開発者向け skill の両方を直すと、`npx` 利用者と `yarn dev` 開発者の両経路をカバーできる
- インストール手順は **README を SoT** にして、skill 側は「何をチェックするか」だけ持つ ── 将来 puppeteer / playwright 等が増えても 1 行追加で済む
- 配布機構 (PR-1a) や typed error (PR-3) に依存しない最小スライス

### Changes in this PR

#### 1. README 8 ファイル (`README.md` + 7 localized) に `### Prerequisites` サブセクション

現状: Quick Start 直下の 1 行 blockquote（Node + Claude CLI のみ）。
変更: 独立したサブセクションに格上げし、ffmpeg / Docker を含めた依存リストを作る。英語版テンプレート:

```markdown
### Prerequisites

- **Node.js 20+** — runtime
- **[Claude Code CLI](https://claude.ai/code)** — installed and authenticated. Run `claude` once to complete OAuth
- **ffmpeg** — required for movie generation. Skip if you don't generate videos
  - macOS: `brew install ffmpeg`
  - Linux: `apt install ffmpeg`
  - Windows: `winget install Gyan.FFmpeg`
- **Docker Desktop** (optional but recommended) — enables sandbox mode. See [Installing Docker Desktop](#installing-docker-desktop) below
```

Localized 7 本 (`ja / zh / ko / es / pt-BR / fr / de`) は同じ構造で各言語に翻訳。Docker install セクションへのアンカーは各言語版の見出しに合わせる（`ja` → `#docker-desktop-のインストール`、`zh` → `#安装-docker-desktop`、`ko` → `#docker-desktop-설치`、`es` → `#cómo-instalar-docker-desktop`、`pt-BR` → `#instalando-o-docker-desktop`、`fr` → `#installer-docker-desktop`、`de` → `#docker-desktop-installieren`）。

#### 2. `.claude/skills/setup-mulmoclaude/` — 新規追加 (dependency check 付き)

未コミットだったので、ffmpeg + claude 認証チェックを含めた完成形を **新規 add**。

- `SKILL.md` Step 3 を **Dependency check** に拡張（`claude` CLI 認証 / Docker / ffmpeg を表で持つ）
- **インストールコマンドは持たない** — 不足時は README の `### Prerequisites` を参照させる（SoT 一本化）
- Pitfall 表に「Movie generation hangs / silently fails → ffmpeg missing」を追加
- `NOTES.ja.md` を SKILL.md と 1:1 で日本語訳

## PR #1367 で扱わない (別 PR で着手)

上の表で「別 PR」の行 (PR-1a / 1b / 1c / 1d / 1e の残り / 2 / 3) はすべてこの PR の外。それぞれ着手時に新しい plan ファイルを切る。

## Verification (PR #1367)

- [x] `yarn format` / `yarn lint` / `yarn build` がパス
- [x] Codex cross-review 2 iteration で LGTM convergence
- [x] localized README 7 本の Docker アンカーが各々の実在見出しに解決することを確認
- [x] README の Quick Start を上から読んで自然に流れる
- [ ] (manual) `/setup-mulmoclaude` を ffmpeg 未インストール環境で実行し、README Prerequisites への誘導が機能する
- [x] PR description に User Prompt + Summary + Items to Confirm を最上部に配置
