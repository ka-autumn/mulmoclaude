# feat: /skills ページを #1335 の Active/Catalog 2 セクション構造に揃える

## 背景

当初この PR は `/skills` のサイドバーを **System / Project / User の 3 カテゴリ**で
グルーピングする案だった。並行して進む #1335
(skill catalog + star-to-activate model) が、サイドバーを
**★ Active / 📚 Catalog / 🛠 My Skills** という *prompt 包含状況 × 出自* 軸の
階層に再編する設計を持っており、main にはすでにその catalog 基盤
(`catalogPresets` / Star / Run once / Preview 右ペイン) がマージ済み。

3 カテゴリ案と #1335 の階層を同じ `View.vue` に併存させると PR-B 本実装で
必ず作り直しになるため、本 PR を #1335 の **トップフレームに直接合わせる**
方針に変更した（#1301 でのレビューやり取り経緯参照）。

## 仕様

### サイドバー = 2 つの折りたたみセクション

| キー | 中身 | prompt 入り | 初期状態 |
|---|---|---|---|
| `active` | `.claude/skills/` の skill（Claude Code が discover） | ✅ | open |
| `catalog` | launcher 管理 preset（閲覧 / ★star / ▶run once） | ❌ | open |

- 出自（System `mc-` 同梱 / Project / User）は **Active 内の行バッジ**
  (`sourceMeta` アイコン) として表示。独立した折りたたみグループにはしない
  （#1335 の `slug-a (mine)` / `mc-library (preset, starred)` 表記に合わせる）。
- 編集ガードは従来どおり `categorizeSkill` で provenance を判定し、
  Project のみ Edit/Delete を表示（UI + method 二段構え）。
- 折りたたみ状態は `localStorage` (`skills:sectionCollapsed`) に `string[]`
  で保存。両セクション初期 open。旧 `skills:groupCollapsed` は別キーなので
  読まない（移行はせず両 open から再開）。

### #1335 PR-C 送り

- 📚 Catalog の Anthropic / Community サブカタログ（backend 未実装）
- 🛠 My Skills を Active と独立ノードにする案 — 現 backend では
  user/project skill は既に Active に含まれるため、当面 Active 内
  `(mine)` バッジに畳む

### 触らないもの

- バックエンド API 形状、`SkillSummary` / `Skill` 型
- 既存 e2e セレクタ `data-testid="skill-item-{name}"`
- main 由来の catalog Star / Run once / Preview ロジック

### testid

- `skill-section-{key}` / `skill-section-toggle-{key}` /
  `skill-section-count-{key}`（`active` / `catalog`）
- `skill-item-{name}`（active 行・温存）
- `skill-catalog-item-{slug}`（catalog 行・main 由来）
- `skill-catalog-empty`（preset 0 件）

## 変更ファイル

- `src/plugins/manageSkills/categories.ts` — section モデルへ書き換え
  （`SKILL_SECTION_KEYS` / `loadCollapsedSections` 等）。`categorizeSkill`
  + `SYSTEM_SKILL_PREFIX` は編集ガード用に維持
- `src/plugins/manageSkills/View.vue` — 左カラムを Active/Catalog
  2 セクションに再構成
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — `categorySystem/Project/User`
  + `categoryLegend` を撤去し `sectionActive` / `sectionCatalog` /
  `sectionLegend` / `catalogEmpty` を 8 ロケール lockstep で追加。
  `catalogPresetHeading` を "Presets"（Catalog セクション配下の小見出し）に更新
- `test/plugins/manageSkills/test_categories.ts` — section API へ書き換え
  （`categorizeSkill` のエッジケースは維持）
- `docs/ui-cheatsheet.md` — `/skills` 節を Active/Catalog 図に更新

## テスト

- `yarn format` / `yarn lint` / `yarn typecheck`（vue-tsc + 全 workspace tsc）
  / `yarn build`
- `npx tsx --test test/plugins/manageSkills/test_categories.ts`

## スコープ外（別 PR）

- #1335 PR-C: Anthropic skills の git sparse checkout + scheduler sync
  + update バッジ、Community catalog
- backend が provenance を明示返却する案（現状 `mc-` フロント判定で十分）
