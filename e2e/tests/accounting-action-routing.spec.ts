// E2E coverage for tab routing driven by `manageAccounting` tool-result
// envelopes. Each PREVIEW action stamps `data: { action, bookId, … }`
// onto its response (server/api/routes/accounting.ts dispatch +
// PREVIEW_ACTIONS); the View reads `action` and routes the canvas to
// the right tab so the user lands on the surface the action just
// touched.
//
// Routing matrix pinned here:
//   addEntries    → Journal      (covered separately in
//                                 accounting-add-entries-autoselect.spec.ts)
//   voidEntry     → Journal + auto-expand the void-marker row
//   upsertAccount → Accounts
//   updateBook    → Settings
//   openBook /
//   createBook /
//   setOpeningBalances → Balance Sheet (or Opening when the book has
//                        no opening on file — the existing
//                        openingGateActive watcher redirects).
// An explicit `initialTab` from the envelope (currently only openBook
// ships one) wins over the action-default; the last test pins that.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { makeAccountingActionToolResult, mockAccountingApi, type AccountingSeedBook, type SeedJournalEntry } from "../fixtures/accounting";
import { ACCOUNTING_ACTIONS } from "@mulmoclaude/accounting-plugin/shared";

const SESSION_ID = "accounting-action-routing-session";
const BOOK_ID = "book-action-routing";

interface SetupOpts {
  /** Override the default seed (one book with empty opening). Pass an
   *  empty array to test cold-load flows like createBook. */
  books?: readonly AccountingSeedBook[];
  /** Pre-seeded journal entries on BOOK_ID. Only honored when the
   *  default seed is used; otherwise pass them through `books`. */
  entries?: readonly SeedJournalEntry[];
  /** Tool-result envelope to inject as the only non-text entry in the
   *  session transcript. */
  envelope: Record<string, unknown>;
}

async function setupSession(page: Page, opts: SetupOpts): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID,
        title: "Accounting Action Routing",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  const books = opts.books ?? [
    {
      id: BOOK_ID,
      name: "Routing Book",
      // Most action-routing tests need the gate inactive so the
      // "land on Balance Sheet" path is observable. Cold-load
      // tests (createBook on an empty workspace) override `books`.
      withEmptyOpening: true,
      entries: opts.entries,
    },
  ];

  await mockAccountingApi(page, { books });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID },
          { type: "text", source: "user", message: "Trigger an action" },
          opts.envelope,
        ],
      }),
  );
}

async function expectActiveTab(page: Page, key: string): Promise<void> {
  // Tab buttons are wrapped in a strip; the active one carries the
  // shared "bg-blue-50 text-blue-600 font-medium" class set. Pinning
  // the class match makes the assertion deterministic without having
  // to guess which tab was previously active.
  await expect(page.getByTestId(`accounting-tab-${key}`)).toHaveClass(/text-blue-600/);
}

test.describe("accounting — action-driven tab routing", () => {
  test("voidEntry → Journal tab with the void-marker row auto-expanded", async ({ page }) => {
    const ORIGINAL_ID = "entry-void-original";
    const MARKER_ID = "entry-void-marker";
    await setupSession(page, {
      entries: [
        {
          id: ORIGINAL_ID,
          date: "2026-04-15",
          kind: "normal",
          lines: [
            { accountCode: "1000", debit: 100 },
            { accountCode: "4000", credit: 100 },
          ],
          memo: "Original",
        },
        // The void-marker row carries kind: "void-marker" with no
        // lines — it's a sentinel, not a balanced entry. Production's
        // voidEntry handler also writes a paired "reverseEntry" with
        // the actual reversing lines, but the user-facing affordance
        // we're highlighting is the marker row.
        { id: MARKER_ID, date: "2026-04-30", kind: "void-marker" },
      ],
      envelope: makeAccountingActionToolResult({
        action: ACCOUNTING_ACTIONS.voidEntry,
        bookId: BOOK_ID,
        data: { markerEntry: { id: MARKER_ID, date: "2026-04-30" } },
      }),
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expectActiveTab(page, "journal");
    await expect(page.getByTestId(`accounting-journal-detail-${MARKER_ID}`)).toBeVisible();
    // Original row rendering (struck-through "voided" testid) is a
    // separate concern handled by the fixture's voidedIdsFrom logic
    // — pinning it here would couple this routing test to that
    // fixture detail. Just confirm the original row is in the list.
    await expect(page.locator(`[data-testid$="${ORIGINAL_ID}"]`).first()).toBeVisible();
  });

  test("upsertAccount → Accounts tab (no row preselect)", async ({ page }) => {
    await setupSession(page, {
      envelope: makeAccountingActionToolResult({
        action: ACCOUNTING_ACTIONS.upsertAccount,
        bookId: BOOK_ID,
        data: { account: { code: "1500", name: "Inventory", type: "asset" } },
      }),
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expectActiveTab(page, "accounts");
  });

  test("updateBook → Settings tab", async ({ page }) => {
    await setupSession(page, {
      envelope: makeAccountingActionToolResult({
        action: ACCOUNTING_ACTIONS.updateBook,
        bookId: BOOK_ID,
        data: { book: { id: BOOK_ID, name: "Renamed", currency: "USD" } },
      }),
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expectActiveTab(page, "settings");
  });

  test("openBook (no initialTab) → Balance Sheet tab", async ({ page }) => {
    await setupSession(page, {
      envelope: makeAccountingActionToolResult({
        action: ACCOUNTING_ACTIONS.openBook,
        bookId: BOOK_ID,
        data: { kind: "accounting-app" },
      }),
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expectActiveTab(page, "balanceSheet");
  });

  test("openBook with explicit initialTab honors the LLM's choice over the action default", async ({ page }) => {
    await setupSession(page, {
      envelope: makeAccountingActionToolResult({
        action: ACCOUNTING_ACTIONS.openBook,
        bookId: BOOK_ID,
        data: { kind: "accounting-app", initialTab: "journal" },
      }),
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expectActiveTab(page, "journal");
  });

  test("setOpeningBalances → Balance Sheet tab", async ({ page }) => {
    await setupSession(page, {
      envelope: makeAccountingActionToolResult({
        action: ACCOUNTING_ACTIONS.setOpeningBalances,
        bookId: BOOK_ID,
        data: {
          openingEntry: { id: "entry-opening-stamp", date: "2026-04-01" },
          replacedExisting: false,
        },
      }),
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expectActiveTab(page, "balanceSheet");
  });

  test("createBook on a fresh book without opening → opening gate redirects to Opening tab", async ({ page }) => {
    // No `withEmptyOpening` on the seed: the gate engages when
    // refetchOpening resolves and overrides our balanceSheet route
    // to "opening". Pins the gate-vs-action interaction the user
    // explicitly called out ("not possible if Opening balance is not
    // entered yet").
    await setupSession(page, {
      books: [{ id: BOOK_ID, name: "Fresh Book" }],
      envelope: makeAccountingActionToolResult({
        action: ACCOUNTING_ACTIONS.createBook,
        bookId: BOOK_ID,
        data: { book: { id: BOOK_ID, name: "Fresh Book", currency: "USD" } },
      }),
    });

    await page.goto(`/chat/${SESSION_ID}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expectActiveTab(page, "opening");
  });
});
