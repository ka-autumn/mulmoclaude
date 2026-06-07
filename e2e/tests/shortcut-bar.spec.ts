// E2E for the launcher shortcut zone (#feat-shortcut-bar): pinning a
// collection from its index card surfaces a one-click shortcut pill in
// the top chrome; clicking it navigates to /collections/:slug; unpinning
// removes it. The shortcuts API is mocked statefully in fixtures/api.ts.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const COLLECTIONS_LIST = {
  collections: [{ slug: "reading-list", title: "Reading List", icon: "bookmark", source: "user" }],
};

const READING_LIST_DETAIL = {
  collection: {
    slug: "reading-list",
    title: "Reading List",
    icon: "bookmark",
    source: "user",
    schema: {
      title: "Reading List",
      icon: "bookmark",
      dataPath: "data/reading-list/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        notes: { type: "string", label: "Notes" },
      },
    },
  },
  items: [{ id: "first", notes: "an existing row" }],
};

async function mockCollections(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections",
    (route) => route.fulfill({ json: COLLECTIONS_LIST }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/reading-list",
    (route) => route.fulfill({ json: READING_LIST_DETAIL }),
  );
}

test.describe("launcher shortcut bar", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockCollections(page);
  });

  test("pin from index card → shortcut appears → navigates → unpin removes it", async ({ page }) => {
    await page.goto("/collections");

    const card = page.getByTestId("collections-index-card-reading-list");
    await expect(card).toBeVisible();

    // No shortcut pill before pinning.
    const pill = page.getByTestId("plugin-launcher-shortcut-collection-reading-list");
    await expect(pill).toHaveCount(0);

    // Pinning toggles the star without opening the collection.
    await page.getByTestId("pin-toggle-collection-reading-list").click();
    await expect(page).toHaveURL(/\/collections$/);

    // Shortcut pill now renders in the launcher.
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("Reading List");

    // Clicking the pill navigates to the collection's route.
    await pill.click();
    await page.waitForURL(/\/collections\/reading-list/);
    expect(new URL(page.url()).pathname).toBe("/collections/reading-list");

    // The header toggle reflects the pinned state; unpinning removes the pill.
    await page.getByTestId("pin-toggle-collection-reading-list").first().click();
    await expect(pill).toHaveCount(0);
  });
});
