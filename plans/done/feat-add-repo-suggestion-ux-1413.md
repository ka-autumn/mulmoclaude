# Add-repo modal — suggestion UX polish (#1413)

Follow-up to #1392 (C2). Frontend-only; no server change.

## Current

`skill-add-repo-suggestion-{url}` button → `installRepo(url, subpath)`
immediately. Description is one-line `truncate`. No way to inspect the
repo first.

## Target behaviour

A suggestion row becomes **select-only**:

1. **Click fills the form** — `selectSuggestion(s)` sets
   `addRepoUrl = s.url`, `addRepoSubpath = s.subpath ?? ""`,
   `selectedSuggestionUrl = s.url`. Does NOT install. Install stays
   driven solely by the existing Install button / Enter-in-URL.
2. **Repo link** — an `<a :href="s.url" target="_blank"
   rel="noopener noreferrer" @click.stop>` with an open-in-new icon
   so the user can review the repo on GitHub before installing.
   `@click.stop` so the link doesn't also trigger row-select.
3. **Expandable description** — when `selectedSuggestionUrl === s.url`
   the description renders full (no `truncate`, `whitespace-normal`);
   otherwise truncated. Selecting also highlights the row
   (`aria-pressed`).

## Changes (`src/plugins/manageSkills/View.vue`)

- State: `selectedSuggestionUrl = ref<string | null>(null)`; reset in
  `openAddRepo()` and the `selectedResult` watcher.
- `selectSuggestion(s: ExternalSuggestion)`: fill form + set selected.
- Template: suggestion row stays a `<button type="button">` (action =
  "fill form"), `:aria-pressed`, description class toggles
  `truncate` ↔ `whitespace-normal break-words`; add the `<a>` repo
  link with `@click.stop`, `data-testid="skill-add-repo-suggestion-link-{url}"`.
  Drop the `@click="installRepo(...)"` + `:disabled="addRepoBusy"`.

## i18n (all 8 locales, lockstep)

`pluginManageSkills.catalogRepoOpenLink` — accessible name/title for
the GitHub link (e.g. "Open repository on GitHub (new tab)").

## Docs

`docs/ui-cheatsheet.md`: tweak the add-repo modal note + add
`skill-add-repo-suggestion-link-{url}` testid.

## Tests

`e2e/tests/skills.spec.ts` — update the existing
"add-repo modal installs from a suggestion" test: clicking a
suggestion now fills `skill-add-repo-url` (assert value), then
clicking `skill-add-repo-submit` fires the install POST. Add an
assertion that `skill-add-repo-suggestion-link-{url}` has the right
`href` + `target="_blank"` + `rel` including `noopener`.

## Acceptance

- Clicking a suggestion never installs; it fills URL+subpath and
  expands its description.
- The repo link opens GitHub in a new tab and does not select/install.
- Install only via the Install button / Enter in the URL field.
- 8 locales + cheatsheet updated; e2e + full suite green;
  format/lint/typecheck/build clean.
