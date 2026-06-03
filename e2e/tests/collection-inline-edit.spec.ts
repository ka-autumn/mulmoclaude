// E2E coverage for inline table-cell editing in CollectionView: a
// `boolean` column renders a checkbox and an `enum` column a dropdown,
// both writing the changed value straight to the record via PUT (no
// open→edit→save). Pins three things a refactor must not regress:
//   1. toggling the cell fires the PUT with the merged record,
//   2. the cell control uses `@click.stop` so it does NOT open the
//      row's detail panel, and
//   3. a failed PUT rolls the cell back and surfaces an error banner.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const ROUTINE = {
  collection: {
    slug: "daily-routine",
    title: "Daily Routine",
    icon: "self_improvement",
    source: "user",
    schema: {
      title: "Daily Routine",
      icon: "self_improvement",
      dataPath: "data/daily-routine/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        yoga: { type: "boolean", label: "Yoga" },
        status: { type: "enum", label: "Status", values: ["todo", "doing", "done"] },
      },
      completionField: "yoga",
      completionDoneValues: ["true"],
    },
  },
  items: [
    { id: "jun-03", yoga: false, status: "todo" },
    { id: "jun-04", yoga: true, status: "done" },
    // `status` absent → this cell was empty at load, so its dropdown
    // keeps the empty placeholder option (the others don't).
    { id: "jun-05", yoga: false },
  ],
};

async function mockCollection(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/daily-routine",
    (route) => route.fulfill({ json: ROUTINE }),
  );
}

/** Mock the item PUT endpoint. `ok` toggles success vs a 500 so the
 *  rollback path can be exercised. Awaits route registration and returns
 *  `{ body }`, where `body` resolves with the first PUT's parsed request
 *  body — for assertion. */
async function mockItemPut(page: Page, ok: boolean): Promise<{ body: Promise<Record<string, unknown>> }> {
  let resolveBody: (body: Record<string, unknown>) => void;
  const body = new Promise<Record<string, unknown>>((resolve) => {
    resolveBody = resolve;
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/collections/daily-routine/items/"),
    (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const parsed = JSON.parse(route.request().postData() ?? "{}");
      resolveBody(parsed);
      const itemId = decodeURIComponent(route.request().url().split("/items/").pop() ?? "");
      if (!ok) return route.fulfill({ status: 500, json: { error: "boom" } });
      return route.fulfill({ json: { itemId, item: parsed } });
    },
  );
  return { body };
}

test.describe("collection inline cell editing", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockCollection(page);
  });

  test("toggling the boolean checkbox PUTs the merged record", async ({ page }) => {
    const { body } = await mockItemPut(page, true);
    await page.goto("/collections/daily-routine");
    const checkbox = page.getByTestId("collections-inline-bool-yoga-jun-03");
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    const put = await body;
    expect(put.yoga).toBe(true);
    expect(put.id).toBe("jun-03");
    await expect(checkbox).toBeChecked();
  });

  test("changing the enum dropdown PUTs the new value", async ({ page }) => {
    const { body } = await mockItemPut(page, true);
    await page.goto("/collections/daily-routine");
    const select = page.getByTestId("collections-inline-enum-status-jun-03");
    await select.selectOption("doing");
    const put = await body;
    expect(put.status).toBe("doing");
  });

  test("the empty placeholder option appears only for cells empty at load", async ({ page }) => {
    await mockItemPut(page, true);
    await page.goto("/collections/daily-routine");
    // jun-03's `status` had a value → no empty option (can't blank inline).
    const filled = page.getByTestId("collections-inline-enum-status-jun-03");
    await expect(filled.locator('option[value=""]')).toHaveCount(0);
    // jun-05's `status` was absent at load → keeps the empty placeholder.
    const empty = page.getByTestId("collections-inline-enum-status-jun-05");
    await expect(empty.locator('option[value=""]')).toHaveCount(1);
  });

  test("inline controls do NOT open the row's detail panel", async ({ page }) => {
    await mockItemPut(page, true);
    await page.goto("/collections/daily-routine");
    await page.getByTestId("collections-inline-bool-yoga-jun-03").check();
    // If `@click.stop` were missing, the row click would open the detail.
    await expect(page.getByTestId("collections-detail")).toHaveCount(0);
  });

  test("a failed PUT rolls the cell back and shows the error banner", async ({ page }) => {
    await mockItemPut(page, false);
    await page.goto("/collections/daily-routine");
    const checkbox = page.getByTestId("collections-inline-bool-yoga-jun-03");
    await checkbox.check();
    await expect(page.getByTestId("collections-inline-error")).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  });
});
