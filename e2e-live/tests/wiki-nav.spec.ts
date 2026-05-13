import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { navigateToWikiIndex, navigateToWikiPage, placeWikiPage, removeWikiPage, replaceWikiIndex, restoreWikiIndex } from "../fixtures/live-chat.ts";

const L14_TIMEOUT_MS = ONE_MINUTE_MS;
const L15_TIMEOUT_MS = ONE_MINUTE_MS;
const L16_TIMEOUT_MS = ONE_MINUTE_MS;
const L_WIKI_PIPE_TIMEOUT_MS = ONE_MINUTE_MS;

// L-14 / L-15 each seed their own pair of wiki pages and never
// touch the shared `data/wiki/index.md`, so they parallelise
// freely. L-16 mutates the shared index file — keep it the only
// index-writing test in this suite, and serialise alongside any
// future index-mutating spec via `test.describe.serial` or by
// putting them in a separate spec file.
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

  test("L-16: /wiki index に並んだ entry をクリックすると各ページが 404 にならず開ける", async ({ page }, testInfo) => {
    test.setTimeout(L16_TIMEOUT_MS);
    // Covers B-23: the wiki index used to drop or mis-link entries
    // because the parser disagreed with the page resolver about how
    // to map index rows → on-disk slugs. Bullet links are the
    // canonical index format, so we seed two entries that point at
    // pages whose actual slugs match the href segment, then click
    // each entry from /wiki and assert the page body actually
    // hydrates (proves both the parser AND the resolver are happy).
    //
    // This is the only test in this spec that mutates the shared
    // `data/wiki/index.md`. The describe block is parallel, so any
    // future test that writes the index must move into its own
    // serial block (or live in a separate file) — see the comment
    // on `describe.configure({ mode: "parallel" })` above.
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

  test("L-WIKI-PIPE: [[slug|alias]] 形式のリンクをクリックすると URL に |alias が混入しない", async ({ page }, testInfo) => {
    test.setTimeout(L_WIKI_PIPE_TIMEOUT_MS);
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
});
