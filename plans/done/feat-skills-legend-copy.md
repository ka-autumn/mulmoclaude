# feat: スキルパネルのコピー改善と「★スターを外す」ボタン

## User Prompt

ユーザーから `/skills` パネルの説明文（`sectionLegend`）が分かりづらいという指摘。「スター」が何をする操作なのか文面から読み取れない。

> ここの 説明がだめなのかも
> スターって何？

加えて、`mc-library` 等の preset 由来スキルを選択した詳細ペインで、「削除」ボタンの意味するところがおかしいという指摘:

> まった、ここってスターを外すが正しい？

→ `mc-*` プリセットはアクティブから削除しても launcher が起動時にカタログを再同期するため、実態は「★スターを外す」（カタログに戻す）操作。「削除」ラベルは破壊的に見えるが、データは取り戻せる。

## Summary

`/skills` パネルの 2 つの認知不一致を解消する:

1. **凡例 (`sectionLegend`) の説明不足** — 「★スター」「▶今だけ実行」が何をする操作か書かれていなかったのを、移動先（カタログ → アクティブ）と効果（毎ターン読み込まれる / 1 回だけ実行）まで含めて書き換える
2. **mc-\* アクティブスキルの「削除」ボタン** — preset 由来のスキルに対しては「★スターを外す」表示に切り替える。確認文も「カタログには残るので再有効化できます」に置換

## Items to Confirm / Review

- mc-\* スキルに対する「★スターを外す」は内部実装上は同じ `DELETE /api/skills/:name` を呼ぶ。launcher の `syncPresetSkills` ([server/workspace/skills-preset.ts](../server/workspace/skills-preset.ts)) がカタログを launcher 起動時に再同期するため、`.claude/skills/mc-library/` を削除してもカタログ層 `data/skills/catalog/preset/mc-library/` は残る — UX として「カタログに戻る」と表現して問題ないかレビュー希望
- preset の判定は **catalog membership lookup** (`catalogPresets` に `source === "preset"` のエントリがあるか) で行う。`isPresetActivation` ヘルパー (`src/plugins/manageSkills/presetDetection.ts`) に切り出し、unit test でカバー。Codex iteration-1 のレビューで「`mc-` 接頭辞だと writer が `mc-` namespace を予約していないので、ユーザーが project skill として `mc-foo` を作るとコピーと挙動が乖離する」と指摘されたため、authoritative source = カタログのエントリそのもの、に変更した。カタログのロード前 (race) は意図的に Delete (destructive) コピーへフォールバックする (安全側)
- i18n 全 8 言語の翻訳精度。`スターを外す` / `unstar` / `desmarcar` / `Stern entfernen` などの表現が各言語の語彙として自然か確認希望
- preset 由来でも `source === "project"` の場合は今まで通り編集可能 ([View.vue:586](../src/plugins/manageSkills/View.vue#L586) の `isSelectedEditable` は変更しない)。挙動として preset を編集 → 削除 → カタログから再有効化で「カタログ版」に巻き戻る、というフローは維持される

## Implementation

### 1. 凡例コピーの書き換え

[src/lang/en.ts](../src/lang/en.ts) `pluginManageSkills.sectionLegend` を 8 言語すべてで書き換え。日本語版の方向性:

```text
Claude がいま使えるスキル。会話の流れで Claude が自動的に使うほか、スキル名を指定して呼び出すこともできます。{system} システム(同梱 mc-) / {project} プロジェクト(編集可。このワークスペース専用) / {user} ユーザー(~/.claude/skills/ のスキル)。
カタログ: {star} を付けるとアクティブになるスキル。アクティブから {star} を外せばカタログに戻り、Claude は使わなくなります (削除はされません)。{runOnce} は追加せずに 1 回だけ実行します。
```

i18n placeholder の構造（`{system}` / `{project}` / `{user}`）はそのまま維持。

### 2. ボタンラベルの動的切り替え

[src/plugins/manageSkills/View.vue](../src/plugins/manageSkills/View.vue) で:

- `isSelectedPreset` computed を追加 — `isPresetActivation(detail.value?.name, catalogPresets.value)` で判定 (catalog membership)
- 削除ボタンのラベル / アイコン / 確認文を `isSelectedPreset` で分岐
  - true (preset): `material-icons` を `star_border` に / ラベル `btnUnstar` / 確認文 `confirmUnstar`
  - false (project user-authored): 現行通り `delete` / `btnDelete` / `confirmDelete`
- 既存の `data-testid="skill-delete-btn"` は維持（テストの後方互換）。preset の場合のみ追加で `data-testid="skill-unstar-btn"` を付ける

### 3. 新規 i18n キー

`pluginManageSkills.*` に追加（8 言語すべて）:

- `btnUnstar` — 「★スターを外す」
- `confirmUnstar` — 「{name} をアクティブから外しますか? カタログには残るので、いつでも再有効化できます。」

## Testing

- `yarn typecheck` で 8 言語の lockstep を検証（`typeof enMessages` 型ガードが効く）
- `yarn lint` / `yarn build` でビルド通過確認
- 手動: `/skills` を開き
  - 凡例が新しい文面で表示される
  - `mc-library` を選択 → ボタンが「★スターを外す」表記、確認文がカタログに残る旨を伝える
  - ユーザー作成の project スキル（mc- 接頭辞無し）を選択 → 「削除」表記のまま
