// L-HAPPY-TOUR: capability-axis sweep of the major Views / endpoints.
//
// This spec is intentionally shallow. Per-feature regressions belong
// in their own L-XX specs (`/wiki` linking → wiki-nav.spec.ts, todo
// schema → unit tests, etc.); happy-tour exists to catch the class of
// regression where an *individual feature* works in its own spec but
// the *whole app* is broken in production. The canonical incident is
// 2026-05-25, where `@mulmoclaude/todo-plugin` was dropped from the
// published `mulmoclaude` tarball — every per-feature spec passed
// against the dev checkout, but `npx mulmoclaude@latest` failed to
// load `/todos`.
//
// Each step is wrapped in `test.step()` so a happy-tour failure
// reports the broken station directly (Playwright surfaces the step
// title in the trace tree). Assertions are extracted into
// `e2e-live/lib/health-checks.ts` as pure functions so a future
// doctor CLI / pre-release smoke harness can reuse them without
// importing Playwright.
//
// Plan: search for "L-HAPPY-TOUR" in `plans/feat-e2e-live.md`.

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { API_ROUTES } from "../../src/config/apiRoutes.ts";
import {
  SESSION_URL_PATTERN,
  deleteSession,
  fetchAuthedJsonViaPage,
  getCurrentSessionId,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";
import { assertHealthBody, assertNoPluginDiagnostics, assertRuntimePluginsRegistered } from "../lib/health-checks.ts";

// 3-minute wall-time budget per the plan ("実行時間目標: 3 分以内");
// the LLM-bearing step (step 5) reuses the same 2-minute window the
// per-role L-06..L-09 specs settle on. All other steps are
// sub-second navigations / authed JSON fetches.
const HAPPY_TOUR_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const SINGLE_TURN_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const VIEW_MOUNT_TIMEOUT_MS = 30 * ONE_SECOND_MS;

const NO_LLM = process.env.E2E_LIVE_NO_LLM === "1";

// Single-word echo prompt borrowed from L-06: deterministic, no tool
// dispatch, no MCP fan-out. The happy-tour LLM check only has to
// prove the chat round-trip survives boot — not exercise reasoning.
const SINGLE_WORD_PROMPT = "Reply with the single word: hellotour";

test.describe.configure({ mode: "serial" });

test.describe("happy-tour (capability sweep)", () => {
  test("L-HAPPY-TOUR: 主要 View / endpoint を 1 spec で薄く広く touch", async ({ page }) => {
    test.setTimeout(HAPPY_TOUR_TIMEOUT_MS);

    // Land on `/` once up front so subsequent `fetchAuthedJsonViaPage`
    // calls have the `<meta name="mulmoclaude-auth">` token to read.
    // Asserting the sidebar testid here doubles as Step 4 (`/` mounts
    // with chrome visible) — splitting it into its own `test.step`
    // would be process theatre, the navigation IS the check.
    await test.step("4. / が mount し sidebar が見える", async () => {
      await page.goto("/");
      await expect(page.getByTestId("chat-sidebar"), "sidebar must render — chrome is the canary that the SPA mounted at all").toBeVisible({
        timeout: VIEW_MOUNT_TIMEOUT_MS,
      });
    });

    await test.step("1. /api/health が 200 + 期待ボディを返す", async () => {
      const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.health);
      expect(probe.ok, probe.ok ? "" : `health probe failed: ${probe.reason}`).toBe(true);
      if (!probe.ok) throw new Error(`unreachable after expect: ${probe.reason}`);
      const result = assertHealthBody(probe.body);
      expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    });

    await test.step("2. /api/plugins/runtime/list が preset を全件含む", async () => {
      const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.plugins.runtimeList);
      expect(probe.ok, probe.ok ? "" : `runtime list probe failed: ${probe.reason}`).toBe(true);
      if (!probe.ok) throw new Error(`unreachable after expect: ${probe.reason}`);
      // `requireDevOnly: true` against `yarn dev`: all four presets
      // resolve via yarn-workspace symlinks, so we hard-require them.
      // CAVEAT — this catches the *shape* of the 2026-05-25 bundle
      // drop (preset entry disappears from the runtime registry), not
      // the published-tarball composition itself. The full tarball-
      // mode catch requires reusing `assertRuntimePluginsRegistered`
      // (with `requireDevOnly: false`) from a doctor CLI / pre-release
      // smoke harness running against `npx mulmoclaude@<tarball>`;
      // that wiring is the planned reuse target for `health-checks.ts`
      // and is not in this PR.
      const result = assertRuntimePluginsRegistered(probe.body, true);
      expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    });

    await test.step("3. /api/plugins/diagnostics が collision 無し", async () => {
      const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.plugins.diagnostics);
      expect(probe.ok, probe.ok ? "" : `diagnostics probe failed: ${probe.reason}`).toBe(true);
      if (!probe.ok) throw new Error(`unreachable after expect: ${probe.reason}`);
      const result = assertNoPluginDiagnostics(probe.body);
      expect(result.ok, result.ok ? "" : result.reason).toBe(true);
    });

    // Step 5 is the only LLM-bearing step. The CI no-LLM matrix
    // entry uses `MULMOCLAUDE_FAKE_AGENT=1` which returns a stub
    // response, so the marker echo wouldn't hold. We early-return
    // out of the step body — `test.skip()` here would skip the
    // *entire* happy-tour test (Playwright semantics), defeating
    // the matrix entry that exists specifically to run the other
    // 10 non-LLM steps under `E2E_LIVE_NO_LLM=1` (Codex iter-2).
    await test.step("5. /chat で 1 ターン送信 → assistant 応答が返る", async () => {
      if (NO_LLM) return;
      await runSingleTurnSmoke(page);
    });

    await test.step("6. /todos が mount + 読み込みエラー無し", async () => {
      await page.goto("/todos");
      await expect(page.getByTestId("todo-view-root"), "todo view root must render — 2026-05-25 preset-drop regression net").toBeVisible({
        timeout: VIEW_MOUNT_TIMEOUT_MS,
      });
      await expect(page.getByTestId("todo-api-error"), "todo-api-error banner must NOT appear on a fresh /todos visit").toHaveCount(0);
    });

    await test.step("7. /calendar が mount", async () => {
      await page.goto("/calendar");
      await expect(page.getByTestId("scheduler-view-root"), "scheduler view root must render under /calendar").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
      await expect(page.getByTestId("scheduler-api-error"), "scheduler-api-error banner must NOT appear on a fresh /calendar visit").toHaveCount(0);
    });

    await test.step("8. /wiki が mount", async () => {
      await page.goto("/wiki");
      // The wiki index is gated on data/wiki/index.md being readable;
      // `wiki-lint-chat-button` lives in the always-rendered header
      // and is the cheapest "view mounted" sentinel here.
      await expect(page.getByTestId("wiki-lint-chat-button"), "wiki header must render under /wiki").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    await test.step("9. /files が mount", async () => {
      await page.goto("/files");
      await expect(page.getByTestId("files-view-root"), "files view root must render under /files").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    await test.step("10. /skills が mount + catalog セクション visible", async () => {
      await page.goto("/skills");
      // `skill-section-catalog` is the always-rendered catalog
      // accordion header. We do NOT assert any specific preset row
      // exists — L-33 / L-33B already cover that — happy-tour just
      // proves the route mounts at all.
      await expect(page.getByTestId("skill-section-catalog"), "skills view catalog section must render under /skills").toBeVisible({
        timeout: VIEW_MOUNT_TIMEOUT_MS,
      });
    });

    await test.step("11. /sources が mount", async () => {
      await page.goto("/sources");
      await expect(page.getByTestId("sources-view-root"), "sources view root must render under /sources").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    // Steps 12-16 sweep the remaining launcher-exposed routes
    // (automations / news / roles / encore / collections). Same
    // shallow "view-root visible, no error banner" shape as 6-11
    // — happy-tour intentionally stays a wide-but-thin canary so
    // per-feature regressions land in their own L-XX specs.
    await test.step("12. /automations が mount", async () => {
      await page.goto("/automations");
      // SchedulerView is shared between /calendar and /automations
      // (force-tab branches the inner content); the route-specific
      // failure mode happy-tour is catching here is "the route
      // resolves AND the underlying view mounts at all", not the
      // tab-switch internals (those are scheduler-spec territory).
      await expect(page.getByTestId("scheduler-view-root"), "scheduler view root must render under /automations").toBeVisible({
        timeout: VIEW_MOUNT_TIMEOUT_MS,
      });
      await expect(page.getByTestId("scheduler-api-error"), "scheduler-api-error banner must NOT appear on a fresh /automations visit").toHaveCount(0);
    });

    await test.step("13. /news が mount", async () => {
      await page.goto("/news");
      await expect(page.getByTestId("news-view"), "news view must render under /news").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    await test.step("14. /roles が mount", async () => {
      await page.goto("/roles");
      await expect(page.getByTestId("roles-view-root"), "roles view root must render under /roles").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    await test.step("15. /encore が mount", async () => {
      await page.goto("/encore");
      // EncoreDashboard is the default branch when no `pendingId`
      // query param is present — that's the canonical /encore
      // landing surface a normal user hits.
      await expect(page.getByTestId("encore-dashboard"), "encore dashboard must render under /encore").toBeVisible({ timeout: VIEW_MOUNT_TIMEOUT_MS });
    });

    await test.step("16. /collections が mount", async () => {
      await page.goto("/collections");
      await expect(page.getByTestId("collections-view-root"), "collections index must render under /collections").toBeVisible({
        timeout: VIEW_MOUNT_TIMEOUT_MS,
      });
    });

    // The plan's NotificationBell startup-warning step
    // is covered structurally by step 3 — `/api/plugins/diagnostics`
    // is the canonical source the bell *reads from* for boot-time
    // collisions, so duplicating the check via the live notifier
    // ledger would be redundant *and* unreliable (the ledger is a
    // shared user surface; pre-existing urgent entries from
    // Encore / ghost-bell publishers would false-positive the
    // assertion, and a true startup-time WARN published at non-
    // urgent severity would be missed). If a future regression
    // class needs a notifier-side canary, the L-17 baseline-diff
    // shape is the right pattern, not a global severity filter.
  });
});

/**
 * The chat-turn leg of step 5. The session id is captured the moment
 * `/chat/<id>` settles — *before* the marker assertion — so a marker
 * timeout still cleans the session up (Codex iter-1: the prior order
 * leaked sessions on assertion failure).
 */
async function runSingleTurnSmoke(page: Page): Promise<void> {
  let sessionIdForCleanup: string | null = null;
  try {
    await startNewSession(page);
    await sendChatMessage(page, SINGLE_WORD_PROMPT);
    await page.waitForURL(SESSION_URL_PATTERN, { timeout: ONE_MINUTE_MS });
    sessionIdForCleanup = getCurrentSessionId(page);
    await expect(
      page.getByTestId("text-response-assistant-body").last(),
      "assistant body must echo the marker — proves the boot → agent → response loop is alive",
    ).toContainText("hellotour", { timeout: SINGLE_TURN_TIMEOUT_MS });
    await waitForAssistantResponseComplete(page);
  } finally {
    if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
  }
}
