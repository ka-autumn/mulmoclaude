# feat: show app version in the web UI Settings modal (#1410)

## 背景

実行中のアプリ版（root `package.json` の version）が web UI から
一切見えず、特に `npx mulmoclaude` ユーザは古いキャッシュ版か判別
できない。バグ報告時の version 特定もできない。

## 仕様

- **サーバ**: 既存の `/api/health` レスポンスに `version` を追加。
  `server/system/appVersion.ts` が最寄りの `package.json` を
  module-load 時に 1 回読む。`../../package.json` 相対で dev
  （repo root）と tarball（`packages/mulmoclaude/`）の両方で正しく
  解決（launcher が publish 時に両者を lockstep 維持）。読めない
  場合は `"unknown"` にフォールバック + warn ログ。
- **UI**: SettingsModal ヘッダのタイトル下に小さく
  `MulmoClaude v{version}`（muted, `data-testid="settings-app-version"`）。
  モーダル open 時に `/api/health` を 1 回 fetch しキャッシュ。
- **i18n**: `settingsModal.version = "MulmoClaude v{version}"` を
  全 8 ロケールに lockstep 追加（ブランド名 + placeholder のため
  全ロケール同値）。

## 設計判断

- runtime（/api/health）採用。Vite build-time `__APP_VERSION__` は
  tarball で publish 時に焼き込まれ runtime 実体とずれ得るため不可。
- 配置は Settings モーダル（About 的定位置、ユーザー選択）。
  sidebar ロゴ / lockStatusPopup は将来別途。
- `errorMessage` / `log` の共有ユーティリティを使用（独自実装しない）。

## 変更ファイル

- `server/system/appVersion.ts`（新規）
- `server/index.ts` — `/api/health` に `version: APP_VERSION`
- `src/components/SettingsModal.vue` — fetch + 表示
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — `settingsModal.version`
- `test/system/test_appVersion.ts`（新規）

## テスト

- `APP_VERSION` == repo `package.json` version（独立に再導出）
- semver 形 / 非空 / 非 "unknown"
- `yarn format` / `lint` / `typecheck` / `build` / `test`
- 手動: Settings を開いて `MulmoClaude vX.Y.Z` 表示確認

## スコープ外

- sidebar ロゴ / lockStatusPopup への表示（将来）
- build-time inject 方式
