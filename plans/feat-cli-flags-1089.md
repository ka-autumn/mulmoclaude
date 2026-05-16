# feat: --disable-sandbox + bundled boolean CLI flags (#1089)

## 背景

サンドボックス無効化など launch 時の boolean トグルは `VAR=1 cmd` の
env-var prefix でしか渡せず、以下で不便:

- Windows PowerShell の `npx mulmoclaude` はインライン `VAR=value cmd` 不可
- IDE / launcher の run config は引数前提
- アドホックなデバッグで毎回 prefix を打つのが手間

#1089 は `--disable-sandbox` を要望。issue 本体の "Out of scope" で
「他 env var の同種フラグは別スコープ」とあるため、同じ性質の
boolean トグルを 1 PR でまとめて対応する（ユーザー合意済み）。

## スコープ

CLI flag 化するのは **launch 時の boolean トグル 5 つ**:

| flag | env var | 用途 |
|---|---|---|
| `--disable-sandbox` | `DISABLE_SANDBOX` | サンドボックス無効化（#1089 本体） |
| `--disable-macos-reminders` | `DISABLE_MACOS_REMINDER_NOTIFICATIONS` | macOS Reminder 通知 sink 無効化 |
| `--persist-tool-calls` | `PERSIST_TOOL_CALLS` | tool_call を session jsonl に永続化（デバッグ） |
| `--journal-force-run` | `JOURNAL_FORCE_RUN_ON_STARTUP` | journal pass を起動時即実行 |
| `--chat-index-force-run` | `CHAT_INDEX_FORCE_RUN_ON_STARTUP` | chat-index pass を起動時即実行 |

**除外**: シークレット系（`MULMOCLAUDE_AUTH_TOKEN` / `GEMINI_API_KEY`
/ `X_BEARER_TOKEN` / `RELAY_TOKEN`）は argv が `ps`・シェル履歴に
漏れるため env 専用維持。`--port` は launcher に既存。値持ち
（`SANDBOX_SSH_*` / `SESSIONS_LIST_WINDOW_DAYS`）はニッチで別スコープ。

env var は並行サポート継続（CI スクリプト / 既存 docs が依存）。

## 設計

単一の真実源 = `server/utils/cli-flags.mjs`（`dev-plugin-args.mjs` /
`port.mjs` と同じ「launcher は tsx 前なので .mjs」規約。`.d.mts`
で型）:

- `CLI_FLAGS`: `{flag, env, help}[]` — flag↔env↔help の対応表
- `flagEnvOverrides(argv)`: launcher 用、present flag → `{ENV:"1"}`
- `cliFlagHelpLines()`: `--help` テキスト生成（ドリフト防止）

**2 経路、同じ内部スイッチ:**

1. **launcher (`bin/mulmoclaude.js`)**: argv をパースし
   `flagEnvOverrides` の結果を `serverEnv` に注入（launcher は
   spawn に argv を渡さない設計なので env 注入が正路）。`--help`
   に `cliFlagHelpLines()` を差し込み。
2. **server (`system/env.ts`)**: `process.argv` も見るよう
   `flagOf(envName)` = `asFlag(process.env[X]) || argvEnabledEnv`。
   `tsx server/index.ts` 直叩き／`yarn dev --<flag>` を救済。
   argv セットは env スナップショットと同じ module-load 時に確定。

両経路とも最終的に `env.disableSandbox` 等の同じフラグを立てる
ので下流（`docker.ts` / `sandboxStatus.ts` 等）は無改修。

## 変更ファイル

- `server/utils/cli-flags.mjs` + `cli-flags.d.mts`（新規）
- `server/system/env.ts` — `flagOf` + 5 フィールド差し替え
- `packages/mulmoclaude/bin/mulmoclaude.js` — flag 注入 + `--help`
- `README.md` ほか 8 ロケール — env-var とフラグ両形式を併記
  （code block 全 8 共通 + 各ロケールの debug-mode 文に追記）
- `server/workspace/helps/sandbox.md` — 両形式 + flag 一覧
- `test/utils/test_cliFlags.ts`（新規）— `flagEnvOverrides` /
  `cliFlagHelpLines` / `CLI_FLAGS` 整合の単体テスト

## テスト

- `flagEnvOverrides`: 0/1/複数/不明 flag、順不同
- `cliFlagHelpLines`: 各 flag 行を含む・整列幅
- `CLI_FLAGS`: secret 系を含まない（回帰防止）
- `yarn format` / `lint` / `typecheck` / `build` / `test`
- 手動: `npx mulmoclaude --disable-sandbox` と
  `yarn dev --disable-sandbox` で sandboxStatus が一致、`--help`
  に新フラグ表示

## スコープ外

- 値持ち env var の CLI 化（`--port` 以外）
- env var 自体の廃止（並行維持）
- secret 系の CLI 化（セキュリティ上やらない）
