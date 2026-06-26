// E2E for the accounting plugin's report-row click behavior and the
// Balance Sheet's period shortcut dropdown. The Journal detail-panel
// flow (Edit / Close / dedup invariants) is its own concern and lives
// in accounting-journal-detail-panel.spec.ts.
//
// Two feature surfaces pinned here:
//   1. Balance Sheet rows are clickable; clicking routes to the
//      Ledger tab pre-filtered to that account (mirrors the existing
//      AccountsList → Ledger handoff). The synthetic
//      `_currentEarnings` row stays non-clickable.
//   2. Profit & Loss rows do the same — the View shares a single
//      click handler across both report tables.
//   3. Balance Sheet's Period dropdown ("This month / Last month /
//      Last quarter / Last year") snaps the `<input type=month>` to
//      the chosen shortcut.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAccountingApi, makeAccountingToolResult, type AccountingSeedBook, type BalanceSheetMock, type ProfitLossMock } from "../fixtures/accounting";

const SESSION_ID = "accounting-reports-session";

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
        title: "Accounting Reports Session",
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

test.describe("Balance Sheet — row click and period shortcuts", () => {
  test("clicking a balance-sheet row routes to the Ledger pre-filtered to that account", async ({ page }) => {
    const SEED_BOOK_ID = "book-bs-row-click";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "BS Click Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "balanceSheet" },
      reports: {
        balanceSheet: {
          asOf: "2026-04-30",
          imbalance: 0,
          sections: [
            { type: "asset", rows: [{ accountCode: "1000", accountName: "Cash", balance: 250 }], total: 250 },
            { type: "liability", rows: [{ accountCode: "2000", accountName: "Accounts payable", balance: 100 }], total: 100 },
            { type: "equity", rows: [{ accountCode: "3000", accountName: "Equity", balance: 150 }], total: 150 },
          ],
        },
      },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-balance-sheet")).toBeVisible();

    const cashRow = page.getByTestId("accounting-bs-row-1000");
    await expect(cashRow).toBeVisible();
    await expect(cashRow).toHaveAttribute("role", "button");
    await expect(cashRow).toHaveAttribute("tabindex", "0");

    await cashRow.click();
    await expect(page.getByTestId("accounting-ledger")).toBeVisible();
    await expect(page.getByTestId("accounting-ledger-account")).toHaveValue("1000");
  });

  test("the synthetic _currentEarnings B/S row is not clickable", async ({ page }) => {
    // The server appends a synthetic equity row with the sentinel
    // accountCode `_currentEarnings` so the B/S balances mid-period.
    // It has no underlying account, so the View must keep it
    // non-clickable (and out of the row testid namespace).
    const SEED_BOOK_ID = "book-bs-earnings-skip";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Earnings Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "balanceSheet" },
      reports: {
        balanceSheet: {
          asOf: "2026-04-30",
          imbalance: 0,
          sections: [
            { type: "asset", rows: [{ accountCode: "1000", accountName: "Cash", balance: 100 }], total: 100 },
            {
              type: "equity",
              rows: [{ accountCode: "_currentEarnings", accountName: "Current period earnings", balance: 100 }],
              total: 100,
            },
          ],
        },
      },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-balance-sheet")).toBeVisible();

    // The earnings row deliberately does NOT carry an `accounting-bs-row-…`
    // testid (so Playwright can't reach it the way it would a real
    // account row). Real account rows still expose the testid.
    await expect(page.getByTestId("accounting-bs-row-1000")).toBeVisible();
    await expect(page.getByTestId("accounting-bs-row-_currentEarnings")).toHaveCount(0);
  });

  test("Balance Sheet shortcut dropdown drives the Period input", async ({ page }) => {
    const SEED_BOOK_ID = "book-bs-shortcut";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "Shortcut Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "balanceSheet" },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-balance-sheet")).toBeVisible();

    const period = page.getByTestId("accounting-bs-period");
    const shortcut = page.getByTestId("accounting-bs-shortcut");

    // Each shortcut snaps the month input to a different YYYY-MM.
    // We don't pin specific values (the test runs against the system
    // clock), but each option must land on a distinct YYYY-MM string
    // to prove the four code paths are wired.
    await shortcut.selectOption("thisMonth");
    const thisMonth = await period.inputValue();
    expect(thisMonth).toMatch(/^\d{4}-\d{2}$/);

    await shortcut.selectOption("lastMonth");
    const lastMonth = await period.inputValue();
    expect(lastMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(lastMonth).not.toEqual(thisMonth);

    await shortcut.selectOption("lastQuarter");
    const lastQuarter = await period.inputValue();
    expect(lastQuarter).toMatch(/^\d{4}-\d{2}$/);

    await shortcut.selectOption("lastYear");
    const lastYear = await period.inputValue();
    expect(lastYear).toMatch(/^\d{4}-12$/);
    // Last year must be strictly older than this month.
    expect(lastYear < thisMonth).toBe(true);
  });
});

test.describe("Profit & Loss — row click", () => {
  test("clicking a P&L income or expense row routes to the Ledger pre-filtered", async ({ page }) => {
    const SEED_BOOK_ID = "book-pl-row-click";
    await setupSession(page, {
      books: [{ id: SEED_BOOK_ID, name: "PL Click Book", withEmptyOpening: true }],
      envelope: { bookId: SEED_BOOK_ID, initialTab: "profitLoss" },
      reports: {
        profitLoss: {
          from: "2026-01-01",
          to: "2026-12-31",
          income: { rows: [{ accountCode: "4000", accountName: "Sales", amount: 500 }], total: 500 },
          expense: { rows: [{ accountCode: "5000", accountName: "Rent expense", amount: 200 }], total: 200 },
          netIncome: 300,
        },
      },
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-profit-loss")).toBeVisible();

    const incomeRow = page.getByTestId("accounting-pl-row-4000");
    await expect(incomeRow).toBeVisible();
    await expect(incomeRow).toHaveAttribute("role", "button");
    await incomeRow.click();
    await expect(page.getByTestId("accounting-ledger")).toBeVisible();
    await expect(page.getByTestId("accounting-ledger-account")).toHaveValue("4000");

    // Bounce back to P&L and pin the expense-side path too — the two
    // tables share a click handler, but a regression that tied the
    // emit to only one tbody would slip through if we only tested
    // income.
    await page.getByTestId("accounting-tab-profitLoss").click();
    const expenseRow = page.getByTestId("accounting-pl-row-5000");
    await expenseRow.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("accounting-ledger")).toBeVisible();
    await expect(page.getByTestId("accounting-ledger-account")).toHaveValue("5000");
  });
});
