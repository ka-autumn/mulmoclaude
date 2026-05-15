# Catalog Preview + Run once — PR-B2 of #1335

## Goal

Round out the catalog UI shipped in PR-B (#1372) with the two remaining per-entry actions from the issue:

- **📖 Preview** — show the SKILL.md description + body in a modal without touching the active layer or system prompt
- **▶ Run once** — open a fresh chat with the SKILL.md body injected as the first user message; no star, no system-prompt entry, just one turn

After this, all three catalog actions (★ Star / ▶ Run once / 📖 Preview) are wired and #1335's "browse → try → keep" flow is complete for preset entries. Anthropic / community catalog sources still wait for PR-C.

## Approach

### Backend

1. **`server/workspace/skills/catalog.ts`** — new exports:
   - `CatalogEntryDetail` shape: `{ slug, source, description, body }`. No `alreadyActive` — Preview and Run once don't care about the active layer.
   - `readCatalogEntryDetail(source, slug, opts?)` — reads the SKILL.md, returns parsed description + body. Same `safeSlugName` taint-launder used by `starCatalogEntry`, so CodeQL stays clear.
   - `CatalogDetailResult` discriminated union: `ok` / `not-found` / `invalid-slug` (same pattern as `StarResult`).

2. **`server/api/routes/skills.ts`** — new endpoint:
   - `GET /api/skills/catalog/preview?source=&slug=` → `{ detail: CatalogEntryDetail }` or 400 / 404.

3. **`src/plugins/manageSkills/meta.ts`** — declare `catalogPreview` route.

### UI

4. **`src/plugins/manageSkills/View.vue`**:
   - Per-row action buttons change from a single `[★ Star]` text button to a row of three icon buttons (`visibility` / `play_arrow` / `star_border|star`). Icons + tooltips fit the narrow w-64 left column.
   - **Preview**: opens an inline modal (`fixed inset-0`, dark backdrop, click-outside or ✕ to dismiss). Renders the body as sanitized markdown via the existing `sanitizeMarkdownHtml` + `marked` chain (same trust chain the active skill detail uses).
   - **Run once**: fetches the detail, then `useAppApi().startNewChat(body)` to open a fresh chat with the body as the first user message. Works in both standalone Settings mode and chat-mounted mode because `useAppApi` is a global composable.
   - Star button switches from text to a single material-icons star; `star` (filled) for already-starred (disabled, yellow), `star_border` (outline) for not-yet (clickable).
   - Single `catalogActioningSlug` ref disables all three buttons on the same row during any in-flight request to prevent double-clicks.

5. **i18n** — 5 new keys × 8 locales:
   - `catalogPreview` (tooltip), `catalogPreviewLabel` (modal header label), `catalogRunOnce` (tooltip), `errCatalogPreviewFailed`, `errCatalogRunOnceEmpty`.
   - Existing `catalogStar` / `catalogStarred` lose their `☆` / `★` prefixes since they now sit alongside the icon buttons.

### Tests

6. **`test/workspace/skills/test_catalog.ts`** — 5 new `readCatalogEntryDetail` cases (happy path, not-found, malformed SKILL.md, path-traversal, no `alreadyActive` field on the detail shape). Existing 16 catalog tests untouched.

## What this does NOT do

- **Hierarchical sub-sections** (Anthropic / Community as siblings of Preset): the layout is still a single flat group. Sub-sections land with PR-C when there are actually anthropic + community entries to show.
- **Slug-collision namespacing**: still relies on `mc-*` prefix to keep preset namespace clean; PR-C handles the anthropic case.
- **`stars.json` registry**: still not introduced — presence in `.claude/skills/` is the active-state signal.
- **Keyboard shortcuts** (Esc to close modal): not wired in this PR; can add via the existing modal-closing patterns if it comes up.

## Acceptance

- Each catalog entry row shows 3 icon buttons.
- Clicking 👁 Preview opens a modal with the description + rendered markdown body. Clicking outside or ✕ closes it.
- Clicking ▶ Run once routes the user to /chat with the body as the first user message (the agent starts processing immediately).
- Clicking ★ Star still works (PR-B behaviour preserved).
- 16 existing catalog tests pass; 5 new `readCatalogEntryDetail` tests pass.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
