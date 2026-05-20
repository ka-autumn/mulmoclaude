# perf(prompt): topic memory context = index-only (#1432)

## 問題

実行時 system prompt が実ワークスペースで ~46KB（~12K トークン）。
うち **~78%（~36KB）が Memory ブロック**。`formatTopicFileForPrompt`
（server/agent/prompt.ts）が **全 topic ファイルの body 全文**を毎ターン・
全セッションでインライン（10数トピック、その大半は当該メッセージと無関係）。

## なぜ冗長か

同関数は既にトピックごとの**索引行**
（`[type] <type>/<topic>.md — section1, section2`）を出力し、system
prompt も「関連トピックは `Read` してから答えよ」と既に指示済み
（proactive-recall）。＝ *索引 + 遅延 Read* 設計なのに body も全文同梱＝
二重持ち。summaries は既に pointer 方式（`prependJournalPointer`）。

## 変更（Option A）

`formatTopicFileForPrompt` を**索引行のみ**返すよう変更（body 削除）。
section ヒント（Read 判断の検索シグナル）は維持。Memory `<reference>`
の topic 分岐先頭に「これは pointer であり中身はファイルにある。関連
時は該当 `conversations/memory/<type>/<topic>.md` を Read せよ」の
明示ヘッダを追加。

**スコープ: topic 形式のみ。** atomic / legacy `memory.md` は #1029 の
移行用 scaffolding（2026-07-01 撤去予定、実ワークスペースは未使用）の
ため無改修。

## 効果（ユーザ提供スナップショットで実測）

| | before | after |
|---|---|---|
| Memory ブロック | ~36,110 B | ~1,571 B（索引29行）|
| prompt 全体 | ~46,175 B | **~11,600 B（約75%減）** |

代償: メモリが実際に関連するターンで `Read` 1往復が増える。大半の
ターンでは10数トピックの大半が無関係なので純益大。

## 変更ファイル

- `server/agent/prompt.ts` — `formatTopicFileForPrompt` 索引のみ化 +
  topic 分岐に pointer ヘッダ
- `test/agent/test_topic_memory_context.ts` — 索引行 present / body
  absent / pointer ヘッダ present にアサート更新

## テスト

- `test_topic_memory_context.ts` 更新、`test_memory_context.ts`
  （atomic）/ `test_agent_prompt.ts` は無改修で pass（計 56 pass）
- lint / typecheck green

## スコープ外

- atomic / legacy memory.md の pointer 化（移行 scaffolding、別途）
- 静的 SYSTEM_PROMPT の helps 退避（別 issue 候補・小幅）
