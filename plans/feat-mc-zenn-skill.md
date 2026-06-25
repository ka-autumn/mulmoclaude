# Plan: `mc-zenn` preset skill — share MulmoClaude work as Zenn articles

Add a bundled preset skill that turns work done in MulmoClaude into a
[Zenn](https://zenn.dev) tech article (markdown) inside the workspace. One skill
covers both jobs the user described: **set up a Zenn project once (idempotently)**
and **write articles from the session's work**, always tagging `MulmoClaude`.

Shape mirrors `mc-cooking-coach` (#1286): a markdown-only preset that drives
plain files via Read / Write / Edit + shell, no runtime plugin, no Vue View.

## Motivation

Users build things in MulmoClaude (research, artifacts, wiki pages, MulmoScript
stories) and want to share the process. Zenn is the low-friction target: GitHub
repo sync, markdown, free topic tags (so a `MulmoClaude` tag is one line). The
skill removes the setup tax — first use initializes a Zenn project in the
workspace; after that "Zenn にまとめて" just works.

## Files

| Path | Action |
|---|---|
| `packages/services/workspace-setup/assets/skills-preset/mc-zenn/SKILL.md` (NEW) | The preset skill. Three workflows: (1) idempotent setup, (2) write article, (3) publish. |
| `plans/feat-mc-zenn-skill.md` (NEW) | This file. |

No code, manifest, or test changes are required:

- Preset skills are discovered by **directory scan** of the assets dir
  (`syncPresetSkills` in `packages/services/workspace-setup/src/sync.ts`) — any
  `mc-*` subdir with a `SKILL.md` ships. There is no list to append to
  (`preset-list.ts` is for **plugins**, not skills).
- `github` is already a `WORKSPACE_DIRS` key (`server/workspace/paths.ts`), so
  the `github/zenn/` location needs no new path constant.

## Behavior

### Location
The Zenn project is a git repo at `github/zenn/` (cwd-relative). Articles live
at `github/zenn/articles/<slug>.md`. Idempotency marker: the project is "ready"
iff `github/zenn/articles/` exists.

### Idempotent setup (Workflow 1)
- If `github/zenn/articles/` exists → already set up, do nothing.
- Else offer two init paths (one `presentForm`):
  - **Clone** an existing Zenn GitHub repo: `git clone <url> github/zenn`.
  - **Fresh**: `npm init --yes && npm install zenn-cli && npx zenn init`
    (the standard zenn-cli flow), then `git init -b main`.
- Fresh repos need one manual step the skill can't automate: connecting the
  GitHub repo on zenn.dev (Deploy from GitHub). The skill tells the user.

### Write article (Workflow 2)
- Step 0 auto-runs setup if the project is missing, so the user can start from
  "write an article" without thinking about setup.
- Material = what the user points at, else the current session (chat transcript
  at `conversations/chat/<id>.jsonl` + produced artifacts/files).
- Slug: Zenn rules `^[a-z0-9_-]{12,50}$`; readable kebab from title keywords;
  collision-checked. Published slug == URL == immutable.
- Frontmatter house style (`title / emoji / type / topics / published`);
  **`topics` always includes `MulmoClaude`** (max 5). Defaults `type: tech`,
  `published: true`.
- Save + `npx zenn preview` instructions.

### Publish (Workflow 3)
- Only on explicit ask. Content repo → push to `main` (no feature-branch / PR).
- Stage files individually (never `git add .`), confirm before push.

## Out of scope

- No runtime plugin / Vue View (markdown-only, like `mc-cooking-coach`).
- The zenn.dev ↔ GitHub deploy connection is a browser step — documented, not
  automated.
- Package-manager: the fresh-init flow follows Zenn's official docs (`npm`);
  `npx zenn` works regardless of how zenn-cli is installed.

## Observation (for reviewer, not changed here)

`test/workspace/test_skills_preset.ts`'s "repository fixture" case anchors to the
retired `server/workspace/skills-preset/` path and is guarded by
`if (!existsSync(...)) return;`, so it is currently a **no-op** after the
move to `packages/services/workspace-setup/assets/skills-preset/`. Re-pointing it
at the new assets dir would make it actually validate the mc-* prefix rule again
— left out of this PR to keep scope tight; flagged so it can be a follow-up.
