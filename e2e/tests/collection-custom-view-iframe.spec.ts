import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// The custom-view iframe's sandbox: it must keep an opaque origin (NO
// allow-same-origin, so the injected scoped token stays isolated) while
// allowing popups so a view can open an external link (a feed card → its
// article) in a normal new tab.

const CARDS_VIEW = { id: "cards", label: "Cards", file: "views/cards.html", capabilities: ["read"] };

const DETAIL = {
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
      fields: { id: { type: "string", label: "ID", primary: true } },
      ingest: { kind: "rss", url: "https://example.com/feed.xml", schedule: "hourly", map: { id: "guid" } },
      views: [CARDS_VIEW],
    },
  },
  items: [{ id: "a" }],
};

const VIEW_HTML = `<!doctype html><html><head></head><body><a id="article" href="https://example.com/a" target="_blank" rel="noopener">Read</a></body></html>`;

async function setup(page: Page) {
  await mockAllApis(page);
  await page.route(
    (url) => url.pathname === "/api/collections/news",
    (route) => route.fulfill({ json: DETAIL }),
  );
  // Mint a scoped token (exp far in the future so the re-mint timer never fires
  // during the test).
  await page.route(
    (url) => url.pathname === "/api/collections/news/view-token",
    (route) => route.fulfill({ json: { token: "tok-123", exp: Date.now() + 3_600_000, dataUrl: "/api/collections/news/view-data", capabilities: ["read"] } }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/news/view-file",
    (route) => route.fulfill({ contentType: "text/html", body: VIEW_HTML }),
  );
}

test.describe("custom view iframe sandbox", () => {
  test("allows popups for external links but keeps the origin opaque", async ({ page }) => {
    await setup(page);
    await page.goto("/collections/news");

    // Select the custom view → the sandboxed iframe mounts.
    await page.getByTestId("collection-view-custom-cards").click();
    const iframe = page.getByTestId("collection-custom-view-iframe");
    await expect(iframe).toBeVisible();

    const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-popups");
    expect(sandbox).toContain("allow-popups-to-escape-sandbox");
    // The token-isolation invariant: never same-origin.
    expect(sandbox).not.toContain("allow-same-origin");
  });
});
