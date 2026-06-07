// Hard-constraint regression for the accounting plugin: in the
// default (General) Role environment, the plugin must be invisible.
// No launcher button, no /accounting route. Reaching the plugin
// requires actively switching into the built-in Accounting role
// (or a custom role) whose `availablePlugins` include
// `manageAccounting`.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
});

test.describe("accounting plugin — isolation regression", () => {
  test("PluginLauncher does not render an accounting button", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    // The launcher buttons use plugin-launcher-{key} testids; the
    // accounting plugin is NOT supposed to register one.
    await expect(page.getByTestId("plugin-launcher-accounting")).toHaveCount(0);
  });

  test("/accounting URL does not match a route — falls through to /chat", async ({ page }) => {
    await page.goto("/accounting");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    const { pathname } = new URL(page.url());
    // Bounded segment, no nested-quantifier overlap — same rationale as router-guards.spec.ts.
    // eslint-disable-next-line security/detect-unsafe-regex -- bounded `[\w-]+`, single optional group
    expect(pathname).toMatch(/^\/chat(?:\/[\w-]+)?$/);
  });

  test("Roles settings tab surfaces no manageAccounting plugin on a fresh workspace", async ({ page }) => {
    // Smoke check that the Roles tab (Settings modal → Roles) doesn't
    // accidentally surface the accounting tool — currently passes
    // because the Roles view only renders custom roles on a fresh
    // workspace, so the assertion is more of a "the surface is clean"
    // guard than a strict role-config check.
    //
    // The strict "the General role's availablePlugins must not
    // include manageAccounting" invariant lives in
    // test/roles/test_role_schema.ts (`describe("General role
    // isolation")`). That unit test is the real regression guard;
    // this e2e check stays as a defense against a future RolesView
    // change that starts surfacing built-in role plugin lists with
    // manageAccounting on display.
    //
    // Roles moved out of the standalone /roles route into the Settings
    // modal, so we reach the surface via the gear button → Roles tab.
    await page.goto("/chat");
    await page.waitForURL(/\/chat\//);
    await page.getByTestId("settings-btn").click();
    await page.getByTestId("settings-tab-roles").click();
    await expect(page.getByTestId("roles-view-root")).toBeVisible();
    await expect(page.getByText("manageAccounting")).toHaveCount(0);
  });
});
