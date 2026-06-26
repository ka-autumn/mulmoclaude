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

// Feeds are collections too, so they support custom views: the toggle renders,
// the header "+" add button appears (the old `!isFeed` exclusion is gone), and
// the config gear opens the manage/delete modal — all the same as a skill-backed
// collection. The view HTML just lives under feeds/<slug>/ (the seed prompt and
// the delete endpoint are both source-aware).
const FEED_CARDS_VIEW = { id: "cards", label: "Cards", file: "views/cards.html", capabilities: ["read"] };

const FEED_DETAIL = {
  collection: {
    slug: "news",
    title: "News",
    icon: "rss_feed",
    source: "feed",
    schema: {
      title: "News",
      icon: "rss_feed",
      dataPath: "data/feeds/news",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true },
        headline: { type: "string", label: "Headline" },
      },
      // The `ingest` block is what marks this collection as a feed.
      ingest: { kind: "rss", url: "https://example.com/feed.xml", schedule: "hourly", map: { id: "guid", headline: "title" } },
      views: [FEED_CARDS_VIEW],
    },
  },
  items: [{ id: "a", headline: "Hello world" }],
};

async function setupFeed(page: Page) {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/collections/news",
    (route) => route.fulfill({ json: FEED_DETAIL }),
  );
}

test.describe("feed custom views", () => {
  test("a feed offers the custom-view toggle, the + add button, and the config gear", async ({ page }) => {
    await setupFeed(page);
    await page.goto("/collections/news");

    // The custom view's toggle renders for a feed.
    await expect(page.getByTestId("collection-view-custom-cards")).toBeVisible();
    // The "+" add-view button is now offered for feeds too.
    await expect(page.getByTestId("collection-view-add")).toBeVisible();
    // The config gear shows (a feed's views are deletable).
    await expect(page.getByTestId("collection-config-open")).toBeVisible();

    // The gear opens the config modal with the feed's view listed + deletable.
    await page.getByTestId("collection-config-open").click();
    await expect(page.getByTestId("collection-config-modal")).toBeVisible();
    await expect(page.getByTestId("collection-view-delete-cards")).toBeVisible();
  });
});
