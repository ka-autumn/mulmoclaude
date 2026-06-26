import { randomUUID } from "node:crypto";

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { expectWikiPageBody, navigateToWikiPage, placeWikiPage, removeWikiPage } from "../fixtures/live-chat.ts";

// `[[slug|alias]]` regression coverage — PR #1312 / issue #1297. Pre-fix
// `wikiSlugify` stripped `|` as a non-ASCII character and concatenated
// the alias's ASCII chars into the slug, breaking both the renderer
// (URL leak) and the lint resolver (false-positive broken-link). The
// renderer side lives here; the lint side lives in wiki-lint.spec.ts
// next to the other lint diagnostics for thematic cohesion.

// Navigate to the wiki lint report and wait for the body-side h1 to
// render. Body-scoped because the panel chrome also has its own
// "Wiki Lint Report" h2 — a top-level `getByRole` would otherwise
// hit strict-mode violation on two matching elements.
const navigateToWikiLintReport = async (page: Page): Promise<void> => {
  await page.goto("/wiki/lint-report");
  await expect(page.getByTestId("wiki-page-body").getByRole("heading", { name: "Wiki Lint Report" })).toBeVisible();
};

test.describe.configure({ mode: "parallel" });

test.describe("wiki piped-link regressions (real workspace)", () => {
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
    // regression` in `test/lib/wiki-page/test_lint.ts` (and by the
    // sibling L-WIKI-LINT-PIPE-CLEAN below).
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
      // `expectWikiPageBody` covers URL ends with target slug + body
      // hydrates + B-24 /chat sentinel. The %7C-leak sentinel is
      // #1297-specific (route owns it, helper doesn't), so it stays
      // inline.
      await expectWikiPageBody(page, targetSlug, targetMarker);
      await expect(page, "URL must not contain a percent-encoded pipe (regression sentinel for %7C alias leak)").not.toHaveURL(/%7C/);
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
});
