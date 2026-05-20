# fix(chat): make generated-file references reliably clickable (#1300)

## 問題

LLM が生成したファイルをチャットで提示するとき、UI 表示が一貫しない:

| 形 | 描画 |
|---|---|
| `[name.md](artifacts/.../name.md)` — Markdown link | クリック可能 ✓ |
| `` `artifacts/.../name.pdf` `` — inline code | リンクにならない ✗ |

LLM 出力ゆらぎが直接的原因。`server/agent/prompt.ts` に
**「チャット返信で生成ファイルをどう示すか」** の指示が無いため、
ゆらぎを抑える術がない。

## 採用方針: A + B 両方適用

issue 本文の推奨どおり、両方やる:

- **B (prompt)** で 80%+ ゆらぎを潰す (低コスト・即効性)
- **A (UI renderer)** で漏れた残り 20% をフォールバック処理 (堅牢性担保)

### B: prompt 追記

`server/agent/prompt.ts` の `SYSTEM_PROMPT` 内に新セクションを追加:

```markdown
## Referring to files in chat replies

When you finish creating / updating / surfacing a file (PDF, Markdown,
HTML, image, spreadsheet, etc.), present it to the user as a Markdown
link: `[<filename>](<workspace-relative-path>)`.

- NEVER write the path as inline code (e.g. `` `artifacts/foo.pdf` ``) — non-clickable.
- The link path is the same workspace-relative form used by the rest of the system (no leading slash, no `file://`, no `/api/files/...`).
- A trailing one-line prompt like "Open to review" is fine; do NOT write the path as plain text without the `[...](...)` wrapper.
```

「Image references in markdown / HTML」と並ぶ位置に挿入。既存の
locale 切り替えやらは無関係 (SYSTEM_PROMPT は英語 only)。

### A: UI auto-linkification (fallback)

`src/utils/markdown/` に新 helper を追加し、marked の `codespan`
renderer override で **「workspace-relative パスっぽい inline code」**
を `<a href>` に変換する。

#### 検出条件

inline code 内容が以下の **両方** を満たす:

1. **接頭辞**: `artifacts/` / `data/` で始まる (= workspace-root 直下の
   生成物 / データ dir)
2. **拡張子**: `.<ext>` で終わる、`ext` は 1-8 文字英数字 (CSS スタイルの
   typing 慣例 e.g. `obj.prop`, CLI flags `--name`, version `v1.2.3`
   などの誤検出を弾く)

正規表現例:

```ts
/^(?:artifacts|data)\/[^\s]+\.[A-Za-z0-9]{1,8}$/
```

`[^\s]+` で path segment 内のスペースを禁じ、`.<ext>$` で末尾アンカー。
末尾 punctuation / paren / 半角コロン等は code span の中身として
含まれない想定 (codespan の中身は backtick で区切られているため、
markdown パーサが既に拡張子の後の punctuation を inline code の外に
出している)。

#### 出力

`<code>` ラッパは残し、内側に `<a>`:

```html
<a href="<href>" class="workspace-link" data-workspace-path="<path>"><code>artifacts/.../foo.pdf</code></a>
```

`data-workspace-path` 属性は既存の workspace-link routing
(L-23, `b8899fb` で入った percent-encoded 経路) と同じ ID を持つ —
クリックハンドラの decode 経路に乗せる。

#### 既存の wiki-embed (`registerWikiEmbed`) パターンと統合

`src/utils/markdown/wikiEmbeds.ts` は `[[type:id]]` を新規 token として
処理しているが、本件は **既存 codespan token を override** するので
別経路。`src/utils/markdown/setup.ts` に新 init を追加し、`marked.use`
で codespan renderer を hook する。

## テスト

### B (prompt) 側

`server/agent/prompt.ts` の SYSTEM_PROMPT は系の起点なので unit test
を新規追加してまでは pin しないが、既存 `test_agent_prompt.ts` が
section の有無を見ている。新セクションを足したら同 spec の
`buildSystemPrompt` が壊れない (= 文字列 contain check が通る) ことを
確認する。

### A (renderer) 側

新規 `test/utils/markdown/test_workspaceLinkify.ts`:

1. `` `artifacts/images/2026/05/foo.png` `` → `<a href>` + `<code>` 構造
2. `` `data/wiki/pages/note.md` `` → 同上
3. `` `artifacts/foo.pdf` `` (depth 1) → リンク化
4. **誤検出回避**:
   - `` `foo.bar` `` → リンク化しない (workspace-root 接頭辞なし)
   - `` `artifacts/foo` `` → リンク化しない (拡張子なし)
   - `` `artifacts/foo.<script>` `` → リンク化しない (拡張子に `<` 等)
   - `` `artifacts/path with space.png` `` → リンク化しない (`[^\s]+`)
   - `` `artifacts/foo.pdf.tmp` `` → リンク化する (`.tmp` は 3 文字英数字、誤検出する案件は別途)
5. Markdown link `[foo](artifacts/foo.pdf)` は今までどおり (codespan
   経路には来ないので影響なし)

## 影響範囲

### B 側
- LLM の出力習慣を変える → 既存チャット履歴に対しては効かない
   (履歴は再生のみ)
- 8 locale i18n 影響なし (SYSTEM_PROMPT は英語)

### A 側
- inline code を override するので、過去メッセージにも遡及して効く
- 誤検出リスク: `artifacts/...` を本当のコード snippet として書いた
   場合に誤ってリンク化する。実例考えにくいが、issue 本文の比較表に
   ある通り受容する

### A vs B 競合
- LLM が B 準拠で markdown link を出力 → codespan に到達しないので A は走らない
- LLM が古い inline-code 形式を出力 → A がフォールバックでリンク化

## 完了基準

- [ ] B: `SYSTEM_PROMPT` に「Referring to files in chat replies」セクション追加
- [ ] A: `src/utils/markdown/workspaceLinkify.ts` 新規追加 + `setup.ts` で `marked.use` に組み込み
- [ ] `test_workspaceLinkify.ts` の 5 ケース pass
- [ ] 既存 markdown レンダラ動作が変わらないことを `test_wikiEmbeds.ts` で確認 (同じ marked instance を共有しているため)
- [ ] typecheck / lint / build clean
- [ ] 既存チャット履歴に対する手動 smoke (`tail -1 conversations/chat/<id>.jsonl` で再現したセッションの再表示)
