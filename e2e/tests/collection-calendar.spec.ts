// E2E coverage for the collection calendar view (feat-collections-calendar-view).
// Any collection with a `date` field gains a table↔calendar toggle; the
// calendar lays each record on its day cell, lists undated records in a
// "No date" tray, and opens the shared detail panel on a chip click. A
// collection with no date field shows no toggle at all.
//
// Records are placed on the 15th of the *current* month so they land on
// the calendar's default-visible grid without mocking the clock.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const today = new Date();
const MID = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;

const EVENTS = {
  collection: {
    slug: "events",
    title: "Events",
    icon: "event",
    source: "user",
    schema: {
      title: "Events",
      icon: "event",
      dataPath: "data/events/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        on: { type: "date", label: "Date" },
      },
      displayField: "name",
      calendarField: "on",
    },
  },
  items: [
    { id: "launch", name: "Launch party", on: MID },
    { id: "someday", name: "Someday item", on: "" },
  ],
};

// A date-bearing collection with ZERO records — the toggle must still
// appear so the empty-day create affordance is reachable.
const EVENTS_EMPTY = {
  collection: { ...EVENTS.collection, slug: "events-empty", schema: { ...EVENTS.collection.schema, dataPath: "data/events-empty/items" } },
  items: [],
};

// A collection with NO date field — must never show the calendar toggle.
const CONTACTS = {
  collection: {
    slug: "contacts",
    title: "Contacts",
    icon: "people",
    source: "user",
    schema: {
      title: "Contacts",
      icon: "people",
      dataPath: "data/contacts/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
      },
    },
  },
  items: [{ id: "jane", name: "Jane Doe" }],
};

async function mockCollections(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/events",
    (route) => route.fulfill({ json: EVENTS }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/events-empty",
    (route) => route.fulfill({ json: EVENTS_EMPTY }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/contacts",
    (route) => route.fulfill({ json: CONTACTS }),
  );
}

test.describe("collection calendar view", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await mockCollections(page);
  });

  test("shows the table↔calendar toggle for a date-bearing collection", async ({ page }) => {
    await page.goto("/collections/events");
    await expect(page.getByTestId("collection-view-toggle-table")).toBeVisible();
    await expect(page.getByTestId("collection-view-toggle-calendar")).toBeVisible();
  });

  test("renders a record on its day cell and opens detail on chip click", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // Grid + the record's chip on the 15th.
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    await expect(page.getByTestId(`collection-calendar-day-${MID}`)).toBeVisible();
    const chip = page.getByTestId("collection-calendar-chip-launch");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("Launch party");
    // Clicking the chip opens the shared record panel below the grid.
    await chip.click();
    await expect(page.getByTestId("collections-calendar-panel")).toBeVisible();
    await expect(page.getByTestId("collections-detail")).toBeVisible();
    await expect(page.getByTestId("collections-detail-title")).toHaveText("launch");
  });

  test("lists undated records in the No date tray", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    await expect(page.getByTestId("collection-calendar-no-date")).toBeVisible();
    await expect(page.getByTestId("collection-calendar-undated-someday")).toBeVisible();
    // The undated record has no day-cell chip.
    await expect(page.getByTestId("collection-calendar-chip-someday")).toHaveCount(0);
  });

  test("clicking an empty day cell opens the create form with the date prefilled", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // The 20th has no record — clicking it starts a create prefilled to that day.
    const empty = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-20`;
    await page.getByTestId(`collection-calendar-day-${empty}`).click();
    await expect(page.getByTestId("collections-create")).toBeVisible();
    await expect(page.getByTestId("collections-input-on")).toHaveValue(empty);
  });

  test("only empty days are create targets (populated days are not)", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // The 15th has a record → not a create button (clicking must not duplicate-create).
    await expect(page.getByTestId(`collection-calendar-day-${MID}`)).not.toHaveAttribute("role", "button");
    // An empty day is a keyboard-operable create button.
    const empty = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-20`;
    const emptyCell = page.getByTestId(`collection-calendar-day-${empty}`);
    await expect(emptyCell).toHaveAttribute("role", "button");
    await expect(emptyCell).toHaveAttribute("tabindex", "0");
  });

  test("shows the toggle and a working calendar for an empty date-bearing collection", async ({ page }) => {
    await page.goto("/collections/events-empty");
    // Toggle is reachable even with zero records…
    await expect(page.getByTestId("collection-view-toggle-calendar")).toBeVisible();
    await page.getByTestId("collection-view-toggle-calendar").click();
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    // …and the empty-day create affordance works to bootstrap the first record.
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-10`;
    await page.getByTestId(`collection-calendar-day-${day}`).click();
    await expect(page.getByTestId("collections-create")).toBeVisible();
    await expect(page.getByTestId("collections-input-on")).toHaveValue(day);
  });

  test("shows no calendar toggle for a date-less collection", async ({ page }) => {
    await page.goto("/collections/contacts");
    await expect(page.getByTestId("collections-row-jane")).toBeVisible();
    await expect(page.getByTestId("collection-view-toggle-calendar")).toHaveCount(0);
  });

  // The standalone route persists the last-used view mode per collection in
  // localStorage, so reopening restores the prior view instead of the table.
  test("restores the last-used view mode after a reload", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    await expect(page.getByTestId("collection-calendar")).toBeVisible();

    await page.reload();

    // Reopens on the calendar, not the default table.
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    await expect(page.getByTestId("collection-calendar-chip-launch")).toBeVisible();
  });
});
