# refactor(marp): extract MarpSplitEditor (shared split-pane layout)

## 背景

PR #1658 (markdown plugin `View.vue` split mode) と PR #1663 (FileContentRenderer Marp editor) で **同じ 50/50 split layout** が独立して 2 箇所にコピーされている:

- `style="height: min(80vh, 720px); display: flex; overflow: hidden"`
- 左 column: textarea + toolbar
- 右 column: `<MarpView :markdown="draft">` (live preview)
- inline-style 戦術で `.stack-natural` overrides を回避

CSS / template の双方で **数十行のコピペ**。1 箇所変えたら 2 箇所修正の負担、片方だけ regression が出る危険もある。

## 目的

`src/plugins/markdown/MarpSplitEditor.vue` (新規) に **layout だけ** を切り出し、Action ボタン / Apply・Cancel・Save の振る舞いは slot で受ける形にする。MarpView は内側に直接 mount。

## API 設計

```ts
defineProps<{
  modelValue: string;        // draft buffer (textarea v-model)
  pdfFilename: string;
  baseDir?: string;
  editorLabel: string;       // i18n キーは呼び出し側で解決
}>();

defineEmits<{
  "update:modelValue": [value: string];
}>();
```

Slots:
- `actions` — 右上のボタン群 (apply/cancel/save 等、呼び出し側のスタイルそのまま)
- `error` — toolbar と textarea の間に挟むエラー表示 (optional)
- `preview-toolbar` — 右 pane の MarpView 内ツールバー (preview-only / close-split など)

## 触るファイル

- `src/plugins/markdown/MarpSplitEditor.vue` (新規)
- `src/plugins/markdown/View.vue` — split mode 分岐を `<MarpSplitEditor>` で書き換え、内部の textarea CSS を削除
- `src/components/FileContentRenderer.vue` — marp 編集分岐を `<MarpSplitEditor>` で書き換え
- `src/lang/*` — i18n キー無改変 (呼び出し側で `t(...)` を解決して渡す)

## 受け入れ基準

- [ ] split mode の挙動 (live preview / apply / cancel / aria-label / `.stack-natural` 配下での高さ) に regression なし
- [ ] FileContentRenderer の marp 編集 (start / save / cancel / content watcher) に regression なし
- [ ] `yarn format` / `lint` / `typecheck` / `build` / `test` 全 pass
- [ ] dev で 2 surface (chat plugin View / File Explorer) を実機確認

## 非ゴール

- 機能追加 (resizer / CodeMirror / debounce) は別 issue
- Apply / Save の状態管理ロジック (`editableMarkdown` / `marpDraft` / `applyMarkdown` / `saveMarpEdit`) は呼び出し側に残す — 共通化すると差異吸収で複雑化するので留保
