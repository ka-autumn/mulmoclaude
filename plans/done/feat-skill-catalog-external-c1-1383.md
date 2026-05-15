# Skill catalog external repos — C1 backend (#1383)

## Goal

Backend foundation for installing arbitrary GitHub skill repositories into the catalog. After this PR:

- `POST /api/skills/external/repos { url, subpath? }` clones a repo, scans for `SKILL.md` files, populates `data/skills/catalog/external/<repoId>/`.
- `GET /api/skills/catalog` returns preset entries + external repos with their skills, grouped.
- `GET /api/skills/external/suggestions` returns the bundled list (Anthropic's `skills` repo seed).
- `DELETE /api/skills/external/repos/:repoId` removes the catalog dir + scratch clone.
- Star on an external skill copies its dir into `.claude/skills/<activeId>/` using the existing PR-B flow, with a flat `<owner>-<skillFolder>` active id.
- 100% testable from curl. No UI changes (those land in C2 once #1301 merges).

## Approach

### 1. Storage

```text
~/mulmoclaude/data/skills/catalog/
├── preset/                           (PR-A, unchanged)
└── external/                         (NEW)
    └── <repoId>/                     anthropics-skills, foo-cool-skill, ...
        ├── .source.json              { url, ref, subpath?, sha, installedAt }
        ├── <skillFolder>/SKILL.md    discovered skills (anthropic case)
        └── SKILL.md                  (single-skill-at-root case)

~/.cache/mulmoclaude/sources/<urlHash>/.git/  scratch clone, workspace-external
```

Cache lives outside workspace to keep `.git/` out of the workspace's own git history.

### 2. ID rules

| | Rule | Examples |
|---|---|---|
| **repoId** (catalog dir name) | `<owner>-<repo>`, sanitised | `anthropics-skills`, `foo-cool-skill` |
| **skillFolder** (inside repoId) | repo's own folder name | `pdf-form-filler`, or none if SKILL.md at root |
| **activeId** (`.claude/skills/<id>/`) | `<owner>-<skillFolder>`, flat | `anthropics-pdf-form-filler` |
| **single-skill at repo root** | activeId = repoId | `foo-cool-skill` |

Conflicts: when two installs derive the same `repoId` or the same `activeId`, return a 409. v1 surfaces the conflict; no auto-suffix yet.

### 3. Discovery

After clone + sparse-checkout, scan to find SKILL.md files:

- If `subpath` given: glob `<repo>/<subpath>/*/SKILL.md` (one level under subpath)
- Else: try `<repo>/SKILL.md` first (single-skill); if missing, glob `<repo>/*/SKILL.md` one level deep.

Skills that fail frontmatter parsing are skipped with a `log.warn`.

### 4. Git clone helper

`server/workspace/skills/external/clone.ts`:

- `--depth=1` shallow
- `--sparse` + sparse-checkout pattern when `subpath` is provided
- Cache dir keyed by sha256(url) so the same repo isn't re-cloned for sibling installs

```ts
async function cloneOrUpdate(url: string, subpath?: string, ref?: string): Promise<{ cacheDir: string; sha: string }>
```

### 5. API endpoints

Existing `manageSkills/meta.ts` extended:

```ts
externalSuggestions: { method: "GET",    path: "/external/suggestions" },
externalReposList:   { method: "GET",    path: "/external/repos" },     // (used internally by catalog list)
externalRepoInstall: { method: "POST",   path: "/external/repos" },     // body: { url, subpath?, ref? }
externalRepoRemove:  { method: "DELETE", path: "/external/repos/:repoId" },
```

`GET /api/skills/catalog` response shape extended:

```ts
{
  entries: CatalogEntry[];       // preset entries (unchanged shape)
  repos: ExternalRepo[];          // new — installed external repos
}

interface ExternalRepo {
  repoId: string;
  url: string;
  ref?: string;
  subpath?: string;
  displayName: string;            // owner/repo or url tail; UI may override
  sha: string;
  installedAt: string;
  entries: CatalogEntry[];        // skills inside this repo, source: "external"
}
```

`CatalogEntry` gains an optional `source: "preset" | "external"` discriminator and an optional `repoId` (set for external entries) so the Star endpoint can resolve the copy source.

### 6. Star extension

`POST /api/skills/catalog/star` body becomes:

```ts
{ source: "preset",   slug: string }                              // unchanged
{ source: "external", repoId: string, skillFolder: string | "." }  // new (skillFolder "." = repo root)
```

`starCatalogEntry()` branches by source. The active id is derived from the catalog's `.source.json` URL (owner) + skillFolder. Path-traversal launder (`safeSlugName`) applied to repoId, skillFolder, and the derived activeId.

### 7. Anthropic preset bundle

`server/workspace/skills/external/presets.ts`:

```ts
export const EXTERNAL_PRESETS: ExternalPresetSuggestion[] = [
  {
    url: "https://github.com/anthropics/skills",
    subpath: "skills",
    displayName: "Anthropic skills",
    description: "Anthropic's official skill collection",
    license: "MIT",
  },
];
```

Bundled, not written into the workspace. `GET /external/suggestions` returns this list as-is for v1.

### 8. Out of scope (deferred)

- gitlab / non-GitHub URLs (v1 GitHub HTTPS only)
- private-repo auth (ssh / token)
- multiple subpath per install
- Update endpoint (`POST .../update`) — C3
- scheduler-driven background pull — C3
- SHA-pinned starred copies — C3
- UI changes — C2
- hierarchical sidebar layout — C2 (waits on #1301)

## Files

| Path | Purpose |
|---|---|
| `server/workspace/skills/external/id.ts` | repo id / active id derivation, slug whitelist |
| `server/workspace/skills/external/clone.ts` | git sparse-checkout helper, cache dir mgmt |
| `server/workspace/skills/external/install.ts` | install/uninstall + per-repo `.source.json` r/w |
| `server/workspace/skills/external/presets.ts` | bundled Anthropic suggestion(s) |
| `server/workspace/skills/catalog.ts` | extend to include external repos in listing + Star |
| `server/api/routes/skills.ts` | new endpoints |
| `src/plugins/manageSkills/meta.ts` | declare new routes |
| `test/workspace/skills/external/test_id.ts` | id derivation cases |
| `test/workspace/skills/external/test_install.ts` | install/uninstall with stubbed clone |

## Acceptance

- `curl -X POST /api/skills/external/repos -d '{"url":"https://github.com/anthropics/skills","subpath":"skills"}'` clones + populates `data/skills/catalog/external/anthropics-skills/<skill>/SKILL.md` for every discovered skill.
- `curl /api/skills/catalog` returns the existing preset entries plus the new `repos` array.
- `curl -X POST /api/skills/catalog/star -d '{"source":"external","repoId":"anthropics-skills","skillFolder":"pdf-form-filler"}'` copies into `.claude/skills/anthropics-pdf-form-filler/`. Claude Code's slash-command resolver picks it up on the next agent run.
- `curl -X DELETE /api/skills/external/repos/anthropics-skills` removes the catalog dir + scratch clone; active copies (already starred) are NOT touched (Star = fork).
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
- All new code paths covered by unit tests against tmpdirs + a stubbed git binary (or `process.execFile` mock) where appropriate.

## Test strategy

- **`id.ts`**: pure functions, deterministic table tests.
- **`clone.ts`**: most invocations are stubbed. One smoke test may shell out to a real `git --version` to confirm the binary exists; we DO NOT hit the network from CI.
- **`install.ts`**: dependency-injected clone helper so tests can supply a fake that just `mkdir -p` + `writeFile` the expected files. Validates discovery + .source.json shape + uninstall cleanup.
- **`catalog.ts`**: extend existing tests (which already operate on tmpdirs) to cover the external case.
- **`skills.ts` route**: existing pattern of unit-testing the helpers; no supertest.

## Risks / open questions

- **`git` binary on PATH**: the workspace init already shells out to `git init` (`server/workspace/workspace.ts`), so this is a pre-existing assumption. Document it in the route's error path.
- **Network access in Docker sandbox**: install runs on the host server (which already does git ops for the workspace itself), so this isn't bound by the sandbox restrictions documented in `docs/mcp-sandbox.md`.
- **Concurrent install of the same URL**: file-lock the cache dir to avoid clobbering. v1: simple `existsSync(cacheDir/.installing)` flag + error if set.
