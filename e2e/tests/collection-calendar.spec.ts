// E2E coverage for the collection calendar view (feat-collections-calendar-view).
// Any collection with a `date` field gains a table↔calendar toggle; the
// calendar lays each record on its day cell and lists undated records in a
// "No date" tray. A collection with no date field shows no toggle at all.
// Clicking any day cell — or any record chip — opens the day (time-allocation)
// view, where a `calendarTimeField` time string renders records as proportional
// blocks / single lines / all-day chips. Selecting a record shows its detail in
// the day view's right pane and mirrors the selection into `?selected=`.
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

// A date + free-form time collection: exercises the day view's three
// renderings via `calendarTimeField`. All three land on the 15th.
const AGENDA = {
  collection: {
    slug: "agenda",
    title: "Agenda",
    icon: "event",
    source: "user",
    schema: {
      title: "Agenda",
      icon: "event",
      dataPath: "data/agenda/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        on: { type: "date", label: "Date" },
        time: { type: "string", label: "Time" },
        location: { type: "string", label: "Location" },
      },
      displayField: "name",
      calendarField: "on",
      calendarTimeField: "time",
    },
  },
  items: [
    { id: "block", name: "Workshop", on: MID, time: "14:00-17:00", location: "Room 5" }, // range → block
    { id: "line", name: "Standup", on: MID, time: "09:30", location: "Hall" }, // start only → single line
    { id: "allday", name: "Conference", on: MID, time: "終日", location: "Expo" }, // no clock → all-day strip
  ],
};

// A collection whose calendar anchor is a `datetime` field — the clock lives in
// the field value, and day-view create must prefill a valid datetime-local.
const DTEVENTS = {
  collection: {
    slug: "dtevents",
    title: "Meetings",
    icon: "event",
    source: "user",
    schema: {
      title: "Meetings",
      icon: "event",
      dataPath: "data/dtevents/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name", required: true },
        at: { type: "datetime", label: "At" },
      },
      displayField: "name",
      calendarField: "at",
    },
  },
  items: [{ id: "kickoff", name: "Kickoff", at: `${MID}T14:30` }],
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
    (url) => url.pathname === "/api/collections/agenda",
    (route) => route.fulfill({ json: AGENDA }),
  );
  await page.route(
    (url) => url.pathname === "/api/collections/dtevents",
    (route) => route.fulfill({ json: DTEVENTS }),
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

  test("renders a record on its day cell and opens detail in the day view on chip click", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // Grid + the record's chip on the 15th.
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    await expect(page.getByTestId(`collection-calendar-day-${MID}`)).toBeVisible();
    const chip = page.getByTestId("collection-calendar-chip-launch");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("Launch party");
    // Clicking the chip opens the day view with the record in its right pane,
    // and mirrors the selection into the URL so the link is shareable.
    await chip.click();
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    await expect(page.getByTestId("collection-day-view-detail")).toBeVisible();
    await expect(page.getByTestId("collections-detail")).toBeVisible();
    await expect(page.getByTestId("collections-detail-title")).toHaveText("launch");
    await expect(page).toHaveURL(/[?&]selected=launch\b/);
  });

  test("a ?selected= deep link opens the calendar day view focused on the record", async ({ page }) => {
    // A pasted link forces the calendar view and opens the day popup on the
    // record's day with its detail already showing.
    await page.goto("/collections/agenda?selected=block");
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    await expect(page.getByTestId("collection-day-view-detail")).toBeVisible();
    await expect(page.getByTestId("collections-detail-title")).toHaveText("block");
  });

  test("navigating back to the collection without ?selected= tears down the day popup", async ({ page }) => {
    await page.goto("/collections/agenda?selected=block");
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    // Reopening the collection without a selection must not leave a stale popup.
    await page.goto("/collections/agenda");
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    await expect(page.getByTestId("collection-day-view")).toHaveCount(0);
  });

  test("closing the day popup detail via its X clears the selection and popup", async ({ page }) => {
    await page.goto("/collections/agenda?selected=block");
    await expect(page.getByTestId("collection-day-view-detail")).toBeVisible();
    // The detail pane's close button tears down the whole popup and the URL.
    await page.getByTestId("collections-detail-close").click();
    await expect(page.getByTestId("collection-day-view")).toHaveCount(0);
    await expect(page).not.toHaveURL(/selected=/);
  });

  test("lists undated records in the No date tray", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    await expect(page.getByTestId("collection-calendar-no-date")).toBeVisible();
    await expect(page.getByTestId("collection-calendar-undated-someday")).toBeVisible();
    // The undated record has no day-cell chip.
    await expect(page.getByTestId("collection-calendar-chip-someday")).toHaveCount(0);
  });

  test("selecting an undated record shows the shared record modal, not the day popup", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // An undated record has no day to place on a timeline → its detail opens in
    // the shared record modal and no day popup appears.
    await page.getByTestId("collection-calendar-undated-someday").click();
    await expect(page.getByTestId("collection-day-view")).toHaveCount(0);
    await expect(page.getByTestId("collections-record-modal")).toBeVisible();
    await expect(page.getByTestId("collections-detail-title")).toHaveText("someday");
  });

  test("clicking a day opens the day view; its + button creates with the date prefilled", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // Any day cell is a keyboard-operable button that opens the day view.
    const empty = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-20`;
    const cell = page.getByTestId(`collection-calendar-day-${empty}`);
    await expect(cell).toHaveAttribute("role", "button");
    await expect(cell).toHaveAttribute("tabindex", "0");
    await cell.click();
    // The day view opens; its + button starts a create prefilled to that day.
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    await page.getByTestId("collection-day-view-create").click();
    // The create form renders INSIDE the day view's right pane — the popup stays
    // open and the form must NOT fall through to the panel below the grid.
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    await expect(page.getByTestId("collection-day-view-detail")).toBeVisible();
    await expect(page.getByTestId("collections-create")).toBeVisible();
    await expect(page.getByTestId("collections-record-modal")).toHaveCount(0);
    await expect(page.getByTestId("collections-input-on")).toHaveValue(empty);
  });

  test("closing the day popup mid-create does not re-open the draft in the shared modal", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    const empty = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-20`;
    await page.getByTestId(`collection-calendar-day-${empty}`).click();
    await page.getByTestId("collection-day-view-create").click();
    await expect(page.getByTestId("collections-create")).toBeVisible();

    // Closing the whole day popup must discard the in-progress create — it must
    // NOT fall through and re-appear in the centred record modal (Codex P2 #1656).
    await page.getByTestId("collection-day-view-close").click();
    await expect(page.getByTestId("collection-day-view")).toHaveCount(0);
    await expect(page.getByTestId("collections-record-modal")).toHaveCount(0);
    await expect(page.getByTestId("collections-create")).toHaveCount(0);
  });

  test("calendar view hides the top Add button (create happens via the day view +)", async ({ page }) => {
    await page.goto("/collections/events");
    // Present in the table view…
    await expect(page.getByTestId("collections-add-item")).toBeVisible();
    await page.getByTestId("collection-view-toggle-calendar").click();
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    // …and gone in the calendar, where the day view's + is the only create entry.
    await expect(page.getByTestId("collections-add-item")).toHaveCount(0);
  });

  test("clicking a day cell opens the day view; its chips select into the detail pane", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // Activating the day cell (a keyboard-operable button) opens the day view;
    // the clock-less record sits in the all-day strip (events has no time field).
    const cell = page.getByTestId(`collection-calendar-day-${MID}`);
    await cell.focus();
    await cell.press("Enter");
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    const chip = page.getByTestId("collection-day-view-allday-launch");
    await expect(chip).toBeVisible();
    // Selecting it shows the detail in the right pane WITHOUT closing the popup.
    await chip.click();
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    await expect(page.getByTestId("collection-day-view-detail")).toBeVisible();
    await expect(page.getByTestId("collections-detail-title")).toHaveText("launch");
  });

  test("day view renders blocks, single lines, and the all-day strip from a time field", async ({ page }) => {
    await page.goto("/collections/agenda");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // Activate the day cell (keyboard) to open the day view, clear of the chips.
    const cell = page.getByTestId(`collection-calendar-day-${MID}`);
    await cell.focus();
    await cell.press("Enter");
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    // "14:00-17:00" → a proportional block; "09:30" → a single line (both chips).
    const blockChip = page.getByTestId("collection-day-view-chip-block");
    await expect(blockChip).toBeVisible();
    await expect(page.getByTestId("collection-day-view-chip-line")).toBeVisible();
    // The chip shows a non-date/time field under the title, not the time range.
    await expect(blockChip).toContainText("Workshop");
    await expect(blockChip).toContainText("Room 5");
    await expect(blockChip).not.toContainText("14:00");
    // "終日" has no parseable clock → the bottom all-day strip.
    await expect(page.getByTestId("collection-day-view-allday-allday")).toBeVisible();
    // Selecting an entry opens its detail in the right pane; the popup stays open.
    await page.getByTestId("collection-day-view-chip-block").click();
    await expect(page.getByTestId("collection-day-view")).toBeVisible();
    await expect(page.getByTestId("collection-day-view-detail")).toBeVisible();
    await expect(page.getByTestId("collections-detail-title")).toHaveText("block");
  });

  test("day-view create on a datetime-anchored collection prefills a valid datetime", async ({ page }) => {
    await page.goto("/collections/dtevents");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // A datetime anchor still drives the day view (its clock renders the block)…
    const cell = page.getByTestId(`collection-calendar-day-${MID}`);
    await cell.focus();
    await cell.press("Enter");
    await expect(page.getByTestId("collection-day-view-chip-kickoff")).toBeVisible();
    await page.getByTestId("collection-day-view-create").click();
    // …and create seeds the datetime-local input with midnight (not a bare date).
    await expect(page.getByTestId("collections-create")).toBeVisible();
    await expect(page.getByTestId("collections-input-at")).toHaveValue(`${MID}T00:00`);
  });

  test("keyboard-activating a chip selects it into the day view's detail pane", async ({ page }) => {
    await page.goto("/collections/events");
    await page.getByTestId("collection-view-toggle-calendar").click();
    // Enter on a focused chip selects the record and opens the day view with its
    // detail in the right pane (the `.self` guard keeps the keydown from also
    // firing the cell's own open handler).
    const chip = page.getByTestId("collection-calendar-chip-launch");
    await chip.focus();
    await chip.press("Enter");
    await expect(page.getByTestId("collection-day-view-detail")).toBeVisible();
    await expect(page.getByTestId("collections-detail-title")).toHaveText("launch");
  });

  test("shows the toggle and a working calendar for an empty date-bearing collection", async ({ page }) => {
    await page.goto("/collections/events-empty");
    // Toggle is reachable even with zero records…
    await expect(page.getByTestId("collection-view-toggle-calendar")).toBeVisible();
    await page.getByTestId("collection-view-toggle-calendar").click();
    await expect(page.getByTestId("collection-calendar")).toBeVisible();
    // …and the day view's create affordance bootstraps the first record.
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-10`;
    await page.getByTestId(`collection-calendar-day-${day}`).click();
    await page.getByTestId("collection-day-view-create").click();
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
