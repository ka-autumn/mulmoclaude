# Fix: workspace link double-encoding on multibyte filenames

## 症状

Claude が assistant メッセージに markdown リンク記法でワークスペース内ファイルへのリンクを書いたとき、リンク先ファイル名に日本語などのマルチバイト文字が含まれているとクリックしても Files タブで 404 になる。

例（generic な再現用ファイル名で示す。現実のセッションで実機確認済み）:

```markdown
[テストファイル.md](data/notes/テストファイル.md)
```

クリック後の URL:

```text
/files/data/notes/%25E3%2583%2586%25E3%2582%25B9%25E3%2583%2588%25E3%2583%2595%25E3%2582%25A1%25E3%2582%25A4%25E3%2583%25AB.md
```

`%25E3%2583%2586` は `%E3%83%86`（"テ"）の `%` を再エスケープしたもの。

API:

```http
GET /api/files/content?path=data%2Fnotes%2F%25E3%2583%2586%25E3%2582%25B9...md
→ 404
```

## 原因

1. `marked.parse` が markdown リンク記法を `<a href>` 化する際、URL を percent-encode する（`%E3%83%86...`）
2. `src/utils/path/workspaceLinkRouter.ts` の `classifyWorkspacePath` は href をデコードせず素通しで `{ kind: "file", path }` を返す
3. `src/App.vue` の `navigateToWorkspacePath` が `target.path.split("/")` で配列化して `pathMatch` に渡す
4. vue-router がそれを **もう一度** percent-encode → `%E3%83%86` が `%25E3%2583%2586` に

## 修正方針

`classifyWorkspacePath` の入口で `decodeURIComponent` を 1 回かける（safe decode）。

- 入力が裸のパス（ASCII / マルチバイトそのまま）→ decode しても変わらない（冪等）
- 入力が encoded（`%E3%83%86...`）→ decode して "テ..." になる
- 不正な percent シーケンスで `decodeURIComponent` が throw した場合は元の値を使う（フォールバック）

これにより `classifyWorkspacePath` の呼び出し元すべてに同じ修正が効く:

- `src/App.vue` の `navigateToWorkspacePath`（routing entrypoint。下 2 経路から踏まれる）
- `src/plugins/wiki/components/WikiPageBody.vue`（wiki 本文内リンクの click 判定 → `appApi.navigateToWorkspacePath`）
- `src/plugins/textResponse/View.vue` の `openLinksInNewTab`（chat 応答内リンクの click 判定 → `appApi.navigateToWorkspacePath`）

UI 経路としては **Wiki** と **textResponse** の 2 つ。

## テスト

`test/utils/path/test_workspaceLinkRouter.ts` に encoded 入力ケースを追加:

- percent-encoded 日本語ファイルパス → decoded path で `{ kind: "file", path }` を返す
- percent-encoded wiki page slug → 正しく `{ kind: "wiki", slug }` を返す
- 不正な percent シーケンス → throw せずフォールバック（元のパスを workspace 相対として扱う）
- encoded 構造トークン（`%2F` / `%2E%2E`）の挙動を pin（root-escape は依然 null）
- 既存の裸パスケース（ASCII / マルチバイト）は引き続き通る

## 動作確認

Playwright で:

1. `/chat/<sessionId>?result=<resultId>` でリンク `[テストファイル.md](data/notes/テストファイル.md)` を表示
2. クリック → URL が `/files/data/notes/%E3%83%86%E3%82%B9...md`（**1 回エンコード**）になる
3. md viewer でファイル内容が表示される（404 にならない）

## スコープ外

- LLM レスポンスに自動でリンクを埋め込む話（プロンプト誘導 / autolink 後処理）→ 別 issue
