# feat: e2e-live — 履歴 / 参照資料

このファイルは `plans/feat-e2e-live.md` から切り出した、 履歴的経緯 / 完了済 TODO / 参照資料を集約したもの。 active な仕様 / 未着手シナリオ / 設計指針は `plans/feat-e2e-live.md` 本体を参照。

切り出し時期: 2026-05-23 (plan refresh + split PR)。

---

## 反映済 — 直近 main の動向 (#950〜#1000) と本テスト計画への反映

このセクションは feat/e2e-live が main にマージされる前 (〜2026-04-29) に着いた最新の動向を、 e2e-live のテスト戦略にどう反映したかをまとめる。 すべて反映済。

- **#969 / #972** image-path-routing stage 1+2: `/artifacts/images/...` static-mount + 絶対パス LLM convention 廃止 → L-01 assertion を新仕様に合わせて更新済
- **#982** presentHtml: filePath only / `/artifacts/html` mount → L-01 prompt を **相対パス** convention (`<img src="../../../images/...">`) に更新済、 `srcdoc` 経路廃止に追従
- **#980 / #981** HTML preview の relative-path / sibling 画像対応 → 既に L-01 の relative-path 検証が同経路をカバー
- **#967** `//{skill}` bridge shortcut → bridge カテゴリ（後続 PR）でカバー
- **#953** session history の bookmark + hard-delete → L-17 / B-50 系の検証時に hard-delete API パス（`DELETE /api/sessions/:id`）が安定供給されている前提が立てやすくなる

### 要対応だったもの → 反映完了

- **#974 onerror self-repair (Stage 3)** ✅ guard 反映済: `<img>` が 404 した時にブラウザ側で `src` を `/artifacts/images/<rest>` に書き換えて自動 retry する仕組みで、 そのままだと **L-01 の `naturalWidth > 0` チェックが甘くなる** （LLM が `artifacts/images/` を含む間違った prefix を emit しても表示が救われ assert がパスする）。
  - 採用ガード: self-repair が発火すると repair script が `<img>` に `data-image-repair-tried="1"` マーカを付ける。 L-01 の assertion で `naturalWidth > 0` 確認後に **マーカ未セット** を assert する形に変更。 helper `readImgRepairAttempted` を `e2e-live/fixtures/live-chat.ts` に追加。
  - 既存の `not.toMatch(/^\/artifacts\//)` 絶対パス退行 guard と直交する（こちらは self-repair が発火しない 「直接 200 が返る絶対パス」 を検出、 マーカ guard は self-repair に救われた間接退行を検出）。
  - 検討した他案: console error 監視 / `page.on("requestfailed")` / `<img>.src` MutationObserver。 マーカ参照が最も直接的（「self-repair が発火した」 = 「LLM が convention 違反した」 そのもの）かつ実装が局所的なので採用。
- **#983 presentDocument / generateImage の path 入り message**: tool result の message 文字列に `Saved … to <path>` が乗るようになり LLM が path を正しく扱える。 → **L-05 (generateImage)** の prompt から `<path>` キャプチャが楽になる（spec 実装時に活用、 ただし実装時には `[generate-image-view]` testid 経由で `<img>.src` を直接読めば prefix が取れるので tool message parse は不要、 と判明）
- **#991 Safari preview iframe CSP** ✅ webkit project 追加 + 動作確認済: `e2e-live/playwright.config.ts` の projects に `webkit` を追加 (`testMatch: "media.spec.ts"` で対象 spec を絞り、 `e2e/playwright.config.ts` の chromium+webkit 分割を踏襲)。 spec 側は手を入れていない。
  - **当初の誤観測**: webkit 走行で L-01 が `naturalWidth=0` で fail し、 #991 の fix が e2e-live 経路に届いていないと推定して issue #1015 を起票した。
  - **真の原因**: **dev server (`tsx server/index.ts`、 `--watch` なし) が PR #991 merge 前に起動されたままだった** ため、 ソース上は fix されているのに走っているプロセスは pre-#991 の `buildHtmlPreviewCsp()` を呼んでいた。 `curl -i http://localhost:5173/artifacts/html/<file>.html` の CSP header が `img-src 'self'` のままだったことから判明（fix 後は `img-src http://localhost:5173 ...` になる）。 dev 再起動後に webkit L-01 + L-02 とも pass を確認、 issue #1015 close 済。
  - **教訓**: e2e-live は server プロセスのコードに敏感。 main pull / branch 切り替えの後は `yarn dev` を必ず再起動してから走らせる。 `/e2e-live` skill の前提セクションに注意書きを追記済。

---

## 完了済 TODO (元 「未確定事項 / TODO」 のチェック済 box)

- [x] **L-22 で使う skill の選定（dry-run 可能なものに絞る）** → 実装済 (開発者依存の既存 skill ではなく `placeProjectSkill` で synthetic な SKILL.md を `<workspace>/.claude/skills/<unique-slug>/` に seed する方針に変更。 body に 「`/<slug>` で `L22-OK-<nonce>` を返答せよ」 と書いておき Run まで踏んで marker 出現を assert する end-to-end 設計に着地。 PR レビュー反映で list/detail のみの初版から書き換え)
- [x] **#974 self-repair で L-01 の `naturalWidth > 0` が甘くなる件の緩和策決定** → `data-image-repair-tried` マーカ参照 guard を採用（上記 「要対応」 セクション参照）
- [x] **Safari (webkit) project の追加** → 反映済（`e2e-live/playwright.config.ts` に `webkit` project + `testMatch: "media.spec.ts"`）
- [x] **webkit で L-01 が `naturalWidth=0` で fail する件の調査と修正** → #1015 close 済（real bug ではなく dev server stale だっただけ。 上の 「真の原因」 セクション参照。 dev 再起動後に webkit L-01 + L-02 pass 確認）
- [x] **L-05 (generateImage)** 実装時に #983 の path-in-message を活用 → 実装済（path 文字列キャプチャは不要だった: `[generate-image-view]` testid 経由で `<img>.src` を読めば `/artifacts/images/...` の prefix が取れるので tool message を parse する必要がない。 #983 で server message に path が乗るのは agent 側の hint として有用、 spec 側は DOM-only assertion で十分）
- [x] **wiki lint 残り 3 診断カテゴリの e2e 化** → 実装済 (L-WIKI-LINT-ORPHAN / L-WIKI-LINT-MISSING / L-WIKI-LINT-TAG-DRIFT)。 Orphan は index 不変なので並列ブロックに残し、 Missing / Tag drift は L-16 と共に `describe.serial("wiki index-mutating diagnostics")` block 内に集約。 これで `/wiki/lint-report` UI の 6 診断カテゴリ (broken link / empty target / orphan / missing / tag drift + 既存 PR #1312 fix の pipe alias false-positive) が end-to-end でカバー完了

---

## 初期の PR 分割計画 (実行済の記録)

| PR | 内容 | 規模 | 結果 |
|---|---|---|---|
| **#1** | このファイル `plans/feat-e2e-live.md` のみ（設計合意） | 小 | landed (#971) |
| **#2** | 基盤: `e2e-live/fixtures/`, `e2e-live/playwright.config.ts`, `package.json` scripts, **`.gitignore` に `test-results-live/` `playwright-report-live/` 追記**, `/e2e-live` 親 skill, `/e2e-live-media` skill, **L-01 サンプル 1 本** | 中 | landed |
| #3 | media 残り（L-02〜L-05） | 中 | L-02 / L-03 / L-04 / L-05 landed |
| #4 | roles 全部（L-06〜L-10）+ `/e2e-live-roles` skill | 中 | L-06 / L-07 / L-08 / L-09 landed、 L-10 は infra 整備待ち |
| #5 | session 全部（L-11〜L-13）+ `/e2e-live-session` skill | 小 | L-11 / L-12 landed、 L-13 は infra 整備待ち |
| #6 | wiki 全部（L-14〜L-16）+ `/e2e-live-wiki` skill | 小 | L-14 / L-15 / L-16 landed (#1347 で L-15b 拡張、 #1472 で lint 3 診断追加) |
| #7 | ui 全部（L-17〜L-20）+ `/e2e-live-ui` skill | 中 | L-18 / L-19 / L-20 landed、 L-17 は inject 経路追加待ち |
| #8 | skills 全部（L-21〜L-22）+ `/e2e-live-skills` skill | 小 | L-21 / L-22 landed (#1296 / #1298 で L-31 / L-32 を追加) |
| #9 | docker 全部（L-23, L-24, L-26, L-28, L-29, L-30）+ `/e2e-live-docker` skill | 中 | L-23 / L-26 / L-28 landed (#1462)。 L-24 は plan 再定義待ち、 L-29 は対象外推奨、 L-30 は階層 1 設計で実装可能 |
| #10 | `docs/manual-testing.md` 更新（L-25, L-27 のチェックリスト追加） | 小 | landed |

**ポイント**: PR #2 で「基盤 + L-01 サンプル」を同梱することで、設計の妥当性を実装で検証してから残りを並行展開できた。L-01 が最重要（B-18 系）なので守備力も同時に上がった。

---

## artifact mode `/e2e-live-pre-release` 設計メモ (未着手)

リリース前テスト用に `npm pack` の tarball を `npx` で起動して同じ `e2e-live/tests/*.spec.ts` を叩く構想。 本 plan 起票時に詳細設計を残したが未着手。 再開時は本セクションを参照。

### 位置付け

- **e2e-live (現行)** = 開発機の `yarn dev` に対する定期回帰テスト
- **e2e-live (artifact mode)** = npm pack の tarball を `npx` で起動し、 リリース前に「公開バージョンが本当に動く」を確認するテスト

同じ `e2e-live/tests/*.spec.ts` を **baseURL 切替だけで両方のサーバを叩ける** よう、 既に `E2E_LIVE_BASE_URL` env override を `playwright.config.ts` に入れてある。 spec 自体は変更不要。

### artifact 取得

GitHub Actions の "MulmoClaude publish smoke" ワークフローが publish 前 tarball を artifact として残している:

```bash
# 例: 最新 successful run の artifact を取得
RUN_ID=$(gh run list --workflow="MulmoClaude publish smoke" --status success --limit 1 --json databaseId --jq '.[0].databaseId')
gh run download "$RUN_ID" -n mulmoclaude-tarball -D /tmp/mulmoclaude-pkg
# → /tmp/mulmoclaude-pkg/mulmoclaude-X.Y.Z.tgz
```

artifact name: `mulmoclaude-tarball`（10 MB 程度、`.tgz`）。

### 起動方法（要注意）

- `npx /path/to/mulmoclaude-X.Y.Z.tgz` は **動かない**: sh が tarball を直接 exec しようとして `Permission denied` で落ちる。
- 正しい起動方法: 一時ディレクトリで `npm install` してから bin を呼ぶ。
  ```bash
  mkdir -p /tmp/mc-install && cd /tmp/mc-install && npm init -y > /dev/null
  npm install /tmp/mulmoclaude-pkg/mulmoclaude-X.Y.Z.tgz
  ./node_modules/.bin/mulmoclaude        # background or 別シェル
  ```
- 起動 port は `DEFAULT_PORT=3001`（dev の 5173 と被らない）。 ただし **3001 がビジーだと自動で 3002 にフォールバック** する（launcher 実装、 `bin/mulmoclaude.js` の `findAvailablePort`）。 port は launcher の stdout（`✓ MulmoClaude is ready → http://localhost:<port>`）または `lsof` で確認する。
- ready 検知: `/api/health` は **認証されてないと 401** だが alive 確認には十分（401 が返る = サーバは生きている）。 launcher ログの `✓ MulmoClaude is ready` を待つほうが確実。

### 認証

- artifact 起動時も dev と同じく `<meta name="mulmoclaude-auth">` に token が注入される（`server/index.ts` が build 済 client/index.html を serve するときに置換）。
- e2e-live の `deleteSession` 等は `<meta>` から token を読む実装なので **そのまま動く**。

### testid 依存（重要）

リリース前テストは **artifact に含まれる UI を叩く** ため、 spec が依存する testid は **artifact 内 build に含まれている必要がある**。

testid を spec で使う前に main 側に landing させてから release smoke artifact が古い tagged build を相手にすると新 testid を追加した spec は構造的に通らない (落ちる)、 という前提を artifact mode skill 設計時に明示する。

つまり：

- 「testid 追加 → main merge → 新しい publish smoke artifact build → リリース前テスト」 の順で動く
- 古い artifact を相手にすると新 testid を追加した spec は構造的に通らない

### Docker on/off matrix（要調査）

- launcher のログ（実機確認）に `useDocker=true` が出ているので、 デフォルトは Docker sandbox 起動。
- env での切替（`DISABLE_SANDBOX=1` 等）が想定通り効くか、 次 PR で実装時に確認。
- skill にモード引数（`MODE=docker-off|docker-on|both`）を持たせて両方を順次回す。

### skill 設計案

```text
.claude/skills/e2e-live-pre-release/SKILL.md
  1. 最新 publish smoke run の artifact を gh run download
  2. /tmp に npm install で展開
  3. ./node_modules/.bin/mulmoclaude を background 起動
  4. launcher の "✓ MulmoClaude is ready → http://localhost:<port>" から port を取得
  5. E2E_LIVE_BASE_URL=http://localhost:<port> yarn test:e2e:live を実行
  6. Docker on/off 両モードで繰り返す（要 launcher 再起動 + workspace 切替検討）
  7. cleanup: launcher kill, /tmp ディレクトリ削除
```

### 次 PR で詰める論点

- [ ] artifact mode 用に専用の `playwright.pre-release.config.ts` を分けるか、 env で切り替えるか
- [ ] artifact 起動中に dev の `yarn dev` も同じ workspace を見ているとセッション/wiki などで競合する → workspace を切替（`MULMOCLAUDE_WORKSPACE_PATH=/tmp/mc-test-ws`）するのが筋
- [ ] Docker on モードで spec が通るか（特に画像 fixture 配置 — Docker 内 path との対応）
- [ ] CI 化: 同じ skill を GitHub Actions で publish smoke 後に走らせる

---

## Docker on/off 自動化検討 (案 A / B / C 比較メモ、 採用は案 C)

人間依頼方式で動いてはいるが、 自動化要望が出ている。 検討した案と却下理由を記録する。

### 不安定なので採らない案

**案 A: AI が `docker stop mulmoclaude-sandbox` でコンテナを kill して再 test**

- mulmoclaude dev サーバは起動時に `DISABLE_SANDBOX` env を見て「サンドボックスを使う / 使わない」 を決める
- 起動後に `docker stop` してもサーバ側設定はそのまま → 次の agent spawn で「サンドボックス使うつもりなのに居ない」 状態になり失敗
- **dev 再起動なしでは挙動が壊れる**

**案 B: AI が `yarn dev` 自体を kill → 別 env で再起動 → test**

- ユーザーターミナルで動いている dev process を AI が止めるのは destructive
- port 5173 の TIME_WAIT (~30s)、 Mac keychain locking、 docker daemon 状態の race で再起動が不安定
- 失敗時の復旧が AI から困難

### 採る案: 案 C (別 workspace + 別 port で並走)

ユーザーの dev には触らず、 AI 制御の dev process を 2 つ background で起動する:

```bash
# Docker off モード: workspace と port を完全分離
MULMOCLAUDE_WORKSPACE_PATH=/tmp/mc-e2e-off MULMOCLAUDE_PORT=5174 \
  DISABLE_SANDBOX=1 yarn dev:server &

# Docker on モード: 同様に別領域で起動
MULMOCLAUDE_WORKSPACE_PATH=/tmp/mc-e2e-on MULMOCLAUDE_PORT=5175 \
  yarn dev:server &
```

spec 側はすでに `E2E_LIVE_BASE_URL` で baseURL を切り替えられるので、 同じ spec を 2 ポートに対して順次叩く:

```bash
E2E_LIVE_BASE_URL=http://localhost:5174 yarn test:e2e:live  # off
E2E_LIVE_BASE_URL=http://localhost:5175 yarn test:e2e:live  # on
```

skill 終了時に 2 process を kill + `/tmp/mc-e2e-{on,off}/` を削除。

利点:

- ユーザー dev (port 5173) に**完全に触らない**
- workspace 分離でセッション / wiki / index の collision なし
- 起動オーダーは並列 OK（ready 待ちは wait-on で）

欠点:

- 起動コスト（dev:server を 2 回 ~10s ずつ）
- process 管理コードが必要（PID 追跡 / cleanup）
- claude credentials は両 workspace で共有する必要（HOME 経由なので OK のはず、 要検証）

### 案 D との関係

artifact mode (`/e2e-live-pre-release`) と案 C は**枠組みが同じ** — 「別 workspace + 別 port で AI 制御の server を起動」。 違いは:

- 案 C: `yarn dev:server` を起動（dev mode、 ソース直 / TypeScript）
- 案 D: `npx mulmoclaude@<tarball>` を起動（prod build / artifact）

なので **launcher 抽象化 → mode (dev / artifact) × Docker (on / off) の 2 軸 matrix を 1 つの skill `/e2e-live-matrix` で扱う** のが最終形。 実装は別 PR で。

---

## 関連 issue / PR (closed の経緯)

L-03 / L-EDIT / wiki self-repair まわりで closed 済みの issue / PR の経緯:

- L-03 実装中に発見した周辺 issue:
  - **#1049** mulmoclaude README に ffmpeg system 依存の明記がない（一般ユーザー向け docs gap、 動画生成は npx でも system ffmpeg 必要）
  - **#1073** presentMulmoScript の Play ボタン: text 空 beat で次に自動送りされない（schema は `duration` 用意済、 frontend が audio end のみを cue にしている疑い）
  - ~~**#1074** presentMulmoScript: beat 編集後「更新」 した内容が別セッションに戻ると消えている疑い~~ → **CLOSED** (2026-05-09 / PR #1243 `adcca773 fix: persist presentMulmoScript beat edits across page reload`)。 L-EDIT spec は同 PR で unskip 済
- L-06 / L-11 / L-14 (cross-category batch) 実装中に発見した周辺 issue:
  - ~~**#1102** wiki page で broken-prefix `<img>` の self-repair が発火しない~~ → **CLOSED** (2026-05-09 / PR #1240 `c8b14e0c fix: image self-repair handles percent-encoded artifacts/images segment`)。 L-W-S-04 chromium が安定して pass する想定 (要 dev 再起動後の確認)

active な親 issue (mock e2e の不足カバレッジ Step 1 (a)) の構成要素:
- presentHtml iframe 画像リライト (B-18) → 反映済
- PDF route 画像 inline (B-19/20) → 反映済
- mulmoScript download-movie 認証 (B-21) → 反映済
- presentForm i18n キー欠落 (B-34) → 反映済
- 通知二重表示 (B-50) → L-17 未着手
- Files view `?path=` クリーンアップ (B-30) → 反映済

---

## 設計仕様 archive — 30 シナリオ詳細 (実装済分、 plan 起票時 2026-04-29 の初期設計)

> ここは plan 起票時に書かれた **初期設計仕様** の記録 (= 「これからどう実装するか」 の意図)。 各シナリオの **実装結果** (採用した assertion / helper / 罠回避) は active 側 `plans/feat-e2e-live.md` の 「実装ステータス」 表の備考、 もしくは各 spec ファイル (`e2e-live/tests/*.spec.ts`) が正規ソース。
>
> active 側に残す必要のない実装済シナリオの初期設計をここに archive している。 plan 起票後 (2026-04-30 以降) に追加実装されたシナリオは plan 起票時の 30 シナリオ詳細セクションには存在せず、 直接 active の 「実装ステータス」 表で起票 → 実装したものなのでここには含まれない (実装結果のみ表に記録)。 該当: L-WIKI-LINT-ORPHAN / L-WIKI-LINT-MISSING / L-WIKI-LINT-TAG-DRIFT (#1472)、 L-31 / L-32 (#1296 / #1298)、 L-EDIT (#1243)、 L-LINKIFY-CODESPAN (#1325 layer A)、 L-SETTINGS-EFFORT / L-SETTINGS-EFFORT-SPAWN (#1323)、 L-W-S-03 (#1275)。

凡例:
- 重要度: **S** = 致命級, **A** = 高, **B** = 中
- 画像: 「fixture」= repo 既存ファイル参照、「生成」= 実 generateImage 経由、「不要」= 画像を扱わない

### media

#### L-01: presentHtml の画像が描画される ★最重要

- カバー: B-17, B-18
- 重要度: **S** / Docker: `both` / 画像: fixture
- 実装: `e2e-live/tests/media.spec.ts`
- 操作: 新規セッション → fixture 画像を `artifacts/images/e2e-live-l01.png` に配置 → 「`<img src="../../../images/e2e-live-l01.png">` を含む HTML を presentHtml で」と LLM に依頼（PR #982 で導入された **相対パス convention** に従う）
- 検証:
  - presentHtml の iframe 内に `<img>` が visible
  - `src` 属性が `e2e-live-l01.png` を含む（リテラル一致）
  - `src` が `/artifacts/...` で始まら**ない**（LLM が新ルール違反していないかの guard）
  - `naturalWidth > 0`（HTML mount + 画像 mount + path-traversal guard を抜けて実際に描画される）
- 失敗例: B-18（path-traversal 防御の副作用で 404 → naturalWidth 0）、 LLM が古い絶対パス convention に戻る

#### L-02: Markdown 応答を PDF DL

- カバー: B-19, B-20
- 重要度: **S** / Docker: `both` / 画像: 不要（textResponse 経由なので workspace 配置なし）
- 実装: `e2e-live/tests/media.spec.ts`、textResponse の PDF ボタン (`text-response-pdf-button`) 経由
- 操作: 新規セッション → 「次の Markdown を **そのまま** 1 ターンの返信本文として返してください」と LLM に依頼 → textResponse view 表示後 PDF DL ボタンクリック
- 検証:
  - DL ファイルが `%PDF-` magic bytes を含む（`readPdfDownload` helper）
  - PDF サイズが 500 bytes 以上（明らかな空 stub を除外）
- 注: 「PDF に画像が inline されている」確認は scope 外（pdf-parse 等の追加依存が要るので別 PR）

#### L-03: mulmoScript 生成 → 動画 DL 成功

- カバー: B-21
- 重要度: **A** / Docker: `both` / 画像: fixture
- 操作: 短い mulmoScript（2〜3 beat）を生成依頼、画像は fixture を指定 → `/api/mulmo-script/download-movie` で DL
- 検証: 認証ヘッダ付きで 200 応答、動画ファイルのマジックバイト確認

#### L-04: mulmoScript animation:true で映像生成失敗しない

- カバー: B-46
- 重要度: **B** / Docker: `both` / 画像: fixture
- 操作: animation:true を含む短い mulmoScript を生成 → render
- 検証: audio → image の順で生成され、エラーが出ない

#### L-05: generateImage プラグインで実画像が返る

- カバー: 一般
- 重要度: **A** / Docker: `both` / 画像: **生成（このテストだけ）**
- 操作: 「猫の絵を 1 枚描いて」と送信 → generateImage tool が呼ばれる
- 検証: 返ってきた画像 URL が 200、画像として描画される

### roles

#### L-06: General ロールで sample query → 完走

- カバー: B-15, B-41
- 重要度: **A** / Docker: `both` / 画像: fixture or 不要
- 操作: General ロール選択 → sample query を 1 つ実行
- 検証: tool 呼び出し成功、最終応答が UI に表示される

#### L-07: Office ロールで sample query → 完走

- カバー: B-41
- 重要度: **A** / Docker: `both` / 画像: 不要

#### L-08: Tutor ロールで sample query → 完走

- カバー: B-41
- 重要度: **B** / Docker: `both` / 画像: 不要

#### L-09: Storyteller ロールで sample query → 完走

- カバー: B-41
- 重要度: **B** / Docker: `both` / 画像: 不要

### session

#### L-11: 新規セッション → 1 ターン → reload → 履歴復元

- カバー: B-14
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: 新規セッション開始 → メッセージ送信 → 応答受信 → ページ reload
- 検証: 履歴が UI に復元、session ID 一致

#### L-12: 古いセッションを resume → LLM が文脈保持

- カバー: B-16
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: 既存セッションを開く → 「さっき何の話してた？」と送信
- 検証: 過去の文脈を引いた応答が返る

### wiki

#### L-14: Wiki ページ生成 → 内部リンクを踏める

- カバー: B-23, B-24, B-25
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: 「Wiki に X というページを作って Y にリンクして」と依頼
- 検証: リンククリックで `/chat` にリダイレクトされず、対象 Wiki ページが開く

#### L-15: 日本語タイトルの Wiki ページ → URL slug が壊れない

- カバー: B-26, B-27
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: 「『日本語タイトル』という Wiki ページを作って」
- 検証: URL slug 化が成功、リンクから正しく開ける

#### L-16: Wiki index から各ページへのリンクが機能

- カバー: B-23
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: 複数ページ生成 → `/wiki` 直下の index を開く → 各リンクをクリック
- 検証: すべて 404 にならず開ける

#### L-WIKI-PIPE: `[[slug|alias]]` 形式リンクのクリック → URL に `|alias` が混入しない

- カバー: issue #1297 / PR #1312
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: source / target の 2 ページ seed → source 側に `[[<targetSlug>|<日本語表示>]]` を埋める → クリック
- 検証: `data-page` が target slug のみ、 表示テキストが alias のみ、 クリック後 URL に `%7C` (`\|`) が含まれない、 target の body marker が表示される

#### L-WIKI-LINT-PIPE-CLEAN: lint レポートで `[[slug|alias]]` が broken link に出ない

- カバー: issue #1297 / PR #1312 (lint UI 側)
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: source / target の 2 ページ seed → source 側に `[[<targetSlug>|<日本語表示>]]` を埋める → `/wiki/lint-report` を開く
- 検証: lint 出力 `<li>` の中に source ページ名 + alias ASCII token + `not found` を全て含む行が 0 件 (pre-fix の false positive shape の sentinel)

#### L-WIKI-LINT-EMPTY-TARGET: lint レポートで bare `[[Japanese]]` が "empty target" 診断に出る

- カバー: PR #1312 で追加された新診断カテゴリ
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: source ページ 1 件 seed (target 不在で resolver が解決不能にする) → `[[日本語のみのターゲット記号終端タイトル]]` (ASCII フリーの固定文字列、 nonce を入れない) を埋める → `/wiki/lint-report` を開く
- 検証: lint 出力に source + bare Japanese target + `empty target` を含む `<li>` が 1 件、 同条件で `not found` を含む行は 0 件 (新診断と broken-link 診断が混ざらないこと)

#### L-WIKI-LINT-BROKEN: lint レポートで `[[bogus-slug]]` が broken link 診断に出る

- カバー: 既存 broken-link 診断の sanity (#1312 の周辺退化検出)
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: source ページ 1 件 seed (bogus target は seed しない) → `[[<bogus-slug>]]` を埋める → `/wiki/lint-report` を開く
- 検証: lint 出力に source + `<bogus-slug>.md not found` を含む `<li>` が 1 件 (一般的な broken-link diagnostic shape)

### ui

#### L-18: presentForm 表示時に i18n キーが直接出ない

- カバー: B-34
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: presentForm を呼ぶシナリオを実行
- 検証: `pluginPresentForm.submit` のような raw key が UI に出ていない

#### L-19: Tool Call History が reload 後も復元

- カバー: B-31
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: tool 実行 → reload → Tool Call History を開く
- 検証: 履歴が消えず表示される
- 注: 実装時に対象が **stack-rehydrate on reload** (canvas layout の stack モードを localStorage 経由で復元) に拡張された。 active の 「シナリオ一覧」 / 「実装ステータス」 表では新タイトル表記 「stack-rehydrate on reload」 を採用。 B-31 の元症状 (Tool Call History reload 退行) は stack layout の rehydrate 経路でカバーされる

#### L-20: Files view reload で `?path=` がクリーンアップ

- カバー: B-30
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: Files view で markdown を開く → reload
- 検証: `?path=` が URL から消えている、Files view に戻らない

### skills

#### L-21: ToolSearch + skill 経由で期待した tool が呼ばれる

- カバー: B-41
- 重要度: **A** / Docker: `both` / 画像: 不要
- 操作: deferred tool を要求するクエリを送信（例: presentMulmoScript）
- 検証: ToolSearch 経由で tool スキーマ取得 → 実 tool 呼び出し成功

#### L-22: 自作 skill を実行して結果が出る

- カバー: B-08
- 重要度: **B** / Docker: `both` / 画像: 不要
- 操作: 既存 skill（例: `/audit-unclosed-issues` の dry-run）を実行
- 検証: skill が dangling link 等で失敗せず、結果が UI に表示される

### docker

#### L-23: X MCP が Docker 内で .env から key を読める

- カバー: B-01
- 重要度: **A** / Docker: `docker-only` / 画像: 不要
- 操作: Docker サンドボックス起動 → MCP 一覧確認
- 検証: X MCP が disable 状態でなく、key が認識されている

#### L-26: Docker 内 cwd 変更後も session resume できる

- カバー: B-04
- 重要度: **A** / Docker: `docker-only` / 画像: 不要
- 操作: Docker サンドボックス内で過去セッションを resume
- 検証: 「No conversation found」エラーが出ない

#### L-28: Docker 内で git/gh 認証が通る

- カバー: B-06
- 重要度: **B** / Docker: `docker-only` / 画像: 不要
- 操作: Docker 内で `gh auth status` を実行
- 検証: 認証成功（SSH agent forward / token mount）

---

## Appendix: 内部バグ報告一覧（匿名化）

直近 1 ヶ月（2026-04-01〜04-29）の内部バグ報告を匿名化して掲載。各シナリオ（L-XX）が参照する根拠資料。報告者・日時・引用文・元投稿リンクは省略。

### A. Docker / サンドボックス系

#### B-01. X MCP が Docker 下で動かない（key 認識失敗）
- 症状: X MCP が disable 状態で起動する
- 原因: Docker 配下では `.env` がコンテナから見えず、key が無いと判断されて自動 disable
- 修正: PR #72
- 関連シナリオ: L-23

#### B-02. `yarn sandbox:login` で docker image が無い
- 症状: `Unable to find image 'mulmoclaude-sandbox:latest' locally` エラー
- 原因: image を build せずに login コマンドが走る
- 関連シナリオ: L-24 (※現在の `yarn sandbox:login` は keychain export スクリプトに変更されており、 image チェックロジックを持たない。 L-24 のシナリオ再定義が必要)

#### B-03. Docker サンドボックスで root 権限のファイルが残る副作用
- 症状: Linux で動かすと root 権限のファイルが作られて、host 側で書き換え不能
- 修正: PR #85（sandbox 内ユーザを root → 通常ユーザに変更）
- 関連シナリオ: L-25 (manual-l4)

#### B-04. PR #85 の副作用で「No conversation found with session ID」
- 症状: 過去のセッションを resume するとエラー
- 原因: workspace path が `/workspace` → `/home/node/mulmoclaude` に変わったため別ディレクトリを参照
- 関連シナリオ: L-26

#### B-05. Mac+Docker 下で Claude credential が expire
- 症状: host 側で auth token が更新されたのに container 側で更新されず Claude Code が使えなくなる
- 原因: Mac の keychain に credential が入るため Docker から見えない
- 修正: PR #97（Keychain 用ソリューション）/ PR #241（auto-renew）
- 関連シナリオ: L-27 (manual-l4)

#### B-06. Docker 下で git/gh が動かない（認証）
- 症状: docker 内では git/gh の認証が通らない（特に SSH）
- 修正: PR #327（SSH agent forward / HTTP key の file mount + ALLOWED_HOSTS で github.com に限定）
- 関連シナリオ: L-28

#### B-07. MCP server Docker クラッシュ
- 症状: docker + モノレポの複合要因で MCP server が crash
- 修正: PR #429（関連: cross-import 破損 → PR #424）
- 関連シナリオ: L-29 (※修正済のため e2e-live 対象外推奨。 unit test cover で十分)

#### B-08. skill が Docker sandbox + symlink の組み合わせで動かない
- 症状: `~/.claude/skills` を symlink で管理していると sandbox 内で dangling link になり skill が見えない
- 回避策: `DISABLE_SANDBOX=1 yarn dev` か symlink を実 dir 化
- 関連シナリオ: L-22, L-30

### B. 起動 / インストール系

#### B-09. 新規ユーザの ENOENT 起動失敗（mkdir 順番問題）
- 症状: `mkdir ~/mulmoclaude` の前に他処理が走り ENOENT で起動失敗
- 修正: PR #96（順番入替）

#### B-10. `npx mulmoclaude` で sandbox setup 失敗（Dockerfile.sandbox 同梱漏れ）★進行中
- 症状: `ENOENT: no such file or directory, open '.../mulmoclaude/Dockerfile.sandbox'`
- 原因: `Dockerfile.sandbox` が npm パッケージに同梱されていない
- 修正: 0.5.3 で対応中

#### B-11. `npx mulmoclaude` で Sandbox モードに入らない
- B-10 と同根

#### B-12. main ブランチ pull 後の `yarn dev` で ERR_MODULE_NOT_FOUND
- 症状: `@receptron/task-scheduler` が見つからない
- 原因: streaming 対応時に追加した CLI option / task-scheduler パッケージ未 build
- 修正: PR #424

### C. 認証 / セッション系

#### B-13. サーバ再起動で CLI クライアントが再接続できない
- 症状: 起動時生成 token を使う仕様で、サーバ再起動で token が変わり bridge が再接続できない
- 暫定: 環境変数で固定 token を渡す機能を追加予定
- 関連シナリオ: L-13

#### B-14. main で「チャットメッセージが入らない」（hotfix 対応）
- 修正: hotfix PR で main にマージ
- 関連シナリオ: L-11

#### B-15. Gemini API key 不要な General ロールでも入力欄が disabled
- 症状: Gemini key 未設定だと General ロールで入力／送信が disabled
- 原因: General ロールが `generateImage` を含む → `needsGemini("general") = true` の判定
- 修正: PR #158（disabled ではなく警告バナー表示に変更）
- 関連シナリオ: L-10

#### B-16. 数時間前のチャットセッションが消える
- 症状: 1 つ前の会話を覚えていない／数時間前の session がない
- 原因: KVCache をサーバーで保持しており、古いものは破棄
- 対応: 履歴のうち LLM が見るべきものだけを渡す実装に変更
- 関連シナリオ: L-12

### D. ファイル / 画像 / PDF 系（path-traversal 副作用）

#### B-17. file explorer で画像（グラフ）が表示されない
- 症状: html iframe 内で画像が表示されない
- 原因: iframe sandbox=「」のままだと Chart.js が動かない／Markdown の `![](path)` が解決できない
- 修正: PR #216（sandbox="allow-scripts" / CDN ホワイトリスト + CSP / `![](path)` → `/api/files/raw?path=...` 自動書き換え）
- 関連シナリオ: L-01

#### B-18. presentHtml の iframe srcdoc 内画像が 404 ★期間最大の燃え玉
- 症状: presentHTML で `<img src="mulmo_logo.png">` または `<img src="/artifacts/...">` を含む HTML を生成すると画像が 404、サーバ警告「image path escapes workspace」
- 原因: path-traversal 対策の副作用で、相対 / leading-slash 画像参照を弾くようになった
- 影響範囲: 画像入り Markdown PDF DL、CC に画像入り HTML 生成、presentHtml の iframe srcdoc 全般
- 修正方針: PR #961 を拡張して presentHtml も iframe に渡す前に `<img src="/artifacts/...">` → `/api/files/raw?path=...` に書き換え
- 重大度: 高（外部宣伝直後に発生）
- 関連シナリオ: **L-01**

#### B-19. 画像入り Markdown を PDF 化すると失敗
- 症状: 画像入り MD は表示できるが、PDF 出力で失敗
- 原因: B-18 と同じ path-traversal 副作用
- 関連シナリオ: L-02

#### B-20. 過去の PDF ダウンロード不能の再発
- 振り返り: 「以前 PDF のダウンロードができなくなっていたのも、これが原因だった」と判明
- 関連シナリオ: L-02

#### B-21. mulmoScript で作った映像のダウンロード失敗
- 症状: `GET /api/mulmo-script/download-movie` でダウンロード不能
- 修正中: PR #889
- セキュリティ指摘: bearerAuth スキップで未認証ファイル読み取り経路ができる懸念
- 関連シナリオ: L-03

#### B-22. server エラーが Web 側で見えない
- 修正: PR #90

### E. Wiki / Router / 内部リンク系

#### B-23. Wiki index から正しくリンクが貼られていない
- 修正: PR #290
- 関連シナリオ: L-14, L-16

#### B-24. wiki 内マークダウンリンクで Router catch-all → /chat へリダイレクト
- 症状: wiki ページ内のソースファイル／セッションログ等のリンクをクリックすると `/chat` に飛ぶ
- 修正: PR #742
- 関連シナリオ: L-14

#### B-25. Wiki のリンク周り 3 件まとめ
- 症状: サイドバーのプレビューカードクリックで新規セッション開始 / テキスト応答内の内部リンク不動 / Wiki の非 ASCII リンクで無関係なページが表示
- 修正: PR #588
- 関連シナリオ: L-14

#### B-26. 日本語タイトルの slug 化が壊れる
- 症状: 日本語や記号でスラッシュをふくむと挙動おかしい
- 修正: PR #655（slug 化時に自動変換）
- 関連シナリオ: L-15

#### B-27. 非 ASCII ラベルに同じ ID が付く
- 修正: PR #186（ハッシュベースの ID を付与）
- 関連シナリオ: L-15

### F. UI / 入力系

#### B-28. Safari で IME 確定 Enter がそのまま送信される
- 修正: PR #264

#### B-29. ファイルツリーの展開状態がリロード／ワークスペース切替で失われる
- 修正: PR #120（localStorage 永続化）

#### B-30. Files view を一度開くと reload で常に Files view に戻る
- 症状: Files view 中で markdown を開くと、reload で必ず Files view に戻る
- 原因: URL の `?path=...` が残ったまま
- 対応: PR #434 で `?path=` クリーンアップ
- 関連シナリオ: L-20

#### B-31. Tool Call History リロード後の更新バグ
- 修正: PR #433
- 関連シナリオ: L-19

#### B-32. ディレクトリ追加 UI で保存ボタンが 2 つ表示／右下が効かない
- 症状: 「追加」ボタン押下後、左右に保存ボタンが 2 つ。右下を押しても保存されず左の保存を押す必要がある
- 提案: 保存ボタンは 1 個にして「追加」を押した時点で保存

#### B-33. /wiki 作業中に Cmd+1 でタブ 1 に飛ぶ副作用
- 症状: ブラウザのショートカットを override するため意図しない移動が発生

#### B-34. presentForm のテキストが表示されない
- 症状: `pluginPresentForm.submit` 等のキーがそのまま表示される
- 原因: 外部 plugin だったものを内部に持ち込んだ際の i18n リソース移行漏れ
- 修正: PR #845
- 関連シナリオ: L-18

### G. テスト / Lint / CI 系

#### B-35. test:e2e が失敗（Playwright インストール不足）
- 補足: `npm i -g @playwright/cli@latest` だけでは不十分

#### B-36. vite の `node_modules/.vite` キャッシュ古いと E2E が旧コードで fail
- 回避: `rm -rf node_modules/.vite`
- ToDo: docs/manual-testing.md に注意書き追加

#### B-37. e2e テスト不足カバレッジ
- 修正: PR #209

#### B-38. claude が e2e するために 5173 を kill する問題
- 修正: 45173 ポートに割り当て

#### B-39. test-results ディレクトリが gitignore されていない

#### B-40. .vue で eslint が効いていなかった
- 症状: eslint 有効化したらエラーが 200 個出現
- 補足: 復旧途中で「全部に eslint disable をつけてしまった」事故も発生

### H. ToolSearch / Claude CLI 連動

#### B-41. ToolSearch で `presentMulmoScript` / `readXPost` が見つからない
- 症状: 各 Role の sample query を流すとどれも失敗
- 原因（推定）: Claude CLI 2.1.114 でツール数が多いと `deferred tools` に切り替わる仕組み。MulmoClaude は 18 個以上のツールを登録しているため自動で deferred mode に入った
- 修正: PR #424
- 関連シナリオ: L-06〜L-09, L-21

### I. 動画 / Mulmocast 系

#### B-42. Seedance 2 が同じプロンプトで成否ばらつく
- 症状: test script も何度か実行しないと全 OK にならない
- 関連 PR: mulmocast-cli #1347

#### B-43. veo 系での rate limit エラー（4 回/分）
- 症状: 各 beat に moviePrompt を持つ script を veo3 で映像化すると rate limit に引っかかる
- 状態: 解決方法を考案中

#### B-44. Replicate 一時利用不可
- 症状: `Service is currently unavailable due to high demand. (E003)`

#### B-45. mulmocast textSlide の背景が黒で読みにくい
- 修正: mulmocast-cli #1344

#### B-46. mulmocast の animation:true で映像生成失敗
- 症状: animation:true のケースで映像の生成に失敗するケース
- 原因（暫定）: animation:true の場合、audio を先に生成してから image を生成すべき
- 関連シナリオ: L-04

#### B-47. mulmocast の Gemini TTS エラー詳細不足
- 修正: mulmocast-cli #1358（エラー detail を返す）

#### B-48. MulmoClaude からの画像生成が失敗するようになった
- 補足: 同時期に外部 LLM プロバイダ側障害が発生していた可能性

### J. セッション ID / favicon / 履歴系

#### B-49. currentSessionId と displayedCurrentSessionId の二重管理
- 症状: 状態管理が複雑化
- 関連: PR #777（リファクタ）

#### B-50. 二重通知（bridge メッセージで bell アイコンと history の両方に出る）
- 修正: PR #818（bridge メッセージは history のバッジのみ）
- 関連シナリオ: L-17

### K. 外部要因（参考、対象外）

#### E-01. GitHub レート制限
#### E-02. Anthropic API 500 / status 異常
#### E-03. GitHub の Pull Request 一覧表示がバグる
