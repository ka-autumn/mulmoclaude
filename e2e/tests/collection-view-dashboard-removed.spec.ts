import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// The built-in "dashboard" view was removed (anyone who wants it authors a
// custom view). These specs lock in that (a) an enum-bearing collection — the
// old dashboard trigger — no longer offers the dashboard toggle, only
// table/kanban, and (b) a stale `dashboard` value left in the per-collection
// view-mode localStorage store collapses to the table rather than wedging.

const TASKS_DETAIL = {
  collection: {
    slug: "tasks",
    title: "Tasks",
    icon: "checklist",
    source: "user",
    schema: {
      title: "Tasks",
      icon: "checklist",
      dataPath: "data/tasks/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true },
        title: { type: "string", label: "Title", required: true },
        // An enum field used to enable BOTH kanban and the (now-removed)
        // dashboard — kanban must survive, dashboard must be gone.
        status: { type: "enum", label: "Status", values: ["todo", "doing", "done"] },
      },
    },
  },
  items: [
    { id: "a", title: "Write spec", status: "todo" },
    { id: "b", title: "Ship it", status: "doing" },
  ],
};

async function setup(page: Page) {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/collections/tasks",
    (route) => route.fulfill({ json: TASKS_DETAIL }),
  );
}

test.describe("collection dashboard view removed", () => {
  test("an enum-bearing collection offers table + kanban but no dashboard toggle", async ({ page }) => {
    await setup(page);
    await page.goto("/collections/tasks");

    await expect(page.getByTestId("collection-view-toggle-table")).toBeVisible();
    // Kanban (the other enum-driven view) stays.
    await expect(page.getByTestId("collection-view-toggle-kanban")).toBeVisible();
    // The dashboard toggle is gone entirely.
    await expect(page.getByTestId("collection-view-toggle-dashboard")).toHaveCount(0);
  });

  test("a persisted `dashboard` view mode falls back to the table", async ({ page }) => {
    // Seed the per-collection view-mode store with the retired mode BEFORE the
    // app boots, so the page restores it on load.
    await page.addInitScript(() => {
      localStorage.setItem("collection_view_modes", JSON.stringify({ tasks: "dashboard" }));
    });
    await setup(page);
    await page.goto("/collections/tasks");

    // Table is the active view (its toggle is pressed); the board never shows.
    await expect(page.getByTestId("collection-view-toggle-table")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("collection-view-toggle-kanban")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("collection-view-toggle-dashboard")).toHaveCount(0);
  });
});
