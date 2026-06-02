# feat: Encore plugin-seeded chat prompts を i18n で多言語化 (#1545)

## 背景 / 問題

Encore プラグインの top-bar ランチャー（`/encore` ダッシュボード）から起動できる導線は、英文の seed prompt をユーザーの最初の発話として注入してチャットを開始する。

seed prompt は LLM の最初の user turn になり、**応答言語のアンカー**になる。普段の手入力チャットで日本語が返るのは「ユーザーが日本語を打っているから」に過ぎず、`personal`/`ENCORE_SEED_ROLE_ID` の system prompt に「ユーザーの言語で返す」指示は無く、`server/agent/` 側で locale を LLM に渡してもいない。そのため英文 seed を注入すると、

- skill 風カードに英文がそのまま表示される
- LLM の応答まで英語化することがある

skill 起動（`/foo`）が英語化しないのは、seed が短いスラッシュコマンドのみで**英文の本文を注入しない**ため。つまり原因は「seed があること」ではなく「**英文プロンプト本文を seed していること**」。

## 方針: ランタイム翻訳ではなく静的 i18n

role の suggested queries は頻繁に追加・変更されるので LLM ランタイム翻訳（`/api/translation/translate` + Haiku）を使っている。一方この seed prompt は**ほぼ変わらない**ため、あらかじめ 8 言語訳を持っておく（vue-i18n の `src/lang/*.ts`）方が、初回レイテンシも LLM コストも無く決定的で良い（PR #1562 のレビューコメントでの合意）。

## 対象スコープ

seed prompt 注入箇所は 3 つある:

| # | 起点 | ハンドラ | 性質 | 本 PR |
|---|---|---|---|---|
| 1 | `+ Add` ボタン | `startSetupChat` | 静的・短い・クリック起点（locale 既知） | ✅ 実装 |
| 2 | obligation のチャットアイコン | `startObligationChat` | 動的（displayName 埋め込み）・クリック起点 | ✅ 実装 |
| 3 | 通知ベル | `resolveNotification`（`reconcile.ts` の `buildSeedPrompt`） | 長い LLM 指示プロンプト・reconcile（スケジュール実行）時に生成し ticket に保存 | ⏭ 別 issue（後述） |

`#1/#2` はクリック起点でブラウザ locale が既知。**訳文の所有はサーバ側**に置き、ブラウザは `locale` だけ送る（レビュー合意: 訳文がほぼ変わらないので、サーバが `src/lang` を直接読んで使う方が一貫する）。

## 実装（#1 / #2）

### 共有レジストリ: `src/lang/index.ts`（新規）

- `messages`(locale→辞書) / `SUPPORTED_LOCALES` / `Locale` / `isSupportedLocale` を **`vue-i18n` 非依存**で export。
- これでサーバ（Node）が `vue-i18n`（ブラウザ runtime）を引っ張らずに辞書を読める。
- `src/lib/vue-i18n.ts` もこのレジストリを import するよう書き換え、locale 一覧と messages マップの重複を解消。

### サーバ: `server/encore/handlers/`

- `shared.ts` に `localizedSeedPrompt(locale, key, params)` を追加。`src/lang/index.js` の `messages` を import し、`{displayName}` / `{obligationId}` をサーバ側で補間。未対応 / 省略 locale は `en` にフォールバック。
- `startSetupChat.ts` / `startObligationChat.ts`: zod スキーマを `seedPrompt` → **`locale: z.string().optional()`** に変更し、`message: localizedSeedPrompt(args.locale, …)` で生成。obligation の `displayName` は**サーバが読み込んだ DSL から**補間（クライアント由来でなく信頼できる値）。

### フロント: `src/plugins/encore/EncoreDashboard.vue`

- 訳文の組み立て（`t()` での compose）を撤廃。
- `startSetupChat()` / `startChatForObligation(obligationId)` の body に **`locale: locale.value` だけ**付与。`displayName` をフロントから渡す必要は無し。

### i18n: `src/lang/*.ts`（8 locale）

- `encoreDashboard.seedPrompts: { setup, obligation }` を全 locale に追加。
- `obligation` は `{displayName}` / `{obligationId}` プレースホルダを各 locale で verbatim 維持。
- ブランド/ツール名（`Encore` / `DSL` / `defineEncore` / `obligationId`）は英語のまま。
- displayName の囲みは ASCII エスケープ `\"` か CJK 角括弧「」を使用し、`de.ts` を壊す typographic quote（`„` / `“` = U+201E/U+201C）は使わない。

### テスト: `test/lang/test_encore_seed_prompts.ts`

副作用ゼロ（`startChat` を呼ばない）で次を検証:
- 全 locale に `seedPrompts.setup`（非空）/ `seedPrompts.obligation` が存在し、obligation は両プレースホルダを保持。
- `localizedSeedPrompt` が locale 別に選択・補間し、未対応 / 省略時に `en` へフォールバックする。

dispatch のハンドラ自体（`startChat` 経由）はセッションファイル書き込み + エージェント起動の副作用があり、`test_encore_dispatch.ts` も意図的にテストしていないため、ここでも呼ばない。

## トレードオフ / セキュリティ

- クライアントが送るのは **`locale` という短いタグだけ**で、プロンプト本文を送らない。未対応 / 不正な値はサーバが `en` にフォールバックするだけなので、クライアントがプロンプトへ任意文字列を注入する余地が無い。
- obligation の `displayName` はサーバが読み込んだ DSL から補間するため、クライアント由来の値で表示が汚れることもない。
- アプリの実効 locale は `vue-i18n`（フロント）状態であり、サーバは HTTP `Accept-Language`（OS 設定で、アプリ内 override を反映しない／dispatch ルートでハンドラに渡っていない）では正確に取れない。よって `locale` はフロントから明示送信する。

## #3（通知ベル）を別 issue にする理由

`#3` の `buildSeedPrompt` は **reconcile（スケジュール実行）時に生成**され ticket に保存される。その時刻にブラウザは居らず、サーバは locale を知らない（locale は `VITE_LOCALE` / `navigator.languages` 由来でサーバ未永続）。さらに中身の大半は `manageEncore` の呼び方・JSON 例などの **LLM 向け指示**で、8 言語に訳すと指示精度が落ちるリスクがある。

→ #3 は「翻訳」よりも、**locale を system prompt に注入して応答言語だけ揃える**方式が安全（プロンプト本文は英語のまま据え置き、`ENCORE_SEED_ROLE_ID` の system prompt に「The user's preferred language is `<locale>`」を埋め込む）。これは Encore に限らず plugin-seeded chat 全般に効く汎用対応でもある。

本 PR 発行後に #3 を別 issue として起票する。

## 完了条件

- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` がすべて通る
- [ ] `yarn test`（`test_encore_seed_prompts.ts` 含む）が通る
- [ ] PR 発行 → `/codex-cross-review` 収束
- [ ] #3 の follow-up issue 起票
