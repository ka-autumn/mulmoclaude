// Plugin launcher buttons that sit above the canvas. All buttons
// navigate to a dedicated page (/wiki, /automations, etc.) — the URL
// path reflects which page is active, and landing on that URL restores it.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

async function clickLauncherAndAssertPath(page: Page, key: string, expectedPath: string): Promise<void> {
  await page.goto("/chat");
  await page.waitForURL(/\/chat\//);

  await page.getByTestId(`plugin-launcher-${key}`).click();

  await page.waitForURL(new RegExp(`${expectedPath}(?:$|\\?)`));
  expect(new URL(page.url()).pathname).toBe(expectedPath);
}

test.describe("plugin launcher — navigation path", () => {
  test("Actions button navigates to /automations", async ({ page }) => {
    await clickLauncherAndAssertPath(page, "automations", "/automations");
  });

  test("Wiki button navigates to /wiki", async ({ page }) => {
    await clickLauncherAndAssertPath(page, "wiki", "/wiki");
  });

  // Skills and Roles are no longer launcher buttons — they moved into
  // the Settings modal (Management group).

  test("Files button navigates to /files with no path param", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);

    await page.getByTestId("plugin-launcher-files").click();

    await page.waitForURL(/\/files(?:$|\?)/);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/files");
    expect(url.searchParams.get("path")).toBeNull();
  });

  // The Chat button is a dedicated control (not a TARGETS entry): it
  // resumes-or-creates a chat rather than pushing a fixed route, and it
  // stays visible on every page so the session-history chrome can be
  // chat-only.
  test("Chat button is always visible and returns to /chat from another page", async ({ page }) => {
    await page.goto("/wiki");
    await page.waitForURL(/\/wiki/);

    // Chat-only chrome (history side panel + role selector) is gone here.
    await expect(page.getByTestId("session-history-side-panel")).toBeHidden();
    await expect(page.getByTestId("role-selector-btn")).toBeHidden();

    // The Chat button persists and lands back on /chat, where the role
    // selector reappears.
    await expect(page.getByTestId("plugin-launcher-chat")).toBeVisible();
    await page.getByTestId("plugin-launcher-chat").click();
    await page.waitForURL(/\/chat\//);
    await expect(page.getByTestId("role-selector-btn")).toBeVisible();
  });
});
