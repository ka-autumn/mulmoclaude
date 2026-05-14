# docs: ffmpeg prerequisite + setup-mulmoclaude dependency check

Tracks: [#1049](https://github.com/receptron/mulmoclaude/issues/1049) のうち **短期分（PR-A）**。

## Scope

`#1049` の umbrella（依存欠落 UX 整備）のうち、低コスト・即効性のある「ドキュメントと skill での予防」だけをこの PR で扱う。bundled system skill の配布機構（PR-1a）や Web UI 表面化（PR-2）、`UserFacingError`（PR-3）は別 PR で扱う。

### Why this slice first

- ffmpeg 不在は **無言失敗** で、ユーザが原因に辿り着けない（issue 本文の症状）
- README と開発者向け skill の両方を直すと、`npx` 利用者と `yarn dev` 開発者の両経路をカバーできる
- インストール手順は **README を SoT** にして、skill 側は「何をチェックするか」だけ持つ ── 将来 puppeteer / playwright 等が増えても 1 行追加で済む
- 配布機構（PR-1a）に依存しないので、umbrella を待たずにマージ可能

## Changes

### 1. `README.md` — `### Prerequisites` サブセクション化

現状: Quick Start 直下の 1 行 blockquote（Node + Claude CLI のみ）。
変更: 独立したサブセクションに格上げし、ffmpeg / Docker を含めた依存リストを作る。

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

### 2. `.claude/skills/setup-mulmoclaude/` — initial commit (with dependency check)

未コミットなので、ffmpeg + claude 認証チェックを含めた完成形を **新規 add**。

- `SKILL.md` Step 3 を **Dependency check** に拡張（Docker / ffmpeg / claude CLI を表で持つ）
- インストールコマンドは持たず、不足時は **README の `### Prerequisites` を参照**させる（SoT 一本化）
- Pitfall 表に「Movie generation hangs / silently fails → ffmpeg missing」を追加
- `NOTES.ja.md` を SKILL.md と 1:1 で日本語訳

### 3. Localized README 7 本 (`ja / zh / ko / es / pt-BR / fr / de`) も同じ構造に更新

英語版と同じく、line 39 の 1 行 blockquote を `### Prerequisites` サブセクションに展開し ffmpeg / Docker を含めた依存リストを各言語で書く。Docker install セクションへのアンカーは各言語版の見出しに合わせる（例：`ja` は `#docker-desktop-のインストール`、`zh` は `#安装-docker-desktop`）。Codex iteration 1 で localized README に drift が残ることが指摘されたため scope に追加。

## Out of scope (別 PR で扱う)

- bundled system skill の配布機構（`--plugin-dir` + `discoverSkills` 拡張） — PR-1a
- `npx` 利用者向けブラウザ onboarding — PR-1d
- 各失敗経路の Web UI 表面化 audit — PR-2
- `UserFacingError` 型導入 — PR-3
- Settings 画面の依存欠落タブ（Gemini タブ横展開） — PR-1c

## Verification

- [ ] `yarn format` / `yarn lint` / `yarn build` がパス
- [ ] README の Quick Start を上から読んで自然に流れる
- [ ] `/setup-mulmoclaude` を実行して、ffmpeg 未インストール環境で「Prerequisites を見て install してください」と案内される
- [ ] PR description に User Prompt + 設計判断（SoT 一本化）を明記
