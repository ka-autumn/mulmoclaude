# Move Windows `lint_test` matrix to a scheduled workflow

Closes #1585.

## Why

`lint_test` runs on every PR push as a 6-cell matrix —
`[ubuntu-latest, windows-latest, macos-latest] × [node 22.x, 24.x]`.
The Windows cells are consistently the slowest (~3-5× the ubuntu wall
clock) because:

- NTFS extraction of the yarn cache and `packages/*/dist` tarballs
  is slow under tar-on-Windows.
- Windows Defender realtime monitoring fights `yarn install`'s atomic
  renames; we disable it per-job, but the disable itself takes time.
- `tsc` across the 25 `@mulmobridge/*` workspaces serialises tighter
  on Windows than on Linux/macOS.

Windows-specific regressions are real but rare — usually path
separators or case-sensitivity bugs. Daily + on-merge coverage is
plenty; paying the cost on every PR push is not.

## What changes

1. **`.github/workflows/pull_request.yaml`** — drop `windows-latest`
   from the `lint_test.strategy.matrix.os` list. The matrix becomes
   `[ubuntu-latest, macos-latest] × [22.x, 24.x]` (4 cells, down
   from 6). Remove the Windows-only step variants (Defender disable,
   node_modules cache) that no longer have a Windows cell to gate.

2. **`.github/workflows/lint_test_windows.yaml`** (new) — runs the
   same step sequence on `windows-latest × [22.x, 24.x]` (2 cells),
   triggered by:

   - `schedule`: `0 18 * * *` (daily 18:00 UTC = 03:00 JST, matches
     `e2e_live_no_llm.yaml`'s cadence).
   - `push: branches: [main]`: catches regressions immediately
     after a merge so the next PR doesn't inherit a broken main.
   - `workflow_dispatch`: manual rerun for triage.

   `paths-ignore: docs/**, plans/**, **/*.md` mirrors the PR
   workflow so doc-only main pushes don't trigger a Windows run.

## Step coverage parity

Both workflows run, in order: install → cache packages/dist →
build:packages (when cache miss) → typecheck → lint →
plugins:codegen:check → build → verify bundle integrity →
test:coverage → test:csrf-wiring.

The Windows-only setup pre-steps (Defender disable, node_modules
cache, no setup-node yarn cache) move with the matrix into the new
workflow.

## Trade-offs

- **PR feedback**: saves ~3-5 minutes per push by retiring the
  Windows cells. e2e (the other long pole) is unchanged.
- **Regression detection lag**: a Windows-only break introduced
  by a PR now lands on main and only surfaces on either (a) the
  post-merge `push` trigger (within ~minutes) or (b) the next
  scheduled run (within 24h). The post-merge trigger reverts the
  "wait 24h to find out" worry — if main breaks, the very next
  scheduled-workflow run on main reports it before the next PR
  starts CI.
- **Coverage gap**: PRs that ONLY change `.github/**` or top-level
  files outside the `paths-ignore` list still trigger the schedule
  workflow's push side after merge, so workflow-edit regressions
  still get caught. PRs that ONLY touch docs are already excluded
  from PR-CI via the existing `paths-ignore` block; they remain
  excluded on the Windows side too.

## Out of scope

- Touching `e2e` (the other PR-CI pole). E2E is already sharded
  across 2 runners and runs only on ubuntu — no Windows cell exists.
- Adding macOS or Linux to the scheduled workflow. The PR-CI
  matrix already covers them, and Windows is the only platform
  with cost asymmetry justifying this split.
- Caching `dist/client` (the Vite build output) — that step is
  fast on Windows compared to `build:packages` and complicates the
  cache key. Out of scope.

## Validation

- `actionlint .github/workflows/pull_request.yaml
  .github/workflows/lint_test_windows.yaml` → clean.
- `zizmor --persona=regular --config .github/zizmor.yml
  .github/workflows/` → clean.
- The new workflow's first run will be the post-merge `push: main`
  trigger — that's the smoke test.
