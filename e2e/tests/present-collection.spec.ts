import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Throwaway reproduction spec for the presentCollection render crash.
// Captures the FIRST thrown exception (page.on("pageerror")) which the
// browser console only showed as downstream null-component fallout.

const SESSION_PATH = "/chat/watchlist-session";

const WATCHLIST_DETAIL = {
  collection: {
    slug: "watchlist",
    title: "Watchlist",
    icon: "movie",
    source: "user",
    schema: {
      title: "Watchlist",
      icon: "movie",
      dataPath: "data/watchlist/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true },
        title: { type: "string", label: "Title", required: true },
        type: { type: "string", label: "Type" },
        mainActor: { type: "string", label: "Main Actor" },
        genre: { type: "string", label: "Genre" },
        platform: { type: "string", label: "Platform" },
        synopsis: { type: "markdown", label: "Synopsis" },
        watched: { type: "boolean", label: "Watched" },
      },
    },
  },
  items: [
    { id: "avatar", title: "アバター", type: "映画", mainActor: "Sam Worthington", genre: "SF", platform: "Disney+", synopsis: "...", watched: false },
    { id: "jack-ryan", title: "Jack Ryan", type: "TV", genre: "Thriller", platform: "Prime", watched: true },
  ],
};

async function setup(page: Page) {
  await mockAllApis(page, {
    sessions: [{ id: "watchlist-session", title: "Watchlist", roleId: "general", startedAt: "2026-05-29T10:00:00Z", updatedAt: "2026-05-29T10:05:00Z" }],
  });

  await page.route(
    (url) => url.pathname === "/api/collections/watchlist",
    (route) => route.fulfill({ json: WATCHLIST_DETAIL }),
  );

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: "watchlist-session" },
          { type: "text", source: "user", message: "show me the watchlist" },
          {
            type: "tool_result",
            source: "tool",
            result: {
              uuid: "pc-result-1",
              toolName: "presentCollection",
              title: "Watchlist",
              message: "Presented collection watchlist / avatar",
              data: { collectionSlug: "watchlist", itemId: "avatar" },
            },
          },
        ],
      }),
  );
}

// Regression: the presentCollection card mounts the full CollectionView
// via `wrapWithScope`, whose setup calls `pluginEndpoints("presentCollection")`.
// That scope MUST be registered in the host endpoint registry
// (`src/main.ts`); otherwise setup throws, the component subtree is left
// null, and Vue's patch crashes with `emitsOptions`/`subTree` of null
// during the next <App> update. This asserts the card renders cleanly,
// the per-item detail modal opens (itemId in the tool result), and no
// uncaught page error fires.
test("presentCollection card renders the collection without crashing", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.goto(SESSION_PATH);

  await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });
  // itemId "avatar" was passed → the read-only detail panel opens inline on mount.
  await expect(page.getByTestId("collections-detail")).toBeVisible();
  await expect(page.getByTestId("collections-detail-title")).toHaveText("avatar");

  // The panel must fit the View width, never the (possibly wider) table
  // width — otherwise a wide collection clips the right of the panel.
  const cardBox = await page.getByTestId("present-collection").boundingBox();
  const detailBox = await page.getByTestId("collections-detail").boundingBox();
  expect(cardBox && detailBox && detailBox.width <= cardBox.width + 1).toBeTruthy();

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

test("Edit on an open record swaps the inline panel to the edit form in place", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.goto(SESSION_PATH);

  await expect(page.getByTestId("collections-detail")).toBeVisible({ timeout: 10_000 });
  // Edit flips the SAME inline expansion to the edit form (no modal).
  await page.getByTestId("collections-detail-edit").click();
  await expect(page.getByTestId("collections-edit")).toBeVisible();
  await expect(page.getByTestId("collections-detail")).toBeHidden();
  await expect(page.getByTestId("collections-input-title")).toHaveValue("アバター");
  // No fixed-overlay modal is used anymore.
  await expect(page.locator(".fixed.inset-0.z-30")).toHaveCount(0);

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

test("Add opens the create form as a panel pinned at the top of the list", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.goto(SESSION_PATH);
  await expect(page.getByTestId("present-collection")).toBeVisible({ timeout: 10_000 });

  await page.getByTestId("collections-add-item").click();
  const createForm = page.getByTestId("collections-create");
  await expect(createForm).toBeVisible();
  // The create panel sits above the first data row (synthetic top row).
  const createBox = await createForm.boundingBox();
  const firstRow = await page.getByTestId("collections-row-avatar").boundingBox();
  expect(createBox && firstRow && createBox.y < firstRow.y).toBeTruthy();

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

test("saving an edit returns to the record's detail (does not close) in the embedded card", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(`${err.message}\n${err.stack ?? ""}`));

  await setup(page);
  await page.route(
    (url) => url.pathname === "/api/collections/watchlist/items/avatar",
    (route) => (route.request().method() === "PUT" ? route.fulfill({ json: { itemId: "avatar", item: WATCHLIST_DETAIL.items[0] } }) : route.fallback()),
  );
  await page.goto(SESSION_PATH);

  await expect(page.getByTestId("collections-detail")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("collections-detail-edit").click();
  await expect(page.getByTestId("collections-edit")).toBeVisible();
  await page.getByTestId("collections-input-title").fill("アバター (改)");
  await page.getByTestId("collections-editor-save").click();

  // Back to the read-only detail of the same record — NOT closed.
  await expect(page.getByTestId("collections-detail")).toBeVisible();
  await expect(page.getByTestId("collections-detail-title")).toHaveText("avatar");
  await expect(page.getByTestId("collections-edit")).toBeHidden();

  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});
