# mc-library Google Books 連動 (#1210 PR-C)

PR-B で投入した `mc-library` skill に外部メタデータ取得を足す。本を保存する
タイミングで Google Books API を叩いて ISBN・表紙画像 URL・著者・概要を拾い、
frontmatter と本文に埋める。あわせて、ユーザーが Amazon URL や生 ISBN/ASIN
を貼ったときに取りこぼさず拾う指示も入れる。

## スコープ

skill 本文 (`server/workspace/skills-preset/mc-library/SKILL.md`) の改訂のみ。
コード変更なし。テストは既存の skill 配信テストで十分（中身が変わっても配信
パイプラインは同じ）。

## 何を変える

### 1. Google Books API 連動

ユーザーが「読みたい」「読んだ」と言ったタイミングで、保存前に WebFetch で
Google Books API を叩いて ISBN・表紙画像 URL・著者・概要を取得する。

エンドポイント:
```text
https://www.googleapis.com/books/v1/volumes?q=<query>&maxResults=1
```

`<query>` は author 既知なら `intitle:<title>+inauthor:<author>`、未知なら
`intitle:<title>` のみ（空 `inauthor:` を付けると正当な title-only マッチを
取りこぼすので分岐させる）。

- 認証不要、API key 不要
- レスポンス JSON の `items[0].volumeInfo` から:
  - `industryIdentifiers[].identifier` （type=ISBN_13 を優先、無ければ ISBN_10）
  - `imageLinks.thumbnail` （表紙 URL）
  - `authors[]` （著者の確認用、ユーザーが author を言わなかった場合の補完）
  - `description` （概要、本文に挿入。**untrusted data として blockquote
    + HTML タグ除去**）

skill 本文への追加方針:
- 「Workflow 1 と Workflow 2 の保存ステップで、`Write` の前に WebFetch で
  Google Books API を1回叩け。レスポンスがあれば ISBN を frontmatter に、
  表紙画像を本文の冒頭に `![cover](thumbnail-url)` で挿入」
- API が空 / エラーを返したら静かに進む（ユーザー体験を遮らない）
- 何もヒットしなくても保存はちゃんと進める

### 2. 明示提供時の ASIN/ISBN 抽出

ユーザーがメッセージに含めてきた識別子を取りこぼさず拾う:

- Amazon URL（例: `https://www.amazon.co.jp/dp/B0XXXXXXXX` の `B0XXXXXXXX`）
  → `asin` フィールドに保存
- 10桁または13桁の ISBN
  → `isbn` フィールドに保存（Google Books から取れた値より優先 — ユーザー指定
  のほうが信頼度高い）

### 3. 本文の表紙埋め込み

frontmatter のすぐ下に `![cover](https://...)` を1行入れる。これにより:
- mulmoclaude の files UI で開いたとき表紙が表示される
- wiki リンクを貼ったときの hover preview にも乗る（既存の wiki-backlinks
  機能の流れ）
- チャットで Read してレンダリングされたときも表紙が出る

## 何を変えない

- ロール追加なし（PR-B 同様、skill 単独で完結）
- BUILTIN_ROLE_IDS 触らない
- 配信メカ (`syncPresetSkills`) 触らない
- 楽天ブックスは対象外

## skill body のサイズ感

PR-B 時点で約 115 行。Google Books 連動 + ASIN/ISBN 抽出の指示で +30 行
程度を見込む。トータル ~145 行になる予定。閾値以下。

## テスト

新規追加なし。配信メカは PR-A の 26 ケースで完備。skill 本文は手動スモークで
検証する:

1. mulmoclaude を起動、適当なロールで「サピエンスを読書リストに追加して」
2. Claude が Google Books API を叩く（WebFetch ログを確認）
3. `data/library/books/sapiens.md` に `isbn`、`![cover](...)` が入っている
4. files UI でファイルを開いて表紙が表示されている
5. 「`https://www.amazon.co.jp/dp/B07XXXX` の本を追加」 → URL から ASIN を
   抽出、frontmatter に `asin: B07XXXX` が入る

## 後始末

- マージ後、本プランファイルを `plans/done/` に移動

## 後続候補（このスコープには入れない）

- `mc-articles` （保存した web 記事 + 自動要約）
- `mc-quotes` （本に紐付かない引用集）
- ジャンル別タグ自動推定
- 読書ペース統計（月別読了数等）
