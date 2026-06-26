// E2E for the accounting plugin's Journal detail panel: clickable
// rows, inline edit/cancel inside the panel, close-button behavior,
// and the row/detail dedup invariant (no field appears on both the
// collapsed row and the expanded panel). Report-row click handlers
// and Balance Sheet shortcuts live in accounting-reports-row-click.spec.ts.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAccountingApi, makeAccountingToolResult, type AccountingSeedBook, type BalanceSheetMock, type ProfitLossMock } from "../fixtures/accounting";

const SESSION_ID = "accounting-journal-session";

interface SetupOpts {
  books?: readonly AccountingSeedBook[];
  envelope: { bookId: string | null; initialTab?: string };
  reports?: { balanceSheet?: BalanceSheetMock; profitLoss?: ProfitLossMock };
}

async function setupSession(page: Page, opts: SetupOpts): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Accounting Journal Session",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page, { books: opts.books, reports: opts.reports });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
          { type: "text", source: "user", message: "Open my books" },
          makeAccountingToolResult(opts.envelope),
        ],
      }),
  );
}

test.describe("Journal — clickable rows and inline detail panel", () => {
  // The fixture's withEmptyOpening already seeds an opening row, but
  // the inline detail flow only triggers on `kind: 'normal'` rows
  // (Edit/Void show only there). Each test posts one balanced normal
  // entry via the inline form before driving the detail behavior —
  // matches the existing accounting-flow shape.
  async function postNormalEntry(page: Page, opts: { debit?: string; credit?: string } = {}): Promise<void> {
    await page.getByTestId("accounting-journal-new-entry").click();
    await page.getByTestId("accounting-entry-line-account-0").selectOption("1000");
    await page.getByTestId("accounting-entry-line-debit-0").fill(opts.debit ?? "100");
    await page.getByTestId("accounting-entry-line-account-1").selectOption("4000");
    await page.getByTestId("accounting-entry-line-credit-1").fill(opts.credit ?? "100");
    await page.getByTestId("accounting-entry-submit").click();
    await expect(page.getByTestId("accounting-journal-inline-form")).toHaveCount(0);
  }

  async function findNormalRow(page: Page) {
    // The fixture's `withEmptyOpening: true` seeds an opening row
    // first; postNormalEntry then appends a normal entry, so the
    // last `accounting-journal-row-…` (excluding voided ones) closes
    // over the normal entry we just posted. The View renders entries
    // in the order the API returns them, which is append order.
    const lastRow = page.locator("[data-testid^='accounting-journal-row-']:not([data-testid*='accounting-journal-row-voided-'])").last();
    await expect(lastRow).toBeVisible();
    const rowTestId = await lastRow.getAttribute("data-testid");
    expect(rowTestId).toMatch(/^accounting-journal-row-/);
    return page.getByTestId(rowTestId as string);
  }

  test("clicking a journal row toggles the detail panel and renders Debit / Credit columns", async ({ page }) => {
    const SEED_BOOK_ID = "book-journal-detail";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Detail Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await postNormalEntry(page);

    const row = await findNormalRow(page);
    await expect(row).toHaveAttribute("role", "button");
    await expect(row).toHaveAttribute("tabindex", "0");

    // Initially collapsed.
    await expect(page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])")).toHaveCount(0);

    // Click expands. Detail panel uses a dedicated testid family.
    await row.click();
    const detailPanel = page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])");
    await expect(detailPanel).toHaveCount(1);

    // Detail header surfaces Edit / Void / Close.
    await expect(page.locator("[data-testid^='accounting-edit-']:not([data-testid*='accounting-edit-opening-'])").first()).toBeVisible();
    await expect(page.locator("[data-testid^='accounting-void-']").first()).toBeVisible();
    await expect(page.locator("[data-testid^='accounting-journal-detail-close-']").first()).toBeVisible();

    // Detail body has dedicated Debit / Credit columns — the inner
    // table headers spell them out. We rely on the (locale-stable)
    // English column headers since the test runs against the default
    // locale build; if a future test fixture switches locales, swap
    // these for `accounting-` testids on the inner table.
    await expect(detailPanel.first()).toContainText("Debit");
    await expect(detailPanel.first()).toContainText("Credit");
  });

  test("clicking the detail close button collapses the panel", async ({ page }) => {
    const SEED_BOOK_ID = "book-journal-close";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Close Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await postNormalEntry(page);

    const row = await findNormalRow(page);
    await row.click();

    const closeButton = page.locator("[data-testid^='accounting-journal-detail-close-']").first();
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    // After close, the detail panel is gone but the row stays.
    await expect(page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])")).toHaveCount(0);
    await expect(row).toBeVisible();
  });

  test("expanding a row swaps its lines cell for createdAt + Close, and the detail panel skips the duplicate metadata header", async ({ page }) => {
    // Pins the "no info shown twice" invariant after the journal row /
    // detail-panel cleanup. Specifically:
    //   1. The collapsed row's lines cell shows DR/CR amounts (e.g.
    //      "DR ¥123") — same surface the user sees today.
    //   2. Selecting that row swaps the cell's content for the
    //      createdAt timestamp and the Close (✕) button — DR/CR
    //      strings disappear from the row because the detail panel
    //      below already breaks them out into their own columns.
    //   3. The detail panel's first child is the Edit / Void action
    //      row directly (not a duplicated date / memo / createdAt
    //      strip above the action row).
    const SEED_BOOK_ID = "book-journal-dedup";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Dedup Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    // Use a non-default amount so "DR 123" / "CR 123" is uniquely
    // identifiable in the row's text content (vs. the seeded opening
    // entry's amounts).
    await postNormalEntry(page, { debit: "123", credit: "123" });

    const row = await findNormalRow(page);
    // Collapsed: lines cell carries DR/CR amounts.
    await expect(row).toContainText("DR");
    await expect(row).toContainText("CR");

    await row.click();

    // Expanded: the row's lines cell drops DR/CR text. We assert on
    // the row's own .innerText (not the page-wide text) so the inner
    // detail-panel table — which still has Debit/Credit columns and
    // the amount itself — doesn't trigger a false positive. The
    // detail-panel is in a SEPARATE <tr> below, not inside `row`.
    await expect(row).not.toContainText("DR");
    await expect(row).not.toContainText("CR");

    // The Close button now lives in the row's lines cell.
    await expect(page.locator("[data-testid^='accounting-journal-detail-close-']").first()).toBeVisible();

    // The detail panel header dropped its date / memo / createdAt
    // strip. The first interactive control inside the panel is now
    // Edit (or Void) — not a metadata line.
    const detailPanel = page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])");
    await expect(detailPanel).toHaveCount(1);
    // The Edit button must still be in the panel; the timestamp from
    // the row's cell (in `(YYYY-MM-DD HH:MM)` form) must NOT also
    // appear inside the panel — that's the duplication we removed.
    await expect(detailPanel).not.toContainText(/\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)/);
  });

  test("clicking Edit in the detail panel replaces it with the in-place form; Cancel returns to read-only", async ({ page }) => {
    const SEED_BOOK_ID = "book-journal-edit-inplace";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Edit-in-place Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await postNormalEntry(page);

    const row = await findNormalRow(page);
    await row.click();

    // Edit lives inside the detail panel (no longer in the row's
    // action cell). Click it; the read-only detail collapses and the
    // JournalEntryForm mounts in its place inside the same row's
    // expanded slot, NOT at the top of the page.
    const editButton = page.locator("[data-testid^='accounting-edit-']:not([data-testid*='accounting-edit-opening-'])").first();
    await editButton.click();

    // Top-bar form must NOT open — that path is reserved for "+ New
    // entry". The in-place form has its own dedicated testid prefix.
    await expect(page.getByTestId("accounting-journal-inline-form")).toHaveCount(0);
    const inPlaceForm = page.locator("[data-testid^='accounting-journal-detail-edit-']");
    await expect(inPlaceForm).toHaveCount(1);

    // Cancel from the in-place edit returns to the read-only detail
    // for the same row (panel stays expanded; edit form unmounts).
    await page.getByTestId("accounting-entry-cancel-edit").click();
    await expect(inPlaceForm).toHaveCount(0);
    const detailPanel = page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])");
    await expect(detailPanel).toHaveCount(1);
    // Edit/Void/Close are back in the read-only header.
    await expect(page.locator("[data-testid^='accounting-edit-']:not([data-testid*='accounting-edit-opening-'])").first()).toBeVisible();
    await expect(page.locator("[data-testid^='accounting-journal-detail-close-']").first()).toBeVisible();
  });

  test("Close from inside Edit mode resets edit state so the row can be reopened", async ({ page }) => {
    // Pins the CodeRabbit-flagged bug on PR #1161: clicking Close
    // while the detail panel was in edit mode used to clear
    // expandedEntryId but leave entryBeingEdited set. The next click
    // on the row would hit toggleExpanded's edit-mode guard, which
    // early-returns when entryBeingEdited.id matches the row, so the
    // user could never reopen that entry. onCloseDetail now clears
    // both refs.
    const SEED_BOOK_ID = "book-journal-close-from-edit";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Close-from-edit Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "journal" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await postNormalEntry(page);

    const row = await findNormalRow(page);
    await row.click();

    // Enter edit mode, then close from the row's lines-cell button.
    await page.locator("[data-testid^='accounting-edit-']:not([data-testid*='accounting-edit-opening-'])").first().click();
    await expect(page.locator("[data-testid^='accounting-journal-detail-edit-']")).toHaveCount(1);
    await page.locator("[data-testid^='accounting-journal-detail-close-']").first().click();

    // Detail panel collapsed; row stays in the list.
    await expect(page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])")).toHaveCount(0);
    await expect(row).toBeVisible();

    // Re-open the same row — must succeed (the bug was that the
    // toggle was a no-op because entryBeingEdited was still set).
    await row.click();
    await expect(page.locator("[data-testid^='accounting-journal-detail-']:not([data-testid*='-close-']):not([data-testid*='-edit-'])")).toHaveCount(1);
    // And the panel reopens in read-only mode (Edit button visible),
    // not back into the in-place edit form.
    await expect(page.locator("[data-testid^='accounting-journal-detail-edit-']")).toHaveCount(0);
    await expect(page.locator("[data-testid^='accounting-edit-']:not([data-testid*='accounting-edit-opening-'])").first()).toBeVisible();
  });
});
