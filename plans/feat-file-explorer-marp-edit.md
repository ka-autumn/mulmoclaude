# feat(files): File Explorer から Marp md を編集できるようにする

Issue: receptron/mulmoclaude#1651

## 背景 / スコープ

- `/files/...` 経路は `FileContentRenderer.vue` で render される
- **非 Marp md** は既に `TextResponseView` 経由で inline 編集できる (Apply で `updateSource` emit → `FilesView` の `saveRawMarkdown` で PUT)
- **Marp md は read-only** — preview のみ。chat plugin 経路 (#1647) では split mode で編集可能だが、File Explorer 経路では編集手段なし
- 本 PR では **FileContentRenderer の Marp 分岐に編集機能** を追加

#1651 のもう一つの side (非 Marp md は File Explorer で編集可能か) は既存実装で OK なので、本 PR の作業は **Marp branch のみ**。

## 設計

JSON editor の既存パターン (`jsonEditing` / `jsonDraft` / `startJsonEdit` / `cancelJsonEdit` / `saveJsonEdit`) を踏襲:

| 項目 | 値 |
|---|---|
| トグル UI | MarpView の toolbar slot に "Edit" ボタン |
| layout (編集中) | 左 = textarea / 右 = MarpView (draft をライブ反映) |
| 編集確定 | `updateSource` emit → `FilesView` が PUT |
| Cancel | 編集破棄 + MarpView preview を `content.content` に戻す |
| 編集中の navigation | content change watcher で `marpEditing = false` |
| 失敗時 | `rawSaveError` を表示 (既存パターン) |

レイアウトは #1647 の split mode と同じ inline-style 戦術:
- `style="height: min(80vh, 720px); display: flex; overflow: hidden"`
- 左 column: `flex: 1 1 50%; min-height: 0; min-width: 0`
- 右 column: 同 + `overflow-y: auto`
- textarea: `flex: 1 1 0; min-height: 0`

FileContentRenderer は StackView 配下にないので `.stack-natural` の override は当たらないが、念の為 inline style で統一しておくと挙動が読みやすい。

## 触るファイル

- `src/components/FileContentRenderer.vue` — Marp 分岐に編集 UI 追加
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — i18n keys 追加 (`editMarp`, `marpEditorLabel`)

## 受け入れ基準

- [ ] File Explorer で Marp `.md` を開くと "Edit slide source" ボタンが MarpView toolbar に出る
- [ ] クリックで split mode (左 textarea / 右 preview) に入る
- [ ] textarea 編集で preview がリアルタイム反映
- [ ] Save で disk 反映 + preview-only に戻る
- [ ] Cancel で破棄 + preview-only
- [ ] 編集中の別 file 切替で edit mode 解除
- [ ] 非 Marp md / JSON edit / HTML / その他 file type に regression なし
- [ ] 8 locale i18n 追加
- [ ] `yarn format` / `lint` / `typecheck` / `build` / `test` 全 pass

## 非ゴール (別 issue)

- `markdown plugin View.vue` の split mode との共通コンポーネント化 — 動作確認できたら follow-up で抽出
- CodeMirror / Monaco syntax highlight
- WYSIWYG — #1650
