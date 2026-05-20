# Skill catalog foundation — PR-A of #1335

## Goal

Stop auto-mirroring every preset skill into `<workspace>/.claude/skills/`. Move them into a separate **catalog** location (`<workspace>/data/skills/catalog/preset/`) that the launcher owns and rewrites on every boot. `.claude/skills/` becomes the **active** layer — only what's there enters Claude Code's discovery + the system prompt.

PR-A is the foundation. PR-B will add UI to star catalog entries → mirror them into `.claude/skills/` (active). PR-C will add Anthropic catalog via git sparse checkout.

## Approach

1. **Add path constants** in `server/workspace/paths.ts`:
   - `skillsCatalog: "data/skills/catalog"` — the catalog root (preset / anthropic / community will live under here)
   - `skillsCatalogPreset: "data/skills/catalog/preset"` — launcher-managed preset slot
2. **Flip the destination** in `server/workspace/skills-preset.ts` + `server/workspace/workspace.ts`:
   - Source unchanged: `<launcher>/server/workspace/skills-preset/<slug>/`
   - Destination: `<workspace>/data/skills/catalog/preset/<slug>/` (was `<workspace>/.claude/skills/<slug>/`)
   - `mkdirSync(WORKSPACE_PATHS.skillsCatalogPreset, { recursive: true })` before the sync (catalog dir is several levels deep, not in `EAGER_WORKSPACE_DIRS`).
3. **Sync behaviour unchanged** at the helper level: still copies every valid `mc-*` slug, still removes retired `mc-*` entries from the destination. The destination's "mc-* only" check stays as defence-in-depth even though `catalog/preset/` is fully launcher-owned.
4. **Skill resolver behaviour unchanged**: Claude Code still scans `.claude/skills/` for slash-command discovery. Catalog entries are invisible to the resolver — that's the entire point.
5. **No migration**: per user direction, existing `.claude/skills/mc-*` from prior installs is left untouched. Existing users will end up with duplicates (the same skill in both `catalog/preset/` and `.claude/skills/`) until they manually clean the active copies. Fresh installs see catalog only, no preset in `.claude/skills/` (until a UI lands in PR-B).

## What this does NOT do

- **No UI changes** (`src/plugins/manageSkills/View.vue` is untouched). PR-B introduces the catalog browser + ★ Star / ▶ Run once / 📖 Preview affordances.
- **No star registry** (`stars.json` or similar). PR-B can introduce one if needed; PR-A leaves "presence in `.claude/skills/`" as the implicit active-state signal.
- **No Anthropic skills catalog**. PR-C adds `data/skills/catalog/anthropic/` + git sparse checkout + scheduler sync.

## Files touched

- `server/workspace/paths.ts` — two new keys.
- `server/workspace/skills-preset.ts` — doc-comment + interface comment refresh; logic untouched (the helper is destination-agnostic).
- `server/workspace/workspace.ts` — destination switch + `mkdirSync` of the new path.
- `test/workspace/test_skills_preset.ts` — doc-comment refresh; assertions tmpdir-based so they continue to pass without change.
- `test/workspace/test_paths_shape.ts` — list the new path keys so the shape test reflects reality.
- `docs/extension-mechanisms.md` — Preset Skills section now documents the catalog vs active split.

## Acceptance

- Fresh `~/mulmoclaude/` workspace: after boot, `data/skills/catalog/preset/mc-*/` contains every shipped preset. `.claude/skills/` is empty (no auto-mirror).
- Existing workspace with `~/mulmoclaude/.claude/skills/mc-*/` from a prior install: those stay; the catalog dir is additionally populated. Existing skills keep working until PR-B's UI lets the user clean up.
- `syncPresetSkills` tests pass unchanged (destination-agnostic).
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
- `WORKSPACE_PATHS.skillsCatalogPreset` resolves correctly.
- Comment block in `skills-preset.ts` + relevant section in `docs/extension-mechanisms.md` reflect the new model.

## Follow-up issues

- **PR-B** — UI: hierarchical menu (Active / Catalog / My Skills), Run once / ★ Star / 📖 Preview actions, slug-collision policy.
- **PR-C** — Anthropic git sparse checkout, scheduler sync task, upstream-update notification badge.
