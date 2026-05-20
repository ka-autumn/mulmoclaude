import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockSlugifyColumnId, setupMutableTodoMocks } from "../fixtures/todos-mutable";
import { disambiguateSlug } from "../../server/utils/slug";
import { WORKSPACE_FILES } from "../../src/config/workspacePaths";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

const TODOS_URL = `/files/${WORKSPACE_FILES.todosItems}`;

async function setupTodoMocks(page: Page): Promise<void> {
  await mockAllApis(page);
  await setupMutableTodoMocks(page, {
    dispatchColumn(method, columnId, body, state) {
      if (method === "POST") {
        const label = typeof body.label === "string" && body.label.length > 0 ? body.label : "New Column";
        const baseId = mockSlugifyColumnId(label);
        const existing = new Set(state.columns.map((col) => col.id));
        // Use the shared helper so the mock mirrors the server's
        // `uniqueId()` exactly — including the truncation it does
        // when a 120-char base would otherwise overflow the cap
        // (Codex iter-2 #732).
        const newId = disambiguateSlug(baseId, existing);
        return {
          columns: [...state.columns, { id: newId, label }],
        };
      }
      if (method === "DELETE" && columnId) {
        return { columns: state.columns.filter((col) => col.id !== columnId) };
      }
      if (method === "PATCH" && columnId) {
        return {
          columns: state.columns.map((col) => (col.id === columnId ? { ...col, label: "Renamed" } : col)),
        };
      }
      return undefined;
    },
    dispatchItem(method, path, _body, state) {
      // Item deletion is wired up here so the "Remove all items" flow
      // can actually shrink the state. The other item verbs aren't
      // exercised in this file.
      const [idSegment] = path.split("/");
      if (method === "DELETE" && idSegment) {
        return { items: state.items.filter((todoItem) => todoItem.id !== idSegment) };
      }
      return undefined;
    },
  });
}

test.describe("Todo column management", () => {
  test.beforeEach(async ({ page }) => {
    await setupTodoMocks(page);
  });

  test("+ Column button opens add-column dialog", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-column-add-btn"]').click();
    await expect(page.getByText("Add Column")).toBeVisible();
  });

  test("column header menu opens on click", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Click the first column's menu button (more_horiz icon)
    const firstColumn = page.locator('[data-testid="todo-column-backlog"]');
    await firstColumn.locator("text=more_horiz").click();
    await expect(page.getByText("Rename")).toBeVisible();
    await expect(page.getByText("Delete column")).toBeVisible();
  });

  test("Escape closes the add-column dialog", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-column-add-btn"]').click();
    await expect(page.getByText("Add Column")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Add Column")).not.toBeVisible();
  });

  test("all 4 kanban columns are rendered", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Check columns exist via data-testid (more reliable than text)
    await expect(page.locator('[data-testid="todo-column-backlog"]')).toBeVisible();
    await expect(page.locator('[data-testid="todo-column-todo"]')).toBeVisible();
    await expect(page.locator('[data-testid="todo-column-in-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="todo-column-done"]')).toBeVisible();
  });

  test("menu shows Mark as done column option", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Open a non-done column's menu
    const todoColumn = page.locator('[data-testid="todo-column-todo"]');
    await todoColumn.locator("text=more_horiz").click();
    await expect(page.getByText("Mark as done column")).toBeVisible();
  });

  test("done column's menu hides Mark-as-done and disables Delete column", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    const doneColumn = page.locator('[data-testid="todo-column-done"]');
    await doneColumn.locator("text=more_horiz").click();

    // The Mark-as-done entry is the previous menu item — gone now
    // because the column is already the done column.
    await expect(page.getByRole("button", { name: "Mark as done column" })).toHaveCount(0);
    // Delete column is still rendered, but disabled.
    await expect(page.getByRole("button", { name: "Delete column" })).toBeDisabled();
  });

  test("done column header shows a check icon, not a colored dot", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    const doneHeader = page.locator('[data-testid="todo-column-done"]');
    // The check icon is the only material-icon-rendered glyph inside the
    // column header that reads as "check". The dot has no text content,
    // so getByText would never have matched it.
    await expect(doneHeader.getByText("check", { exact: true })).toBeVisible();

    // Non-done columns must NOT render a check icon.
    const todoHeader = page.locator('[data-testid="todo-column-todo"]');
    await expect(todoHeader.getByText("check", { exact: true })).toHaveCount(0);
  });

  test("done column menu shows Remove all items", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    const doneColumn = page.locator('[data-testid="todo-column-done"]');
    await doneColumn.locator("text=more_horiz").click();
    await expect(page.getByRole("button", { name: "Remove all items" })).toBeVisible();
  });

  test("non-done column menu does NOT show Remove all items", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    const todoColumn = page.locator('[data-testid="todo-column-todo"]');
    await todoColumn.locator("text=more_horiz").click();
    // The menu is open (Rename is the canary).
    await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
    // But there's no Remove-all-items entry.
    await expect(page.getByRole("button", { name: "Remove all items" })).toHaveCount(0);
  });

  test("Remove all items: confirm wipes the column's cards", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.accept());

    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });
    // Seeded fixture has one item in the done column.
    await expect(page.getByText("Clean kitchen")).toBeVisible();

    const doneColumn = page.locator('[data-testid="todo-column-done"]');
    await doneColumn.locator("text=more_horiz").click();
    await page.getByRole("button", { name: "Remove all items" }).click();

    await expect(page.getByText("Clean kitchen")).toHaveCount(0);
  });

  test("Remove all items: dismissing the confirm keeps the cards", async ({ page }) => {
    page.on("dialog", (dialog) => dialog.dismiss());

    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });
    await expect(page.getByText("Clean kitchen")).toBeVisible();

    const doneColumn = page.locator('[data-testid="todo-column-done"]');
    await doneColumn.locator("text=more_horiz").click();
    await page.getByRole("button", { name: "Remove all items" }).click();

    // Same card still around after the user cancels.
    await expect(page.getByText("Clean kitchen")).toBeVisible();
  });

  test("clicking outside the column menu dismisses it", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    const todoColumn = page.locator('[data-testid="todo-column-todo"]');
    await todoColumn.locator("text=more_horiz").click();
    await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();

    // Click a stable element outside the menu wrapper (the search box
    // up in the explorer chrome). The document-level listener should
    // fire and close the menu.
    await page.getByTestId("todo-search").click();
    await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  });

  test("adds a column with a Japanese label (#161)", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    await page.locator('[data-testid="todo-column-add-btn"]').click();
    const input = page.locator('input[placeholder="Review"]');
    await input.fill("完了");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // The new column's header shows the Japanese label, proving the
    // UI round-trip accepted the non-ASCII input without crashing.
    await expect(page.getByText("完了")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
  });

  test("two distinct Japanese labels produce two distinct columns (#161)", async ({ page }) => {
    await page.goto(TODOS_URL);
    await expect(page.getByText("Todo").first()).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // First Japanese column
    await page.locator('[data-testid="todo-column-add-btn"]').click();
    await page.locator('input[placeholder="Review"]').fill("完了");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("完了")).toBeVisible({ timeout: 5 * ONE_SECOND_MS });

    // Second Japanese column — previously would collide on id="column"
    // and the kanban board would fail to render the second column.
    await page.locator('[data-testid="todo-column-add-btn"]').click();
    await page.locator('input[placeholder="Review"]').fill("進行中です");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("進行中です")).toBeVisible({
      timeout: 5 * ONE_SECOND_MS,
    });

    // Both labels coexist → distinct column ids were generated.
    await expect(page.getByText("完了")).toBeVisible();
    await expect(page.getByText("進行中です")).toBeVisible();
  });
});
