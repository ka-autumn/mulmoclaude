# feat(collections): curated collection registry — author / curate via PR / discover & import in-app

Issue: receptron/mulmoclaude#1814
Registry repo: `receptron/mulmoclaude-collections` (public, bootstrapped by Workstream B)

## Summary

ユーザが作ったコレクション（`schema.json` + custom view + 任意 seed）を、我々が管理する公式レジストリ
repo（`receptron/mulmoclaude-collections`）へ PR で寄稿 → CI＋人手で審査・merge → 他ユーザは mulmoclaude の
`/collections`「発見」タブから **index.json 経由**で発見・取り込みできるようにする。

既存 external-skill 機構（clone → catalog → ★star=fork → discovery）の**宛先・schema 検証・view サンドボックスを
再利用**し、**供給源だけ index＋単一 collection fetch に差し替える**。書き込み系 API・discovery・検証・
サンドボックスは無改修。

## Items to Confirm / Review

- R2: index を **GitHub Pages/Release 配信**（main を bot commit で汚さない）で良いか。
- R3: 取り込み時に schema の `dataPath` を **`data/collections/<localSlug>/items` へ強制正規化**する判断。
- R9: `meta.json.author` を **PR 作成者の GitHub login と CI で一致検証**する（なりすまし防止）。
- seed: **実データ込みを許可**（本人責任）＋ PII スキャンは警告止まり、**credential 検出のみ hard fail**、で良いか。
- 実装の進行は Workstream B（レジストリ repo bootstrap）→ Workstream A（host）の順。本 plan の B が先行 PR。

## User Prompt（原依頼の統合）

ユーザ（本アプリ作者）からの依頼を会話横断で統合:

- collections 機能は「データ構造だけ」なのか「skill も含む」のか、カスタムビューは「データだけ」なのか、
  その仕組み・仕様を知りたい。そのうえで**これらを配布する方法を考えてほしい**。
- 配布のユーザシナリオ: ユーザが作ったコレクション・カスタムビューを **PR で我々が管理するレポジトリに送る**。
  それを我々が審査して取り込む。他ユーザは mulmoclaude からそのレポジトリを参照し、良いコレクションを
  発見したら取り込みたい。取り込み側は GitHub を直接ではなく、**バックエンドで GitHub の index ファイルを
  見てデータを出しても良い**かも。その **GitHub の構造も含めて**考えてほしい。
- 詰めた前提（フォーム回答）: ① 新規 repo `receptron/mulmoclaude-collections` を切る。② seed は**寄稿者の
  実データ込みも許可（本人責任）**。③ 識別子は**作者名前空間 `collections/<author>/<slug>/`**。④ issue の
  単位はおまかせ。⑤ **author は GitHub アカウントとして、CI で一致するかも確認**する。
- 進め方: `gh issue create` で issue 化し、ブランチを切って plan を書き出し、そして実装する。collections の
  レポジトリは作成済み。

## Background — 現状の配布機構とギャップ

- 既存 **external-skill 機構**（#1383 / #1386, 2026-05）: git URL を clone → `SKILL.md` を持つフォルダを発見 →
  `data/skills/catalog/external/<repoId>/` へコピー → ★star で `.claude/skills/<slug>/` に fork → discovery が
  `/collections/<slug>` を描画。schema 検証 = `packages/core/src/collection/server/validate.ts`（host discovery と
  `putSchema` が共有）。view サンドボックス = CSP / CDN 許可リスト / phone-home 禁止。
- 実績: `anthropics/skills` を出荷当日に 1 回 install したのみ、**star 実績ゼロ**。コレクションを配った実績は無い。
- ギャップ:
  1. star/install は **skill フォルダしか運ばない** = `data/<name>/items/` の**レコードは配布されない**。
  2. 読み取り系 API（`catalogList`/`catalogPreview`）は **SKILL.md しか見ない** = コレクション（schema.json）か
     判別できず、icon/fields/views を返さず、「コレクションとして発見」できない。
  3. clone は **repo 丸ごと** = 多数 collection を抱えるレジストリには重い。
  4. `dataPath` が schema にハードコード = 他人由来だと衝突する。

## Decisions（確定 R1–R9）

| # | 決定 |
|---|---|
| R1 | 取り込み源 = index＋単一 collection fetch を新設、clone（external-skill）は温存 |
| R2 | index = CI 生成 → GitHub Pages/Release 配信、backend は 1GET + ETag + サーバ側キャッシュ |
| R3 | 取り込み時 dataPath を `data/collections/<localSlug>/items` へ正規化。local 衝突時のみリネーム |
| R4 | screenshot 任意、欠落時は「アイコン＋フィールド要約＋view ラベル」カードでフォールバック |
| R5 | 更新 = bundle 差し替え・records 保持・field 集合差分は警告のみ。schema migration は punt（別 issue） |
| R6 | v1 公式 1 本＋index.json を `schemaVersion` 付き公開契約として設計（将来の任意 URL 追加に備える） |
| R7 | index は表示用。fetch した実体を `packages/core` で再検証してから着地（index は信頼境界でない） |
| R8 | 既存 localSlug は更新（再取り込み）扱い |
| R9 | `meta.json.author` = GitHub アカウント。CI が PR 作成者の login と一致検証。path の `<author>` とも一致必須 |
| seed | 寄稿者の実データ込み可（本人責任）。PII/個人情報は警告止まり＋PR で本人 affirmation。credential/secret は hard fail |

## 識別子・パスの確定仕様

- レジストリ global id: `<author>/<slug>`（author = 認証済み GitHub login）。
- repo path: `collections/<author>/<slug>/`。
- local install: `localSlug` の既定は `<slug>`。local 衝突時のみ `<author>-<slug>` 等にリネーム（または取込時に
  ユーザへ提示）。URL は `/collections/<localSlug>`。
- dataPath: 取込時に `data/collections/<localSlug>/items` へ正規化（schema の authored dataPath は信用しない）。
- provenance: `.claude/skills/<localSlug>/.origin.json` に
  `{ registry, author, slug, version, contentSha, importedAt }` を記録。

## Workstream B — registry repo（`receptron/mulmoclaude-collections`）★ 先行

### 構造
```
mulmoclaude-collections/
  index.json                         ← CI 生成。backend が読む唯一の入口（R2）
  schema/                            ← contracts（JSON Schema）
    meta.schema.json
    index.schema.json
  collections/
    <author>/<slug>/
      SKILL.md   schema.json   meta.json
      screenshot.png（任意）  views/*.html  templates/*.md  seed/items/*.json（任意）
  scripts/
    build-index.mjs                  ← collections/ を走査して index.json を再生成
    validate.mjs                     ← meta/schema/seed/view/identity を検証
    lib/                             ← 共有ロジック（collection 列挙・schema 要約）
  .github/
    workflows/{pr-validate.yml, build-index.yml}
    PULL_REQUEST_TEMPLATE.md
  CONTRIBUTING.md   README.md   LICENSE
```

### meta.json（流通情報の単一ソース）
```jsonc
{ "author": "isamu",          // = GitHub login（R9: CI が PR 作成者と一致検証）
  "slug": "movies",
  "version": "1.0.0",         // semver。破壊的 schema 変更 = major
  "title": "映画リスト", "description": "…",
  "tags": ["entertainment"], "license": "MIT",
  "dataConsent": true }       // seed に実データを含む場合の本人 affirmation
```

### index.json（versioned public contract）
```jsonc
{ "schemaVersion": 1, "generatedAt": "…", "registry": "receptron/mulmoclaude-collections",
  "collections": [{
    "id": "isamu/movies", "author": "isamu", "slug": "movies",
    "title": "映画リスト", "icon": "movie", "description": "…",
    "version": "1.0.0", "tags": ["entertainment"], "license": "MIT",
    "fieldCount": 14, "views": ["シネマ"], "hasSeed": true, "seedCount": 16,
    "screenshot": "collections/isamu/movies/screenshot.png",
    "path": "collections/isamu/movies", "contentSha": "…" }] }
```

### scripts
- `build-index.mjs`: `collections/<author>/<slug>/` を走査し、`schema.json`/`meta.json` から index エントリを
  生成。`contentSha` は collection 配下（screenshot を除く）の安定ハッシュ。
- `validate.mjs`: ① meta 必須項目・semver・`mc-` 禁止・slug 一意 ② schema を host と同等ルールで検証
  ③ seed を schema＋id charset で検証、credential/secret 検出（hard fail）、PII（warn） ④ view の CSP 静的 lint
  ⑤ identity（`--pr-author` 指定時、`meta.author` == PR 作成者・path == author/slug）。
- 当面 validate は **自己完結（依存最小）** に実装。将来 `packages/core` の検証器を npm 経由で共有する余地を残す。

### CI
- `pr-validate.yml`（PR 時）: `node scripts/validate.mjs --changed --pr-author "${{ github.event.pull_request.user.login }}"`。
- `build-index.yml`（main push 時）: `node scripts/build-index.mjs` → index.json を **GitHub Pages/Release** に publish
  （main を bot commit で汚さない）。

### 例 collection
- `collections/isamu/movies/` に既存 movies コレクション（SKILL.md + schema.json + views/cinema.html）を移植し、
  パイプライン（validate → build-index）を実証。seed は demo 用の数件のみ。

## Workstream A — host（`receptron/mulmoclaude`）

1. **contract 型**: index.json/meta.json の型と検証を `packages/core/src/collection/registry/`（新規）に置く。
2. **読み取り系の新エンドポイント**（既存 `catalogList`/`catalogPreview` は無改修）:
   - `GET /api/collections/registry/list` … index.json をサーバ側 fetch＋ETag キャッシュして返す。
   - `GET /api/collections/registry/preview?author=&slug=` … 対象の schema.json（＋screenshot URL）を返す。
3. **取り込み fetcher**: `collections/<author>/<slug>/` 配下を raw URL で取得 → `packages/core` で再検証（R7）→
   `.claude/skills/<localSlug>/` へ書き込み（star=fork 流用）。
4. **dataPath 正規化（R3）** / **seed materialize**（dataPath 空時のみ・skip-on-conflict・`safeRecordId` 検証）。
5. **provenance/更新**: `.origin.json` 記録、index との version/contentSha 差分で「更新あり」。再取り込みは
   bundle 差し替え・records 保持・field 差分警告（R5/R8）。
6. **UI**: `/collections` に「発見（Discover）」タブ。clone 経路（external-skill）は温存（R1）。

## Out of scope（別 issue）

schema migration 付き自動更新／任意レジストリ URL 追加 UI／スクショの headless 自動生成／マーケットの評価・
ランキング・課金。

## 進め方

1. 本 plan を commit（このコミット）。
2. Workstream B（レジストリ repo bootstrap）を実装 → PR。
3. Workstream A（host）を後続 PR で実装。
4. push / PR は都度ユーザの明示許可を得てから。
