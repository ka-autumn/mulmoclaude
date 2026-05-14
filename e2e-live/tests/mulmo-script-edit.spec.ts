import path from "node:path";

import { expect, test } from "@playwright/test";

import { TOOL_NAME as PRESENT_MULMO_SCRIPT_TOOL } from "../../src/plugins/presentMulmoScript/definition.ts";
import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import {
  deleteSession,
  getCurrentSessionId,
  placeFixtureInWorkspace,
  removeFromWorkspace,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";

const LEDIT_TIMEOUT_MS = 3 * ONE_MINUTE_MS;

test.describe.configure({ mode: "parallel" });

test.describe("mulmoScript edit (real workspace)", () => {
  // Regression net for #1074. The fix has three parts:
  //   1. View re-reads the script from disk on mount via
  //      `refreshScriptFromDisk` (calling the reopen endpoint
  //      `POST /api/mulmoScript/save` with `{ filePath }`), so an
  //      in-SPA navigation that reuses the cached `ActiveSession`
  //      still surfaces the latest disk content. Server-side
  //      `enrichWithMulmoScript` only fires on `/api/sessions/:id`
  //      (a full reload), so without this client-side refresh the
  //      bug remained on the in-SPA path the user actually hits.
  //   2. The post-click wait watches the textarea closing —
  //      successful saves flip `sourceOpen[index] = false` which
  //      removes the entire editor block via `v-if`. Earlier
  //      versions waited for the button to re-enable, but the
  //      button is gone from the DOM by then so `toBeEnabled`
  //      always timed out at 30s.
  //   3. The round-trip uses sidebar/session-tab clicks instead of
  //      `page.goto` so the bug actually surfaces in the test —
  //      `page.goto` triggers a full reload which goes through the
  //      server enrichment and would mask a regression in the
  //      View-side refresh.
  test("L-EDIT: beat 編集 → 更新 → 別セッションへ移動 → 戻ると編集が永続化されている", async ({ page }, testInfo) => {
    // Needs presentMulmoScript server-side handler to surface the
    // generate-movie button. Fake tool_call alone doesn't mount it.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs server-side presentMulmoScript dispatch");
    test.setTimeout(LEDIT_TIMEOUT_MS);
    // Covers issue #1074 — beat edits made via the source-editor
    // textarea were reported to disappear after navigating away and
    // back. We seed the L-03 textSlide fixture under a distinct
    // path so it doesn't collide with media.spec's L-03 run, then
    // round-trip an edit through the update button + navigation.
    const slug = testInfo.project.name;
    const fixtureBasename = `e2e-live-edit-${slug}.json`;
    const workspaceScriptRel = path.posix.join("artifacts/stories", fixtureBasename);
    const wireFilePath = path.posix.join("stories", fixtureBasename);
    await placeFixtureInWorkspace("mulmo/l03-two-beat.json", workspaceScriptRel);
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      const message = [
        `\`${PRESENT_MULMO_SCRIPT_TOOL}\` ツールに \`filePath: "${wireFilePath}"\` を渡して、 既存スクリプトをそのまま表示してください。`,
        "",
        "- ツールには filePath だけを渡し、 script は省略してください",
        "- 動画生成 (Generate Movie / generateMovie ツール) は呼ばないでください",
      ].join("\n");
      await sendChatMessage(page, message);
      await expect(page.getByTestId("mulmo-script-generate-movie-button").first()).toBeVisible({ timeout: ONE_MINUTE_MS });
      await waitForAssistantResponseComplete(page);

      const sessionId = getCurrentSessionId(page);
      if (sessionId === null) throw new Error("session id should not be null after presentMulmoScript turn");
      sessionIdForCleanup = sessionId;

      await editBeat0Text(page, "L-EDIT marker via e2e-live");

      // Navigate to /wiki and back via SPA-internal links — NOT
      // `page.goto`. This is the actual #1074 repro path: a full
      // reload triggers `/api/sessions/:id` which is already
      // disk-enriched server-side (`enrichWithMulmoScript` in
      // server/api/routes/sessions.ts), so the bug only surfaces
      // when the SPA reuses its cached `ActiveSession` after
      // in-app navigation. Clicking the sidebar Wiki launcher and
      // then the session tab keeps the SPA mount alive — Vue
      // Router pushes between routes, no /api/sessions re-fetch
      // happens, and the View must re-read the script from disk
      // itself to surface the edit. An earlier draft of this spec
      // used `page.goto` for the round-trip and would have passed
      // even with the View-side refresh removed.
      await page.getByTestId("plugin-launcher-wiki").click();
      await page.waitForURL(/\/wiki/);
      await page.getByTestId(`session-tab-${sessionId}`).click();
      await page.waitForURL(new RegExp(`/chat/${sessionId}$`));
      await expect(page.getByTestId("mulmo-script-generate-movie-button").first()).toBeVisible({ timeout: ONE_MINUTE_MS });

      await assertBeat0EditPersisted(page, "L-EDIT marker via e2e-live");
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
      await removeFromWorkspace(workspaceScriptRel);
    }
  });
});

/**
 * Open beat 0's JSON source editor, replace the empty `text` value
 * with the given marker, and click the per-beat update button. Each
 * step is gated on the appropriate testid so the test fails fast on
 * the offending stage instead of bubbling a generic timeout.
 */
async function editBeat0Text(page: import("@playwright/test").Page, marker: string): Promise<void> {
  await page.getByTestId("mulmo-script-beat-source-toggle-0").click();
  const textarea = page.getByTestId("mulmo-script-beat-source-textarea-0");
  await expect(textarea).toBeVisible();
  const originalJson = await textarea.inputValue();
  if (!originalJson.includes('"text": ""')) {
    throw new Error(`fixture beat 0 should have empty text, got: ${originalJson.slice(0, 120)}`);
  }
  await textarea.fill(originalJson.replace('"text": ""', `"text": "${marker}"`));
  await page.getByTestId("mulmo-script-beat-update-button-0").click();
  // `sourceOpen[index] = false` (which `v-if`-unmounts the editor)
  // only fires on `response.ok` inside `updateBeat()` — see
  // src/plugins/presentMulmoScript/View.vue. So waiting for the
  // textarea to detach IS de-facto waiting for the network call to
  // settle successfully; a 4xx/5xx leaves the editor open with an
  // inline error and the test would (correctly) time out here.
  // We avoid `toBeEnabled` because successful saves remove the
  // button from the DOM entirely — the locator would retry forever.
  // 30s leaves headroom for disk I/O coinciding with another beat's
  // render.
  await expect(textarea).toBeHidden({ timeout: 30 * ONE_SECOND_MS });
}

async function assertBeat0EditPersisted(page: import("@playwright/test").Page, marker: string): Promise<void> {
  await page.getByTestId("mulmo-script-beat-source-toggle-0").click();
  const textarea = page.getByTestId("mulmo-script-beat-source-textarea-0");
  await expect(textarea).toBeVisible();
  const reopenedJson = await textarea.inputValue();
  expect(reopenedJson, "beat 0 edit must persist across session navigation (#1074)").toContain(marker);
}
