// E2E coverage for the `image` collection field type
// (feat/collection-image-field). A field typed `image` holds a
// workspace-relative path; the host renders it as an <img> — a
// thumbnail in the list row and a larger image in the detail / open
// view — via resolveImageSrc → the auth-exempt /api/files/raw route. A
// record without the field falls back to the em-dash placeholder.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// 1x1 transparent PNG so the mocked /api/files/raw returns real image
// bytes — the <img> gets natural dimensions (toBeVisible passes) and
// the catch-all 501 noise is avoided.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const CARD_PATH = "data/attachments/2026/05/3c7bdd20ec494f8f.jpg";
// resolveImageSrc(CARD_PATH) → `/api/files/raw?path=<encoded>`: the
// path is neither a data: URI nor under artifacts/images/, so it routes
// through the workspace file server. No cache-bust token (the
// non-Fresh variant), so this is an exact match.
const EXPECTED_SRC = `/api/files/raw?path=${encodeURIComponent(CARD_PATH)}`;

const CONTACTS_DETAIL = {
  collection: {
    slug: "contacts",
    title: "Contacts",
    icon: "contact_page",
    source: "user",
    schema: {
      title: "Contacts",
      icon: "contact_page",
      dataPath: "data/contacts/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        company: { type: "string", label: "Company" },
        businessCard: { type: "image", label: "Business Card" },
      },
    },
  },
  items: [
    { id: "michel-zgarka", name: "Michel Zgarka", company: "Sonic Origin", businessCard: CARD_PATH },
    { id: "jane-doe", name: "Jane Doe", company: "Acme" },
  ],
};

async function mockContacts(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/files/raw",
    (route) => route.fulfill({ contentType: "image/png", body: TINY_PNG }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/contacts",
    (route) => route.fulfill({ json: CONTACTS_DETAIL }),
  );
}

test.describe("collection image field", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockContacts(page);
  });

  test("list table omits the image column (no per-row thumbnail)", async ({ page }) => {
    await page.goto("/collections/contacts");
    // The collection still renders...
    await expect(page.getByTestId("collections-row-michel-zgarka")).toBeVisible();
    // ...but the image field is neither a column header nor a per-row cell
    // (excluded from listColumnFields — a per-row fetch is too expensive).
    await expect(page.locator("thead th", { hasText: "Business Card" })).toHaveCount(0);
    await expect(page.getByTestId("collections-cell-image-businessCard")).toHaveCount(0);
  });

  test("detail view renders the image-field value as a larger image", async ({ page }) => {
    await page.goto("/collections/contacts");
    await page.getByTestId("collections-row-michel-zgarka").click();
    await expect(page.getByTestId("collections-detail")).toBeVisible();
    const img = page.getByTestId("collections-detail-image-businessCard");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", EXPECTED_SRC);
  });

  test("a record without the image falls back to the em-dash placeholder", async ({ page }) => {
    await page.goto("/collections/contacts");
    await page.getByTestId("collections-row-jane-doe").click();
    await expect(page.getByTestId("collections-detail")).toBeVisible();
    await expect(page.getByTestId("collections-detail-image-businessCard")).toHaveCount(0);
    await expect(page.getByTestId("collections-detail-value-businessCard")).toContainText("—");
  });
});
