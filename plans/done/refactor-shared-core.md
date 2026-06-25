# Plan: Consolidate shared server/core packages into `@mulmoclaude/core`

## Motivation

`packages/` currently mixes **two unrelated reasons** for splitting code out:

1. **Independently-optional fleets** — must stay many packages:
   - `@mulmobridge/*` platform bridges (×25)
   - `@mulmoclaude/*-plugin` runtime plugins (×12) — the runtime-plugin model is "1 plugin = 1 npm package" (scaffolded by `create-mulmoclaude-plugin`, dispatched via `/api/plugins/runtime/:pkg`, gated by roles). Merging breaks the model.

2. **Shared-with-MulmoTerminal core** — over-fragmented into 7 micro-packages under `packages/services/`. This is the consolidation target.

The fragmentation forced the whole `tier1→tier5` build-order dance, the `skill-bridge → collection-plugin` "uphill" externalize hack, and the recurring "where do I put a shared predicate (`isSafeActionTemplatePath`)?" problem. One module dissolves all three.

## Current state (the 7 services)

| package | exports | external deps | intra-group deps | host consumers | browser face? |
|---|---|---|---|---|---|
| `file-change-publisher` | `.` | — | — | server×1 | no |
| `notifier` | `.` | — | — | server×2 | no |
| `scheduler` | `.` | `@receptron/task-scheduler` | — | server×2 | no |
| `workspace-setup` | `.`, `./slug` | — | — | server×3 | **`./slug` browser-safe** |
| `whisper` | `.`, `./client` | — | — | server×1 + **frontend×1** | **`./client` browser** |
| `collection-watchers` | `.` | `collection-plugin`, `notifier` | → notifier | server×2 | no |
| `skill-bridge` | `.` | `collection-plugin` (peer) | — | server×2 | no |

Key facts:
- **Not all server-only.** `whisper/client` is imported by `src/composables/useVoiceInput.ts`; `workspace-setup/slug` is browser-safe. Subpath isolation is mandatory.
- **Intra-group dep:** `collection-watchers → notifier`.
- **The collection-engine trap:** `skill-bridge` needs only `isSafeActionTemplatePath`; `collection-watchers` needs the **engine** (`discoverCollections`, `loadCollection`, `whenMatches`, `CollectionSchema`, `CollectionItem`, `LoadedCollection`, reconcile). That engine lives in `collection-plugin`'s isomorphic (`.`) + `./server` surfaces (`derive`, `discovery`, `paths`, `templatePath`, `io`, `validate`, `spawn`, `delete`, `views`) — **bundled inside a Vue tier5 plugin**. This is why everything downstream reaches uphill.

## Target shape

A single early-tier package with subpath exports; the **collection engine moves out of the Vue plugin into core**.

```
@mulmoclaude/core
  ./notifier
  ./scheduler              (external: @receptron/task-scheduler)
  ./file-change
  ./workspace-setup        ./workspace-setup/slug   (browser-safe)
  ./whisper                ./whisper/client         (browser)
  ./skill-bridge
  ./collection-watchers
  ./collection             (isomorphic engine: derive/formula/visibility/validate)
  ./collection/server      (discovery/io/spawn/delete/views)
  ./collection/paths       (isSafeActionTemplatePath, isSafeTemplatePath, isSafeCustomViewPath)
```

`@mulmoclaude/collection-plugin` shrinks to **Vue-only** (`./vue` + `./style.css`) and depends on `@mulmoclaude/core` for the engine + types. Runtime-plugin model preserved.

### What this dissolves
- **Build tiers:** `core` goes in the explicit tier-1/2 enumeration (auto-discovery only covers tier3 bridges + tier4 `-plugin`s). Every consumer — both apps, collection-plugin, the old services — depends on it **downhill**. No externalize, no same-tier parallel race.
- **`isSafeActionTemplatePath` placement:** just `core/collection/paths`; skill-bridge and the schema validator both import it intra-/downhill.
- **`collection-watchers → notifier`** becomes an intra-package relative import.
- **Version skew / drift:** both apps track one `core` version.

## Constraints to preserve
- **Browser subpaths must not pull server code.** `whisper/client`, `workspace-setup/slug`, `collection` (isomorphic) stay in files that never transitively import `node:fs`/sidecar/ffmpeg. Already true across today's package split; keep separate entry files + mark `node:*` external in vite, multi-entry build (workspace-setup and whisper already do multi-entry — proven pattern).
- **`skill-bridge` lean-dispatcher:** still satisfied via the `@mulmoclaude/core/skill-bridge` subpath (server-only entry, collection import becomes a relative `../collection/paths`).
- **No Vue in core.** Collection *engine* only; Vue surfaces remain in collection-plugin.

## Migration order (incremental, each step shippable)

**Phase 1 — move the no-collection services (mechanical, low risk): ✅ DONE**
- `@mulmoclaude/core` created at `packages/core/` with subpath exports; two-pass vite build (ESM+CJS for the CJS-safe entries, ESM-only for `workspace-setup`); added to the tier-2 explicit enumeration in `build:packages` / `build:packages:dev`.
- file-change-publisher → `./file-change`, notifier → `./notifier`, scheduler → `./scheduler`, whisper → `./whisper`(+`/client`), workspace-setup → `./workspace-setup`(+`/slug`). Old `packages/services/*` dirs deleted.
- All host consumers (server/ + src/) + collection-watchers + the two extra root tests repointed; `packages/mulmoclaude` app deps collapsed 5→1 (`@mulmoclaude/core`); collection-watchers dep `notifier`→`core`.
- `server/tsconfig.json` excludes `../packages/core` (depth-1 glob would otherwise pull its `.ts`-extension imports into the server program).
- Verified GREEN: build, typecheck, lint, format, unit (host + core's 29), **E2E 439 passed**.

**Phase 1 (original outline):**
1. Create `@mulmoclaude/core` skeleton; add to `package.json` workspaces + the explicit tier-1/2 `concurrently` block in `build:packages` / `build:packages:dev`.
2. Move one at a time, each as a subpath, repoint host imports, delete old package:
   `file-change-publisher` → `./file-change`, `notifier` → `./notifier`,
   `workspace-setup` (+`/slug`), `whisper` (+`/client`), `scheduler`.
   (`collection-watchers → notifier` now resolves intra-core.)

**Phase 2 — free the collection engine: ✅ DONE**
- Moved collection-plugin's `src/core` (isomorphic) + `src/server` (node) + the `.` barrel into `@mulmoclaude/core/collection`, `@mulmoclaude/core/collection/server`, and a lean dependency-free `@mulmoclaude/core/collection/paths` entry (templatePath, for skill-bridge). Added `zod` to core deps and externalized it in core's vite pass-1.
- `@mulmoclaude/collection-plugin` shrank to **Vue-only** (`./vue` + `./style.css`); `main`/`types` repointed to the vue entry; it now depends on `@mulmoclaude/core` (externalized in its vite build) and its SFCs import the engine from `@mulmoclaude/core/collection`.
- Repointed every host consumer (server/ + src/ + root test/ ≈ 30 sites): `collection-plugin` → `core/collection`, `collection-plugin/server` → `core/collection/server`. `skill-bridge` → `core/collection/paths`; `collection-watchers` → `core/collection`(+`/server`). Dropped the `collection-plugin` dep from both (they now depend only on `@mulmoclaude/core`).
- `import/no-duplicates` from the collapsed barrel imports auto-fixed (one hand-repaired multiline merge in `CollectionView.vue`).
- Verified GREEN: build, typecheck, lint, format, unit tests, **E2E 439 passed**.

**Outcome — the uphill dependency is gone.** `skill-bridge` and `collection-watchers` (services, tier 4) now depend ONLY on `@mulmoclaude/core` (tier 2) — strictly downhill, no externalize-to-survive hack, no same-tier race. `collection-plugin` (plugins, tier 5) → `core` (tier 2), also downhill. The `isSafeActionTemplatePath` placement question is dissolved: it's `core/collection/paths`, imported downhill by both the schema validator and skill-bridge.

**Deviation from the original outline:** step 5 (folding `skill-bridge` / `collection-watchers` *into* core as subpaths) was NOT done — it's unnecessary for dissolving the uphill dependency (repointing to `core` already achieves strictly-downhill). They remain standalone `packages/services/*` packages. Folding them in is now a pure tidy-up, optional.

**Phase 2 (original outline):**
3. Move collection-plugin's `.` (isomorphic engine) + `./server` into `core/collection`, `core/collection/server`, `core/collection/paths`. Leave Vue in collection-plugin.
4. Repoint `collection-plugin` (Vue) → `@mulmoclaude/core/collection*`; repoint host `server/` imports.
5. Fold `skill-bridge` → `./skill-bridge` (collection dep becomes relative) and `collection-watchers` → `./collection-watchers` into core.

**Phase 3 — publish:**
6. Single `@mulmoclaude/core` version. Cascade-publish for both MulmoClaude and MulmoTerminal (memory: shared `@mulmoclaude/*` consumed by both → version skew = cross-app data bug).
7. **Drift gap:** `scripts/mulmoclaude/drift.mjs` only scans `@mulmoclaude/core`? No — it only scans `@mulmobridge/*`. Extend it to also cover `@mulmoclaude/core` (single package, easy) so the value-export drift check guards it.

## Cost / trade-offs
- Coarser versioning: any subsystem change bumps all of `core`. Acceptable — these always ship together and have exactly 2 consumers; one version is simpler to reason about than 7.
- Phase 2 is a real refactor (engine extraction). Phase 1 is mechanical and delivers 5/7 of the win immediately, so it can land first and independently.

## Out of scope (do NOT merge)
- The 25 `@mulmobridge/*` bridges.
- The 12 `@mulmoclaude/*-plugin` runtime plugins.
- `create-mulmoclaude-plugin` (scaffolding CLI), `@mulmobridge/relay` (Workers).
