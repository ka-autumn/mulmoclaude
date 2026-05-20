# feat(files): JSON editor → CodeMirror 6 (#1448 / #833 polish)

## 背景

#833 Phase 1 の inline JSON エディタはプレーン `<textarea>`（保存時に
サーバ `JSON.parse` で 400）。ハイライト無し・構文エラー位置が出ず、
ユーザは Save するまで崩れに気づけない。

## 設計判断

de-facto 比較の結果 **CodeMirror 6** を採用（軽量・tree-shakeable・
主流）。Monaco は小 config 編集に対しバンドル/worker 過剰で却下。
`vanilla-jsoneditor` は #833 Phase 2（tree/schema）で再評価。

## 実装

- deps: `codemirror` 系（`@codemirror/lang-json` `@codemirror/lint`
  `@codemirror/view` `@codemirror/state`）。
- `src/components/JsonEditor.vue`（新規, Composition API, `v-model`）:
  json ハイライト + `jsonParseLinter` でインライン構文エラー
  （サーバ 400 と相補）。`editor-label` prop → `EditorView.
  contentAttributes` の `aria-label`（a11y、旧 textarea 同等）。
  外部 modelValue 変更は doc 差分時のみ反映（タイプ中の clobber 回避、
  echo ループ防止フラグ）。
- `FileContentRenderer.vue`: textarea を JsonEditor へ差し替え。
  **`defineAsyncComponent` で遅延ロード** — CM6（~339KB raw）は
  JSON 編集を実際に開いた時だけ取得（初期バンドルから分離）。
  `data-testid="files-json-editor"` / Save・Cancel / jsonDraft フロー
  は不変。サーバ検証は維持（多層防御）。
- e2e: CM6 は contenteditable のため `.fill()`/`toHaveValue` 不可。
  `setEditorContent`（select-all → `insertText` で 1 トランザクション
  置換）に変更。3 ケース（保存往復 / 400 バナー / agent-managed は
  Edit 非表示）green。

## バンドル

- `dist/client` 12,204KB → 12,544KB。増分は **専用 lazy chunk
  `JsonEditor-*.js`（~339KB raw, gzip 配信で実転送はその数分の1）**。
  初期ロードパスには入らない（JSON 編集を開くまで未取得）。

## 変更ファイル

- `src/components/JsonEditor.vue`（新規）
- `src/components/FileContentRenderer.vue` — async 差し替え
- `e2e/tests/files-json-edit.spec.ts` — CM6 操作へ更新
- `package.json` / `yarn.lock` — CM6 deps
- plan

## テスト

- e2e 3/3 pass（lazy 後も）、lint(uncached)/typecheck green
- 手動: `/files` で `config/settings.json` を開き Edit → ハイライト＆
  壊すと赤波線、Save で 400 バナー / 正常で反映

## スコープ外

- #833 Phase 2: schema-aware form/tree（vanilla-jsoneditor 再評価）
- Phase 3: 保存前 diff
