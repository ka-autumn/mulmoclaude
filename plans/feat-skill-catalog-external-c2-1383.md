# C2 — hierarchical external-skill catalog UI (#1383 / #1335 PR-C)

Sub-PR **C2** of #1383. C1 (backend, #1386) is merged. #1301 (collapsible
`/skills` sidebar sections) is merged — C2 extends that pattern.

## Goal

Surface installed external skill repos in the `/skills` page: a
collapsible per-repo subgroup under the existing **Catalog** section,
plus install (URL + seed suggestions) and uninstall. External entries
get the same right-pane (preview / ★ star / ▶ run once) as presets.

Backend already exists (C1): `GET/POST /api/skills/external/repos`,
`DELETE /api/skills/external/repos/:repoId`,
`GET /api/skills/external/suggestions`, and `GET /api/skills/catalog`
already returns external entries inline (`source:"external"` +
`repoId` / `skillFolder` / `repoUrl`). C2 is **frontend-only** plus
i18n + e2e — no server changes.

## UX

Left column, inside the existing **Catalog** collapsible section
(`View.vue:77`), after the Preset sub-list:

```text
▾ CATALOG                                   (count)
    PRESET
      mc-…  rows (unchanged)
    ▾ anthropics/skills            [⤫ uninstall] (17)
      anthropics-algorithmic-art   ★? [preset-style row]
      …
    ▸ foo/cool-skill                          (1)
    [ + Add skill repository ]
```

- Each installed repo = its own collapsible subgroup (chevron + repo
  display name + entry count + uninstall icon-button). Collapse state
  per repo persisted to `localStorage` (`skills:repoCollapsed`, a Set
  of repoId) — independent of the section-level
  `skills:sectionCollapsed` from #1301.
- Row click → right pane (reuse the `selectedCatalog` path; external
  entries carry `repoId`/`skillFolder`).
- "+ Add skill repository" → modal: URL field (+ optional subpath) and
  the seed-suggestion list from `/external/suggestions` as one-click
  installs. Errors (invalid-url / invalid-subpath / id-collision /
  no-skills) surface inline in the modal.
- Uninstall → confirm, `DELETE`, refresh. Starred copies survive
  (backend-guaranteed in C1) — note this in the confirm copy.

## Frontend changes (`src/plugins/manageSkills/`)

- `View.vue`
  - `CatalogSource` → `"preset" | "external"`; `CatalogEntry` /
    `CatalogDetail` gain optional `repoId` / `skillFolder` / `repoUrl`.
  - `loadCatalog`: keep `catalogPresets` (filter `preset`); add
    `catalogRepos` (from `/external/repos`) and group `external`
    entries by `repoId` into a `Map<repoId, CatalogEntry[]>`.
  - New state: `catalogRepos`, `repoCollapsed` (shallowRef Set),
    `addRepoOpen`, `addRepoUrl`, `addRepoSubpath`, `addRepoError`,
    `addRepoBusy`, `suggestions`, `uninstallingRepoId`.
  - Generalise the action gate: `catalogActioningKey` =
    `slug` (preset) or `${repoId}/${skillFolder}` (external).
    `star/preview/runOnce` send `{source:"preset",slug}` or
    `{source:"external",repoId,skillFolder}`.
  - Handlers: `loadExternalRepos`, `loadSuggestions`,
    `installRepo(url,subpath?)`, `uninstallRepo(repoId)`,
    `toggleRepo(repoId)`.
- `categories.ts`: add `loadRepoCollapsed` / `persistRepoCollapsed` /
  `REPO_COLLAPSED_STORAGE_KEY` (mirrors the section helpers; pure,
  unit-tested). repoId set is open-ended so no key-union type guard —
  validate as `string[]`.

## i18n (all 8 locales, lockstep)

New keys under `pluginManageSkills.*`: `catalogAddRepo`,
`catalogAddRepoTitle`, `catalogRepoUrlLabel`,
`catalogRepoUrlPlaceholder`, `catalogRepoSubpathLabel`,
`catalogRepoSubpathPlaceholder`, `catalogAddRepoSubmit`,
`catalogAddRepoSuggestions`, `catalogUninstallRepo`,
`catalogUninstallConfirm`, `catalogRepoInstalling`,
`errCatalogRepoListFailed`, `errCatalogRepoInstallFailed`,
`errCatalogRepoUninstallFailed`, `errCatalogRepoInvalidUrl`,
`errCatalogRepoCollision`, `errCatalogRepoNoSkills`. English first
(schema source), then ja/zh/ko/es/pt-BR/fr/de translated; placeholders
verbatim; product names stay English.

## Docs

`docs/ui-cheatsheet.md`: update the `/skills` block to show the
per-repo hierarchy + add-repo affordance + new `data-testid`s.

## Tests

`e2e/tests/skills.spec.ts` (+ `e2e/fixtures` mocks): stub the four
`/api/skills/external/*` endpoints and an extended `/catalog`.
Assert: repos render as collapsible subgroups; expand/collapse
persists; external row → right pane; star external (body
`{source:"external",repoId,skillFolder}`); add-repo modal install
(URL + suggestion); uninstall confirm + row removal.
`test/plugins/manageSkills/test_categories.ts`: add cases for the new
repo-collapse helpers.

## Out of scope (→ C3)

Update button, scheduler/SHA-pin, update notifications. No server
changes in C2.

## Acceptance

- `/skills` shows installed external repos as collapsible per-repo
  subgroups under Catalog; preset list unchanged.
- Add via URL and via a seed suggestion both work; backend error kinds
  surface inline.
- External preview / star / run-once work via the existing right pane.
- Uninstall removes the subgroup; previously-starred skills remain in
  the Active section.
- All 8 locales updated; cheatsheet updated; e2e + unit green;
  `format`/`lint`/`typecheck`/`build`/`test` clean.
