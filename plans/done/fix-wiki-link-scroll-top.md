# fix: wiki ページ間リンクで遷移時にスクロールが先頭に戻らない

## 症状

Wiki ページ内のリンク (`[[other-page]]` など) をクリックして別の Wiki
ページに遷移したとき、新ページの先頭ではなく、前ページのスクロール位置
を引き継いだ「中途半端な位置」が表示される。

## 根本原因

`src/plugins/wiki/View.vue` の `action === 'page'` 用 Content タブの
スクロールコンテナ (230 行目) に `ref="scrollRef"` が付いていない。

```html
<!-- 現状: scrollRef なし -->
<div v-show="pageTab === PAGE_TAB.content" class="flex-1 overflow-y-auto flex flex-col">
```

他のビュー (index/page-edit/log・lint) には `ref="scrollRef"` が付いて
おり、`watch(content)` で scrollTop=0 にリセットされる仕組み
(672-675 行目)。

```ts
watch(content, async () => {
  await nextTick();
  if (scrollRef.value) scrollRef.value.scrollTop = 0;
});
```

ページ→ページ遷移では `action` は `'page'` のまま `content.value`
だけ変わるため、スクロールコンテナは同じ DOM が再利用される。
`scrollRef.value` が `null` のためリセットがサイレントにスキップされ、
前ページのスクロール位置が残る。

## 修正

230 行目のコンテナに `ref="scrollRef"` を追加する。1 行の変更。

## E2E 観点

`e2e/` 配下の wiki テストには「リンククリック後の scrollTop 検証」は
存在しない。回帰検出用に最小のテストを追加するか、手動確認のみで済ませ
るかは PR レビューで判断。まずは修正のみコミットし、PR で議論する。
