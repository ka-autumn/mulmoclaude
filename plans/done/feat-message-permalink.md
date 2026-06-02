# feat: message permalink bar in RightSidebar

## 背景 / 動機

debug 時に「このメッセージのリンクが壊れているから調査して」「この tool call 失敗してるから見て」と Claude にピンポイントで指示したい。現状は `/chat/<sessionId>` までしか共有手段がなく、その後 Claude 側で LLM 検索する無駄が発生する。

過去 `?result=<uuid>` を URL に書き込む機能はあった (#dropped in 179587b1, 2026-05-14)。外した理由は「選択するたび URL バーに反映される副作用 = browser back ボタンが panel-selection の undo になる anti-pattern」のため、permalink 文字列そのものを否定したわけではない。

## 方針

- ブラウザ URL バーには反映しない（`router.push` しない、back を汚さない）
- アプリ内のデバッグ pane (`RightSidebar`) に readonly な permalink フィールドを置き、コピーボタンで Claude にペーストできる文字列を提供
- 新規 ID 発行はしない。既存の `ToolResultComplete.uuid` をそのまま使う
- 形式: `/chat/<sessionId>?result=<uuid>` (過去の規約をそのまま復活、URL 文字列としてのみ)
- `sessionId` か `resultUuid` どちらかが欠けたらセクションごと非表示 (helper が `null` を返し `v-if` で隠す)。「選択中メッセージへの…」というラベルが空振りしないようにするため、session-only fallback URL は出さない

## スコープ外（今回やらない）

- TextEntry / SkillEntry への uuid 発行（JSONL schema 拡張）
- tool call 履歴の各行ホバーで個別コピーボタン
- `?result=` URL を Claude 側でパースして対応行を読む補助 (Claude は workspace の JSONL を直接読めるので URL 文字列だけあれば足りる)

## 変更ファイル

1. `src/components/RightSidebar.vue` — 最上段に Permalink セクション追加
   - props 追加: `sessionId: string | null`, `selectedResultUuid: string | null`
   - permalink computed: `sessionId` と `selectedResultUuid` が両方揃った時のみ `?result=<uuid>` 付き URL を返す。どちらか欠けたら `null` でセクション非表示
   - origin は `window.location.origin` で組み立て
   - コピーボタンは既存 `useClipboardCopy` を流用、既存 [copy-tool-call-history] と同じ UI 言語

2. `src/App.vue` — `<RightSidebar>` 呼び出しに `:session-id="activeSession?.id ?? null"` と `:selected-result-uuid="selectedResultUuid"` を渡す

3. `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — `rightSidebar` 配下に 3 keys を追加
   - `permalink` (セクションタイトル)
   - `copyPermalink` (ボタン aria/title)
   - `copiedPermalink` (コピー直後の表示)

## UI イメージ

```text
┌─ Right Sidebar ──────────────────────────────┐
│ PERMALINK                                     │
│ ┌──────────────────────────────────────┬───┐ │
│ │ /chat/<sessionId>?result=<uuid>      │ 📋│ │
│ └──────────────────────────────────────┴───┘ │
│ ───────────────────────────────────────────── │
│ システムプロンプト                          ▼│
│ …                                             │
└───────────────────────────────────────────────┘
```

## テスト

- yarn typecheck / yarn lint / yarn build が通ること
- 手動: チャットを開き、stack のカードをクリックして選択 → permalink の `?result=` 部分が変化することを目視確認
- 手動: コピーボタンクリック → クリップボードに URL が入っていること、アイコンが check に変わること
- 手動: 別チャットへ切り替え → permalink の sessionId が追従すること

E2E は今回追加しない（既存 e2e/ への影響なし、RightSidebar の追加セクションだけ）。

## ロールアウト

worktree → feat ブランチ → PR → codex-cross-review → ユーザーがマージ。
