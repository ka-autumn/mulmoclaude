import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Feeds are collections too, so they support custom views: the toggle renders,
// the header "+" add button appears (the old `!isFeed` exclusion is gone), and
// the config gear opens the manage/delete modal — all the same as a skill-backed
// collection. The view HTML just lives under feeds/<slug>/ (the seed prompt and
// the delete endpoint are both source-aware).

const CARDS_VIEW = { id: "cards", label: "Cards", file: "views/cards.html", capabilities: ["read"] };

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
      views: [CARDS_VIEW],
    },
  },
  items: [{ id: "a", headline: "Hello world" }],
};

async function setup(page: Page) {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/collections/news",
    (route) => route.fulfill({ json: FEED_DETAIL }),
  );
}

test.describe("feed custom views", () => {
  test("a feed offers the custom-view toggle, the + add button, and the config gear", async ({ page }) => {
    await setup(page);
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
