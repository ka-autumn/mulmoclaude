# Rich embed syntax + iframe sandbox fixes (#1221)

## Goal

Make external content render usefully inside MulmoClaude's wiki / files / chat-artifact surfaces:

1. External `<a href="https://...">` links opened from sandboxed iframes are dead-clicks today — fix that.
2. The LLM (and preset skills like `mc-library`) currently spell out raw URLs for Amazon / GitHub / YouTube / etc. Define a compact wiki record that renders into the right card / link / embed at display time, decoupling the on-disk form from the visual rendering.

Phasing keeps risk low: PR-A is a sandbox-fix ready in hours; PR-B introduces the syntax + the first two renderers; PR-C+ extends one prefix at a time as real usage demands them.

## Design — hybrid embed syntax

Distilled from a survey of Hatena / PukiWiki / DokuWiki / MediaWiki / Hugo / Notion (see issue thread for the full comparison).

### Surface (3-tier progressive disclosure)

```text
[[type:id]]                          # 90% case — minimum
[[type:id|shorthand]]                # one positional shortcut
[[type:id?key=val&key=val]]          # full extensibility (URL-query shape)
```

| Example | Renders as |
|---|---|
| `[[amazon:B00ICN066A]]` | Amazon card (default region from config) |
| `[[amazon:B00ICN066A\|link]]` | inline link only — `style=link` shorthand |
| `[[amazon:B00ICN066A?region=jp&style=card]]` | full named-param form |
| `[[isbn:9780062316097]]` | Book card via OpenLibrary (Amazon-independent) |
| `[[github:receptron/mulmoclaude]]` | repo card |
| `[[github:receptron/mulmoclaude/issues/1221]]` | issue link with title (id may contain `/`) |
| `[[youtube:dQw4w9WgXcQ?style=thumbnail]]` | thumbnail instead of full embed |
| `[[map:35.6586,139.7454?zoom=12]]` | geo pin |

### Internal data model (parser output)

```ts
interface ParsedEmbed {
  type: string;                       // "amazon" | "isbn" | "github" | ...
  id: string;                         // primary id (slash-tolerant)
  shorthand?: string;                 // |xxx (single positional)
  params: Record<string, string>;     // ?key=val&... named params
  raw: string;                        // original [[...]] for round-trip
}
```

### Renderer registry (per type, Zod-validated)

```ts
interface EmbedRenderer<T extends z.ZodSchema> {
  type: string;
  schema: T;                                  // params validation + type derivation
  render(args: z.infer<T> & { id: string }, ctx: RenderCtx): VNode;
}
```

`shorthand` is interpreted by the schema (e.g. `|link` → `style: "link"` for `amazon` / `github` / `youtube`).

### Cross-type reserved param names

| name | values | applies to |
|---|---|---|
| `style` | `link` / `card` / `inline` / `image` | all types |
| `region` | country code | amazon, news, ... |
| `caption` | any string | all (link-text override) |

Type-specific keys live under each type's schema (`github.kind`, `map.zoom`, `youtube.start`).

### Parsing

One regex captures every form:

```regex
\[\[([a-z][a-z0-9-]*):([^\|\?\]]+)(?:\|([^\?\]]+))?(?:\?([^\]]+))?\]\]
```

→ `type`, `id`, `shorthand`, `query` capture groups. `URLSearchParams` over `query` produces the params map. Done.

### Disambiguation from existing `[[wiki-link]]`

**Important — the original "presence of `:` ⇒ embed" rule is unsafe** (Codex review on PR #1248). Today's `renderWikiLinks` (`src/plugins/wiki/helpers.ts`) accepts any text inside `[[...]]` except `]]`, and `isSafeWikiSlug` (`src/plugins/wiki/route.ts`) only blocks `/`, `\`, `..` — so a page literally named `foo:bar` is a valid wiki link. Reinterpreting `:` globally as embed syntax would silently change every existing `[[foo:bar]]` link's meaning.

The discriminator is therefore **a closed set of known type prefixes**, not the bare presence of `:`:

| Inside brackets | Treatment |
|---|---|
| `[[X:Y...]]` where `X` ∈ `EMBED_TYPES` (`amazon`, `isbn`, `github`, `youtube`, `map`, …) | embed |
| anything else, including `[[foo:bar]]` where `foo` is not a registered type | wiki page link (unchanged) |
| `[[X:Y]]` where the user genuinely wants a page named `X:Y` even if `X` is a registered type | escape with backslash: `[[X\:Y]]` (parser strips the `\` for the page-name lookup; reserved `\` is added to the wiki-link grammar in PR-B together with this rule) |

**Precedence: embed always wins at registry hit.** `[[X:Y...]]` where `X ∈ EMBED_TYPES` is **always** treated as an embed at runtime — there is no "migration mode" runtime fallback to wiki resolution. Determinism beats forgiveness here; otherwise parser, server-side renderer, and client-side wiki-link rewriter could each pick a different precedence and silently disagree. Users who genuinely want a wiki page whose name collides with a reserved prefix MUST use the backslash escape `[[X\:Y]]`.

**Pre-merge migration step (one-shot, runs BEFORE PR-B lands, not at runtime):**

1. **`scripts/scan-reserved-wiki-collisions.ts`** ships in PR-B and runs as part of CI. It walks every `data/wiki/pages/*.md` body for `[[<reserved>:Y]]` patterns and **fails the lint job** if any are found, listing each occurrence with its file path. The list is the user's checklist: rename the page or rewrite the link to use `[[X\:Y]]`. Once the scan reports zero hits, PR-B is mergeable. Production behaviour after merge is the deterministic registry rule above — no fallback ambiguity.

**Post-merge guardrails (runtime, prevent new collisions):**

2. **Wiki page rename / save guard**: `manageWiki` save / rename refuses to create a slug whose first `:`-segment matches a reserved type prefix. Error message points at the escape. Closes the back door so users can't reintroduce collisions after PR-B lands.
3. **`EMBED_TYPES` is closed and host-owned**, not user-extensible. Adding a new embed type is a host code change, gated by review — the review naturally checks "does this collide with any existing wiki page name?" before merge.

This converts the discriminator from a global syntactic rule (every `:` ⇒ embed) into a closed registry lookup, so the backward-compat surface is only as wide as the host-owned `EMBED_TYPES` set — and the pre-merge scan + rename guard make the migration explicit rather than silent.

### Choices we explicitly reject

| Rejected | Why |
|---|---|
| MediaWiki magic links (bare-text `ISBN ...` auto-link) | Un-localizable, deprecated by Wikipedia itself |
| Hugo full shortcode (`{{< amazon asin="..." >}}`) | Too verbose for inline prose |
| Pure positional flags (PukiWiki `(asin, left, image)`) | Reordering breaks; 4th param is a footgun |
| Notion-style implicit URL unfurl | No way to express author intent (link vs card vs image-only) |
| Hatena-style `:` separator for modifiers | Collides with `:` inside ids (URLs, repo paths) |

## Phasing

### PR-A — iframe sandbox fix (smallest possible change, closes Issue 1)

**Scope**: external `<a href="https://...">` produced by `marked.parse` should open in a new tab on a normal click.

**Touch points** (all `marked.parse` callers in the host):

- `src/plugins/wiki/View.vue`
- `src/plugins/markdown/View.vue`
- `src/plugins/textResponse/View.vue`
- `src/plugins/news/View.vue` (if it lives in the same renderer)
- `src/plugins/spreadsheet/View.vue` (XLSX → HTML — already trusted, but check)

**Approach**:

1. Add a shared `src/utils/markdown/externalLinks.ts` helper:
   - `marked.use({ renderer: { link({href, title, text}) {...} } })` — when `href` is an absolute URL (`/^https?:\/\//.test(href)`), append `target="_blank" rel="noopener noreferrer"` to the emitted `<a>`.
   - Internal links (`/`, `#`, `[[wiki-link]]` post-processing) untouched.
2. Unit test for the renderer override: external URL → `target="_blank"` injected; relative URL → unchanged.

**No iframe sandbox tweak required** (revised after the 48h sweep). The wiki / files / chat-artifact markdown does NOT render inside an iframe — it goes straight through `marked.parse` → `DOMPurify` → SPA DOM, so a renderer override is enough. The only iframe in scope is `/artifacts/html/...` (the `presentHtml` preview, see #1228), and it deliberately uses `sandbox="allow-scripts"` (no `allow-same-origin`) so LLM-generated HTML can't read the parent's bearer token. Loosening that is a regression — leave it alone.

**Out of scope** for PR-A:

- New embed syntax — that's PR-B.
- Restyling links — only their open-target changes.
- Iframe sandbox capability changes (see note above).

**Acceptance**:

- [ ] Click any `https://...` link in wiki / files / chat artifact → opens in new tab.
- [ ] Click any internal link (`[[other-page]]`, `/route`) → in-place navigation as before.
- [ ] No new XSS vector (the `noopener noreferrer` is the standard mitigation).
- [ ] All existing markdown unit + e2e tests still pass.

### PR-B — embed syntax core + Amazon + ISBN renderers

**Scope**: introduce `[[type:id...]]` parser + a renderer registry + the first two type renderers (`amazon`, `isbn`). Wires into the same `marked.parse` pipeline PR-A touched.

**Files (new)**:

- `src/utils/markdown/embed/parser.ts` — regex + URL-query parsing → `ParsedEmbed`
- `src/utils/markdown/embed/registry.ts` — type-keyed registry, `register(renderer)`, `get(type)`
- `src/utils/markdown/embed/renderers/amazon.ts` — Zod schema + render fn
- `src/utils/markdown/embed/renderers/isbn.ts` — Zod schema + render fn
- `src/utils/markdown/embed/index.ts` — exported entry: `expandEmbedsInMarkdown(md: string): string`
- `test/utils/markdown/embed/test_parser.ts` — minimum / shorthand / full-params / collision-with-wiki-link / malformed-input cases
- `test/utils/markdown/embed/test_amazon.ts`, `test_isbn.ts` — schema validation + render output snapshot

**Files (changed)**:

- `marked.use(...)` config in the shared `markdown/externalLinks.ts` helper from PR-A — extend to also walk the AST (or do a pre-pass on the markdown source) and replace `[[type:id...]]` tokens before `marked.parse`.
- Each `View.vue` that renders markdown gets `expandEmbedsInMarkdown(md)` in its pipeline. No direct DOM injection from the renderer — just produce HTML strings through the existing `marked` + DOMPurify pipe.

**Renderer responsibilities**:

- `amazon`:
  - schema: `{ region: enum default "jp" (configurable), style: enum default "card", tag?: string (affiliate, defaults from config) }`
  - card style: cover image (when fetchable) + title + price line + region badge
  - link style: `<a href="https://www.amazon.<region>/dp/<asin>?tag=<tag>" target="_blank">…</a>`
  - cover/title fetch: deferred to a SSR-side cache or client-side fetch via the existing pubsub `bookmarks`/cache pattern. **Do NOT fetch on every render** — needs same caching primitive `mc-library` Google-Books fetcher uses.
- `isbn`:
  - schema: `{ style: enum default "card", source: enum["openlibrary", "googlebooks"] default "openlibrary" }`
  - card style: cover + title + author + year via OpenLibrary `https://openlibrary.org/isbn/<isbn>.json`
  - link style: `<a href="https://openlibrary.org/isbn/<isbn>">…</a>` (openlibrary search page)

**Affiliate-tag policy**:

- Single global config setting (e.g. `config/settings.json#amazonAffiliateTag`) injected into every `amazon` link unless `?tag=` is set explicitly.
- Empty default → no tag appended (unmonetised by default).

**Acceptance**:

- [ ] `[[amazon:B00ICN066A]]` renders an Amazon card.
- [ ] `[[amazon:B00ICN066A|link]]` renders a plain link.
- [ ] `[[amazon:B00ICN066A?region=jp]]` switches the destination URL.
- [ ] `[[isbn:9780062316097]]` renders a book card via OpenLibrary.
- [ ] `[[wiki-page-name]]` (no `:`) still renders as an internal wiki link.
- [ ] Malformed `[[amazon:]]` (empty id) emits a fallback "?" badge with the `raw` source visible (no crash).
- [ ] Parser unit tests cover all cases above.
- [ ] `mc-library` skill (preset) is updated to write `[[amazon:<asin>]]` instead of raw `https://www.amazon.co.jp/dp/...` (separate small commit on the same PR or a follow-up).

**Out of scope** for PR-B:

- youtube / x / map / github renderers — PR-C+.
- Server-side cover/metadata caching — first cut can fetch on-demand with a basic in-memory cache.
- Editor UX (suggestion popups, picker UI) — pure markdown for now.

### PR-C+ — additional types

Each future type is one self-contained PR adding `src/utils/markdown/embed/renderers/<type>.ts` + the corresponding schema + tests. No changes to the parser or registry. Suggested order based on `mc-library` and #1169 needs:

1. `youtube` — embed iframe (default thumbnail-link, opt-in to full embed via `?style=embed` since the iframe itself is heavy)
2. `github` — repo card + issue/PR link (kind detected from id shape: `owner/repo`, `owner/repo/issues/N`, `owner/repo/pull/N`)
3. `x` (Twitter) — tweet embed via oEmbed API
4. `map` — geo pin (lat,lng + zoom). Renderer is a thin shim that emits a `showLocation` invocation against the upstream `@gui-chat-plugin/google-map@0.4.0` plugin runtime API (integrated in #1241), NOT a custom `<google-map>` component. The `region` reserved param doesn't apply; `zoom` does.

### Future candidate types (not on the critical path)

- `photo:<id>` — embed a thumbnail + map link from `data/photo-locations/<id>` after #1222 / #1247 / #1250 / #1251 land. Needs a stable id surface (filename or stable hash) on the photo metadata first; flagging here so we remember to design the id shape with this in mind when photo metadata stabilises.

## Out of scope (the whole issue)

- Universal oEmbed fallback (any URL → unfurl). Author intent matters; we want the explicit `[[type:id]]` opt-in.
- Editing UX — just markdown for now. A picker / autocomplete is a separate UX PR if needed.
- Magic-link auto-detection (bare ISBN / ASIN in prose) — explicitly rejected per the design.

## Related

- #1210 — preset skills infrastructure (mc-library is the first heavy user; will switch to `[[amazon:...]]` once PR-B lands)
- #1169 — home-application plugin & role plan (most planned skills will produce content with external references)
- #1227 / #1241 — map plugin via `@gui-chat-plugin/google-map` (PR-C `map:` renderer composes with this)
- #1228 — `presentHtml` iframe sandbox + auto-height; explains why PR-A does NOT touch iframe sandbox
- #1222 / #1247 / #1250 / #1251 — photo-EXIF + `managePhotoLocations` + Photos settings tab (sets up the eventual `[[photo:<id>]]` candidate)

## Tracking

- PR-A: iframe sandbox fix
- PR-B: parser + registry + amazon + isbn
- PR-C: youtube
- PR-D: github
- (later) PR-E: x, PR-F: map

Move this file to `plans/done/` only when the **last** of the planned PRs (PR-A through PR-D at minimum) merges. Later additions (PR-E, PR-F) can be one-shot follow-ups without keeping the plan file open.
