# fix-e2e-live-regressions

`yarn test:e2e:live` を main(675c3e2a) で 2 周 (Docker off / on) 回した結果、5 シナリオが fail。原因調査と修正計画。

## 結果サマリ

| モード | passed | failed | did not run | 所要時間 |
|---|---:|---:|---:|---:|
| Docker **off** (1 周目) | 38 | 4 | 1 | 6.2 min |
| Docker **on** (2 周目) | 39 | 4 | 0 | 9.4 min |

## 失敗テスト一覧

| ID | spec | Docker off | Docker on | 初回 PR scope |
|---|---|:---:|:---:|:---:|
| L-ERR | [error-banner.spec.ts:17](e2e-live/tests/error-banner.spec.ts#L17) | fail | fail | ✅ |
| L-22 | [skills.spec.ts:111](e2e-live/tests/skills.spec.ts#L111) | fail | fail | ✅ |
| L-15b | [wiki-nav.spec.ts:155](e2e-live/tests/wiki-nav.spec.ts#L155) | fail | fail | ✅ |
| L-SETTINGS-EFFORT | [settings.spec.ts:155](e2e-live/tests/settings.spec.ts#L155) | fail | pass | 2nd PR |
| L-31 | [skills.spec.ts:205](e2e-live/tests/skills.spec.ts#L205) | pass | fail | 2nd PR |

PR の切り方: **初回 PR は両モード fail (L-ERR / L-22 / L-15b)**。 モード差分のあるテストは別 PR。

---

## L-ERR — 真の症状 = 別エラー (409) が表示されている

期待した fake-echo の forced error は **届いておらず**、 代わりに `POST /api/agent` の **409 Conflict** がエラーカードに出ている。

- **期待**: `fake-echo forced error for the e2e-live error-banner canary`
- **実際**: `[Error] Server error 409: {"error":"Session is already running"}`

`text-response-assistant-body` testid 自体は存在する。 中身が違う。 fake-echo の `__FAKE_ERROR__` 検知ロジック ([server/agent/backend/fake-echo.ts:89](server/agent/backend/fake-echo.ts#L89)) より手前で、 backend が「session が既に running」と判断して 409 を返している。

### 仮説 (更新: 2026-05-18 codex review iter-1)

**回帰ではなく、 テスト側の fixture 取り違えが最有力**。

- L-ERR は [`startNewSession`](e2e-live/fixtures/live-chat.ts#L742) を使用 — `page.goto("/")` 後に SPA の `resumeOrCreateChatSession` が動いて `/chat/<既存>` に resume する可能性あり
- もし resume された既存 session に in-flight な turn があれば `sendChatMessage` → `POST /api/agent` → 409 で弾かれる
- PR #1345 で **同じ問題を回避するための [`startGuaranteedNewSession`](e2e-live/fixtures/live-chat.ts#L828) が追加済み** だが、 L-ERR を導入した PR `f94af88d` (2026-05-16) はそれより後にもかかわらず naive な `startNewSession` を使っている
- 結論: **テストの fixture 選択ミス**。 `startGuaranteedNewSession` に置き換える方針が筋

### 次のアクション

- [ ] `startNewSession` → `startGuaranteedNewSession` に置換し、 戻り値 (session id) を `sessionIdForCleanup` 取得にも利用
- [ ] 置換後に同 spec をループ 5 回程度走らせて 409 が再現しないことを確認
- [ ] (補強) `server/api/routes/agent.ts:175-183` の 409 emitter は最新の変更が無く、 backend 側の回帰ではないことを確認済み (`git log -S "Session is already running"` で commit は initial impl のみ)

---

## L-22 — 真の症状 = Claude が seeded skill の実行に失敗

assistant の応答 (Japanese, real LLM):

> "スキル e2e-live-l22-... の実行を試みましたが、エラーが返りました。 これは L-22 canary スキル ... として登録されているもののようです。"

- skill 自体は staged されている (sidebar に `/e2e-live-l22-chromi` が見える)
- slash command `/e2e-live-l22-...` は送信されている
- だが Claude の skill 実行 (Agent SDK 経由) が失敗 → 自然言語で言い訳

### 真の root cause (2026-05-19 判明)

session JSONL で観測した tool 呼び出し:

```json
{"type":"tool_use","name":"Skill","input":{"skill":"e2e-live-l22-..."}}
{"type":"tool_result","content":"Execute skill: e2e-live-l22-...","is_error":true}
```

過去 ~80 セッションを集計した結果、 失敗は claude CLI 2.1.141+ に集中 (2.1.119 / 2.1.140 では 0 件)。 「CLI の Skill ツール regression」だと当初推測し、 私は `server/agent/config.ts` に `--disallowedTools Skill` を入れる workaround を commit した (`0c4a39a3`, `ae49b335`)。

ところがこれは **逆方向** だった。 upstream で別の作者が PR #1445 (`9c024d01 fix(agent): permit the Skill tool so .claude/skills/ skills are invokable`) を main に投入:

> "`--allowedTools` is passed as a strict allowlist, but `Skill` (the tool Claude Code uses to execute a discovered `.claude/skills/<name>/SKILL.md`) was missing from `BASE_ALLOWED_TOOLS`. Every autonomous `Skill({skill:"…"})` call was therefore permission-denied: the harness errored with `Execute skill: <name>`..."

つまり真の原因は **`Skill` が `BASE_ALLOWED_TOOLS` から欠落していた permission-deny**。 修正は **add `"Skill"` to allowedTools** (allow)、 私の `--disallowedTools` は症状を悪化させる方向。

### 修正方針 (実施済)

1. 私の `0c4a39a3` + `ae49b335` を **`git revert`** で打ち消し (`d227f9f7`, `e7553ef5`)
2. main を merge — PR #1445 (`9c024d01`) の正しい修正が入る
3. L-22 は main の `Skill` allowlist 修正で通る想定 (verify は手元で要確認)

---

## L-15b — 真の症状 = target page が "does not exist yet"

navigation 後の page snapshot:

```
- heading "日本語タイトル-chromium-L-15b-1779093371043-6a6e0c" [level=2]
- paragraph: The page "日本語タイトル-chromium-L-15b-..." does not exist yet.
- button "auto_fix_high Request creation of this wiki page"
```

[src/plugins/wiki/View.vue:232-246](src/plugins/wiki/View.vue#L232-L246) によれば `wiki-page-body` testid は `pageExists` かつ `content` が非空のときだけマウントされる。 ここは `pageExists === false` の枝。

つまり target page の **seed が disk に届いていない or wiki backend が non-ASCII slug を resolve できていない**。 fuzzy-resolve バグ (PR #1194 の sentinel) というより、 そもそもページの作成 / 検出 で失敗している。

### 仮説

- non-ASCII slug の seed が、 最近の wiki resolve / file write 周りの refactor で壊れた
- 候補 PR (要確認):
  - `dbeb1019 refactor(wiki): pure-text helpers in src/lib/wiki-page/ — fixes #1297`
  - `423d7a5c fix(wiki): score-based fuzzy resolve to stop iteration-order miss-matches (#1194)`
  - `f16eafdb fix(wiki): parseBulletWikiLinkRow splits [[slug|display]] via parseWikiLink`
- test fixture (`seedWikiPage` 相当) を確認、 何の API でファイルを書いているか追跡

### 次のアクション

- [ ] `e2e-live/fixtures/` の wiki seed helper を読む
- [ ] non-ASCII slug の write/read の挙動を `git log -p` で確認
- [ ] `git bisect` の対象範囲を絞る (前回 pass していた commit が分かれば bisect が確定)

---

## L-SETTINGS-EFFORT (Docker off only) — 2nd PR

- 期待: `effortLevel` を clear すると settings.json から key が消える (null sentinel)
- 実際: `effortLevel: "low"` が残る
- Docker on では pass、 off のみ fail → 環境依存 (FS event の reorder?) かフレーキーの可能性

### 次のアクション (初回 PR 後)

- [ ] settings.json の write 経路を確認 ([server/utils/files/settings-io.ts](server/utils/files/settings-io.ts) 等)
- [ ] null sentinel handling のロジックを確認
- [ ] Docker off だけで再現するか、 フレーキーかを切り分け (リトライ)

---

## L-31 (Docker on only) — 2nd PR

- 期待: General role の agent が `data/skills/<slug>/SKILL.md` に `Write` する
- 実際: `Write` 呼び出しが **そもそも行われていない** (`stagingWrites: []`)
- Docker on のみ fail

L-22 と一見近いが別のレイヤ (L-22 は skill 実行、 L-31 は skill 作成)。

### 仮説 (更新: 2026-05-18 codex review iter-1)

**hook bridge (`server/workspace/hooks/dispatcher.mjs`) は Write/Edit ツール呼び出し後 (`dispatcher.mjs:229-233`) にしか動かない**。 今回は Write 呼び出し自体が `stagingWrites: []` (= 配列が空) なので、 bridge が動く以前の問題。 つまり root cause は **upstream**:

- agent が `mc-manage-skills` preset skill を発見できていない (skill discovery 問題)
- agent が tool 選択で `Write` まで辿り着けていない (role の `availablePlugins` 不整合 or tool dispatch 問題)
- 何らかの理由で Docker on でのみエージェントの行動が変わる (sandbox 環境差?)

PR #1430 でロール分割が入ったが、 `mc-manage-skills` は skill preset (`config/helps/` 系) で `availablePlugins` には乗らない。 General から preset skill が discoverable かどうかは別途確認が必要。

### 次のアクション (初回 PR 後)

- [ ] L-31 の失敗 trace から、 agent が実際にどんな tool を呼んでいるか / 何で止まっているかを `readSessionToolCalls(sessionId)` の生データで確認
- [ ] `mc-manage-skills` preset skill が General role から discoverable か確認 (skill discovery 経路を読む)
- [ ] L-22 を直したら L-31 の挙動も変わる可能性があるので、 初回 PR 後に再実行して挙動を見る

---

## 進捗管理

- [x] worktree 作成 + deps install
- [x] 初版 plans コミット (`797c7d04`)
- [x] codex-cross-review iter-1 (plans) — 3 findings 適用 (`9ff8834d`)
- [x] L-ERR race fix — `startGuaranteedNewSession` 置換 (`24abb8e6`)
- [x] L-15b fix — testLabel lowercase (`1481a204`)
- [x] (誤判断) `--disallowedTools Skill` を commit → 真の原因は逆向きだったため revert (`d227f9f7`, `e7553ef5`)
- [x] main を merge — PR #1445 (`9c024d01`) の **正しい修正** (`Skill` を allowedTools に追加) を取り込み
- [x] L-ERR fake-echo gate — `E2E_LIVE_NO_LLM !== "1"` で skip (`5c558ed6`)
- [x] L-22 は main の修正で real Claude 経由 pass を実機で確認済
- [x] local checks (yarn install / typecheck / lint / test) — 全 pass
- [ ] codex-cross-review (最終ブランチ状態に対して)
- [ ] PR 作成 (push 後 `gh pr create`)
- [ ] 2nd PR (L-SETTINGS-EFFORT, L-31) スコープ精査と修正
