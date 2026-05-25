# Plan: fix plugin-scoped file links from chat resolving to wrong on-disk path

Issue: receptron/mulmoclaude#1473

## 背景

プラグインデータディレクトリは URL エンコードした npm スコープ名を 1 ディレクトリとして平坦化する命名規約（`data/plugins/%40<scope>%2F<name>/`）を採用しているが、チャットからのリンククリック時に `src/utils/path/workspaceLinkRouter.ts` の `safeDecode` がパス全体を `decodeURIComponent` するため、`%40` `%2F` が `@` `/` に化けてセグメント分裂し、サーバが該当ファイルを見つけられない。

詳細な原因分析と検討した代替案は issue #1473 を参照。

## 採用方針

**Approach A — disk-canonical string (per-segment)**: `safeDecode` を「`/`-区切りセグメント単位で `decodeURIComponent` を実行。ただし `%2F` を含むセグメントだけ opaque に保つ」形に変える。

プラグインディレクトリの命名規約は現状維持。

> 初回実装では「multibyte (高位バイト) percent sequence だけ decode、ASCII percent encoding は全部 literal」という粗い判定で `%20` を含む正常な URL transport encoding を破壊するリグレッションを起こした。Codex GHA / CodeRabbit が PR 上で同じ regression を指摘。本方針はその対応版。

## 実装ステップ

### 1. `src/utils/path/workspaceLinkRouter.ts` の `safeDecode` 改修

現状:
```ts
function safeDecode(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}
```

変更後:
```ts
// Per-segment decode. Segments containing `%2F` are kept opaque
// because the plugin convention stores npm-scoped packages as a
// single literal on-disk directory (data/plugins/%40<scope>%2F<name>/).
// All other segments are decoded normally so multibyte filenames,
// `%20` spaces, and encoded `%2E%2E` round-trip through the file
// API correctly (the latter then caught by `normalizePath`).
function safeDecode(str: string): string {
  return str.split("/").map(decodeSegment).join("/");
}

function decodeSegment(seg: string): string {
  if (/%2[fF]/.test(seg)) return seg;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}
```

### 2. テスト反転

`test/utils/path/test_workspaceLinkRouter.ts:139-145` (pin: `%2F` を path separator として展開):
- 旧期待: `data/some/foo%2Fbar.md` → `{ kind: "file", path: "data/some/foo/bar.md" }`
- 新期待: `data/some/foo%2Fbar.md` → `{ kind: "file", path: "data/some/foo%2Fbar.md" }` （ASCII percent は literal）
- コメントも新セマンティクスを反映する形に書き直す

`test/utils/path/test_workspaceLinkRouter.ts:109-112` (pin: `%20` を space に decode):
- 旧期待: `data/some/my%20file.txt` → `{ kind: "file", path: "data/some/my file.txt" }`
- 新期待: `data/some/my%20file.txt` → `{ kind: "file", path: "data/some/my%20file.txt" }`

### 3. テスト追加

a) プラグインスコープ命名規約の round-trip pin:
```ts
it("preserves plugin-scoped percent-encoded directory name as a single literal segment", () => {
  const result = classifyWorkspacePath("data/plugins/%40mulmoclaude%2Fworklog/committed/2026-05.jsonl");
  assert.deepEqual(result, {
    kind: "file",
    path: "data/plugins/%40mulmoclaude%2Fworklog/committed/2026-05.jsonl",
  });
});
```

b) ASCII percent + multibyte 混在ケース:
```ts
it("decodes multibyte percent sequence while preserving ASCII percent literals", () => {
  // Hypothetical: plugin-scoped file with a Japanese filename
  const encoded = "data/plugins/%40mulmoclaude%2Fworklog/%E3%83%A1%E3%83%A2.md";
  const result = classifyWorkspacePath(encoded);
  assert.deepEqual(result, {
    kind: "file",
    path: "data/plugins/%40mulmoclaude%2Fworklog/メモ.md",
  });
});
```

### 4. path traversal の回帰確認

既存テスト (`%2E%2E` 系) を新セマンティクス下でも pass することを確認。`%2E%2E` は ASCII percent encoding なので literal 保持され、`normalizePath` の `..` リテラル検出には届かない。これは「encoded form の traversal が effectiveに無害化される」方向の挙動変化で、セキュリティ的にはむしろ強化。

ただし `%2E%2E` を ASCII literal として保持すると `..` 検出に引っかからないので、テスト期待値も変わる:
- 旧期待: `data/wiki/pages/%2E%2E/sources/foo.md` → 正規化されて `data/wiki/sources/foo.md`
- 新期待: 同じ入力 → `{ kind: "file", path: "data/wiki/pages/%2E%2E/sources/foo.md" }` （`%2E%2E` がリテラル保持される）

これは挙動変化だが、攻撃面は **狭くなる** （`..` リテラルでの traversal 試行は引き続き弾かれる; encoded form での traversal は今回 effectively 無害化される — サーバ側の `resolveWithinRoot` も別途防御層を持つはず）。

### 5. `todoPreview.ts` の workaround について

`src/utils/filesPreview/todoPreview.ts:10-19` の both-form 比較 workaround は今回の PR では触らない（別 PR で整理）。

### 6. yarn format / lint / typecheck / build / test

すべて pass を確認してから commit。

## コミット予定

1 コミット:
```
fix: preserve ASCII percent encodings (%40, %2F) in workspace link decode

The plugin naming convention stores npm-scoped directories as single
URL-encoded directories on disk (data/plugins/%40<scope>%2F<name>/).
classifyWorkspacePath's previous decodeURIComponent over the whole
path collapsed `%2F` into a path separator, breaking server-side
file resolution for any plugin-scoped link from chat.

Decode only multibyte (high-byte) percent sequences so that
multibyte filenames still work, but ASCII percent encodings are
preserved as literal characters matching disk layout.

Refs: #1473
```

## 影響範囲（再確認）

- 修正: `src/utils/path/workspaceLinkRouter.ts`
- テスト: `test/utils/path/test_workspaceLinkRouter.ts`
- その他: なし（呼び出し元の `App.vue`, `WikiPageBody.vue`, `textResponse/View.vue` は変更不要）
- サーバ・ルーター設定: 変更なし
