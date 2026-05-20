# chore: auto-install Playwright browsers via test script chain

## 背景

`@playwright/test` のバージョン bump (新しい browser binary 要求) 後にローカル開発者が `yarn playwright install` を実行し忘れ、`yarn test:e2e:live:media` が webkit binary 不在で 5/10 failed になるケースが #1195 QA 検証中に発生した。

CI 側は workflow step で対応済み:

- `.github/workflows/pull_request.yaml:214` — `npx playwright install chromium webkit --with-deps`
- `.github/workflows/e2e_live_no_llm.yaml:73` — `npx playwright install chromium --with-deps`

ローカル dev だけが取りこぼす構造になっている。

## 修正方針

新しい共通 script `ensure:playwright-browsers` (中身は `playwright install chromium webkit`) を 1 個追加し、`test:e2e` / `test:e2e:live*` の各 npm script の先頭に `yarn ensure:playwright-browsers && ` を chain する (議論時の「案 A」)。共通化することで将来ブラウザ追加 / バージョン制約変更が 1 箇所で済む。

### なぜ chain inline か (他案との比較)

- **postinstall フック (案 B)**: `yarn install` 後に自動 download。e2e を一切回さない contributor にも 150MB の cost を強制してしまうので不採用。
- **skill / docs での誘導 (案 C)**: skill を経由しない人 (`yarn test:e2e:live:media` 直叩き / CI 以外のローカル実行) が守られないので不採用。

### なぜ idempotent / 安全か

- `playwright install` は idempotent: 既存ブラウザ検出時は ~1s で fast-path return (download なし)
- CI workflow が先に `--with-deps` で system deps + binaries を入れ済みなので、CI 側でも fast no-op で素通り
- `e2e_live_no_llm.yaml` は npm script を bypass して `npx playwright test --project=chromium` を直接呼ぶので、本変更の影響範囲外

## 変更対象

`package.json` の test:e2e 系 scripts (現状 chromium + webkit projects を両方持つもの):

- `test:e2e`
- `test:e2e:live`
- `test:e2e:live:media`
- `test:e2e:live:wiki`
- `test:e2e:live:wiki-nav`
- `test:e2e:live:session`
- `test:e2e:live:roles`
- `test:e2e:live:mulmo-script-edit`
- `test:e2e:live:ui`
- `test:e2e:live:skills`
- `test:e2e:live:settings`

`e2e/playwright.config.ts` と `e2e-live/playwright.config.ts` は両方 chromium + webkit projects を定義しているので、両方 install する。

## 検証

1. ローカル: 自分の OS の Playwright WebKit cache を消した状態で `yarn test:e2e:live:media` → 自動 install が走り pass することを確認
   - macOS: `~/Library/Caches/ms-playwright/webkit-*`
   - Linux: `~/.cache/ms-playwright/webkit-*`
   - Windows: `%LOCALAPPDATA%\ms-playwright\webkit-*`
2. もう一度同じ script を実行 → fast no-op (1s 以下) で先に進むことを確認
3. `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` 全 green

## 関連

- #1195 QA 検証中に発覚
