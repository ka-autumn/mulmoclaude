# feat(marp): Marp スライド (.md) を画面内で直接編集できるようにする

Issue: receptron/mulmoclaude#1646

## 背景

`src/plugins/markdown/View.vue:12-19` の `marpMode === true` 分岐は `<MarpView>` のみ render し、非 Marp 分岐 (`v-else`) にある下部 source-editor (`<details>` + textarea + Apply/Cancel) を露出していない。結果として **App 内で Marp スライドの .md を編集する手段がない** (file 直編集 or 外部 editor が必要)。

通常 Markdown 側のエディタ実装はそのまま流用できる:
- `editableMarkdown` ref と `applyMarkdown()` (`PUT /api/markdowns/update` 経由) は marp / 非 marp に依らず動作
- `MarpView` は `props.markdown` を watch しているので、保存後に親の `markdownContent` が更新されれば自動再描画

## 設計

最小コストで「とりあえず編集できる」を出す。

### 変更方針

`View.vue` の `<template v-else-if="marpMode">` を、現状の「`MarpView` のみ」から「`MarpView` + 下部 source editor bar」の 2 段構成に変える。

具体には、非 marp 分岐の `<div class="bottom-bar-wrapper">` ブロック (lines 67-82) を marp 分岐にも展開する。

- `MarpView` 本体は `flex-1 min-h-0` でメインエリアを占有 (既存通り)
- その下に `<details class="markdown-source">` の bottom bar を `shrink-0` で追加

### 流用するもの (変更不要)

- `editableMarkdown` ref
- `hasChanges` computed
- `applyMarkdown()` (PUT → markdownContent 更新 → emit updateResult)
- `cancelEdit()`, `onDetailsToggle()`
- `editing` ref
- `saveError` ref, `loadError` 関連
- i18n keys: `pluginMarkdown.editSource` / `applyChanges` / `cancel` / `saving` / `saveError`
- CSS (`.markdown-source` / `.markdown-editor` / `.editor-actions` / `.save-error`)

### marp 側で省くもの

- copy button (`.copy-btn`): MarpView の上に copy ボタン重ねるのは UX 的に微妙。最小では省略。要望が出たら別 issue
- PDF download bar: MarpView 内に既に "Export PDF" ボタンがあるので不要

### task-list checkbox 連動

`onMarkdownClick` は marp 分岐では使われない (`MarpView` は iframe sandbox で独立し、Vue の delegation を受けない) ので影響なし。

## 触るファイル

- `src/plugins/markdown/View.vue` — marp 分岐 template に bottom bar 追加のみ。script は無改変

## 受け入れ基準

- [ ] frontmatter `marp: true` の .md を開くと下部に「ソースを編集」 `<details>` panel が表示される
- [ ] panel を開いて textarea で編集 → Apply で disk 書き込み → MarpView preview が更新
- [ ] Cancel で編集破棄
- [ ] 非 marp Markdown の編集挙動 (task-list checkbox を含む) に regression なし
- [ ] e2e: 既存の markdown plugin テストに「marp: true ファイルの open → edit → save → preview reload」を追加
- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` 全 pass

## 非ゴール (別 issue)

- side-by-side ライブプレビュー — #1647
- CodeMirror / Monaco の syntax highlight 化 — #1647 と一緒に検討
- カスタム CSS / テーマ — #1649
- WYSIWYG — #1650 (discovery)
