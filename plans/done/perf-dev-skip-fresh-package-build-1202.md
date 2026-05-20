# perf: skip workspace package rebuild when dist is fresher than src (#1202)

`yarn dev` runs `yarn build:packages:dev` unconditionally and burns ~8.5 s
on every restart. Replace with an mtime-based skip-if-fresh gate so only
genuinely stale packages get rebuilt.

Issue: [#1202](https://github.com/receptron/mulmoclaude/issues/1202)

## Files

- `scripts/dev-build-if-needed.mjs` — new. Walks the 6 workspace packages,
  compares latest mtime under `src/` (+ `package.json`) vs `dist/`, runs
  `yarn workspace <name> run build` for the stale ones, no-ops the rest.
- `package.json` — `dev` / `dev:debug` route through the gate. Add
  `dev:full-build` as the always-rebuild escape hatch.
- `test/test_devBuildIfNeeded.ts` — unit tests for the mtime comparison
  and the stale-package selection (no spawn — pure logic factored out into
  a helper).

## Acceptance

- [ ] `yarn install && rm -rf packages/*/dist && yarn dev` → all 6 rebuild
  (cold-start path)
- [ ] `yarn dev` immediately after a successful `yarn dev` → all 6 skip,
  total runtime ~0.3 s
- [ ] Edit a single source file in `packages/todo-plugin/src/` → only
  `@mulmoclaude/todo-plugin` rebuilds; the other 5 skip
- [ ] Edit `packages/todo-plugin/package.json` (e.g. bump deps) → still
  triggers rebuild even if no `src/` file changed
- [ ] `yarn dev:full-build` always rebuilds all 6 regardless of mtime
- [ ] `yarn typecheck / lint / build / test` all green

## Why mtime over a more clever cache

`tsc --build` with `incremental: true` + `composite: true` references is
the "right" answer in TypeScript-land but requires cross-cutting tsconfig
surgery across 4 tsc-based packages and doesn't help the 2 vite-based
ones. mtime gives 90% of the benefit with ~50 lines of plain Node.

If mtime turns out insufficient (e.g. file deletions under `src/` start
producing hard-to-diagnose bugs), the natural follow-up is full
`incremental: true` adoption — but that's a separate PR with its own
cost/benefit case.
