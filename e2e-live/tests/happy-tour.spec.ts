// L-HAPPY-TOUR: capability-axis sweep of the major Views / endpoints.
//
// This spec is intentionally shallow. Per-feature regressions belong
// in their own L-XX specs (`/wiki` linking → wiki-nav.spec.ts, etc.);
// happy-tour exists to catch the class of regression where an
// *individual feature* works in its own spec but the *whole app* is
// broken in production. The canonical incident is 2026-05-25, where a
// preset plugin was dropped from the published `mulmoclaude` tarball —
// every per-feature spec passed against the dev checkout, but
// `npx mulmoclaude@latest` failed to load that plugin's route.
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
import type { HealthCheckResult } from "../lib/health-checks.ts";
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

// Step 4 is asserted first because every later `fetchAuthedJsonViaPage`
// call needs the `<meta name="mulmoclaude-auth">` token from `/` to
// be loaded — the goto IS the precondition for steps 1-3, and the
// sidebar testid is the cheapest "SPA mounted at all" sentinel.
//
// The plan's NotificationBell startup-warning step is covered
// structurally by step 3 (`/api/plugins/diagnostics`) — the bell
// reads its boot-collision rows from that route, so duplicating
// the check via the live notifier ledger would be redundant AND
// unreliable (pre-existing urgent entries from ghost-bell
// publishers would false-positive the assertion). If a future
// regression class needs a notifier-side canary, the L-17
// baseline-diff shape is the right pattern, not a global filter.

interface RouteSweepEntry {
  readonly stepTitle: string;
  readonly path: string;
  readonly rootTestId: string;
  /** Optional error-banner testid that must NOT appear post-mount. */
  readonly errorBannerTestId?: string;
}

// Per-route notes:
// - `/wiki` uses `wiki-lint-chat-button` (always-rendered header)
//   instead of a body testid — the page body is gated on
//   `data/wiki/index.md`, the header is unconditional.
// - Skills and Roles are no longer launcher routes — they moved into
//   the Settings modal (Management group), so this path-based sweep no
//   longer covers them. L-33 / L-33B still exercise the skills surface.
// - `/automations` mounts `scheduler-view-root` (the standalone
//   AutomationsView). happy-tour only checks "view mounted at all".
//   (The Calendar view + `/calendar` route were removed; `/calendar`
//   now redirects to `/automations`.)
const LAUNCHER_ROUTE_SWEEP: readonly RouteSweepEntry[] = [
  { stepTitle: "7. /automations が mount", path: "/automations", rootTestId: "scheduler-view-root", errorBannerTestId: "scheduler-task-error" },
  { stepTitle: "8. /wiki が mount", path: "/wiki", rootTestId: "wiki-lint-chat-button" },
  { stepTitle: "9. /files が mount", path: "/files", rootTestId: "files-view-root" },
  { stepTitle: "10. /collections が mount", path: "/collections", rootTestId: "collections-view-root" },
  { stepTitle: "11. /feeds が mount", path: "/feeds", rootTestId: "feeds-view-root" },
];

test.describe("happy-tour (capability sweep)", () => {
  test("L-HAPPY-TOUR: 主要 View / endpoint を 1 spec で薄く広く touch", async ({ page }) => {
    test.setTimeout(HAPPY_TOUR_TIMEOUT_MS);
    await assertSpaSidebarMount(page);
    await runHealthApiSteps(page);
    await runChatSmokeStep(page);
    await runLauncherRouteSweep(page);
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

async function assertSpaSidebarMount(page: Page): Promise<void> {
  await test.step("4. / が mount し sidebar が見える", async () => {
    await page.goto("/");
    await expect(page.getByTestId("chat-sidebar"), "sidebar must render — chrome is the canary that the SPA mounted at all").toBeVisible({
      timeout: VIEW_MOUNT_TIMEOUT_MS,
    });
  });
}

// `requireDevOnly: true` for step 2 against `yarn dev`: all preset
// packages resolve via yarn-workspace symlinks, so we hard-require
// them. CAVEAT — this catches the *shape* of the 2026-05-25 bundle
// drop (preset entry disappears from the runtime registry), not the
// published-tarball composition itself. The full tarball-mode catch
// requires reusing `assertRuntimePluginsRegistered` (with
// `requireDevOnly: false`) from a doctor CLI / pre-release smoke
// harness — that wiring is the planned reuse target for
// `health-checks.ts` and is not in this PR.
async function runHealthApiSteps(page: Page): Promise<void> {
  await test.step("1. /api/health が 200 + 期待ボディを返す", async () => {
    await assertAuthedJsonOk(page, API_ROUTES.health, assertHealthBody);
  });
  await test.step("2. /api/plugins/runtime/list が preset を全件含む", async () => {
    await assertAuthedJsonOk(page, API_ROUTES.plugins.runtimeList, (body) => assertRuntimePluginsRegistered(body, true));
  });
  await test.step("3. /api/plugins/diagnostics が collision 無し", async () => {
    await assertAuthedJsonOk(page, API_ROUTES.plugins.diagnostics, assertNoPluginDiagnostics);
  });
}

async function assertAuthedJsonOk(page: Page, url: string, validator: (body: unknown) => HealthCheckResult): Promise<void> {
  const probe = await fetchAuthedJsonViaPage(page, url);
  expect(probe.ok, probe.ok ? "" : `${url} probe failed: ${probe.reason}`).toBe(true);
  if (!probe.ok) throw new Error(`unreachable after expect: ${probe.reason}`);
  const result = validator(probe.body);
  expect(result.ok, result.ok ? "" : result.reason).toBe(true);
}

// Step 5 is the only LLM-bearing step. The CI no-LLM matrix entry
// uses `MULMOCLAUDE_FAKE_AGENT=1` which returns a stub response, so
// the marker echo wouldn't hold. We early-return out of the step
// body — `test.skip()` here would skip the *entire* happy-tour test
// (Playwright semantics), defeating the matrix entry that exists
// specifically to run the other 15 non-LLM steps under
// `E2E_LIVE_NO_LLM=1` (Codex iter-2).
async function runChatSmokeStep(page: Page): Promise<void> {
  await test.step("5. /chat で 1 ターン送信 → assistant 応答が返る", async () => {
    if (NO_LLM) return;
    await runSingleTurnSmoke(page);
  });
}

async function runLauncherRouteSweep(page: Page): Promise<void> {
  for (const entry of LAUNCHER_ROUTE_SWEEP) {
    await test.step(entry.stepTitle, async () => {
      await assertRouteMount(page, entry);
    });
  }
}

// Best-effort gate for async fetches to settle before asserting an
// error banner is absent. `view-root` becoming visible only proves
// the template mounted — the on-mount fetch (scheduler
// items / …) is still in-flight and may surface `*-api-error` a
// moment later. Without this gate, `toHaveCount(0)` resolves
// instantly in the pre-fetch state and false-passes regressions
// (Codex GHA iter-2 finding). `networkidle` is best-effort because
// pages with long-polling / SSE never reach it — the swallow is
// intentional, the worst case is we revert to the pre-fix behaviour
// for that one route rather than hang.
const POST_FETCH_GRACE_MS = 3000;

async function assertRouteMount(page: Page, entry: RouteSweepEntry): Promise<void> {
  await page.goto(entry.path);
  await expect(page.getByTestId(entry.rootTestId), `${entry.rootTestId} must render under ${entry.path}`).toBeVisible({
    timeout: VIEW_MOUNT_TIMEOUT_MS,
  });
  if (entry.errorBannerTestId !== undefined) {
    await page.waitForLoadState("networkidle", { timeout: POST_FETCH_GRACE_MS }).catch(() => {});
    await expect(page.getByTestId(entry.errorBannerTestId), `${entry.errorBannerTestId} must NOT appear on a fresh ${entry.path} visit`).toHaveCount(0);
  }
}
