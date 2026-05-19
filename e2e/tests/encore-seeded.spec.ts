// E2E for the plugin-seeded first user turn. When `session_meta`
// carries a `plugin:<pkg>` origin (e.g. Encore opens a chat via
// `runtime.chat.start()`), the very first user message is rendered
// through the skill-style collapsed card path instead of the regular
// text-response bubble — both in the canvas View and in the
// chat-history preview.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const SESSION_ID = "encore-seeded-session";
const PLUGIN_PKG = "@mulmoclaude/encore-plugin";
const SEEDED_BODY = "Seeded greeting from Encore plugin — please respond.";

async function setupSeededSession(page: Page) {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Encore Seeded",
        roleId: "general",
        startedAt: "2026-04-15T10:00:00Z",
        updatedAt: "2026-04-15T10:00:00Z",
      },
    ],
  });

  // Per-session entries override (Playwright matches last-registered
  // first, so this beats the default in mockAllApis). The `session_meta`
  // row's `origin` is what flips `parseSessionEntries` into seeding
  // the first user turn with `data.seededByPlugin`.
  await page.route(
    (url) => url.pathname === `/api/sessions/${SESSION_ID}`,
    (route) =>
      route.fulfill({
        json: [
          {
            type: "session_meta",
            roleId: "general",
            sessionId: SESSION_ID,
            origin: `plugin:${PLUGIN_PKG}`,
          },
          { type: "text", source: "user", message: SEEDED_BODY },
        ],
      }),
  );
}

test.describe("plugin-seeded first user turn", () => {
  test.beforeEach(async ({ page }) => {
    await setupSeededSession(page);
  });

  test("renders the skill-style collapsed card in the canvas View", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    // App-ready signal: the home button renders once the shell mounts.
    // (Plain `getByText("MulmoClaude")` is ambiguous here because the
    // seeded fixture's pkg name `@mulmoclaude/encore-plugin` also
    // matches.)
    await expect(page.getByTestId("app-home-btn")).toBeVisible();

    const card = page.getByTestId("text-response-seeded-card");
    await expect(card).toBeVisible();

    // The "from {pkg}" label uses the pluginTextResponse.seededByPlugin
    // i18n key. Asserting on the visible text keeps the test resilient
    // to template tweaks while still pinning down the chip content.
    await expect(card).toContainText(PLUGIN_PKG);

    // The default text-response bubble path must NOT be taken for the
    // seeded turn — there's no speaker label ("You" / "Assistant")
    // bubble rendered in the canvas.
    await expect(page.getByTestId("text-response-assistant-body")).toHaveCount(0);
  });

  test("collapses body by default and reveals it on summary click", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    // App-ready signal: the home button renders once the shell mounts.
    // (Plain `getByText("MulmoClaude")` is ambiguous here because the
    // seeded fixture's pkg name `@mulmoclaude/encore-plugin` also
    // matches.)
    await expect(page.getByTestId("app-home-btn")).toBeVisible();

    const summary = page.getByTestId("text-response-seeded-summary");
    await expect(summary).toBeVisible();

    // Body markdown lives inside the `<details>` element and is hidden
    // until expanded. `<details>` content is `display: none` when the
    // parent is closed, so toBeVisible() returns false.
    const body = page.getByTestId("text-response-seeded-card").locator(".markdown-content");
    await expect(body).toBeHidden();

    await summary.click();
    await expect(body).toBeVisible();
    await expect(body).toContainText("Seeded greeting from Encore plugin");
  });

  test("sidebar preview renders the seeded one-liner, not the markdown excerpt", async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);
    // App-ready signal: the home button renders once the shell mounts.
    // (Plain `getByText("MulmoClaude")` is ambiguous here because the
    // seeded fixture's pkg name `@mulmoclaude/encore-plugin` also
    // matches.)
    await expect(page.getByTestId("app-home-btn")).toBeVisible();

    // The chat-history sidebar uses Preview.vue; the seeded variant
    // renders only the extension icon + "from {pkg}" label.
    const preview = page.getByTestId("text-response-preview-seeded");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(PLUGIN_PKG);
  });
});
