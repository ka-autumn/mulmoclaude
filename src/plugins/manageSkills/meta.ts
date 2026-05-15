import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "manageSkills",
  apiNamespace: "skills",
  apiRoutes: {
    /** GET /api/skills — list every available skill (user + project). */
    list: { method: "GET", path: "" },
    /** GET /api/skills/:name — read one skill's body + frontmatter. */
    detail: { method: "GET", path: "/:name" },
    /** POST /api/skills — create a new project-scope skill. The MCP
     *  bridge posts here. */
    create: { method: "POST", path: "" },
    /** PUT /api/skills/:name — overwrite an existing project-scope
     *  skill. */
    update: { method: "PUT", path: "/:name" },
    /** DELETE /api/skills/:name — delete a project-scope skill. */
    remove: { method: "DELETE", path: "/:name" },
    /** GET /api/skills/catalog — list catalog entries (preset for
     *  now; anthropic / community land in #1335 PR-C). Catalog
     *  entries are NOT in `.claude/skills/` and don't enter the
     *  Claude Code system prompt until the user ★ Stars them. */
    catalogList: { method: "GET", path: "/catalog" },
    /** POST /api/skills/catalog/star — body `{ source, slug }`.
     *  Copies the catalog entry into `.claude/skills/<slug>/` so
     *  Claude Code's slash-command resolver picks it up. */
    catalogStar: { method: "POST", path: "/catalog/star" },
    /** GET /api/skills/catalog/preview?source=&slug= — returns one
     *  catalog entry's description + body. Used by the 📖 Preview
     *  modal and the ▶ Run once action (which feeds `body` into a
     *  fresh chat as user input). For external source, pass `repoId`
     *  + `skillFolder` instead of `slug`. */
    catalogPreview: { method: "GET", path: "/catalog/preview" },
    /** GET /api/skills/external/suggestions — bundled list of repo
     *  URLs the launcher recommends as starting points (Anthropic
     *  skills + community picks). */
    externalSuggestions: { method: "GET", path: "/external/suggestions" },
    /** GET /api/skills/external/repos — list installed external
     *  repos with their recorded URL / subpath / SHA. */
    externalReposList: { method: "GET", path: "/external/repos" },
    /** POST /api/skills/external/repos — body `{ url, subpath?, ref? }`.
     *  Clone (or refresh) the repo, copy each discovered SKILL.md
     *  into the catalog under `<external>/<repoId>/`. */
    externalReposInstall: { method: "POST", path: "/external/repos" },
    /** DELETE /api/skills/external/repos/:repoId — remove the
     *  catalog dir + scratch clone for one external repo. Active
     *  copies under `.claude/skills/` are NOT touched (star = fork). */
    externalReposRemove: { method: "DELETE", path: "/external/repos/:repoId" },
  },
  mcpDispatch: "create",
});
