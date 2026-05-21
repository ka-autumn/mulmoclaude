import { randomUUID } from "node:crypto";

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { navigateToWikiIndex, navigateToWikiPage, placeWikiPage, removeWikiPage, replaceWikiIndex, restoreWikiIndex } from "../fixtures/live-chat.ts";

const L14_TIMEOUT_MS = ONE_MINUTE_MS;
const L15_TIMEOUT_MS = ONE_MINUTE_MS;
const L16_TIMEOUT_MS = ONE_MINUTE_MS;
// L-WIKI-* (the four #1297 regression scenarios below) all use the
// shared `ONE_MINUTE_MS` budget directly via `test.setTimeout()`; we
// don't introduce per-test wrappers because `ONE_MINUTE_MS` is
// already the named constant they would alias to. L14/L15/L16 keep
// their original per-test consts above for repo-history continuity
// (intentionally not refactored in this PR).

// Navigate to the wiki lint report and wait for the body-side h1 to
// render. Body-scoped because the panel chrome also has its own
// "Wiki Lint Report" h2 — a top-level `getByRole` would otherwise
// hit strict-mode violation on two matching elements.
const navigateToWikiLintReport = async (page: Page): Promise<void> => {
  await page.goto("/wiki/lint-report");
  await expect(page.getByTestId("wiki-page-body").getByRole("heading", { name: "Wiki Lint Report" })).toBeVisible();
};

// L-14 / L-15 / the non-mutating L-WIKI-LINT-* tests each seed
// their own pages and never touch the shared `data/wiki/index.md`,
// so they parallelise freely. L-16 and L-WIKI-LINT-MISSING /
// L-WIKI-LINT-TAG-DRIFT all mutate that single shared index file;
// they share the inner `describe.serial` block below to keep one
// test's restore from clobbering another's replace.
test.describe.configure({ mode: "parallel" });

test.describe("wiki navigation (real workspace)", () => {
  test("L-14: wiki ページ内の内部リンクで /chat にリダイレクトされず対象ページが開く", async ({ page }, testInfo) => {
    test.setTimeout(L14_TIMEOUT_MS);
    // Covers B-23 / B-24 / B-25: the catch-all router used to swallow
    // /wiki/pages/<slug> links and bounce them back to /chat. We seed
    // two pages directly on disk (no LLM authoring drift) and click
    // the rendered <a> in the source page; the test fails if the URL
    // ever leaves the wiki surface.
    //
    // Slug uniqueness comes from two pieces:
    //   * Playwright project name — chromium / webkit do not race on
    //     the same disk file during parallel runs.
    //   * per-run nonce (timestamp + small random suffix) — even if a
    //     previous run was killed before its finally block fired, the
    //     stale fixture file lives under a different slug, so this
    //     run's cleanup only ever touches its own pages and never a
    //     user-owned page that happens to share a static name.
    const projectSlug = testInfo.project.name;
    // crypto.randomUUID over Math.random() — sonarjs/pseudo-random
    // flags the latter even though uniqueness is the only requirement
    // here (slugs aren't a security boundary). UUID is plenty unique
    // and keeps lint clean.
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-l14-source-${projectSlug}-${nonce}`;
    const targetSlug = `e2e-live-l14-target-${projectSlug}-${nonce}`;
    const targetMarker = "L-14 target body marker";
    // Both seed calls live inside the try block — if the second
    // placeWikiPage throws (filesystem error, permission, etc.) we
    // still hit finally and clean up the first page. removeWikiPage
    // is rm({ force: true }) under the hood, so calling it for a
    // slug that was never written is a no-op.
    //
    // mulmoclaude wiki uses double-bracket [[slug]] wikilinks (see
    // src/plugins/wiki/helpers.ts), not plain markdown links —
    // markdown links would be rewritten as Files-view paths and
    // produce a "File not found" view instead of routing to /wiki.
    try {
      await placeWikiPage(sourceSlug, [`# L-14 source`, ``, `[[${targetSlug}]]`, ``].join("\n"));
      await placeWikiPage(targetSlug, [`# L-14 target`, ``, targetMarker, ``].join("\n"));
      await navigateToWikiPage(page, sourceSlug);
      await page.locator(`.wiki-link[data-page="${targetSlug}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodeURIComponent(targetSlug)}$`));
      await expect(page.getByTestId("wiki-page-body")).toContainText(targetMarker);
      // Negative guard: if the catch-all regression resurfaces, the
      // SPA falls through to /chat (B-24's reported failure mode).
      await expect(page).not.toHaveURL(/\/chat/);
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });

  test("L-15: 非 ASCII slug の wiki ページが URL でも内部リンクでも開ける", async ({ page }, testInfo) => {
    test.setTimeout(L15_TIMEOUT_MS);
    // Covers B-26 / B-27: a wiki page whose slug starts with
    // Japanese characters has to survive the round trip through
    //   * isSafeWikiSlug (must accept non-ASCII)
    //   * URL percent-encoding / decoding on the SPA side
    //   * resolvePagePath's fuzzy `key.includes(slug)` branch on the
    //     server (wikiSlugify drops the Japanese chars to "" or to
    //     just the trailing ASCII suffix, so the exact-key map miss
    //     and the fuzzy fallback is what makes the file findable
    //     without depending on a seeded data/wiki/index.md row)
    //
    // Slug shape — the trailing ASCII tail must survive wikiSlugify
    // so the fuzzy step has *something* to substring-match against.
    // The original first run of this spec also hit a server-side bug
    // (#1194): when the slug + a sibling page filename shared a
    // suffix, the resolver's fuzzy `key.includes(slug)` loop returned
    // whichever matching key it iterated first (readdir order) — i.e.
    // the source page got rendered instead of the target. That bug
    // is fixed (`pickFuzzyMatch` now scores by length-ratio and
    // returns null on a tie), so the `nonascii-target` token is no
    // longer load-bearing for correctness. It stays as a redundancy
    // belt: the target slug is still uniquely identifiable and the
    // spec doesn't depend on the implementation's tie-breaker. The
    // shared `nonce` drives cleanup correlation across both pages.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const targetSlug = `日本語タイトル-nonascii-target-${projectSlug}-${nonce}`;
    const sourceSlug = `e2e-live-l15-source-${projectSlug}-${nonce}`;
    const targetMarker = "L-15 target body marker (本文サンプル)";
    // encodeURIComponent output is the percent-encoded path the
    // browser actually sits on; reuse it both for the URL assertion
    // regex and for documenting the encoded form. encodeURIComponent
    // is regex-safe (no `.` `(` `)` `*` etc. in its output for our
    // input), so we splice it into the RegExp source verbatim — same
    // shape L-14 uses one screen up.
    const encodedTargetSlug = encodeURIComponent(targetSlug);
    try {
      await placeWikiPage(sourceSlug, [`# L-15 source`, ``, `[[${targetSlug}]]`, ``].join("\n"));
      await placeWikiPage(targetSlug, [`# 日本語タイトル`, ``, targetMarker, ``].join("\n"));

      // (A) Direct URL routing — non-ASCII slug, no wikilink in the
      // path, just isSafeWikiSlug + resolvePagePath. If B-26 ever
      // regresses, the server returns "page not found" and the body
      // marker assertion fails fast.
      await navigateToWikiPage(page, targetSlug);
      await expect(page.getByTestId("wiki-page-body")).toContainText(targetMarker);
      await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodedTargetSlug}$`));
      // Negative guard mirroring L-14 — the catch-all router must
      // not swallow non-ASCII page slugs (B-24 regression shape).
      await expect(page).not.toHaveURL(/\/chat/);

      // (B) Wikilink click — `[[日本語…]]` renders verbatim into a
      // `.wiki-link[data-page="…"]` span (renderWikiLinks does no
      // slugification), so the click handler hands the raw slug to
      // the wiki router. Verifying this path keeps the [[ ]] →
      // router-push pipeline honest for non-ASCII targets.
      await navigateToWikiPage(page, sourceSlug);
      await page.locator(`.wiki-link[data-page="${targetSlug}"]`).first().click();
      await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodedTargetSlug}$`));
      await expect(page.getByTestId("wiki-page-body")).toContainText(targetMarker);
      await expect(page).not.toHaveURL(/\/chat/);
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });

  test("L-15b: 非 ASCII slug fuzzy resolve が衝突候補から正しい target を決定的に選ぶ (#1194)", async ({ page }, testInfo) => {
    // Previously test.fail()'d on CI under the theory that the
    // server-side resolver had a fresh-workspace quirk. The real
    // root cause was in this spec: `testInfo.title.split(":")[0]`
    // returns "L-15b" with an uppercase L, which then landed in the
    // slug via `nonce`. Wiki filenames are conventionally all
    // lowercase (every real page goes through `wikiSlugify` whose
    // output is `[a-z0-9-]+`), so when the resolver did
    // `wikiSlugify(target) = "...-l-15b-..."` and tried to fuzzy-
    // match against the on-disk key `...-L-15b-...`, neither
    // `slug.includes(key)` nor `key.includes(slug)` succeeded — the
    // case mismatch killed the substring match. The fix below
    // lowercases `testLabel` before splicing it into the slug, so
    // the seeded filename matches the slug-form output of
    // `wikiSlugify` and the resolver lands on the target page.
    // L-15 と同じ shape のテストなので timeout 定数も共用 (plan
    // file の方針)。
    test.setTimeout(L15_TIMEOUT_MS);
    // End-to-end repro of the #1194 collision condition. L-15 keeps
    // a `nonascii-target` token in the target slug as a redundancy
    // belt; this spec strips that belt off and exercises the
    // resolver under the exact shape the original bug needed:
    //
    //   target slug = `日本語タイトル-${projectSlug}-${nonce}`
    //   source slug = `e2e-live-l15b-source-${projectSlug}-${nonce}`
    //
    // wikiSlugify(target) drops the Japanese chars → leaves a tail
    // like `-${projectSlug}-${nonce}`. That tail is a substring of
    // BOTH on-disk filenames, so the resolver's fuzzy fallback has
    // two equally-includes-eligible candidates. Pre-#1319, the
    // fuzzy loop returned whichever key Map iteration (= readdir
    // order, = creation order) surfaced first — typically the
    // source page, since we seed it first below — and the SPA
    // silently rendered the wrong page. Post-#1319 `pickFuzzyMatch`
    // scores `min/max` of slug-vs-key lengths; the target key (≈
    // Japanese 7 chars + shared suffix) is closer in length to the
    // slug than the source key (≈ "e2e-live-l15b-source-" 21 chars
    // + shared suffix), so target wins deterministically regardless
    // of seed order.
    //
    // The negative `not.toContainText(sourceMarker)` assertion is
    // the load-bearing one: it fails loudly if the resolver ever
    // returns the source page again, which is the exact regression
    // shape we're protecting against.
    //
    // Two routes are exercised, mirroring L-15's shape:
    //   (A) Direct URL navigation — hits resolvePagePath via the
    //       /api/wiki request triggered by the wiki route guard.
    //   (B) Wikilink click in the source page — `[[targetSlug]]`
    //       renders into a `.wiki-link[data-page]` span; clicking
    //       hands the raw slug to the SPA router, which makes the
    //       same /api/wiki request. Both routes ultimately ask the
    //       server to resolve the same colliding slug, so both must
    //       land on the target page.
    const projectSlug = testInfo.project.name;
    // `testInfo.title` を nonce に織り込む (Sourcery review #1347)。
    // 失敗時に `data/wiki/pages/` に残った slug ファイルを見ただけ
    // で「どのテストが書いた fixture か」が分かるため、parallel
    // 実行中の triage と stale 検出が楽になる。`.split(":")[0]` で
    // テスト名先頭の short id (例: "L-15b") だけ取り出して slug に
    // 安全な ASCII プレフィックスに揃える。`.toLowerCase()` は必須:
    // wiki page filename の規約は `[a-z0-9-]+` (`wikiSlugify` 出力)
    // で、大文字が混ざると resolver の `wikiSlugify(target)` と
    // on-disk key の case mismatch で fuzzy match が全滅する。
    const testLabel = testInfo.title.split(":")[0].trim().toLowerCase();
    const nonce = `${testLabel}-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const targetSlug = `日本語タイトル-${projectSlug}-${nonce}`;
    const sourceSlug = `e2e-live-l15b-source-${projectSlug}-${nonce}`;
    const targetMarker = `L-15b target body marker ${nonce}`;
    const sourceMarker = `L-15b source body marker ${nonce}`;
    const encodedTargetSlug = encodeURIComponent(targetSlug);
    try {
      // Seed source first — the original bug's repro relied on the
      // source page being readdir-first when both keys partial-
      // matched. The new resolver is order-independent, so this
      // ordering is documentation, not a load-bearing setup step.
      // Source body carries the unique sourceMarker (for the
      // negative assertion) plus a `[[targetSlug]]` wikilink so
      // route (B) below has something to click.
      await placeWikiPage(sourceSlug, [`# L-15b source`, ``, sourceMarker, ``, `[[${targetSlug}]]`, ``].join("\n"));
      await placeWikiPage(targetSlug, [`# 日本語タイトル`, ``, targetMarker, ``].join("\n"));

      // Each route is wrapped in `test.step` so the Playwright
      // trace viewer renders (A) and (B) as separate, named nodes
      // and CI failures attribute to the correct route without
      // hunting through a flat assertion log (Sourcery review
      // #1347). The four assertions inside each step are
      // intentionally duplicated rather than extracted into a
      // helper — collision repro semantics differ subtly between
      // routes (e.g. the "click into a colliding wikilink" shape
      // is route-(B)-only), and a helper would obscure that.
      await test.step("(A) direct URL navigation to target slug", async () => {
        await navigateToWikiPage(page, targetSlug);
        await expect(page.getByTestId("wiki-page-body"), "target page body must render (positive assertion)").toContainText(targetMarker);
        // Negative assertion = #1194 regression sentinel. If the
        // fuzzy resolver ever silently picks the source page again,
        // this is the line that fails.
        await expect(
          page.getByTestId("wiki-page-body"),
          "source marker must NOT appear — would indicate #1194 regression (fuzzy resolver returned colliding page)",
        ).not.toContainText(sourceMarker);
        await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodedTargetSlug}$`));
        // Negative guard mirroring L-14 / L-15 — catch-all router
        // must not swallow non-ASCII page slugs (B-24 shape).
        await expect(page).not.toHaveURL(/\/chat/);
      });

      await test.step("(B) wikilink click from source page → target", async () => {
        // The [[ ]] → router-push pipeline hands the raw non-ASCII
        // slug to the same server resolver, so the collision
        // condition applies here too. If the resolver ever returns
        // the source page, the click bounces back to its own page
        // and the target marker never appears.
        await navigateToWikiPage(page, sourceSlug);
        await page.locator(`.wiki-link[data-page="${targetSlug}"]`).first().click();
        await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodedTargetSlug}$`));
        await expect(page.getByTestId("wiki-page-body"), "target page body must render after wikilink click").toContainText(targetMarker);
        await expect(
          page.getByTestId("wiki-page-body"),
          "source marker must NOT appear after wikilink click — would indicate #1194 regression",
        ).not.toContainText(sourceMarker);
        await expect(page).not.toHaveURL(/\/chat/);
      });
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });

  test("L-WIKI-PIPE: [[slug|alias]] 形式のリンクをクリックすると URL に |alias が混入しない", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // Covers PR #1312 / issue #1297: pre-fix `wikiSlugify` stripped
    // `|` as a non-ASCII character and concatenated the right-hand-
    // side alias's ASCII chars into the slug. Three symptoms all
    // stemmed from the same bug:
    //   1. lint flagged every `[[slug|alias]]` link as a broken link
    //      to a slug like `<slug>-<alias-ascii>.md`
    //   2. `renderWikiLinks` (frontend) emitted
    //      `<span data-page="<slug>|<alias>">` so clicking produced
    //      a URL containing `%7C<alias-encoded>`
    //   3. the visible link text was the raw slug+alias string
    //      instead of just the display alias
    //
    // Post-fix, parser/resolver/renderer all share `parseWikiLink`
    // (`src/lib/wiki-page/link.ts`) and split on `|`. This spec
    // exercises 2 and 3 end-to-end against a live mulmoclaude server;
    // 1 is covered by `findBrokenLinksInPage — [[slug|alias]]
    // regression` in `test/lib/wiki-page/test_lint.ts`.
    //
    // Same nonce strategy as L-14: each project gets unique slugs so
    // chromium / webkit don't race, and `finally` cleans up its own
    // pages even if an earlier run died mid-test.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-wiki-pipe-source-${projectSlug}-${nonce}`;
    const targetSlug = `e2e-live-wiki-pipe-target-${projectSlug}-${nonce}`;
    const targetMarker = `wiki-pipe target body marker ${nonce}`;
    // Display alias deliberately mixes Japanese and a unique ASCII
    // token so a regression that re-includes the alias in the URL
    // would be visually obvious (the ASCII suffix would survive
    // wikiSlugify and end up appended to the path segment).
    const aliasAsciiToken = `alias-ascii-token-${nonce}`;
    const displayAlias = `日本語の表示テキスト ${aliasAsciiToken}`;
    try {
      await placeWikiPage(sourceSlug, [`# wiki-pipe source`, ``, `[[${targetSlug}|${displayAlias}]]`, ``].join("\n"));
      await placeWikiPage(targetSlug, [`# wiki-pipe target`, ``, targetMarker, ``].join("\n"));
      await navigateToWikiPage(page, sourceSlug);

      // Renderer assertions — `parseWikiLink` must put the slug in
      // data-page and the alias in the visible text. Pre-fix both
      // were the whole `slug|alias` inner string.
      const pipeLink = page.locator(`.wiki-link[data-page="${targetSlug}"]`);
      await expect(pipeLink, "wiki-link's data-page must be the target slug only").toBeVisible();
      await expect(pipeLink, "visible text must be the display alias, not the raw slug+alias string").toHaveText(displayAlias);
      // Negative DOM guard — if the renderer regresses and emits
      // data-page with `|`, this locator would match (it does not on
      // the post-fix DOM). The selector tolerates the renderer
      // putting other wiki-links on the page; it just asserts none
      // of them contain a literal pipe.
      await expect(page.locator(`.wiki-link[data-page*="|"]`), "no wiki-link's data-page should contain a literal pipe").toHaveCount(0);

      await pipeLink.first().click();
      // Strict URL assertion — path must end with the target slug
      // exactly, no `|` (or its `%7C` percent-encoding) anywhere.
      await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodeURIComponent(targetSlug)}$`));
      await expect(page, "URL must not contain a percent-encoded pipe (regression sentinel for %7C alias leak)").not.toHaveURL(/%7C/);
      // Negative guard mirroring L-14/L-15/L-16 — the catch-all
      // router must not swallow the click into /chat.
      await expect(page).not.toHaveURL(/\/chat/);
      await expect(page.getByTestId("wiki-page-body"), "target page must hydrate after click").toContainText(targetMarker);
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });

  test("L-WIKI-LINT-PIPE-CLEAN: lint レポート画面で [[slug|alias]] が broken link 扱いされない", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // Covers PR #1312 / issue #1297 from the lint-UI side: pre-fix
    // `findBrokenLinksInPage` slugified the whole `<slug>|<alias>`
    // string and emitted false-positive broken-link entries on the
    // /wiki/lint-report page (`<slug>-<alias-ascii>.md not found`).
    // Post-fix, the lint resolver shares `parseWikiLink` with the
    // renderer so the alias suffix never reaches the slug.
    //
    // Same nonce strategy as L-14: each project gets unique slugs.
    // The lint endpoint scans the entire workspace, so collision-
    // safety comes from the per-test nonce — assertions only check
    // for the seeded slug substring, never a fixed slug.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-wiki-lint-clean-source-${projectSlug}-${nonce}`;
    const targetSlug = `e2e-live-wiki-lint-clean-target-${projectSlug}-${nonce}`;
    const aliasAsciiToken = `lint-clean-alias-ascii-${nonce}`;
    const displayAlias = `日本語の表示テキスト ${aliasAsciiToken}`;
    try {
      await placeWikiPage(sourceSlug, [`# wiki-lint-clean source`, ``, `[[${targetSlug}|${displayAlias}]]`, ``].join("\n"));
      await placeWikiPage(targetSlug, [`# wiki-lint-clean target`, ``, `body marker ${nonce}`, ``].join("\n"));
      await navigateToWikiLintReport(page);
      // Strict negative: no <li> in the lint output mentions our
      // source page with "not found" — that would be the pre-fix
      // false-positive shape. The `:has-text` filter scopes by both
      // tokens so the assertion fails only when our seeded link
      // actually got flagged as broken (not on unrelated noise).
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("not found")`),
        "lint must not flag the seeded [[slug|alias]] link as broken (pre-fix false-positive sentinel)",
      ).toHaveCount(0);
      // Equally strict: the alias's ASCII token must never end up in
      // a slug-form "not found" entry. Pre-fix produced
      // `<slug>-<alias-ascii>.md not found`; post-fix it can't.
      await expect(
        page.locator(`li:has-text("${aliasAsciiToken}"):has-text("not found")`),
        "alias ASCII token must not surface in any 'not found' lint entry",
      ).toHaveCount(0);
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });

  test("L-WIKI-LINT-EMPTY-TARGET: lint レポート画面で bare [[Japanese]] が empty target 診断に出る", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // Covers PR #1312's new "empty target" diagnostic. Pre-fix
    // bare `[[Japanese title]]` (or `[[#anchor]]`) collapsed via
    // `wikiSlugify` into an empty string and was reported as a
    // broken link to `<empty>.md`, indistinguishable from a real
    // missing-file regression. Post-fix, the resolver detects the
    // empty-slug case and emits `→ empty target` so operators can
    // filter the noise apart from genuine `<slug>.md not found`.
    //
    // No target page is seeded — by design the link cannot resolve.
    // Cleanup only touches the source page.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-wiki-lint-empty-source-${projectSlug}-${nonce}`;
    // Bare Japanese-only target — wikiSlugify strips every char and
    // returns "" so the resolver has no slug to look up. Crucially
    // the target string contains NO ASCII (no nonce, no hyphen, no
    // digit) — any surviving ASCII would slip through wikiSlugify
    // and become a non-empty slug, demoting the diagnostic from
    // "empty target" back to "<slug>.md not found". Per-test
    // uniqueness comes from `sourceSlug` (which IS nonce-stamped),
    // so the `<li>:has-text(sourceSlug)` filter still scopes the
    // assertion to this run only.
    const bareJapaneseTarget = "日本語のみのターゲット記号終端タイトル";
    try {
      await placeWikiPage(sourceSlug, [`# wiki-lint-empty source`, ``, `[[${bareJapaneseTarget}]]`, ``].join("\n"));
      await navigateToWikiLintReport(page);
      // Positive: the seeded link must surface as an "empty target"
      // entry naming our source file and the bare Japanese token.
      // Pre-fix would have produced "→ <some-ascii-tail>.md not
      // found" instead of "→ empty target".
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("${bareJapaneseTarget}"):has-text("empty target")`),
        "lint must report bare Japanese-only [[…]] as empty target diagnostic",
      ).toHaveCount(1);
      // Negative: same source file, no "<slug>.md not found" entry
      // for this link. If the diagnostic regressed back to broken-
      // link reporting, this would catch it.
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("${bareJapaneseTarget}"):has-text("not found")`),
        "empty-target case must not also surface as a 'not found' broken link",
      ).toHaveCount(0);
    } finally {
      await removeWikiPage(sourceSlug);
    }
  });

  test("L-WIKI-LINT-BROKEN: lint レポート画面で [[bogus-slug]] が broken link 診断に出る", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // General sanity: the broken-link diagnostic itself still works
    // post-fix. Distinct from L-WIKI-LINT-EMPTY-TARGET (Japanese
    // → empty slug) and L-WIKI-LINT-PIPE-CLEAN (alias must NOT
    // false-positive). Here a plain ASCII slug references a file
    // that doesn't exist — the canonical broken-link case the user
    // would encounter when typoing or deleting a target page.
    //
    // No target page is seeded — by design the link cannot resolve.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const sourceSlug = `e2e-live-wiki-lint-broken-source-${projectSlug}-${nonce}`;
    const bogusTargetSlug = `e2e-live-wiki-lint-broken-bogus-${projectSlug}-${nonce}`;
    try {
      await placeWikiPage(sourceSlug, [`# wiki-lint-broken source`, ``, `[[${bogusTargetSlug}]]`, ``].join("\n"));
      await navigateToWikiLintReport(page);
      // Positive: an entry naming both the source file and the bogus
      // target's `<slug>.md not found` form must appear. The
      // `bogusTargetSlug` substring also implicitly checks that the
      // resolver did NOT slugify it down to an empty string — it
      // is plain ASCII and must survive verbatim.
      await expect(
        page.locator(`li:has-text("${sourceSlug}"):has-text("${bogusTargetSlug}.md not found")`),
        "lint must report [[bogus-slug]] as broken link with '<slug>.md not found' shape",
      ).toHaveCount(1);
    } finally {
      await removeWikiPage(sourceSlug);
    }
  });

  test("L-WIKI-LINT-ORPHAN: lint レポート画面で index.md にない page が orphan 診断に出る", async ({ page }, testInfo) => {
    test.setTimeout(ONE_MINUTE_MS);
    // Covers `findOrphanPages` end-to-end. Any `<slug>.md` on disk
    // that the index does not reference must surface as the
    // dedicated "Orphan page" diagnostic — pre-fix this was merged
    // with the broken-link line and operators could not filter the
    // two cases apart.
    //
    // No index mutation is needed: the user's existing
    // `data/wiki/index.md` will not reference our nonce-stamped
    // slug, so seeding just the page file produces a deterministic
    // orphan. That keeps this test parallel-safe and lets it run
    // alongside the other non-mutating L-WIKI-LINT-* tests above.
    //
    // The lint report aggregates every orphan on disk, so other
    // parallel tests' transiently-seeded source pages (L-WIKI-PIPE
    // et al.) may also surface here while they run. That is fine:
    // the assertion is scoped to our unique slug via `:has-text`,
    // not to a total orphan count.
    const testLabel = testInfo.title.split(":")[0].trim().toLowerCase();
    const nonce = `${testLabel}-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const orphanSlug = `e2e-live-wiki-lint-orphan-${testInfo.project.name}-${nonce}`;
    try {
      await placeWikiPage(orphanSlug, [`# wiki-lint-orphan ${nonce}`, ``, `orphan body ${nonce}`, ``].join("\n"));
      await navigateToWikiLintReport(page);
      // Diagnostic shape: `**Orphan page**: \`<slug>.md\` exists
      // but is missing from index.md`. Anchor on all three tokens
      // (slug + "Orphan page" + "missing from index.md") so the
      // assertion only matches the dedicated diagnostic and not,
      // e.g., a future "<slug>.md not found" line that happened
      // to mention the same slug.
      await expect(
        page.locator(`li:has-text("${orphanSlug}.md"):has-text("Orphan page"):has-text("missing from index.md")`),
        "lint must report the seeded page as an orphan diagnostic",
      ).toHaveCount(1);
    } finally {
      await removeWikiPage(orphanSlug);
    }
  });

  // The three diagnostics below all replace `data/wiki/index.md`
  // for the duration of the test. The shared `replaceWikiIndex`
  // helper has no internal locking, so they MUST run serially with
  // respect to each other; without this fence one test's
  // `restoreWikiIndex` would race against a sibling's
  // `replaceWikiIndex`, leaving the workspace in a hybrid state.
  // The outer describe stays parallel — the L-14 / L-15 / L-15b /
  // L-WIKI-PIPE / L-WIKI-LINT-PIPE-CLEAN / L-WIKI-LINT-EMPTY-TARGET
  // / L-WIKI-LINT-BROKEN / L-WIKI-LINT-ORPHAN tests above do not
  // touch index.md and can run alongside this block without
  // contention. Any future test that mutates index.md MUST move
  // inside this block (or a sibling serial block).
  test.describe.serial("wiki index-mutating diagnostics", () => {
    test("L-16: /wiki index に並んだ entry をクリックすると各ページが 404 にならず開ける", async ({ page }, testInfo) => {
      test.setTimeout(L16_TIMEOUT_MS);
      // Covers B-23: the wiki index used to drop or mis-link entries
      // because the parser disagreed with the page resolver about how
      // to map index rows → on-disk slugs. Bullet links are the
      // canonical index format, so we seed two entries that point at
      // pages whose actual slugs match the href segment, then click
      // each entry from /wiki and assert the page body actually
      // hydrates (proves both the parser AND the resolver are happy).
      const projectSlug = testInfo.project.name;
      const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
      const slugA = `e2e-live-l16-alpha-${projectSlug}-${nonce}`;
      const slugB = `e2e-live-l16-beta-${projectSlug}-${nonce}`;
      const titleA = `L-16 alpha ${nonce}`;
      const titleB = `L-16 beta ${nonce}`;
      const markerA = `L-16 alpha body marker ${nonce}`;
      const markerB = `L-16 beta body marker ${nonce}`;
      // Bullet-link rows (`- [Title](pages/<slug>.md) — description`)
      // are the format `parseBulletLinkRow` resolves slug-from-href —
      // important so non-ASCII or unusually shaped titles do not
      // collapse via `wikiSlugify`. Keep the index minimal: just the
      // two test entries, replacing whatever the user has on disk so
      // the rendered list contains exactly the entries we expect to
      // click. The original content is restored in `finally`.
      const newIndex = ["# Wiki Index", "", `- [${titleA}](pages/${slugA}.md) — alpha`, `- [${titleB}](pages/${slugB}.md) — beta`, ""].join("\n");
      // Two-state cleanup gate (codex iter-2 fix): `replaceWikiIndex`
      // returns `string | null`, where `null` is a meaningful "the
      // file did not exist before — `restoreWikiIndex(null)` should
      // delete it" signal. A previous gate of `if (originalIndex !==
      // null)` would skip cleanup in exactly that case and leave the
      // synthetic index on disk. Track replacement separately so the
      // null payload is forwarded verbatim.
      let originalIndex: string | null = null;
      let replacedIndex = false;
      try {
        await placeWikiPage(slugA, [`# ${titleA}`, ``, markerA, ``].join("\n"));
        await placeWikiPage(slugB, [`# ${titleB}`, ``, markerB, ``].join("\n"));
        originalIndex = await replaceWikiIndex(newIndex);
        replacedIndex = true;
        await navigateToWikiIndex(page);

        // Both entries must render in the index list as testid'd rows.
        // Visibility is the strong signal the parser found the bullet
        // and the View hydrated `pageEntries` from the API response.
        await expect(page.getByTestId(`wiki-page-entry-${slugA}`), "alpha entry must appear in the index list").toBeVisible();
        await expect(page.getByTestId(`wiki-page-entry-${slugB}`), "beta entry must appear in the index list").toBeVisible();

        // Click entry A — expect /wiki/pages/<slugA> + body marker.
        // encodeURIComponent matches the L-14 / L-15 assertion shape
        // (a no-op for ASCII slugs, but explicit about intent and
        // silences static analysis flags on raw template-string regex).
        await page.getByTestId(`wiki-page-entry-${slugA}`).click();
        await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodeURIComponent(slugA)}$`));
        await expect(page.getByTestId("wiki-page-body"), "alpha page body must hydrate after clicking the index entry").toContainText(markerA);
        // Negative guard mirroring L-14: if the catch-all router ever
        // swallows wiki page navigations again (B-24 regression), the
        // URL would land on /chat — fail loud here so the diagnostic
        // points at the right bug.
        await expect(page).not.toHaveURL(/\/chat/);

        // Back to the index, click entry B — same shape, different
        // page. Two clicks, not one, because B-23 historically
        // affected only some bullet rows, not all (e.g. when the
        // index had mixed link styles), so a single click could
        // false-pass.
        await navigateToWikiIndex(page);
        await page.getByTestId(`wiki-page-entry-${slugB}`).click();
        await expect(page).toHaveURL(new RegExp(`/wiki/pages/${encodeURIComponent(slugB)}$`));
        await expect(page.getByTestId("wiki-page-body"), "beta page body must hydrate after clicking the index entry").toContainText(markerB);
        await expect(page).not.toHaveURL(/\/chat/);
      } finally {
        if (replacedIndex) await restoreWikiIndex(originalIndex);
        await removeWikiPage(slugA);
        await removeWikiPage(slugB);
      }
    });

    test("L-WIKI-LINT-MISSING: lint レポート画面で index.md が参照する未存在 file が missing 診断に出る", async ({ page }, testInfo) => {
      test.setTimeout(ONE_MINUTE_MS);
      // Covers `findMissingFiles` end-to-end. An index.md row that
      // references a slug whose `<slug>.md` does not exist on disk
      // must surface as "Missing file". This is the symmetric
      // partner to "Orphan page" — together they let operators
      // reconcile the index vs. the pages directory.
      //
      // We replace `data/wiki/index.md` with a synthetic row that
      // points at a nonce-stamped slug we never seed. Restoration
      // happens in `finally` via the standard `replaceWikiIndex` →
      // `restoreWikiIndex` round trip (see L-16's iter-2 fix for
      // the null-vs-empty restore semantics this inherits).
      const testLabel = testInfo.title.split(":")[0].trim().toLowerCase();
      const nonce = `${testLabel}-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const bogusSlug = `e2e-live-wiki-lint-missing-${testInfo.project.name}-${nonce}`;
      // Bullet-link form is what `parseBulletLinkRow` reads to
      // recover entry.slug from the href — same shape L-16 uses.
      const newIndex = ["# Wiki Index", "", `- [${bogusSlug} title](pages/${bogusSlug}.md) — missing-file canary`, ""].join("\n");
      let originalIndex: string | null = null;
      let replacedIndex = false;
      try {
        originalIndex = await replaceWikiIndex(newIndex);
        replacedIndex = true;
        await navigateToWikiLintReport(page);
        // Diagnostic shape: `**Missing file**: index.md references
        // \`<slug>\` but the file does not exist`. Anchor on slug
        // + "Missing file" + "does not exist" so the assertion is
        // narrowly scoped to our seeded entry, even if the
        // workspace has unrelated missing-file diagnostics.
        await expect(
          page.locator(`li:has-text("${bogusSlug}"):has-text("Missing file"):has-text("does not exist")`),
          "lint must report the seeded index row as a missing-file diagnostic",
        ).toHaveCount(1);
      } finally {
        if (replacedIndex) await restoreWikiIndex(originalIndex);
      }
    });

    test("L-WIKI-LINT-TAG-DRIFT: lint レポート画面で frontmatter tag と index tag の drift が診断に出る", async ({ page }, testInfo) => {
      test.setTimeout(ONE_MINUTE_MS);
      // Covers `findTagDrift` end-to-end. A page whose YAML
      // frontmatter `tags:` differs from the matching index row's
      // hashtag set must surface as "Tag drift" — pre-fix it
      // surfaced as a generic warning that operators could not
      // filter. The page exists (no Missing file noise) AND is in
      // the index (no Orphan page noise) so the assertion can
      // anchor narrowly on the drift diagnostic itself.
      //
      // Both the page body and the index row need to be seeded.
      // The shared `data/wiki/index.md` is mutated → serial block.
      const testLabel = testInfo.title.split(":")[0].trim().toLowerCase();
      const nonce = `${testLabel}-${Date.now()}-${randomUUID().slice(0, 6)}`;
      const slug = `e2e-live-wiki-lint-drift-${testInfo.project.name}-${nonce}`;
      // Tag tokens use only lowercase ASCII + hyphens + digits so
      // both `parseFrontmatterTags` (post-`cleanTagToken`) and
      // `extractHashTags` (whose regex allows `\p{L}\p{N}_-`) keep
      // them verbatim. Distinct tags on each side so the drift
      // condition is unambiguous (set inequality).
      const pageTag = `pageonly-${nonce}`;
      const indexTag = `indexonly-${nonce}`;
      // YAML block-list frontmatter — js-yaml parses both flow
      // (`tags: [a, b]`) and block forms, but the block form is
      // unambiguous and survives a future parseFrontmatter rewrite
      // that drops flow support.
      const pageBody = ["---", `tags:`, `  - ${pageTag}`, "---", "", `# ${slug}`, "", `drift body ${nonce}`, ""].join("\n");
      // Bullet-link row with the index-side tag tucked into the
      // description via `#<tag>` (extractHashTags reads it from
      // the description line). Keep the slug in the href so
      // `parseBulletLinkRow` recovers entry.slug = slug.
      const newIndex = ["# Wiki Index", "", `- [${slug} title](pages/${slug}.md) — drift canary #${indexTag}`, ""].join("\n");
      let originalIndex: string | null = null;
      let replacedIndex = false;
      try {
        await placeWikiPage(slug, pageBody);
        originalIndex = await replaceWikiIndex(newIndex);
        replacedIndex = true;
        await navigateToWikiLintReport(page);
        // Diagnostic shape: `**Tag drift**: \`<slug>.md\`
        // frontmatter has [pageonly...] but index.md has
        // [indexonly...]`. Both tag tokens are nonce-stamped so
        // the same <li> can be uniquely identified by joining the
        // slug + "Tag drift" + both tokens — no risk of a partial
        // match landing on an unrelated diagnostic.
        await expect(
          page.locator(`li:has-text("${slug}.md"):has-text("Tag drift"):has-text("${pageTag}"):has-text("${indexTag}")`),
          "lint must report the seeded slug as a tag-drift diagnostic",
        ).toHaveCount(1);
      } finally {
        if (replacedIndex) await restoreWikiIndex(originalIndex);
        await removeWikiPage(slug);
      }
    });
  });
});
