# Plan: let the agent author collection skills (carry `schema.json` across the `.claude/` gate)

## Problem

A **collection skill** is a skill dir that ships `schema.json` (+ optional
`templates/*.md`) next to `SKILL.md`. Discovery scans only
`~/.claude/skills/` and `<workspace>/.claude/skills/`
(`server/workspace/collections/discovery.ts:357-358`) — the `schema.json`
**must** land in `.claude/skills/<slug>/` for a collection to register.

The agent cannot put it there:

- **Direct `Write` to `.claude/skills/…` is gated.** Claude Code applies a
  self-modification permission prompt to `.claude/` that fires even with an
  explicit `Write(.claude/**)` allow rule; MulmoClaude's headless transport
  has no surface to answer it, so the write fails with "you haven't granted
  it yet." (Documented at `server/workspace/hooks/handlers/skillBridge.ts:7-15`.)
- **The skill-bridge only carries `SKILL.md`.** The sanctioned crossing
  (write to `data/skills/<slug>/SKILL.md`, hook mirrors it into
  `.claude/skills/<slug>/`) drops every sibling: `slugFromDataPath` returns
  `null` for any basename other than `SKILL.md`
  (`skillBridge.ts:104-115`, comment at `:99-103`). `schema.json` never crosses.
- **The `manageSkills` MCP tool writes host-side (gate-free) but only emits
  `SKILL.md`.** `saveProjectSkill` writes a single file via
  `writeFileAtomic(projectSkillPath(...))` (`server/workspace/skills/writer.ts:61-69`);
  its only content params are `name` / `description` / `body`
  (`src/plugins/manageSkills/definition.ts:34-46`). No `schema.json`, no
  templates, no multi-file write path.

So today a collection skill can only be created by the server's boot-time
preset sync (`syncPresetSkills`) — i.e. the bundled `mc-*` collections — never
by the agent at runtime.

### Role-availability constraint (affects the approach choice)

The `manageSkills` MCP tool is exposed to **only the `tutor` role**
(`src/config/roles.ts:211`). Per #1295 (`roles.ts:244-256`) the management
tools were de-bundled in favor of the `mc-manage-skills` *skill* (file-editing,
discoverable by every role). So:

- The **MCP-tool** path is gate-free but reaches one role.
- The **skill / bridge** path reaches every role but can't carry `schema.json`.

## Two candidate designs

### Design A — extend the `manageSkills` MCP tool (host-side writer)

Add a `schema` (and optional `templates`) parameter; the server writes
`schema.json` + `templates/*` alongside `SKILL.md` into
`.claude/skills/<slug>/`. Host-side fs ⇒ no permission gate.

- **Pros:** one transactional host call; can **validate the schema at write
  time** with `CollectionSchemaZ` and return a real error instead of the
  discovery-time silent skip; clear success/failure result.
- **Cons:** only `tutor` has the tool — needs `availablePlugins` wiring for
  every role that should author collections; runs against the #1295 direction
  (which moved away from bundled management MCP tools).

### Design B — extend the skill-bridge to mirror the whole skill dir

Teach the bridge to mirror `data/skills/<slug>/schema.json` and
`data/skills/<slug>/templates/*.md` (not just `SKILL.md`) into
`.claude/skills/<slug>/`. The agent writes the files to `data/skills/`
(gate-free — it's not `.claude/`) via its normal `Write` tool; the hook copies
them over.

- **Pros:** no role changes (every role already has `Write` to `data/`);
  aligned with the current "skills edit files directly" architecture; the
  `mc-manage-skills` skill already instructs the `data/skills/` + bridge flow.
- **Cons:** mirror is best-effort / silent-fail by design
  (`skillBridge.ts:179-188`) — a failed mirror leaves the staging copy with no
  in-chat error; no validate-on-write (bad schema is logged + skipped at
  discovery); multi-file mirror needs careful path/slug safety (templates
  subdir, deletes).

**Recommendation:** start with **Design B**. It reaches all roles with zero
role wiring, fits the post-#1295 file-editing model, and the existing
`mc-manage-skills` instructions already point at `data/skills/`. Layer
Design A's validate-on-write later only if silent discovery-skips prove
confusing in practice. (Decision is the first open question below — confirm
before I implement.)

---

## Why the bridge mirrors `SKILL.md` only today — and how to widen it safely

The "drop siblings" behaviour is deliberate, per the original commits
(PR #1298 `11fdf900`, fix `7aa7e6eb`). Three reasons, so the widening
respects them rather than steamrolls them:

1. **A skill was modelled as one file.** Siblings (`README.md`, `assets/`)
   were treated as the author's *scratch* material — "skill authors can keep
   extra material there until they decide what belongs in the shipped bundle"
   (`7aa7e6eb`). The bridge is a **publish boundary**: only the canonical file
   is promoted; drafts stay staging-side.
2. **The bridge is a deliberate hole in the `.claude/` self-modification
   gate.** `.claude/` is gated *because* it holds the agent's own
   skills/hooks/settings. The narrower the bypass, the safer — hence one known
   filename, two segments deep, strict `SLUG_RE`, no subtrees, and (on delete)
   no wildcards/bulk `rm`.
3. **It was a targeted fix and `schema.json` didn't exist as agent output
   yet.** Runtime collection authoring wasn't a use case; the `mc-*`
   collections are boot-synced server-side, never bridged.

The load-bearing assumption is #1 — and it's exactly what breaks for
collections: `schema.json` is **not scratch**, it's the required, defining
artifact (no schema → no collection). So the correct widening is **not**
"mirror the whole dir" (that would blow reason #2's narrow hole wide open —
the agent could auto-publish a `settings.json`, an executable, arbitrary
nested trees into its own config dir). Instead: **mirror a fixed allowlist of
filenames that are canonical for a collection**, keeping every existing guard.

**Allowlist to cross the gate (and nothing else):**

- `SKILL.md` — unchanged.
- `schema.json` — the collection definition.
- `templates/*.md` — only because schema `actions` reference them by path
  (`discovery.ts` action `template`); a single `templates/` segment, no deeper.

Any other basename / path shape stays staging-side, exactly as today.

---

## Design B — change surface

1. **`server/workspace/hooks/handlers/skillBridge.ts`**
   - Widen `slugFromDataPath` (`:104-115`) from "basename must be `SKILL.md`"
     to "basename/relpath is on the **allowlist**" — `SKILL.md`, `schema.json`,
     or `templates/<name>.md`. Return both the slug **and the relative
     destination path** so the mirror knows where to write (today it only
     returns the slug and hard-codes `SKILL.md`). Reject everything else, same
     as now.
   - Keep the strict `SLUG_RE` guard. For the `templates/` case, allow exactly
     one `templates/` segment + a safe `*.md` basename (reuse the safe-name
     rule from action `template` validation, `discovery.ts:114-117`); no `..`,
     no deeper nesting, no non-`.md`.
   - `mirrorWrite` (`:138-146`) already does atomic tmp+rename into the slug
     dir — parameterize it by the relative destination filename so it can write
     `schema.json` / `templates/x.md` as well as `SKILL.md`. `mkdirSync(destDir,
     {recursive:true})` already covers the `templates/` subdir.
   - **Delete is NOT a no-op anymore.** `rm -rf data/skills/<slug>` → mirror
     `rm -rf .claude/skills/<slug>` (`:148-150`) is still correct (whole-dir
     delete sweeps the new files too). But the `mc-manage-skills` *plain-skill*
     delete still works file-by-file in some flows — confirm the canonical
     delete is the whole-`<slug>/`-dir form so an orphaned `schema.json` can't
     survive a SKILL.md-only delete. (See item 2.)
   - Refresh ordering invariant (`:159-161`, `:170-173`) unchanged: mirror,
     then `POST /api/config/refresh` so discovery re-scans. Note `configRefresh`
     has its own `data/skills/*.md` matcher — verify it also fires for a
     `schema.json`-only write (a collection edit that doesn't touch SKILL.md
     must still trigger a re-scan), else widen it too.

2. **`server/workspace/skills-preset/mc-manage-skills/SKILL.md`**
   - Document the collection flow: to create a collection, write
     `data/skills/<slug>/SKILL.md` **and** `data/skills/<slug>/schema.json`
     (+ `templates/*.md` if it declares actions); the bridge mirrors all of
     them; the collection appears at `/collections/<slug>`.

3. **`server/workspace/helps/collection-skills.md`** (the doc that caused the
   original failure)
   - Replace every "write to `<workspace>/.claude/skills/<slug>/…`"
     instruction with "write to `data/skills/<slug>/…`; the host mirrors it
     into `.claude/skills/`." Fix the Anatomy diagram, the SKILL.md path, the
     schema.json path, and the End-to-end checklist.

4. **Tests** (`test/` mirrors source)
   - Unit: bridge matcher accepts `schema.json` + `templates/x.md`, rejects
     traversal (`../`, nested dirs, bad slug), still rejects unrelated
     basenames. Mirror copies content faithfully; delete removes the dir.
   - Integration (if a harness exists for the hook + discovery): write a full
     collection under `data/skills/` and assert it shows up via
     `discoverCollections()`.

## Design A — change surface (only if we pick A, or layer it on later)

1. `src/plugins/manageSkills/definition.ts` — add optional `schema`
   (string or object) and `templates` (`[{ path, content }]`) params.
2. `server/api/routes/skills.ts` — accept + validate on create/update; run
   `schema` through `CollectionSchemaZ` and 400 on failure.
3. `server/workspace/skills/writer.ts` — `saveProjectSkill` /
   `updateProjectSkill` write `schema.json` (+ templates) into the slug dir;
   `deleteProjectSkill` must remove siblings (today it `unlink`s SKILL.md then
   `rmdir`, which **fails** when siblings exist — `:159-163` — orphaning the
   dir).
4. `src/config/roles.ts` — add `TOOL_NAMES.manageSkills` to the
   `availablePlugins` of every role meant to author collections (decide which;
   `general` / `personal` at minimum). Note the CI guard at `roles.ts:460`.
5. Docs — same updates as B items 2-3, pointing at the tool instead of files.

## Out of scope

- Editing existing records (that's already Read/Write on `data/<name>/items/`).
- User-scope (`~/.claude/skills/`) collection authoring — project scope only,
  same boundary the writer already enforces.
- Schema migration of existing records when a schema changes (documented
  deferred item in `docs/collections-architecture.md`).
- **Removing the `manageSkills` plugin.** Its MCP write tool is now redundant
  (the agent authors via `data/skills/` + bridge), but the `/api/skills` route
  + Skills catalog UI on the same plugin are still live. Excision is deferred
  to its own PR — NOT part of this branch. Bridge work stands without it.

## Open questions

1. ~~**Design A vs B?**~~ **RESOLVED → Design B** (widen the bridge to a fixed
   allowlist; no role wiring, fits #1295).
2. If B: do we also want validate-on-write later, or is the discovery-time
   log-and-skip acceptable? (A bad schema currently fails silently from the
   user's view — only a server log.)
3. If A: which roles get `manageSkills`? (`general`, `personal`, … ?)
4. Should `mc-manage-skills` actively *teach* collection authoring, or just
   reference `collection-skills.md`? (Keeps one source of truth.)
