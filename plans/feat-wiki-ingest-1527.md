# feat(wiki): mc-wiki-ingest preset — Ingest workflow (RFC #1491 Phase A)

## 背景

RFC #1491 Phase A = **Ingest**。Karpathy「New source → LLM reads, writes
summary, updates 10–15 wiki pages, appends log」。RFC 初の **wiki 書き込み
あり** preset。Phase D (#1523) / Phase B (#1526) は read-only だったが、
これは設計上必ず書く。

## 設計（#1527 で Q1–Q6 合意済み）

| 軸 | 決定 |
|---|---|
| Input | ファイルパス / 貼り付けテキスト（URL fetch / batch は別フェーズ）|
| Size cap | **100 KB** ハード上限 → 超過時 reject |
| Write/Rollback | 各 write 独立、cross-ref **N=5 上限**、log = source-of-truth |
| Cross-ref 選定 | `index.md` + LLM 判断 + `manageWiki.graph` (#1520) |
| Idempotency | 既存 page には `## Updated YYYY-MM-DD` 追記 + log 1行（上書き禁止）|
| Provenance | 全 bullet に `<!-- source: <slug> YYYY-MM-DD -->`（Phase B stale 検出条件）|

## 仕様要点

- preset `mc-wiki-ingest` を `server/workspace/skills-preset/mc-wiki-ingest/SKILL.md` に追加
- ユーザーが ★ star するまで非アクティブ（既存ユーザー無影響）
- write 順序: **summary page → xref ≤5 → log.md（最後）**。log は
  **完了レジャー**（presence = 完了、absence + 新規ファイル = 部分状態）。
  中断時は log エントリが書かれず、`data/wiki/` を直接 diff することで
  partial state を認識・手動クリーンアップする
- prompt-injection 防御も明記（mc-wiki-deep-lint と同じ posture）

## 変更ファイル

- `server/workspace/skills-preset/mc-wiki-ingest/SKILL.md`（新規・唯一）
- `plans/feat-wiki-ingest-1527.md`

ソース・エンドポイント・i18n の変更なし。新規コードゼロ。

## 検証

- `test/workspace/test_skills_preset.ts` の glob ベース sync テストが
  新規 dir を自動で拾う（既存 35 ケース pass）
- `yarn typecheck` green（.md のみ）
- 手動: launcher 起動 → `/skills` Catalog に `mc-wiki-ingest` → ★ star
  → 任意ファイル/テキストで ingest 依頼 → summary page + 5 xref + log
  + provenance marker が反映されることを確認

## スコープ外

- **URL fetch / batch ingest**（後続フェーズ）
- **Phase C** Query→Page promotion (#1528)
- 本 skill の cross-ref 数を 5 超えるよう拡張 / staging mechanism
