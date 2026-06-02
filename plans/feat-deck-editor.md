# feat: presentMulmoScript に interactive deck editor を組み込む (#1575)

## 背景

`presentMulmoScript` の現状は **beat ごとに JSON 直書き**できる 1589 行の View — slide 編集には Keynote 的な WYSIWYG が欲しい。`@mulmocast/deck-web@0.5.1` が npm 公開済みで、`MulmoScriptDeckEditor` Vue コンポーネントが MulmoScript を v-model 風に受け取り編集する API を提供してる。これを既存プラグインに組み込む。

詳細議論: [#1575](https://github.com/receptron/mulmoclaude/issues/1575)

## スコープ (P1)

ユーザ意向で **「全 beat が slide の deck」に限定**。Mixed-content 対応は一切しない。

### 判定

```ts
const isAllSlideDeck = (script: MulmoScript) =>
  Array.isArray(script.beats) &&
  script.beats.length > 0 &&
  script.beats.every((b) => b?.image?.type === "slide");
```

- `true` → `<MulmoScriptDeckEditor>` のみ表示、既存 Beat list UI は出さない
- `false` → 既存 Beat list UI のみ (今までと完全に同じ)

View-mode toggle / しきい値判断 / mixed 配慮は **全部スコープ外**。

## 完了条件

- [ ] `@mulmocast/deck-web` を root `package.json` の dependency に追加 (`^0.5.1`)
- [ ] `isAllSlideDeck(script)` 二者択一で `presentMulmoScript/View.vue` を分岐
- [ ] `MulmoScriptDeckEditor` は `defineAsyncComponent` + dynamic `import()` で **lazy-load** (bundle size 対策)
- [ ] `@update:script` を **300ms debounce** で受けて `POST /api/mulmoScript/update-script` に丸ごと送る
- [ ] 既存の `AUTO_RENDER_TYPES` (`View.vue:1306`) に `"slide"` が含まれることを確認 → re-render が連鎖発火する
- [ ] `useFileChange` を配線して **chat 側からの `update-script` を UI が拾う**（リアルタイム同期）
- [ ] `docs/server/workspace/helps/presentation-deck.md` に「ユーザは UI で直接 deck を編集できる」旨を 1 行追記
- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` クリーン
- [ ] テスト fixture 2 種で round-trip:
  - `all-slide.json` (全 slide) → Deck Editor が mount、編集 → 保存 → re-render
  - `all-movie.json` (slide 0) → 既存 UI のみ、Deck Editor 出ない

## 設計

### データフロー

```
[UI 編集]
  └─ MulmoScriptDeckEditor.@update:script(next)
       └─ debounce 300ms
            └─ POST /api/mulmoScript/update-script  ← 既存 endpoint
                 └─ writeFileAtomic + publishFileChange  ← 既存
                      └─ [他タブ / 他経路の useFileChange が version bump]
                           └─ script 再 fetch → MulmoScriptDeckEditor に再注入
[Chat 編集]
  └─ LLM が presentMulmoScript 経由で update-script
       └─ 同じ writeFileAtomic + publishFileChange
            └─ UI 側 useFileChange が拾って再描画
```

### Vue 統合

```vue
<script setup>
import { computed, defineAsyncComponent } from "vue";

const MulmoScriptDeckEditor = defineAsyncComponent(() =>
  import("@mulmocast/deck-web").then((m) => m.MulmoScriptDeckEditor)
);

const isAllSlide = computed(() => isAllSlideDeck(script.value));
const onDeckUpdate = debounce(300, async (next) => {
  await apiPost(endpoints.updateScript.url, { filePath: filePath.value, script: next });
});
</script>

<template>
  <MulmoScriptDeckEditor
    v-if="isAllSlide"
    :script="script"
    @update:script="onDeckUpdate"
  />
  <ExistingBeatListView v-else ... />
</template>
```

`isAllSlideDeck` は pure helper、`src/plugins/presentMulmoScript/helpers.ts` に追加してテスト可能に。

### Bundle 戦略

`@mulmocast/deck-web` は Vue 3 components + 内部で deck rendering 含む小さくないライブラリ。**Deck-not 系の script (movie / podcast) を開いた時に load を発生させない**ために:

- `defineAsyncComponent(() => import("@mulmocast/deck-web"))` で chunk 分離
- `isAllSlide.value === true` の時だけ template でマウント → import が発火
- Vite が自動で別 chunk に分割するはず — `yarn build` 後の chunk size 確認

### Re-render

slide が編集されると pre-rendered image は古くなる。既存 `AUTO_RENDER_TYPES = ["textSlide", "markdown", "chart", "mermaid", "html_tailwind", "slide"]` (`View.vue:1306`) が `"slide"` を含む → `update-script` 後に再 hydrate される設計。**そのまま流用**。

追加 debounce で連打防止:

- UI 編集 → 300ms debounce → `update-script` 保存
- 保存後の re-render は既存 path に任せる
- もし re-render の連鎖が問題になったら別途 issue を起こして P2 で詰める

## 想定リスク

| リスク | 対応 |
|---|---|
| **Vue / Tailwind バージョン互換** | 実装一発目に `yarn add @mulmocast/deck-web@^0.5.1` して boot + DeckEditor mount の smoke だけ取る。peer dep mismatch があればここで露呈 |
| **deck-web の round-trip 制約** (reorder / mid-insertion 未対応) | 全 slide deck なので append-position 問題は起きない (新 slide は末尾追加でユーザ直感と合致しやすい)。reorder が無いことは MVP では受け入れ。 |
| **debounce 中の競合** (chat と UI が同時刻に書く) | last-write-wins。MVP は受け入れる。後で `useFileChange` の version が UI の pending edit を上書きしないようなマージは P3 |
| **bundle size 増** | dynamic import で吸収。`yarn build` 後の `dist/assets/` 内 chunk サイズを PR で報告 |
| **e2e の互換** | `e2e/tests/present-mulmo-script.spec.ts` が JSON 直書き UI に依存してたら回帰する。事前に grep で確認 |

## Phase

| Phase | 内容 | PR |
|---|---|---|
| **P1** | 本 plan の MVP (上記完了条件 全部) | 1 PR |
| **P2** | `useFileChange` で chat → UI realtime 同期の堅牢化 + 競合バナー検討 | 後続 issue |
| **P3** | Mixed-content 対応 (deck-web 0.6+ の reorder/insertion を待って) | 別 issue |

## 関連

- Issue: [#1575](https://github.com/receptron/mulmoclaude/issues/1575)
- Help: [`docs/server/workspace/helps/presentation-deck.md`](../docs/server/workspace/helps/presentation-deck.md) (#1574)
- 拡張機構の設計指針: [`docs/extension-mechanisms.md`](../docs/extension-mechanisms.md) §6.3 (新 plugin を増やさず既存拡張)
- npm: `@mulmocast/deck-web@0.5.1` (`MulmoScriptDeckEditor` export)
- Source ref: `src/plugins/presentMulmoScript/View.vue:1306` (`AUTO_RENDER_TYPES`)
