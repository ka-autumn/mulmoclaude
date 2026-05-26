# feat(wiki): mc-wiki-health-check preset — weekly read-only lint (RFC #1491 Phase D)

## 背景

RFC #1491（Karpathy LLM-Wiki パターン取り込み）の Phase D。
ユーザー要望: **副作用のないものから着手**。

## 設計判断 — なぜ副作用なしか

- **preset の追加のみ**（`server/workspace/skills-preset/mc-*` 配下に新規
  ディレクトリ）。launcher は #1335 PR-A 以降 preset を
  `data/skills/catalog/preset/` に sync するだけで、**★ star されない
  限り自動でアクティブにならない**。既存ワークスペースの挙動はゼロ影響。
- 起動後に呼ぶ操作は既存 `manageWiki.lint_report` のみ。これは現状
  `src/lib/wiki-page/lint.ts` の `findBrokenLinksInPage` /
  `findMissingFiles` / `findOrphanPages` / `findTagDrift` を回す
  **完全 read-only** ルート。wiki への書き込みは一切しない。
- 既定スケジュールは `interval 168h`（≈ weekly）。ユーザーは star 後に
  `/automations` で頻度変更・停止可能。

## 仕様

- 新規ファイル: `server/workspace/skills-preset/mc-wiki-health-check/SKILL.md`
- frontmatter: `name` / `description` / `schedule: interval 168h`
- 本文:
  - `manageWiki` を `{ action: "lint_report" }` で呼ぶ
  - findings 0 件 → **1行で「Wiki is healthy (N pages checked)」のみ**
    返して終了（healthy week の沈黙が運用価値）
  - findings あり → カテゴリ別グループで簡潔に提示（broken links /
    missing refs / orphan pages / tag drift）。既存 `formatLintReport`
    の出力を貼るのを優先
  - **自動修正しない**: 各 finding は判断要件（rename vs delete 等）。
    ユーザーが個別に依頼してきた時のみ follow-up ターンで対応

## 変更ファイル

- `server/workspace/skills-preset/mc-wiki-health-check/SKILL.md`（新規・唯一）
- `plans/feat-wiki-health-check-1521.md`（このファイル）

ソースコード変更なし。新規ルート・新規ディスパッチなし。i18n 追加なし。

## 検証

- 既存 `test/workspace/test_skills_preset.ts` 26 ケース pass（preset
  sync は glob ベースなので新規 dir は自動で検出される）
- `yarn typecheck` green（.md のみ）
- 手動: launcher 起動 → `/skills` の Catalog に `mc-wiki-health-check`
  が現れる → ★ star → `/automations` に weekly エントリ → 実行で
  findings の有無に応じた応答

## スコープ外（RFC #1491 後続フェーズ）

- **Phase A**: `mc-wiki-ingest` 系の **書き込みあり** ワークフロー
- **Phase B**: LLM 駆動 lint（contradiction / stale claims /
  missing-concepts）。read-only にできるが LLM コスト/精度の設計が要る
- **Phase C**: Query→Page 昇格 UI（書き込みあり、UX 設計）
