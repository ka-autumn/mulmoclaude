// Backend-offline banner + retry (#1479). The banner is surfaced by
// `apiCall` setting `backendReachable = false` whenever `fetch` throws
// — i.e. any HTTP probe to a stopped server triggers it. The first
// such probe at mount time is `fetchHealth()` in App.vue's
// `onMounted`, so aborting `/api/health` is the simplest reliable
// trigger.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

test.describe("backend offline banner (#1479)", () => {
  test("shows when the backend is unreachable and hides after a successful retry", async ({ page }) => {
    await mockAllApis(page);

    // Abort every /api/* call so `backendReachable` stays false (any
    // successful apiCall flips it back to true; we need a sustained
    // failure for the banner to remain visible while we observe it).
    // Registered AFTER mockAllApis so this catch-all wins.
    let offline = true;
    await page.route("**/api/**", (route) => (offline ? route.abort("connectionrefused") : route.fallback()));

    await page.goto("/");
    // Banner appears as soon as the first apiCall throws.
    await expect(page.getByTestId("backend-offline-banner")).toBeVisible();

    // Switch the catch-all to pass-through; mockAllApis defaults now
    // answer. Click Retry → `fetchHealth` succeeds → banner hides.
    offline = false;
    await page.getByTestId("backend-offline-retry").click();
    await expect(page.getByTestId("backend-offline-banner")).toBeHidden();
  });

  test("does not show when the backend is reachable", async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
    // Wait for the app shell rather than a localized text — testids
    // survive i18n changes and aren't ambiguous against other
    // "MulmoClaude" occurrences in copy.
    await expect(page.getByTestId("app-title")).toBeVisible();
    await expect(page.getByTestId("backend-offline-banner")).toHaveCount(0);
  });
});
