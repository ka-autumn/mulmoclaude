# Remove the Encore feature

**Rationale.** Collections gained time-driven bells (`triggerField` + `triggerLeadDays`)
and host-driven recurrence (`spawn`) in #1xxx (commit `df120253`). Those subsume
Encore's two pillars — "remind before a date" and "auto-create the next cycle".
The only remaining Encore-unique capability is graduated multi-phase severity
escalation, which the user judged not worth maintaining a second time-driven
harness for. Decision: remove Encore entirely; Collections stays as-is.

## Blast radius (verified)

### Delete wholesale (Encore-only)
- `server/encore/` (dir, dispatch/tick/cycle/obligation/notifier/lock/paths/boot/closure/reconcile/yaml-fm + `handlers/*` + INVARIANTS.md)
- `src/plugins/encore/` (dir, 8 files)
- `src/types/encore-dsl/` (dir: schema/cadence/at-expression/at-resolver)
- `server/api/routes/encore.ts`
- `server/utils/files/encore-io.ts`
- `server/workspace/helps/encore-dsl.md`  (helps are dir-copied via `readdirSync`, no manifest)
- `test/plugins/test_encore_dispatch.ts`, `test_encore_reconcile.ts`, `test_encore_delete_obligation.ts`
- `test/roles/test_encore_seed_role.ts`
- `test/lang/test_encore_seed_prompts.ts`
- `e2e/tests/encore-seeded.spec.ts`

### Edit — de-register from host
- `server/index.ts` — drop `encoreRoutes` import, `registerEncoreTick` import, `app.use(encoreRoutes)`, `registerEncoreTick(taskManager)`
- `src/main.ts` — drop `encore: API_ROUTES.encore,`
- `src/config/roles.ts` — drop `TOOL_NAMES.defineEncore`/`manageEncore`, the `(Encore)` prompt phrase, and the `ENCORE_SEED_ROLE_ID` block (only consumers are deleted files)
- `src/config/apiRoutes.ts` — update the `manageEncore` example comment (l.133)
- `src/router/pageRoutes.ts` — drop `encore` PAGE_ROUTES key
- `src/router/index.ts` — drop `/encore` route + comments
- `src/App.vue` — drop `encoreViewComponent` + its template branch + comments
- `src/components/PluginLauncher.vue` — drop `encore` launcher entry + union-type member
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — drop `sections.encore` + the whole `encoreDashboard` block (all 8 in lockstep)
- `server/workspace/helps/index.md` — drop the encore-dsl link
- `server/workspace/helps/collection-skills.md` — drop the "that's Encore's job" cross-refs
- `test/workspace/test_paths_shape.ts` — drop `"encore"` from `expectedKeys`
- `src/plugins/_generated/{registrations,metas,server-bindings}.ts` — regenerate via `yarn plugins:codegen`

### Edit — e2e-live
- `e2e-live/tests/skills.spec.ts` — drop the L-21B `defineEncore` scenario + `removeEncoreObligation` import
- `e2e-live/tests/happy-tour.spec.ts` — drop the `/encore` tour step + comments
- `e2e-live/fixtures/live-chat.ts` — drop `removeEncoreObligation` helper + `ENCORE_*` consts
- `e2e-live/tests/ui.spec.ts` — comment-only mention; light edit

### Docs
- `README.md` + 7 locale READMEs — drop the Encore intro mention
- `docs/developer.md` — remove the "canonical worked example" section (l.693-705, points at deleted files)
- `docs/dsl-as-harness.md` — Encore worked examples rewritten to Collections (recurrence facet: `triggerField`/`triggerLeadDays`/`spawn`); the two intro sections merged
- `MANIFEST.md` — Pattern B ("NL → DSL → engine") rewritten from Encore to Collections; example mentions + runtime-plugin count fixed
- `docs/CHANGELOG.md` — add a removal entry

### Deliberately NOT touched (out of scope)
- "Phase 1 of the Encore plan" historical comments in `server/plugins/runtime*.ts`, `runtime-tasks-api.ts`,
  `runtime.ts`, `runtime-loader.ts`, `preset-list.ts`, `diagnostics.ts`, `server/events/notifications.ts`,
  `src/components/NotificationBell.vue`, `src/plugins/textResponse/*`, `e2e/tests/notifications.spec.ts` —
  these attribute generic host infra (`runtime.tasks`/`runtime.chat`/`/debug`) to the dev effort named
  "the Encore plan"; that infra stays.
- `packages/plugins/debug-plugin/*`, `packages/plugins/todo-plugin/src/handlers/priority-notifier.ts` —
  reference the Encore plan / `server/encore/*` as design lineage in comments only; the plugins stay.
- `test/server/notifier/test_engine.ts`, `test/utils/session/test_sessionEntries.ts` — `"encore"` appears only
  as arbitrary string literals in generic notifier/session tests; they pass unchanged.

## Verify
`yarn plugins:codegen` → `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test` → `yarn test:e2e`
