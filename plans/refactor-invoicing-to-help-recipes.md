# Migrate the invoicing suite from preset skills to help-file recipes

**Status:** planning · **Owner:** snakajima · **Created:** 2026-06-04

## Rationale

The invoicing suite ships today as four bundled preset skills under
`server/workspace/skills-preset/`: `mc-clients`, `mc-worklog`, `mc-invoice`,
`mc-profile`. Each is a schema-driven collection (`SKILL.md` + `schema.json`,
plus four action templates for `mc-invoice`). They are synced into
`data/skills/catalog/preset/` on every boot and must be **starred** in the
skill manager to become active — `syncActivePresetSkills` never auto-stars them.

Two problems:

1. **Discoverability.** The skill manager / catalog is hard to find and the
   catalog↔active "star" gesture is non-obvious, so most users never light up
   the suite even when they'd want it. It's clutter for everyone who doesn't.
2. **Maintenance + correctness coupling.** Four preset dirs are overwritten on
   every boot; any change is host-side and ships to all users unconditionally.

The **todo list already demonstrates the better model**: there is no preset
`todos` skill. `config/helps/todo-collection.md` is a recipe with copy-paste
`schema.json` + `SKILL.md` blocks, and a **sample query** ("make me a todo
list") triggers Claude to scaffold it on demand into `data/skills/todos/`. The
bridge mirrors it and `/collections/todos` renders — the skill manager is never
involved.

**Decision:** move the invoicing suite to the same recipe model. The collections
engine is fully generic — verified that **no host code depends on the `mc-*`
slugs** (every `mc-clients`/`mc-invoice`/`mc-profile`/`mc-worklog` hit outside
`skills-preset/` is a comment, a doc example, a help cross-ref, or a link-router
test fixture). So the suite is pure data + prompt and can live entirely in
recipes.

## Shape: two bundles, two sample queries

Per the dependency graph (verified against the four `schema.json` files):

| Collection | Outbound references |
|---|---|
| `clients` | none (foundation) |
| `worklog` | `clientId` → `clients` (required) |
| `profile` | none (singleton foundation, `singleton: "me"`) |
| `invoice` | `clientId` → `clients` (required); `embed` `profile/me`; soft-reads `worklog` for the "invoice my hours" flow; 4 actions in the `accounting` role |

Bundles:

- **Bundle A — `clients` + `worklog`** → fully self-contained (`worklog → clients`
  is internal). No external deps.
- **Bundle B — `invoice` + `profile`** → `invoice → profile` embed is internal,
  but `invoice → clients` (required ref) and the worklog data-pull point **into
  Bundle A**.

Install matrix:

- **A alone** → fully works (contact book + timesheet). ✓
- **A then B** → clean. ✓
- **B then A** → fine: refs resolve lazily at render, so invoice's `clientId`
  links light up once A is installed. Same end state regardless of order. ✓
- **B alone** → invoice works but is **degraded**: empty client picker (no
  `clients` collection to populate it), worklog data-pull unavailable so it
  falls back to manual line items.

**Mitigation for B-alone:** Bundle B's recipe is **dependency-aware** — when
scaffolding `invoice` it checks whether a `clients` collection exists and, if
not, prompts the user "Invoicing links to a Clients collection — add the Clients
& Worklog bundle too?". The `invoice` SKILL already degrades gracefully on
missing worklog ("if no matching entries, ask for line items") — no change there.

### Slug contract (both files must agree)

De-`mc-` the slugs to `clients` / `worklog` / `invoice` / `profile`. Bundle B's
`ref to: "clients"` and `embed to: "profile"` MUST match what Bundle A (and B)
create. Bake the exact slugs into both recipe files. `dataPath` values are
**already** prefix-free in the presets (`data/clients/items`, `data/invoice/items`,
…), so de-slugging changes only the collection URL and the ref/embed targets —
**no record data moves.**

### Verbatim-schema rule

Each recipe carries its collections' **known-good `schema.json` + `SKILL.md`**
(and invoice's four action template bodies) as literal copy blocks — NOT "design
an invoicing app from the DSL." Financial correctness is preserved; we're only
changing the delivery vehicle. Diff from the current presets: `to:` targets
de-`mc-`'d, and the SKILL/description cross-references updated to the new slugs.

## Files

### New (sources live in repo; helps are dir-copied via `readdirSync`, no manifest — drop the file and it ships)

- `server/workspace/helps/billing-clients-worklog.md` — Bundle A recipe:
  verbatim `clients` + `worklog` schema/SKILL blocks, slug contract, dependency-
  order note (clients before worklog), de-`mc-`'d `worklog.clientId → clients`.
- `server/workspace/helps/billing-invoice.md` — Bundle B recipe: verbatim
  `invoice` + `profile` schema/SKILL blocks + the four action templates
  (`invoice.md`, `journal-sale.md`, `journal-payment.md`, `journal-void.md`),
  de-`mc-`'d `clientId → clients` / `embed → profile`, and the dependency-aware
  "add the clients bundle too?" prompt instruction.

### Delete (preset dirs)

- `server/workspace/skills-preset/mc-clients/` (SKILL.md + schema.json)
- `server/workspace/skills-preset/mc-worklog/` (SKILL.md + schema.json)
- `server/workspace/skills-preset/mc-invoice/` (SKILL.md + schema.json + templates/{invoice,journal-sale,journal-payment,journal-void}.md)
- `server/workspace/skills-preset/mc-profile/` (SKILL.md + schema.json)

### Edit — discoverability

- `src/config/roles.ts` — add two `queries` entries so the bundles are
  discoverable from a sample prompt. Home: the **`personal`** role (it already
  hosts every "Create a … collection" sample prompt and exposes
  `presentCollection`). **Recommended order: A then B** (B's `invoice` has a
  required `clientId → clients` ref and soft-reads `worklog`, both in A — install
  A first and invoicing works frictionlessly; B-then-A still converges via lazy
  ref resolution, A-alone is fully functional). List the A query first.

  **CRITICAL — the query must point at the recipe.** A bare query like "Set up
  invoicing for my business" does NOT work: nothing connects it to the recipe, so
  the agent never reads `config/helps/billing-*.md` and instead free-styles a
  custom schema (mimicking other collections, calling `presentForm` to ask design
  questions). The established codebase pattern (wiki / presentation / spreadsheet
  / the generic collection-create query in `en.ts`) is to **embed the read-this
  instruction in the prompt text**. So the shipped strings are:
  - "Set up client and time tracking for my consulting work. First read
    `config/helps/billing-clients-worklog.md` and follow it exactly to author the
    clients and worklog collections — do not redesign the schemas or ask me design
    questions."  *(Bundle A — list first)*
  - "Set up invoicing for my business. First read `config/helps/billing-invoice.md`
    and follow it exactly to author the invoice and profile collections — do not
    redesign the schemas or ask me design questions."  *(Bundle B)*

  The backticked help path survives runtime query translation verbatim (same as
  the existing `en.ts` collection-create query). **Belt-and-suspenders:** each
  recipe also opens with a "Follow this recipe verbatim — do NOT redesign / no
  `presentForm` / don't mimic other collections" callout, so the agent stays on
  rails even when reached by a free-form request rather than the sample button.

### Edit — repoint help/doc cross-refs that currently point at the deleted presets

- `server/workspace/helps/collection-skills.md`:
  - l.46-47 — "reserved for the bundled presets (`mc-clients` …)" — reword now
    that they're recipe-authored, not boot-overwritten presets.
  - l.128, l.135 — `ref`/`embed` examples use `mc-clients` / `mc-profile`;
    update to `clients` / `profile` for consistency.
  - l.587-600 "Worked reference: the billing suite" — currently says "read their
    `schema.json` when in doubt" pointing at the deleted preset dirs. Repoint to
    the two recipe files (the schemas now live there).
- `server/workspace/helps/index.md` — add links to the two new recipes (mirror
  how `todo-collection.md` is linked).

### Verify during implementation (blast-radius unknowns)

- **Stale catalog prune.** `syncPresetSkills` does `rmSync` + full copy *per
  source dir*. Once the four source dirs are deleted, confirm whether stale
  `data/skills/catalog/preset/mc-*` dirs from prior boots are pruned or linger.
  If they linger, add a prune step (or document that they're inert).
  (`server/workspace/skills-preset.ts` ~l.157-236.)
- **Tests referencing the presets.** Grep `test/`, `e2e/`, `e2e-live/` for
  `mc-clients`/`mc-invoice`/`mc-profile`/`mc-worklog` and any preset-count
  assertions in skills-preset / collections discovery tests; update counts and
  fixtures.

## Existing users (decision: remove legacy skills on launch, preserve data)

> **Decision revised** (was "option 1 — notify-only"). The notify-only approach
> left the starred `mc-*` collections in the dashboard, which the user found
> confusing. New decision: the host **removes** the legacy skill dirs on launch,
> leaving all records in place.

Users who already starred the `mc-*` presets have live data at
`data/{clients,worklog,invoice,profile}/items`. On launch
(`migrateLegacyBillingPresets`, `server/workspace/billing-migration.ts`, wired in
`server/index.ts` after `announceOptionalDeps`):

- Any `mc-{clients,worklog,invoice,profile}` dir present in `.claude/skills/` is
  **deleted** (`rmSync`). Only the **skill directory** is removed — the records
  under `data/*/items` are left completely untouched.
- A **one-time bell** fires when at least one was removed, explaining the change
  and pointing at the two sample queries. (i18n `billingMigration.{title,body}`,
  8 locales.)

**Idempotency is structural — no marker file.** Once the dirs are gone the boot
check finds nothing and is a no-op; the bell only fires on the boot that actually
removes something. The preset sources are deleted and their catalog entries are
pruned by `removeRetiredPresets`, so a legacy `mc-*` billing skill can never
reappear through the normal star flow.

**Data is never deleted, and the recipe re-attaches to it.** Because `dataPath`
is prefix-free (`data/clients/items`, …) and unchanged, running "Set up client
and time tracking" then "Set up invoicing" recreates the bare-slug collections
over the **same** records — the user's existing clients / invoices / worklog
entries reappear under `/collections/clients`, `/collections/invoice`, etc.

Alternatives considered and rejected: **(1) notify-only** (leave the `mc-*`
skills; the original choice) — rejected because the stale collections stayed in
the dashboard and read as "the migration didn't happen"; **(auto-migrate)**
delete `mc-*` AND host-recreate bare-slug on boot — re-introduces the host↔slug
coupling the refactor removes and is a risky one-time host-side rewrite of
financial collections. The chosen path removes the stale skills (so the dashboard
is clean) but lets the **recipe** — not the host — recreate them on demand.

### Docs

- `docs/CHANGELOG.md` — entry: invoicing suite moved from preset skills to help
  recipes; existing starred installs keep working; new installs use bare slugs.
- `docs/dsl-as-harness.md` (l.323-371) — uses `mc-profile`/`mc-clients` as
  *illustrative* DSL examples (not live-file pointers). Optional: align to bare
  slugs for consistency. Low priority — not required for correctness.

## Deliberately NOT in scope

- The other `mc-*` presets (`mc-cooking-coach`, `mc-library`, `mc-wiki-*`,
  `mc-manage-*`) — only the invoicing four move.
- The built-in `accounting` role and `manageAccounting` plugin — invoice actions
  keep targeting `role: "accounting"`; the role is untouched.
- Record data and `dataPath` values — unchanged (already prefix-free).

## Verification checklist

- [ ] Fresh workspace: "Set up client and time tracking" → A scaffolds
      `data/skills/{clients,worklog}/`, renders at `/collections/clients` +
      `/collections/worklog`, `worklog.clientId` picker lists clients.
- [ ] Fresh workspace: "Set up invoicing" → B scaffolds `invoice` + `profile`,
      and (clients absent) prompts to add Bundle A.
- [ ] A-then-B and B-then-A both reach an identical working end state (invoice
      links clients, embeds profile, pulls worklog hours).
- [ ] All four invoice actions (PDF / sale / payment / void) open a seeded
      `accounting` chat with the de-`mc-`'d record.
- [ ] No stale `data/skills/catalog/preset/mc-{clients,worklog,invoice,profile}`
      after a boot (or documented as inert).
- [ ] Upgrade with active `mc-*` billing skills present: first boot **removes**
      `.claude/skills/mc-{clients,worklog,invoice,profile}` and fires exactly
      **one** migration bell; second boot fires none (dirs already gone); the
      records under `data/*/items` remain untouched and reappear when the recipe
      is re-run.
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build` clean; unit +
      e2e suites updated for removed presets.

## Open decisions for review

(All resolved — see below.)

### Resolved

- **Existing users → remove legacy skills on launch, preserve data** (revised
  from notify-only). `migrateLegacyBillingPresets`
  (`server/workspace/billing-migration.ts`), wired at `server/index.ts` after
  `announceOptionalDeps`: deletes `.claude/skills/mc-{clients,worklog,invoice,profile}`
  (records under `data/*/items` untouched) and fires a one-time bell, i18n in all
  8 locales (`billingMigration.{title,body}`). Idempotent without a marker — the
  deletion is the guard. (See "Existing users" above.)
- **Install order → recommend A then B**, A-query listed first; both orders and
  A-alone still work.
- **Sample-query home → `personal` role** (NOT `general`). The `personal` role
  already hosts every "Create a … collection" sample prompt and exposes
  `presentCollection`, so the two billing prompts join that cluster
  (`src/config/roles.ts`).
- **Sample query must embed the recipe path** (learned during live validation).
  Each query carries "First read `config/helps/billing-*.md` and follow it
  exactly … do not redesign / ask design questions" — without this the agent
  free-styles a custom schema + `presentForm`. Reinforced by a verbatim-only
  callout at the top of each recipe. (See "Edit — discoverability".)
- **Recipe filenames → `billing-clients-worklog.md` + `billing-invoice.md`** (as
  proposed).
- **Stale catalog prune → already handled.** `removeRetiredPresets`
  (`server/workspace/skills-preset.ts:165`) deletes catalog `mc-*` entries whose
  source is gone, so deleting the four source dirs auto-prunes the catalog on the
  next boot; starred active copies under `.claude/skills/` correctly linger.

## Implementation status (landed in working tree)

- ✅ Recipes `billing-clients-worklog.md` (A) + `billing-invoice.md` (B), verbatim
  de-`mc-`'d schemas/SKILL + the four invoice action templates, slug contract,
  dependency-aware "add clients too?" prompt.
- ✅ Deleted the four `mc-*` preset dirs (−1002 lines).
- ✅ Two `personal`-role sample queries (A first), **each embedding the recipe
  path + "follow it exactly, no redesign / no presentForm"**; reinforced by a
  verbatim-only callout at the top of both recipes.
- ✅ Repointed cross-refs (`collection-skills.md`, `helps/index.md`).
- ✅ Launch-time removal of legacy `mc-*` billing skills (data preserved) + one-time
  bell + i18n (8 locales). No marker / no gitignore change.
- ✅ `docs/CHANGELOG.md` entry.
- ✅ e2e-live: `skills.spec.ts` L-33B retargeted `mc-invoice` → `mc-library`
  (CI-relevant, no-LLM); `journey-llm.spec.ts` clients journey rewritten to
  recipe-scaffold the `clients` collection — **needs a live e2e-live run to
  validate** (could not be exercised here).
- ✅ `yarn format / lint / typecheck / build` clean; unit suite green (5355 pass,
  0 fail).

### Manually validated in the running app (2026-06-04)

- ✅ Launch-time removal of the four starred legacy `mc-*` billing skills +
  one-time bell fired.
- ✅ Bundle A: the sample query made the agent read
  `config/helps/billing-clients-worklog.md` and author `data/skills/{clients,worklog}/`
  **verbatim** — no `presentForm`, no extra fields. Existing client/worklog
  records preserved.
- ✅ Bundle B: same for `config/helps/billing-invoice.md` → `data/skills/{profile,invoice}/`
  + the four templates, verbatim; the dependency check saw `clients` present and
  proceeded; existing `profile/me` + `INV-2026-0001` preserved.

### Still unverified (automated only)

- The `journey-llm.spec.ts` clients journey under a real `e2e-live` run (the
  manual path above exercises the same flow, but the spec itself hasn't been run).
