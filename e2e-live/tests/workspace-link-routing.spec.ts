import { randomUUID } from "node:crypto";
import { posix as pathPosix } from "node:path";

import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  deleteSession,
  getCurrentSessionId,
  navigateToWikiPage,
  placeWikiPage,
  placeWorkspaceFile,
  removeFromWorkspace,
  removeWikiPage,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";

const L23_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L24_TIMEOUT_MS = ONE_MINUTE_MS;
const L_LINKIFY_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const SESSION_URL_PATTERN = /\/chat\/[0-9a-f-]+/;
const FILES_URL_PATTERN = /\/files\//;

// Each test seeds its own uniquely-named workspace file under
// artifacts/, so they parallelise without touching shared state.
test.describe.configure({ mode: "parallel" });

test.describe("workspace link routing (real workspace)", () => {
  test("L-23: マルチバイトファイル名を含む Markdown リンクが二重 percent-encode されず Files で開ける", async ({ page }, testInfo) => {
    test.setTimeout(L23_TIMEOUT_MS);
    // Covers the regression behind plans/fix-workspace-link-double-encoding.md.
    //
    // marked.parse() percent-encodes multibyte chars in <a href>
    // (e.g. "作" → "%E4%BD%9C"). Before the fix, classifyWorkspacePath
    // returned that already-encoded path verbatim, vue-router
    // percent-encoded it AGAIN on push, and /api/files/content
    // received "%25E4%25BD%259C..." and 404'd — every internal link
    // to a non-ASCII filename was a dead click.
    //
    // Reproduce by:
    //   1. seeding a real file under artifacts/ with a Japanese
    //      filename, so a single-encoding round-trip resolves and a
    //      double-encoding round-trip 404s
    //   2. asking the LLM to echo a markdown link to that file as
    //      its only output — chat user messages aren't rendered on
    //      the canvas (the canvas only mounts the selectedResult
    //      plugin View), so we have to drive an assistant turn for
    //      a clickable <a> to land in the canvas
    //   3. clicking the rendered link and asserting that
    //      (a) the URL is single-encoded (no `%25`), AND
    //      (b) FilesView actually shows the file body (not 404)
    //
    // Slug uniqueness mirrors the wiki-nav specs: project name +
    // randomUUID nonce so parallel chromium/webkit and stale-run
    // remnants never collide.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const filename = `e2e-live-l23-${projectSlug}-${nonce}-テストファイル.md`;
    // Stage the seed file under a test-only subtree so a stale-run
    // remnant cannot mix into real user reports if cleanup misses.
    const relativePath = pathPosix.join("artifacts", "e2e-live", "workspace-link-routing", filename);
    const marker = `L-23 ${projectSlug} ${nonce} body marker`;
    const fileBody = `# ${filename}\n\n${marker}\n`;

    // Echo prompt — explicit single-line instruction keeps the LLM
    // from wrapping the link in narration or quoting it. The link
    // itself must arrive on the canvas as a clickable <a>; if the
    // LLM prefixes it with "Here is the link:" we still get an <a>
    // because the prompt asks for the markdown form verbatim.
    //
    // Brittleness note: this depends on the LLM honouring the echo
    // instruction. The selector below tolerates leading prose
    // (matches by encoded href suffix, not visible text) but cannot
    // recover if the model wraps the link in a code fence or makes
    // a tool call instead of replying with text. The repo runs
    // e2e-live with `retries: 0` deliberately — flakes here should
    // be diagnosed (prompt drift, model regression) rather than
    // papered over. Bump the inner timeouts before reaching for
    // retries.
    const userPrompt = [
      "次のテキストを 1 行だけそのまま返答してください。説明・前置き・引用符・コードブロックは付けないでください。",
      `[${filename}](${relativePath})`,
    ].join("\n");

    const sessionsToCleanup: string[] = [];
    await placeWorkspaceFile(relativePath, fileBody);
    try {
      await startNewSession(page);
      await page.waitForURL(SESSION_URL_PATTERN);
      const sessionId = getCurrentSessionId(page);
      if (sessionId === null) {
        throw new Error("getCurrentSessionId returned null after startNewSession — URL pattern likely drifted");
      }
      sessionsToCleanup.push(sessionId);

      await sendChatMessage(page, userPrompt);

      // Wait for the assistant's textResponse to land in the canvas
      // (selectedResult auto-flips to the latest tool result on SSE
      // settle). Match the link by the encoded href substring rather
      // than its visible text — accessible-name selectors are
      // brittle when the LLM tucks the link inside Markdown
      // emphasis or wraps it in narration.
      const link = page.locator(`a[href$="${encodeURIComponent(filename)}"]`).first();
      await expect(link, "assistant must render a markdown link to the seeded file").toBeVisible({ timeout: 2 * ONE_MINUTE_MS });
      await link.click();

      // Single-encoding check: vue-router encodes once on push, so
      // "%E4%BD%9C" is expected. Two encodings show up as "%25E4%25BD%259C".
      await expect(page).toHaveURL(FILES_URL_PATTERN, { timeout: ONE_MINUTE_MS });
      expect(page.url(), "URL must not be double-percent-encoded (no %25)").not.toContain("%25");

      // FilesView resolved the path → /api/files/content returned
      // 200 → the markdown body got rendered. The marker text is
      // unique enough that any stray match elsewhere on the page
      // would itself indicate that the file load reached the renderer.
      await expect(page.getByText(marker), "FilesView must render the seeded file body (no 404)").toBeVisible({ timeout: ONE_MINUTE_MS });

      await waitForAssistantResponseComplete(page, L23_TIMEOUT_MS);
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
      await removeFromWorkspace(relativePath);
    }
  });

  test("L-24: wiki ページ内の Markdown リンクからもマルチバイトファイルが Files で開ける", async ({ page }, testInfo) => {
    test.setTimeout(L24_TIMEOUT_MS);
    // Same regression as L-23, but exercises the OTHER UI path that
    // shares classifyWorkspacePath: WikiPageBody.vue's click handler
    // (`@workspace-link-click` → appApi.navigateToWorkspacePath).
    // L-23 covers the textResponse path; without this case, the wiki
    // path would only be transitively covered by the unit tests on
    // classifyWorkspacePath, with no live verification that the wiki
    // view actually wires the decoded path into the SPA router.
    //
    // No LLM round-trip — the markdown link is seeded directly into
    // the wiki page body, so this scenario is deterministic (unlike
    // L-23 which depends on the model echoing the link).
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const filename = `e2e-live-l24-${projectSlug}-${nonce}-テストファイル.md`;
    const relativePath = pathPosix.join("artifacts", "e2e-live", "workspace-link-routing", filename);
    const marker = `L-24 ${projectSlug} ${nonce} body marker`;
    const fileBody = `# ${filename}\n\n${marker}\n`;

    const sourceSlug = `e2e-live-l24-source-${projectSlug}-${nonce}`;
    // Markdown link form (not [[wikilink]]) — that's what triggers
    // marked.parse's percent-encoding of the multibyte filename, which
    // is the input shape the fix has to handle.
    const sourceBody = [`# L-24 source page`, ``, `[${filename}](${relativePath})`, ``].join("\n");

    await placeWorkspaceFile(relativePath, fileBody);
    try {
      await placeWikiPage(sourceSlug, sourceBody);
      try {
        await navigateToWikiPage(page, sourceSlug);

        const link = page.locator(`a[href$="${encodeURIComponent(filename)}"]`).first();
        await expect(link, "wiki body must render the markdown link to the seeded file").toBeVisible({ timeout: L24_TIMEOUT_MS });
        await link.click();

        await expect(page).toHaveURL(FILES_URL_PATTERN, { timeout: L24_TIMEOUT_MS });
        expect(page.url(), "URL must not be double-percent-encoded (no %25)").not.toContain("%25");

        await expect(page.getByText(marker), "FilesView must render the seeded file body (no 404)").toBeVisible({ timeout: L24_TIMEOUT_MS });
      } finally {
        await removeWikiPage(sourceSlug);
      }
    } finally {
      await removeFromWorkspace(relativePath);
    }
  });

  test("L-LINKIFY-CODESPAN: inline-code workspace path が自動リンク化されて Files で開ける (#1300 / PR #1325)", async ({ page }, testInfo) => {
    test.setTimeout(L_LINKIFY_TIMEOUT_MS);
    // Covers the issue-#1300 / PR #1325 fallback layer (A) end-to-end.
    //
    // SYSTEM_PROMPT (layer B) asks the LLM to emit Markdown links for
    // generated files. The remaining tail — where the model drops the
    // wrapper and ships ``artifacts/.../name.md`` as an inline code
    // span — used to render as non-clickable <code>, forcing copy-paste.
    // `src/utils/markdown/workspaceLinkify.ts` overrides marked's
    // codespan renderer to wrap matching paths in
    // `<a href="..." class="workspace-link" data-workspace-path="...">`,
    // and the textResponse view's `openLinksInNewTab` handler then
    // routes the click through `appApi.navigateToWorkspacePath`.
    //
    // Unit tests (`test/utils/markdown/test_workspaceLinkify.ts`) pin
    // the detector + the marked pipeline; this spec is the missing
    // end-to-end net: marked → linkify → DOM anchor → click → Files
    // view actually opens the seeded file.
    //
    // ASCII filename on purpose — L-23 already covers the multibyte
    // percent-encoding axis on the Markdown-link branch. Keeping this
    // case ASCII isolates the codespan-fallback regression from the
    // encoding regression.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const filename = `e2e-live-linkify-codespan-${projectSlug}-${nonce}.md`;
    const relativePath = pathPosix.join("artifacts", "e2e-live", "workspace-link-routing", filename);
    const marker = `L-LINKIFY-CODESPAN ${projectSlug} ${nonce} body marker`;
    const fileBody = `# ${filename}\n\n${marker}\n`;

    // Inline-code echo prompt — explicitly require backticks so the
    // LLM emits the codespan shape that triggers the fallback path,
    // not the Markdown-link shape that bypasses it. The trailing
    // Japanese phrase mirrors the exact reproduction shape from the
    // issue (``artifacts/.../foo.pdf`` followed by plain text).
    const userPrompt = [
      "次の 1 行を**そのまま**返答してください。説明・前置き・引用符・コードブロックは付けないでください。バッククォートも 1 文字目と最後のバッククォートをそのまま保持してください:",
      `\`${relativePath}\` 開いて内容を確認`,
    ].join("\n");

    const sessionsToCleanup: string[] = [];
    await placeWorkspaceFile(relativePath, fileBody);
    try {
      await startNewSession(page);
      await page.waitForURL(SESSION_URL_PATTERN);
      const sessionId = getCurrentSessionId(page);
      if (sessionId === null) {
        throw new Error("getCurrentSessionId returned null after startNewSession — URL pattern likely drifted");
      }
      sessionsToCleanup.push(sessionId);

      await sendChatMessage(page, userPrompt);

      // Target the anchor produced by `workspaceLinkifyExtension`. The
      // detector accepts exactly this path shape (artifacts/... with
      // ≤8-char extension, no whitespace), and the wrapper sets the
      // `workspace-link` class + `data-workspace-path` attribute.
      // Matching on all three (class, data-attr, inner <code>) makes
      // sure we're seeing the fallback path, not a stray Markdown-link
      // shape that would defeat the regression.
      const linkifySelector = `a.workspace-link[data-workspace-path="${relativePath}"]`;
      const link = page.locator(linkifySelector).first();
      await expect(link, 'codespan workspace path must be wrapped in <a class="workspace-link">').toBeVisible({ timeout: 2 * ONE_MINUTE_MS });
      await expect(link.locator("code"), "anchor must wrap a <code> (default codespan renderer preserved)").toHaveText(relativePath);

      await link.click();

      await expect(page).toHaveURL(FILES_URL_PATTERN, { timeout: ONE_MINUTE_MS });
      await expect(page.getByText(marker), "FilesView must render the seeded file body").toBeVisible({ timeout: ONE_MINUTE_MS });

      await waitForAssistantResponseComplete(page, L_LINKIFY_TIMEOUT_MS);
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
      await removeFromWorkspace(relativePath);
    }
  });
});
