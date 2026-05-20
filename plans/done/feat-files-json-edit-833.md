# feat(files): JSON config inline editor — #833 Phase 1

## 背景

Files Explorer は markdown のみ Edit 可。`config/*.json` 等の構造化
設定ファイルは raw 表示のみで、ブラウザから編集できない（ターミナル
`vi`/`jq` か LLM 依頼の 2 択）。フォーマットを壊さず編集できる UI が
欲しい。本 PR は #833 の **Phase 1（Text mode + JSON validate）**。

## スコープ（Phase 1）

- **サーバ**: `PUT /api/files/content` で対象が `.json` の場合
  `JSON.parse` を実行、失敗なら 400 + 明示メッセージ。書き込み前に
  実行するので壊れた JSON はディスクに到達しない。`.jsonl` は各行が
  独立ドキュメントなので除外。整形（prettier）は Phase 1 では行わない
  （差分予測性を優先）。
- **クライアント**: FileContentRenderer の JSON プレビューに inline
  エディタ（Edit → textarea → Save/Cancel）。Save は既存の
  `updateSource`→`saveRawMarkdown`→`PUT files/content` 経路を再利用。
  400 は既存の `rawSaveError` バナーに表示し編集モード継続。
- **可視性ゲート**: `jsonEditableByPolicy(path)`（systemFileDescriptors,
  #832 の editPolicy 利用）。descriptor なし or
  `user-editable` / `agent-managed-but-hand-editable` のみ Edit 表示。
  `agent-managed` / `fragile-format` / `ephemeral` は非表示
  （agent/app 所有 state の破壊・脆弱フォーマットのリスク回避）。

## 設計判断

- 既存 `PUT /api/files/content`（text-only gate）に validate を 1 段
  足すだけ。新エンドポイント不要。
- エディタは markdown 編集と同じ generic save 経路を再利用（重複回避）。
- editable 判定はユーザー合意:
  user-editable + hand-editable + descriptor なし。

## 変更ファイル

- `server/api/routes/files.ts` — `jsonSyntaxError()` + PUT で 400
- `src/config/systemFileDescriptors.ts` — `jsonEditableByPolicy()`
- `src/components/FileContentRenderer.vue` — inline JSON editor
- `src/lang/{8}.ts` — `fileContentRenderer.editJson`
- `test/config/test_systemFileDescriptors.ts` — policy ゲート単体
- `e2e/tests/files-json-edit.spec.ts` — 編集→保存→反映 / 400→バナー /
  agent-managed→Edit 非表示

## 完了条件（Phase 1, issue より）

- [x] `.json` 選択時 Edit 表示（descriptor で suppress 可）
- [x] save 時 server-side `JSON.parse` validate + 400 + UI エラー
- [x] 保存成功で編集モード解除 + content 反映
- [x] read-only（agent-managed/ephemeral/fragile）は Edit 非表示
- [x] e2e: 編集→保存→反映 を pin

## スコープ外（後続 Phase）

- Phase 2: schema-aware form mode（#832 descriptor に JSON Schema）
- Phase 3: 保存前 before/after diff
- 保存時 prettier 正規化（オプトイン）
- 新規ファイル作成
