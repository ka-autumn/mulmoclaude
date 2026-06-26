// E2E coverage for the accounting Book Settings tab. Two independent
// features sit side-by-side here:
//
//   - **Advanced gate for Delete book**: pins that the destructive
//     Delete UI is hidden until the user explicitly opens the
//     Advanced section, and that switching books re-collapses the
//     gate so a typed confirmName can't carry into the wrong book.
//   - **Rename book**: pins that the editable name input saves
//     through `updateBook`, that the input re-syncs from the props
//     watcher after the books-changed refetch, and that the Save
//     button mirrors the server's non-empty-string contract for
//     empty / whitespace inputs.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { makeAccountingToolResult, mockAccountingApi } from "../fixtures/accounting";

const SESSION_ID_ADVANCED = "accounting-advanced-session";
const SESSION_ID_RENAME = "accounting-rename-session";
const BOOK_ID_A = "book-advanced-a";
const BOOK_ID_B = "book-advanced-b";
const BOOK_ID_RENAME = "book-rename";

async function setupAdvancedSession(page: Page): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID_ADVANCED,
        title: "Settings Advanced",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page, {
    // Two books so we can verify the bookId-watcher resets the
    // showAdvanced flag on switch. withEmptyOpening keeps the
    // settings tab reachable on first mount (otherwise the opening
    // gate would force-route to "opening").
    books: [
      { id: BOOK_ID_A, name: "Book A", withEmptyOpening: true },
      { id: BOOK_ID_B, name: "Book B", withEmptyOpening: true },
    ],
  });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID_ADVANCED },
          { type: "text", source: "user", message: "Open the book settings" },
          makeAccountingToolResult({ bookId: BOOK_ID_A, initialTab: "settings" }),
        ],
      }),
  );
}

async function setupRenameSession(page: Page, initialName: string): Promise<void> {
  await mockAllApis(page, {
    sessions: [
      {
        id: SESSION_ID_RENAME,
        title: "Settings Rename",
        roleId: "general",
        startedAt: "2026-04-14T10:00:00Z",
        updatedAt: "2026-04-14T10:05:00Z",
      },
    ],
  });

  await mockAccountingApi(page, {
    // withEmptyOpening keeps the gate inactive so the Settings tab
    // is reachable on the FIRST mount via initialTab — without it,
    // openingGateActive would force-route to "opening" and the
    // Settings UI would be unreachable until an opening is on file.
    books: [{ id: BOOK_ID_RENAME, name: initialName, withEmptyOpening: true }],
  });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) =>
      route.fulfill({
        json: [
          { type: "session_meta", roleId: "general", sessionId: SESSION_ID_RENAME },
          { type: "text", source: "user", message: "Open the book settings" },
          makeAccountingToolResult({ bookId: BOOK_ID_RENAME, initialTab: "settings" }),
        ],
      }),
  );
}

test.describe("accounting — Settings: Advanced gate for Delete book", () => {
  test("Delete book section is hidden until Advanced is pressed", async ({ page }) => {
    await setupAdvancedSession(page);
    await page.goto(`/chat/${SESSION_ID_ADVANCED}`);
    await expect(page.getByTestId("accounting-settings")).toBeVisible();

    // Initial mount: Advanced button visible, Delete UI hidden.
    await expect(page.getByTestId("accounting-settings-advanced")).toBeVisible();
    await expect(page.getByTestId("accounting-settings-delete")).toBeHidden();
    await expect(page.getByTestId("accounting-settings-delete-confirm")).toBeHidden();

    await page.getByTestId("accounting-settings-advanced").click();

    // After click: Delete UI revealed, Advanced button collapsed away.
    await expect(page.getByTestId("accounting-settings-delete")).toBeVisible();
    await expect(page.getByTestId("accounting-settings-delete-confirm")).toBeVisible();
    await expect(page.getByTestId("accounting-settings-advanced")).toBeHidden();
  });

  test("switching to a different book collapses the Advanced section", async ({ page }) => {
    await setupAdvancedSession(page);
    await page.goto(`/chat/${SESSION_ID_ADVANCED}`);
    await expect(page.getByTestId("accounting-settings")).toBeVisible();

    // Open Advanced on book A.
    await page.getByTestId("accounting-settings-advanced").click();
    await expect(page.getByTestId("accounting-settings-delete")).toBeVisible();

    // Switch to book B via the BookSwitcher dropdown — the bookId
    // watcher should reset showAdvanced back to false.
    await page.getByTestId("accounting-book-select").selectOption(BOOK_ID_B);

    await expect(page.getByTestId("accounting-settings-advanced")).toBeVisible();
    await expect(page.getByTestId("accounting-settings-delete")).toBeHidden();
  });
});

test.describe("accounting — Settings: rename book", () => {
  test("renaming via the input + Save persists the new name and resyncs the input", async ({ page }) => {
    await setupRenameSession(page, "Original Name");
    await page.goto(`/chat/${SESSION_ID_RENAME}`);
    await expect(page.getByTestId("accounting-app")).toBeVisible();
    await expect(page.getByTestId("accounting-settings")).toBeVisible();

    const nameInput = page.getByTestId("accounting-settings-name");
    await expect(nameInput).toHaveValue("Original Name");

    await nameInput.fill("Renamed Book");
    await page.getByTestId("accounting-settings-save").click();

    // Success banner confirms the dispatch round-tripped.
    await expect(page.getByTestId("accounting-settings-update-ok")).toBeVisible();
    // Input keeps the new name post-save — the View's books-changed
    // → refetchBooks loop bumps `bookName` on the prop, and the
    // watcher in BookSettings syncs `selectedName` to it. Without the
    // watcher this would silently reset to the OLD value after save.
    await expect(nameInput).toHaveValue("Renamed Book");
    // BookSwitcher renders option text as `Name (CCY)`. Grepping the
    // dropdown for the new name confirms the rename also flows through
    // to the parent's books list, not just the local input ref.
    await expect(page.getByTestId("accounting-book-select")).toContainText("Renamed Book");
  });

  test("Save button is disabled when the name is cleared to empty", async ({ page }) => {
    await setupRenameSession(page, "Original Name");
    await page.goto(`/chat/${SESSION_ID_RENAME}`);
    const nameInput = page.getByTestId("accounting-settings-name");
    await expect(nameInput).toHaveValue("Original Name");
    await nameInput.fill("");
    // Mirrors server-side validateUpdateBookInput's "non-empty string"
    // contract — without this client gate, Save would fire a doomed
    // 400.
    await expect(page.getByTestId("accounting-settings-save")).toBeDisabled();
  });

  test("Save button is disabled when the name is whitespace-only", async ({ page }) => {
    await setupRenameSession(page, "Original Name");
    await page.goto(`/chat/${SESSION_ID_RENAME}`);
    const nameInput = page.getByTestId("accounting-settings-name");
    await nameInput.fill("   ");
    // Server trims + rejects whitespace-only names; the client mirrors
    // the trim so a single whitespace edit doesn't look like a valid
    // "pending change".
    await expect(page.getByTestId("accounting-settings-save")).toBeDisabled();
  });
});
