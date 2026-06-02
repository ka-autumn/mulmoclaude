# feat(wiki): mc-wiki-promote preset — Query→Page promotion (RFC #1491 Phase C v1)

## 背景

RFC #1491 Phase C = **Query→Page return-loop**。Karpathy「file
valuable answers back as new pages」。RFC 最後のフェーズ。Phase A
（`mc-wiki-ingest`）が外部ソース駆動、本フェーズは **チャットの Q&A**
駆動の page 生成。

## 設計（#1528 で Q1–Q6 合意）

| 軸 | 決定 |
|---|---|
| Q1 Trigger | 明示的ユーザートリガー（slash command / 自然言語起動）|
| Q2 Scope | Assistant + 直前ユーザー質問 の Q&A ペア |
| Q3 Target | LLM 提案（new slug or 既存 page）→ preview 確認 |
| Q4 Editor | TextResponseView 編集モード（**v2**、v1 はチャット内編集）|
| Q5 X-ref | v1 atomic（cross-ref なし、必要なら `mc-wiki-ingest`）|
| Q6 Privacy | preview 必須・編集可・サイレント commit 禁止 |

## v1 スコープ

**preset SKILL のみ**（Phase A/B/D と一貫した枠）。UI 変更なし。

- 起動: ユーザー発話 → SKILL 起動
- preview: SKILL が次の assistant ターンで slug / new-or-append / draft
  を提示（**まだ書かない**）
- 編集: ユーザーがチャット内で修正依頼 → SKILL 再生成
- commit: 確認後に書き込み（new page or `## Promoted YYYY-MM-DD` 追記
  + log 1行）
- bullet 単位の provenance marker `<!-- promoted: slug YYYY-MM-DD -->`
  （`source:` と区別、Phase B stale 検出条件）

## v2（別 issue / 別 PR・スコープ外）

- per-message "Promote" ボタン + TextResponseView modal preview
- 軽い secret-scan 警告（regex ベース）

## 変更ファイル

- `server/workspace/skills-preset/mc-wiki-promote/SKILL.md`（新規・唯一）
- `plans/feat-wiki-promote-1528.md`

ソース・エンドポイント・i18n の変更なし。新規コードゼロ。

## 検証

- 既存 preset sync テスト（glob ベース）が新規 dir を自動で拾う（35 件 pass）
- `yarn typecheck` green（.md のみ）
- 手動: launcher 起動 → `/skills` Catalog に `mc-wiki-promote` →
  ★ star → 任意の chat で「これ wiki にして」発話 → proposal が出る
  → confirm or edit → 書き込みされること、preview 段階では書き込まれ
  ないことを確認

## RFC #1491 全体完成

Phase A/B/C/D の全 4 phase が preset SKILL として揃う:
- D: `mc-wiki-health-check`（構造 lint, scheduled, RO, #1523）
- B: `mc-wiki-deep-lint`（LLM lint, on-demand, RO, #1526）
- A: `mc-wiki-ingest`（source-driven, on-demand, writes, #1529）
- C: `mc-wiki-promote`（chat-driven, on-demand, writes, **本 PR**）

Karpathy LLM-Wiki パターンの 3 操作（ingest / query / lint）が
完全カバー。
