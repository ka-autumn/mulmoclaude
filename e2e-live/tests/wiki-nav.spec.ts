import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  expectWikiPageBody,
  navigateToWikiIndex,
  navigateToWikiPage,
  placeWikiPage,
  removeWikiPage,
  replaceWikiIndex,
  restoreWikiIndex,
} from "../fixtures/live-chat.ts";

// Wiki navigation regressions — the SPA's [[wikilink]] → /wiki/<slug>
// pipeline. Piped-link bugs (PR #1312) live in wiki-piped-links.spec.ts;
// lint-report diagnostics live in wiki-lint.spec.ts. This file keeps
// the core "click a wikilink and land on the right page" coverage,
// including the non-ASCII slug fuzzy-resolver regression (#1194) and
// the index-bullet round-trip (B-23).

const L14_TIMEOUT_MS = ONE_MINUTE_MS;
const L15_TIMEOUT_MS = ONE_MINUTE_MS;
const L16_TIMEOUT_MS = ONE_MINUTE_MS;

// L-14 / L-15 / L-15b each seed their own pages and never touch the
// shared `data/wiki/index.md`, so they parallelise freely. L-16
// mutates that single shared index file, so it lives in the inner
// `describe.serial` block below — keeping one test's restore from
// clobbering another's replace.
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
      // Three-in-one wiki landing assertion (URL + body marker +
      // B-24 /chat sentinel) — see `expectWikiPageBody` docstring.
      await expectWikiPageBody(page, targetSlug, targetMarker);
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
    try {
      await placeWikiPage(sourceSlug, [`# L-15 source`, ``, `[[${targetSlug}]]`, ``].join("\n"));
      await placeWikiPage(targetSlug, [`# 日本語タイトル`, ``, targetMarker, ``].join("\n"));

      // (A) Direct URL routing — non-ASCII slug, no wikilink in the
      // path, just isSafeWikiSlug + resolvePagePath. If B-26 ever
      // regresses, the server returns "page not found" and the body
      // marker assertion fails fast (B-24 /chat sentinel + URL +
      // body marker are all in `expectWikiPageBody`).
      await navigateToWikiPage(page, targetSlug);
      await expectWikiPageBody(page, targetSlug, targetMarker);

      // (B) Wikilink click — `[[日本語…]]` renders verbatim into a
      // `.wiki-link[data-page="…"]` span (renderWikiLinks does no
      // slugification), so the click handler hands the raw slug to
      // the wiki router. Verifying this path keeps the [[ ]] →
      // router-push pipeline honest for non-ASCII targets.
      await navigateToWikiPage(page, sourceSlug);
      await page.locator(`.wiki-link[data-page="${targetSlug}"]`).first().click();
      await expectWikiPageBody(page, targetSlug, targetMarker);
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
      // #1347). The three generic checks (URL + body marker +
      // B-24 /chat sentinel) collapse into `expectWikiPageBody`;
      // the route-specific #1194 collision sentinel
      // (`not.toContainText(sourceMarker)`) stays inline so its
      // semantics — "the resolver did NOT return the colliding
      // source page" — are obvious at the call site rather than
      // hidden behind a helper signature.
      await test.step("(A) direct URL navigation to target slug", async () => {
        await navigateToWikiPage(page, targetSlug);
        await expectWikiPageBody(page, targetSlug, targetMarker);
        // Negative assertion = #1194 regression sentinel. If the
        // fuzzy resolver ever silently picks the source page again,
        // this is the line that fails.
        await expect(
          page.getByTestId("wiki-page-body"),
          "source marker must NOT appear — would indicate #1194 regression (fuzzy resolver returned colliding page)",
        ).not.toContainText(sourceMarker);
      });

      await test.step("(B) wikilink click from source page → target", async () => {
        // The [[ ]] → router-push pipeline hands the raw non-ASCII
        // slug to the same server resolver, so the collision
        // condition applies here too. If the resolver ever returns
        // the source page, the click bounces back to its own page
        // and the target marker never appears.
        await navigateToWikiPage(page, sourceSlug);
        await page.locator(`.wiki-link[data-page="${targetSlug}"]`).first().click();
        await expectWikiPageBody(page, targetSlug, targetMarker);
        await expect(
          page.getByTestId("wiki-page-body"),
          "source marker must NOT appear after wikilink click — would indicate #1194 regression",
        ).not.toContainText(sourceMarker);
      });
    } finally {
      await removeWikiPage(sourceSlug);
      await removeWikiPage(targetSlug);
    }
  });

  // L-16 replaces `data/wiki/index.md` for the duration of the test.
  // The shared `replaceWikiIndex` helper has no internal locking, so
  // any test that mutates index.md MUST run serially with respect to
  // others that do the same (currently only L-16 in this file; the
  // L-WIKI-LINT-MISSING / L-WIKI-LINT-TAG-DRIFT pair lives in its own
  // wiki-lint.spec.ts file, which is a separate Playwright run).
  // The outer describe stays parallel — the L-14 / L-15 / L-15b
  // tests above do not touch index.md and can run alongside this
  // block without contention. Any future test that mutates index.md
  // MUST move inside this block.
  test.describe.serial("wiki index-mutating navigation", () => {
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

        // Click entry A — expect URL + body marker + B-24 /chat
        // sentinel, all via `expectWikiPageBody`.
        await page.getByTestId(`wiki-page-entry-${slugA}`).click();
        await expectWikiPageBody(page, slugA, markerA);

        // Back to the index, click entry B — same shape, different
        // page. Two clicks, not one, because B-23 historically
        // affected only some bullet rows, not all (e.g. when the
        // index had mixed link styles), so a single click could
        // false-pass.
        await navigateToWikiIndex(page);
        await page.getByTestId(`wiki-page-entry-${slugB}`).click();
        await expectWikiPageBody(page, slugB, markerB);
      } finally {
        if (replacedIndex) await restoreWikiIndex(originalIndex);
        await removeWikiPage(slugA);
        await removeWikiPage(slugB);
      }
    });
  });
});
