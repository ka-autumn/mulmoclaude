import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// The per-collection config modal (gear) manages custom views: it lists them
// and deletes them via DELETE /api/collections/:slug/views/:viewId. The header
// "+" add-view button stays put — it's the discoverable add entry point.

const GRID_VIEW = { id: "grid", label: "Grid", file: "views/grid.html", capabilities: ["read"] };
const CHART_VIEW = { id: "chart", label: "Chart", file: "views/chart.html", capabilities: ["read"] };

function detail(views: (typeof GRID_VIEW)[]) {
  return {
    collection: {
      slug: "tasks",
      title: "Tasks",
      icon: "checklist",
      source: "project",
      schema: {
        title: "Tasks",
        icon: "checklist",
        dataPath: "data/tasks/items",
        primaryKey: "id",
        fields: { id: { type: "string", label: "ID", primary: true }, title: { type: "string", label: "Title" } },
        views,
      },
    },
    items: [{ id: "a", title: "Write spec" }],
  };
}

interface Harness {
  deleteCalls: string[];
}

async function setup(page: Page): Promise<Harness> {
  const harness: Harness = { deleteCalls: [] };
  await mockAllApis(page);

  // The detail starts with both views; once `grid` is deleted, the refetch
  // returns only `chart` — exactly what the server would persist.
  await page.route(
    (url) => url.pathname === "/api/collections/tasks",
    (route) => route.fulfill({ json: harness.deleteCalls.length === 0 ? detail([GRID_VIEW, CHART_VIEW]) : detail([CHART_VIEW]) }),
  );

  await page.route(
    (url) => url.pathname === "/api/collections/tasks/views/grid",
    (route) => {
      harness.deleteCalls.push(route.request().method());
      return route.fulfill({ json: { deleted: true, viewId: "grid" } });
    },
  );

  return harness;
}

test.describe("collection view config modal", () => {
  test("lists custom views, deletes one, and keeps the header + button", async ({ page }) => {
    const harness = await setup(page);
    await page.goto("/collections/tasks");

    // Both custom-view toggles render, the header "+" stays, and the gear shows.
    await expect(page.getByTestId("collection-view-custom-grid")).toBeVisible();
    await expect(page.getByTestId("collection-view-custom-chart")).toBeVisible();
    await expect(page.getByTestId("collection-view-add")).toBeVisible();
    await expect(page.getByTestId("collection-config-open")).toBeVisible();

    // Open the config modal — both views are listed with a delete button each.
    await page.getByTestId("collection-config-open").click();
    await expect(page.getByTestId("collection-config-modal")).toBeVisible();
    await expect(page.getByTestId("collection-view-delete-grid")).toBeVisible();
    await expect(page.getByTestId("collection-view-delete-chart")).toBeVisible();

    // Delete `grid` → confirm.
    await page.getByTestId("collection-view-delete-grid").click();
    await expect(page.getByTestId("host-confirm-modal")).toBeVisible();
    await page.getByTestId("host-confirm-ok").click();

    // The DELETE fired exactly once with the right verb.
    await expect.poll(() => harness.deleteCalls).toEqual(["DELETE"]);

    // After the refetch, `grid` is gone from both the modal list and the
    // header toggle row; `chart` survives.
    await expect(page.getByTestId("collection-view-delete-grid")).toHaveCount(0);
    await expect(page.getByTestId("collection-view-delete-chart")).toBeVisible();
    await expect(page.getByTestId("collection-view-custom-grid")).toHaveCount(0);
    await expect(page.getByTestId("collection-view-custom-chart")).toBeVisible();
  });
});
