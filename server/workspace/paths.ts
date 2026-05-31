// Single source of truth for workspace directory / file names and
// their absolute paths. The record below uses workspace-relative
// paths (possibly multi-segment, e.g. `config/roles`) as values; code
// looks up via `WORKSPACE_PATHS.<key>` to get the absolute form.
//
// Layout grouping (issue #284):
//
//   config/          settings + roles + helps
//   conversations/   chat + memory.md + summaries
//   data/            user-managed (wiki, todos, calendar, contacts,
//                    scheduler, sources, transports)
//   artifacts/       LLM-generated (charts, html, images, documents,
//                    spreadsheets, stories, news)
//
// Pre-#284 workspaces (with `chat/`, `summaries/`, `memory.md` at the
// root) continue to boot — the modern layout above is what new
// installs use, but the older directory names are still accepted.
//
// When adding a new top-level directory: add the name to the
// `WORKSPACE_DIRS` record below. The absolute path is derived
// automatically via `WORKSPACE_PATHS`.

import { homedir, tmpdir, userInfo } from "os";
import path from "path";

// Well-known individual files — imported from the shared
// src/config/workspacePaths.ts (single source of truth for both
// server and frontend). Re-exported so server callers keep the
// same `import { WORKSPACE_FILES } from "./paths.js"` they use.
import { WORKSPACE_FILES } from "../../src/config/workspacePaths.js";

// Plugin-owned workspace dirs are auto-aggregated from every
// plugin's META in `src/plugins/metas.ts`. Adding a new plugin =
// register its META there; this file keeps the central
// `WORKSPACE_DIRS.<key>` shape via spread so existing consumers
// don't migrate. Plugin-specific literals never appear here.
import {
  BUILT_IN_PLUGIN_METAS,
  defineHostAggregate,
  type BuiltInPluginMetas,
  type HostPluginCollision,
  type IntraPluginCollision,
} from "../../src/plugins/metas.js";

// Merge every plugin's `workspaceDirs` into one record. The mapped
// type below preserves each plugin's literal path strings (e.g.
// `"data/accounting"`) so consumers like `WORKSPACE_DIRS.accounting`
// keep their narrow types — without it, TypeScript widens to
// `string` and downstream `WORKSPACE_PATHS.accounting` lookups break.
//
// Distributive conditional types collapse the per-plugin union into
// an INTERSECTION so consumers see the merged shape rather than a
// union (which TS won't let you index into safely once 2+ plugins
// register).
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

// Plugins WITHOUT `workspaceDirs` must contribute an empty object
// (`Record<never, never>`), NOT `Record<string, never>`. The latter
// carries an index signature that, once intersected with a sibling
// plugin's narrow contribution, drags `keyof` of the merged type
// back to `string`. See server/workspace/workspace.ts: indexing
// `WORKSPACE_PATHS[key]` over `EAGER_WORKSPACE_DIRS` requires
// `WorkspaceDirKey` to stay a union of literals.
type PluginWorkspaceDirsContribution<M> = M extends { readonly workspaceDirs: infer D } ? { readonly [K in keyof D]: D[K] } : Record<never, never>;

type PluginWorkspaceDirsMap<T extends BuiltInPluginMetas> = UnionToIntersection<PluginWorkspaceDirsContribution<T[number]>>;

// Detect Node test runner or other typical test environments
export const isTestEnv =
  process.env.NODE_ENV === "test" ||
  process.execArgv.includes("--test") ||
  process.argv.some((arg) => arg.includes("test")) ||
  typeof process.env.NODE_TEST_CONTEXT !== "undefined";

// Detect if process.env.HOME has been overridden (a common pattern in workspace/IO integration tests to isolate runs)
const realUserHome = (() => {
  try {
    return userInfo().homedir;
  } catch {
    return homedir();
  }
})();
const isHomeOverridden = homedir() !== realUserHome;

// Workspace root. Configurable via environment variable or isolated
// inside a temporary directory under test environments (unless process.env.HOME
// is already overridden to isolate the test, in which case we preserve the overridden homedir).
export const workspacePath =
  process.env.MULMOCLAUDE_WORKSPACE_PATH || (isTestEnv && !isHomeOverridden ? path.join(tmpdir(), "mulmoclaude-test") : path.join(homedir(), "mulmoclaude"));

// Workspace-relative paths. Keys are the stable code-side identifiers
// (e.g. `markdowns` — unchanged for call-site compatibility); values
// are the on-disk paths, grouped per issue #284.
const HOST_WORKSPACE_DIRS = {
  // conversations/
  chat: "conversations/chat",
  // Typed memory entries (#1029). One markdown file per fact, indexed
  // by `MEMORY.md` (= WORKSPACE_FILES.memoryIndex). Replaces the
  // single-file `memory.md`; the legacy file is kept as
  // `memory.md.backup` after migration.
  memoryDir: "conversations/memory",
  // Staging dir for the atomic→topic migration (#1070 PR-A). Cluster
  // output lands here; the user reviews via `diff`, then `topic-swap`
  // promotes it to `memoryDir`. The dir name is also matched verbatim
  // by `topicStagingPath` and the swap-window detection in
  // `topic-detect.ts`, so changes here ripple through both places.
  memoryStaging: "conversations/memory.next",
  summaries: "conversations/summaries",
  // Tool-trace output for WebSearch (one .md per search, referenced
  // from chat JSONL `contentRef`). Lives alongside chat/ so search
  // trace and chat session share the same grouping.
  searches: "conversations/searches",
  // data/
  wiki: "data/wiki",
  // todos: removed (#1145) — todo data now lives under the plugin's
  // own `files.data` scope at `data/plugins/%40mulmoclaude%2Ftodo-plugin/`.
  calendar: "data/calendar",
  contacts: "data/contacts",
  clients: "data/clients",
  scheduler: "data/scheduler",
  sources: "data/sources",
  translation: "data/translation",
  // Pasted/dropped chat attachments — saved at upload time so the
  // LLM can be handed a stable workspace path instead of inline
  // base64. Conversion artefacts (e.g. PPTX → PDF) live alongside
  // the original under the same YYYY/MM partition.
  attachments: "data/attachments",
  // Sidecar JSON for photo EXIF capture (#1222 PR-A). Mirrors the
  // attachments YYYY/MM partition: `data/locations/<YYYY>/<MM>/<id>.json`.
  // Each file shape-compatible with `mapControl`'s addMarker args
  // (lat/lng numbers) so the LLM can hand a sidecar straight to the
  // Google Map plugin without reshape.
  locations: "data/locations",
  // Recipe markdown files driven by the `mc-cooking-coach` preset
  // skill (#1286). Replaces the runtime plugin's `files.data` scope
  // path (`data/plugins/<sanitised-pkg>/recipes/`) with a clean,
  // human-readable canonical path. A boot-time migration helper
  // (`server/workspace/cooking-recipes/migrate.ts`) moves any
  // existing files from the legacy plugin path on first boot after
  // the migration lands.
  cookingRecipes: "data/cooking/recipes",
  transports: "data/transports",
  // artifacts/
  charts: "artifacts/charts",
  // `markdowns` key preserved for call-site compatibility; on-disk
  // name is `documents` for clarity.
  markdowns: "artifacts/documents",
  // `htmls` = `presentHtml` plugin output (many files, persistent).
  // On-disk normalized to lowercase `html`.
  htmls: "artifacts/html",
  // Distinct from `htmls`: scratch buffer for the `/api/html`
  // generate-and-preview route. One file (`current.html`), always
  // overwritten. Kept separate so reloading a saved HTML artifact
  // doesn't clobber the current preview.
  html: "artifacts/html-scratch",
  // `svgs` = `presentSVG` plugin output (vector graphics).
  svgs: "artifacts/svg",
  images: "artifacts/images",
  spreadsheets: "artifacts/spreadsheets",
  stories: "artifacts/stories",
  news: "artifacts/news",
  // config/
  configs: "config",
  roles: "config/roles",
  helps: "config/helps",
  // Project-scope Claude Code skills root — both user-authored and
  // launcher-managed presets live here. Path is hardcoded by Claude
  // Code's slash-command resolver (it scans `<cwd>/.claude/skills/`
  // alongside `~/.claude/skills/`); we centralise the literal here
  // so server code references it through `WORKSPACE_PATHS.claudeSkills`
  // instead of inlining the string.
  claudeSkills: ".claude/skills",
  // Skill catalog root (#1335). Holds preset skills shipped with the
  // launcher (`catalog/preset/`) and — in later PRs — git-synced
  // Anthropic skills (`catalog/anthropic/`) and community URL-install
  // entries (`catalog/community/`). Entries here are catalog-only:
  // visible to UI / tooling but NOT discovered by Claude Code's
  // slash-command resolver. An entry becomes active by being copied
  // (or symlinked) into `.claude/skills/`. The catalog vs active
  // split keeps unused skills out of the system prompt.
  skillsCatalog: "data/skills/catalog",
  skillsCatalogPreset: "data/skills/catalog/preset",
  // Staging root for runtime-authored skills / collections. Claude
  // writes `data/skills/<slug>/{SKILL.md,schema.json,templates/*}` here
  // (an ungated data dir) and the skill-bridge hook mirrors the
  // allowlisted files into `claudeSkills`. This is the *canonical*
  // copy — the `.claude/skills/` entry is a mirror — so a
  // collection-delete archives from here and removes it last.
  skillsStaging: "data/skills",
  // Restorable backups written before a destructive delete. A
  // collection-delete drops `archive/<date>-<uuid>/` holding one skill
  // copy + the records + an LLM-readable RESTORE.md (see
  // docs/collections-architecture.md "Deleting a collection").
  archive: "archive",
  // Nested subdirs inside a top-level grouping. Kept here (rather
  // than module-local constants) when multiple modules need to
  // reference the same nested path — e.g. wiki/pages/ is used by
  // the wiki route, the wiki-backlinks driver, and the system
  // prompt hint.
  wikiPages: "data/wiki/pages",
  wikiSources: "data/wiki/sources",
  // Per-page edit-history snapshots (#763 PR 2). Hidden by leading
  // dot so a curious user listing `data/wiki/` doesn't trip over a
  // peer directory of historical content. Each `<slug>/` underneath
  // holds N snapshot .md files newest-first.
  wikiHistory: "data/wiki/.history",
  // Development — git-cloned repositories (#256).
  github: "github",
  // Runtime-loaded plugins (#1043 C-2). The `plugins/` directory holds
  // user-installed npm-published plugin tarballs; `.cache/<name>/<ver>/`
  // is the extracted-on-boot mirror. Both live under the workspace root
  // so the install / extract artefacts persist across npx invocations.
  plugins: "plugins",
  pluginCache: "plugins/.cache",
  // Per-runtime-plugin storage roots (#1110). The platform creates
  // `<root>/<sanitized-pkg-name>/` lazily on first write. data is the
  // backup target; config holds per-machine UI state / defaults.
  pluginsData: "data/plugins",
  pluginsConfig: "config/plugins",
  notifier: "data/notifier",
} as const;

// First-write-wins host+plugin aggregate (see `defineHostAggregate`):
// host keys win on collision, second-claiming plugin wins are
// dropped, both diagnostic lists are exposed for boot warnings.
const WORKSPACE_DIRS_AGGREGATE = defineHostAggregate(BUILT_IN_PLUGIN_METAS, {
  label: "WORKSPACE_DIRS",
  hostRecord: HOST_WORKSPACE_DIRS,
  // Reserve `WORKSPACE_FILES` keys too — those land in `WORKSPACE_PATHS`
  // alongside dir paths and would silently overwrite a plugin's
  // `workspaceDirs.<sameKey>` at the absolute-path step, leaving
  // `WORKSPACE_DIRS` and `WORKSPACE_PATHS` disagreeing for that key
  // (CR review #1125).
  additionalReservedKeys: new Set(Object.keys(WORKSPACE_FILES)),
  extract: (meta) => meta.workspaceDirs,
  dimension: "workspaceDirs",
});
export const WORKSPACE_DIRS_HOST_COLLISIONS: readonly HostPluginCollision[] = WORKSPACE_DIRS_AGGREGATE.hostCollisions;
export const WORKSPACE_DIRS_INTRA_COLLISIONS: readonly IntraPluginCollision[] = WORKSPACE_DIRS_AGGREGATE.intraCollisions;

export const WORKSPACE_DIRS = WORKSPACE_DIRS_AGGREGATE.merged as unknown as typeof HOST_WORKSPACE_DIRS & PluginWorkspaceDirsMap<BuiltInPluginMetas>;
export { WORKSPACE_FILES };

// Absolute paths, built once at module load from `workspacePath`.
// The `workspacePath` const is itself fixed (reads `homedir()`
// at process start — no env override, see `server/workspace.ts`),
// so freezing these paths is safe.
//
// Auto-derived from `WORKSPACE_DIRS` and `WORKSPACE_FILES`. Adding
// a new dir or file to the upstream maps now flows into
// `WORKSPACE_PATHS` automatically — no second hand-curated edit
// required (CodeRabbit #1125 review: previously plugins adding
// `workspaceDirs` keys still needed a manual `WORKSPACE_PATHS`
// patch-up to be reachable in absolute form).
const WORKSPACE_DIR_PATHS = Object.fromEntries(Object.entries(WORKSPACE_DIRS).map(([key, relativePath]) => [key, path.join(workspacePath, relativePath)])) as {
  readonly [K in keyof typeof WORKSPACE_DIRS]: string;
};

const WORKSPACE_FILE_PATHS = Object.fromEntries(
  Object.entries(WORKSPACE_FILES).map(([key, relativePath]) => [key, path.join(workspacePath, relativePath)]),
) as {
  readonly [K in keyof typeof WORKSPACE_FILES]: string;
};

export const WORKSPACE_PATHS = {
  ...WORKSPACE_DIR_PATHS,
  ...WORKSPACE_FILE_PATHS,
} as const;

export type WorkspaceDirKey = keyof typeof WORKSPACE_DIRS;
export type WorkspacePathKey = keyof typeof WORKSPACE_PATHS;

// Directories `initWorkspace()` creates eagerly on server start.
// Kept as a subset of `WORKSPACE_DIRS` so new entries are additive
// without touching `server/workspace.ts`. Everything *not* on this
// list is created lazily (first write) by its owning module.
export const EAGER_WORKSPACE_DIRS: readonly WorkspaceDirKey[] = [
  "chat",
  "calendar",
  "contacts",
  "clients",
  "scheduler",
  "roles",
  "stories",
  "images",
  "markdowns",
  "spreadsheets",
  "charts",
  "configs",
  "github",
];
