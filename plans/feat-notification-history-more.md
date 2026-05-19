# feat: 通知履歴セクションに「もっと見る」を追加

Issue: receptron/mulmoclaude#1438

## User Prompt

> 通知履歴（NotificationBell の cleared 履歴セクション）は最大 50 件をパネル内スクロールでそのまま表示しているため、`docker が起動していません` のような繰り返し通知で埋まってしまう。履歴セクションだけ初期表示を制限して「もっと見る」で展開できるようにしたい。
>
> - 初期 5 件 / 閉じるボタンあり / 文言は「もっと見る (N)」で
> - worktree で作業、完了したら commit → `/codex-cross-review`

## 背景

- `HISTORY_CAP = 50`（[server/notifier/types.ts:116](../server/notifier/types.ts#L116)）で履歴は最大 50 件まで保持
- パネルは `max-h-[80vh]` で頭打ち + `overflow-y-auto` で**パネル内スクロール**になるため画面外にはみ出しはしない
- しかし 50 件が一気に DOM レンダリングされるためアクティブ通知の視認性が落ちる
- 同一 key の dedupe / 折りたたみは現状なし

## 変更方針

### 1. `src/components/NotificationBell.vue`

- 定数 `HISTORY_INITIAL_VISIBLE = 5` を追加
- `historyExpanded` ref を追加（初期 `false`）
- `displayedHistory` computed: 折りたたみ時は `visibleHistory.slice(0, HISTORY_INITIAL_VISIBLE)`、展開時は `visibleHistory` 全件
- `hiddenHistoryCount` computed: `visibleHistory.length - HISTORY_INITIAL_VISIBLE`（0 未満は 0 に clamp）
- template の `v-for` を `displayedHistory` に差し替え
- 履歴 `<ul>` の直後に切替ボタンを追加。`visibleHistory.length > HISTORY_INITIAL_VISIBLE` の時のみ表示
  - 折りたたみ時: `もっと見る (N)`（N = 隠れている件数）
  - 展開時: `閉じる`
- `open` を watch して、ベルを閉じたら `historyExpanded.value = false` に戻す（次回開いた時のスクロール位置を一定にする）
- 履歴セクションヘッダーの件数 `(N)` は**合計件数のまま**（隠れている件数を含む）

### 2. i18n キー追加（全 8 ロケール）

`notificationBell` 配下に以下を追加:

| key | en | ja |
|---|---|---|
| `showMore` | `Show more ({count})` | `もっと見る ({count})` |
| `showLess` | `Show less` | `閉じる` |

zh / ko / es / pt-BR / fr / de も同様に追加。placeholder `{count}` は全ロケールで verbatim 維持。

### 3. テスト

`e2e/tests/notifications.spec.ts` に追加:

- 6 件以上の cleared 履歴を `listHistory` mock で返す
- ベルを開いて履歴は 5 件しか描画されないこと
- 「もっと見る (N)」ボタンが見えること
- クリックで全件表示に切り替わること
- 「閉じる」ボタンに文言が切り替わること
- 再クリックで 5 件表示に戻ること
- ベル popup を閉じて再度開くと初期 5 件表示に戻ること

## スコープ外

- 同一 key 通知の dedupe / グルーピング
- 履歴の手動削除 UI
- 仮想スクロール
- アクティブセクションの表示変更

## 検証コマンド

リポジトリルート (または対応する worktree) で実行:

```bash
yarn format && yarn lint && yarn typecheck && yarn build
yarn test:e2e --grep "history more / less toggle"
```

Playwright を視覚確認したい場合は (global rule に従い `--debug` 付き):

```bash
cd <repo-root>/.claude/worktrees/feat-notification-history-more
yarn test:e2e --debug --grep "history more / less toggle"
```
