# feat: CSRF guard — opt-in trusted origins for LAN dev access

## User Prompt

`yarn run dev` を Mac で動かし、同じ Wi-Fi 上の iPad から `http://192.168.x.x:5173` で
アクセスすると、Wiki だけが 403 で開けない。基本的なページは見えるが Wiki ページの本文を
取りに行く `POST /api/wiki { action: "page" }` が CSRF ガードで弾かれる。

LAN 経由でも Wiki を見られるように、ユーザーが明示的に許可した Origin だけ
`requireSameOrigin` をパスする仕組みを追加する。

## Root Cause

- `vite.config.ts` の `server.host: true` で Vite が LAN 公開される
- iPad は `http://192.168.x.x:5173` を叩く → ブラウザは `Origin: http://192.168.x.x:5173` を送る
- Vite proxy の `changeOrigin: true` は `Host` だけを書き換え、`Origin` はそのまま転送される
- backend の [`server/api/csrfGuard.ts`](../server/api/csrfGuard.ts) `requireSameOrigin` が localhost 系以外の Origin で POST を弾く → 403
- GET は safe method として素通りするので、wiki index 等は普通に見える。Wiki ページ閲覧だけ
  `POST /api/wiki` を使っているため落ちる

## Approach

新しい env var `MULMOCLAUDE_TRUSTED_ORIGINS` を追加し、カンマ区切りで Origin を列挙できる
ようにする。`requireSameOrigin` はこのリストに含まれる Origin を localhost と同等に扱う。

例:

```env
MULMOCLAUDE_TRUSTED_ORIGINS=http://192.168.1.42:5173,http://192.168.1.50:5173
```

DHCP で IP が変動する環境では、ルーターで Mac の DHCP 予約を取るか、ありうる候補を
カンマ区切りで列挙する。

### なぜ env var の opt-in か

- private LAN レンジ (192.168.0.0/16 など) を自動許可するパターンは、同じ Wi-Fi の悪意ある
  デバイスからの CSRF を素通りさせる → 非採用
- フロント側で POST → GET に倒すパターンは `save` 等の書き込み系では使えない → 不完全
- 「ユーザーが明示的に許可した Origin だけを通す」が最小権限の原則に沿う

## Implementation Steps

1. `server/system/env.ts`
   - 既存の `asCsv` helper を流用して `env.trustedOrigins: readonly string[]` を追加
   - 値は `MULMOCLAUDE_TRUSTED_ORIGINS` から読む

2. `server/api/csrfGuard.ts`
   - `requireSameOrigin` で、`isLocalhostOrigin(origin)` の他に `env.trustedOrigins.includes(origin)`
     も許可する
   - localhost 判定と trusted-origin 判定は同じ「Origin 完全一致」セマンティクスで揃える
     （末尾スラッシュなし・大小同一・scheme 含む）

3. `test/server/test_csrfGuard.ts`
   - trusted-origin リストに登録した Origin で POST が通ること
   - リストに含まれない LAN IP は引き続き 403 で弾かれること（既存テストが守る）
   - 末尾スラッシュ付きは登録しても弾かれること（誤設定検出）
   - 空文字や malformed Origin は trusted リストにあっても弾く（防御線）

4. `.env.example`, `docs/developer.md`
   - 新 env var を documented リストに追加
   - LAN/iPad アクセス時の設定例を README ではなく developer.md 側に書く（dev 限定機能のため）

## Out of Scope

- フロントの POST → GET への切り替え（別 PR でやる価値はある、本 PR ではやらない）
- Cloudflare Tunnel / ngrok 経由のアクセス対応（同じ env var で対応可能、本 PR で動作確認はしない）
- CIDR / wildcard 対応（過剰、明示列挙で十分）

## Risk / Items to Confirm

- LAN-broadcast デバイスから Origin ヘッダを偽装される攻撃面: ブラウザは Origin ヘッダの
  クライアント側書き換えを禁じている（fetch 仕様）ので、攻撃者ページがこの Origin を
  自由に名乗ることはできない。ただし non-browser caller（curl 等）には意味がない
  ガードであることに変わりなし（同じ理由で missing Origin は元々素通り）
- DHCP で IP が変わると `.env` 書き換えが必要 → 設定例に注意書きを入れる
