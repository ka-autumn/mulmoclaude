# test: env-bound `requireSameOrigin` wiring smoke (#1463)

## 背景

PR #1458 で CSRF guard に opt-in trusted-origin allowlist を追加。
[`server/api/csrfGuard.ts`](../server/api/csrfGuard.ts) 末尾の以下の export 行が wiring:

```ts
export const requireSameOrigin = requireSameOriginWith(env.trustedOrigins);
```

既存テスト [`test/server/test_csrfGuard.ts`](../test/server/test_csrfGuard.ts) の "env-binding integration" describe は、`server/system/env.ts` を fresh import → `requireSameOriginWith(envMod.env.trustedOrigins)` を **手動 recompose** している。これでは `env-parser + factory` の合成は検証できるが、`csrfGuard.ts` の export 行で

```ts
export const requireSameOrigin = requireSameOriginWith([]);  // ← typo
// or
export const requireSameOrigin = requireSameOriginWith(env.sandboxMountConfigs);  // ← wrong field
```

のような typo が混入しても fail しない。CodeRabbit が PR #1458 で指摘した通り。

## 方針

Issue #1463 の **案 A**（別 spec ファイル + 専用 yarn script）を採用。

ESM resolver は `import { env } from "../system/env.js"` を un-queried URL でキャッシュするため、同一プロセス内で `csrfGuard.ts` を fresh re-import しても初回 env snapshot に張り付く。subprocess で別プロセスから fresh load するのが唯一確実な方法。

## 実装

### 1. 新規 spec ファイル: `test/server/test_csrfGuard_env_wiring.ts`

- `import { requireSameOrigin } from "../../server/api/csrfGuard.js"` だけ（factory は import しない）
- `process.env.MULMOCLAUDE_TRUSTED_ORIGINS` の状態で test の登録を分岐:
  - **set モード** (trusted origin が含まれる): listed LAN origin への POST が `next()` を呼ぶこと、非 listed LAN origin が 403 になることを検証
  - **unset モード** (default): LAN origin への POST が 403 になる (localhost-only fallback) ことを検証
- 共通: `http://localhost:5173` への POST は常に通る (sanity)

### 2. `package.json` に dedicated script を追加

```json
"test:csrf-wiring": "cross-env MULMOCLAUDE_TRUSTED_ORIGINS=http://192.168.1.42:5173 tsx --test test/server/test_csrfGuard_env_wiring.ts"
```

`cross-env` 経由なので Windows でも動く (CI matrix に Windows あり)。

### 3. CI 連携

`.github/workflows/pull_request.yaml` の `lint_test` job に step を追加:

```yaml
- run: yarn run test:csrf-wiring
```

`yarn run test:coverage` の後に配置。env-unset の variant は既存の glob `./test/*/test_*.ts` が拾うので、新規 step は env-set variant を担当。

## 何をテストして何をしないか

- ✅ `csrfGuard.ts` の export 行が正しい env field (`env.trustedOrigins`) と factory を wiring していること
- ✅ env unset 時の fallback (localhost-only) が壊れていないこと
- ❌ env parser 自体の挙動 (CSV split, null 拒否) — `test_csrfGuard.ts` の既存 suite 担当
- ❌ middleware の純粋ロジック (Origin parse, allowlist match) — `test_csrfGuard.ts` の既存 suite 担当
- ❌ 他の env-bound module への横展開 — 必要になったら別 issue

## 受け入れ条件 (Issue #1463)

- [x] env を set した subprocess / spawned context で csrfGuard.ts を fresh import し、`requireSameOrigin` が当該 LAN Origin の POST を 200 で通すことを検証する test がある
- [x] 同じ仕組みで env unset 時に LAN Origin は 403 になることも検証
- [x] CI で実行され、export 文 typo (`requireSameOriginWith([])` 等) が必ず fail を出す

## 影響範囲

- 追加:
  - `test/server/test_csrfGuard_env_wiring.ts` — env-bound wiring smoke spec
  - `test/server/helpers/fakeExpressMiddleware.ts` — shared fake Express helpers (`FakeReq` / `FakeRes` / `makeReq` / `makeReqWithRawOrigin` / `makeRes`)、既存 spec との duplicate を解消するため抽出
  - `plans/test-csrf-env-wiring-1463.md`
- 修正:
  - `package.json` (`scripts.test:csrf-wiring` を追加)
  - `.github/workflows/pull_request.yaml` (lint_test job に CI step を追加)
  - `test/server/test_csrfGuard.ts` — 上記 helper module を import するように refactor。仕様変更なし、net -47 lines
- production code (`server/api/csrfGuard.ts`, `server/system/env.ts`) は触らない
