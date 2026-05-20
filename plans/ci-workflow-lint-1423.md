# ci: actionlint + zizmor for GitHub Actions workflows (#1423)

## 背景

workflow YAML 専用の静的解析が無い。CodeQL `Analyze (actions)` は
動くが `${{ }}` 構文ミスや `run:` の shellcheck、workflow 固有の
セキュリティ smell は拾わない。記事
（https://zenn.dev/kou_pg_0131/articles/gha-static-checker）の
actionlint / ghalint / zizmor を現状 CI に照らして評価:

- **actionlint** — 構文 + 式 + 埋め込み shellcheck。低ノイズ高価値 → 採用
- **zizmor** — workflow セキュリティ（テンプレートインジェクション・
  過剰権限・artifact poisoning）。CodeQL と相補 → 採用（regular persona）
- **ghalint** — 主価値の `permissions:` 必須は5本全て既達。hash-pin
  ルールが first-party `actions/*` に churn を強いる → **見送り**
  （community action 導入時に再検討）

## 実装

- `.github/workflows/workflow-lint.yaml`（新規）。`.github/**` 変更の
  PR/push でトリガ。リポジトリの supply-chain 方針（`secret-scan.yml`
  と同じ）に従い **version+SHA256 pin したバイナリを DL+検証** して
  実行（third-party action 不使用）。
  - actionlint `v1.7.12`（SHA256 は release の checksums.txt 由来）
  - zizmor `v1.25.2`（checksums 非公開のため tarball から算出）
- `.github/zizmor.yml`: `unpinned-uses` を `actions/*` は `ref-pin`、
  その他は `hash-pin`。first-party のタグ pin を許容しつつ将来の
  third-party action はタグ pin だと検出される。ghalint 見送り判断と整合。
- zizmor `artipacked`（checkout が token を .git/config に残す）9 件を
  全 workflow の `actions/checkout` に `persist-credentials: false` を
  付けて解消（いずれの job も git push しない。`gh` は GH_TOKEN env 認証
  なので codex_review も安全）。

## 検証（ローカル、mac バイナリ）

- `actionlint` → exit 0（新 workflow 含む全 5+1 本クリーン）
- `zizmor --persona=regular`（`.github/zizmor.yml` 適用）→ exit 0
  "No findings"（unpinned-uses 23 件は config で suppress）

## 完了条件（#1423）

- [x] actionlint + zizmor が `.github/**` PR で実行・findings で fail
- [x] 両ツール version+SHA256 pin（DL+検証）
- [x] zizmor config が `actions/*` の SHA-pin churn を再導入しない
- [x] 既存 5 workflow が両ツールを通過（artipacked 9 件修正）

## スコープ外

- ghalint 導入（別途、community action 追加時）
- 既存 `actions/*` の SHA pin 化（方針として tag pin 維持）
