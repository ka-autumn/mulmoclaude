// #833 Phase 1 — inline JSON editor in the Files Explorer.
//
// Pins the observable contract:
//   - policy-editable JSON (config/settings.json → user-editable)
//     shows an Edit button; edit → Save round-trips through
//     PUT /api/files/content
//   - a server 400 (invalid JSON) surfaces in the inline error banner
//     and the editor stays open
//   - agent-managed JSON (config/scheduler/tasks.json) shows NO Edit
//     button (gated by editPolicy in systemFileDescriptors)

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { API_ROUTES } from "../../src/config/apiRoutes";
import { ONE_SECOND_MS } from "../../server/utils/time.ts";

const EDITABLE = "config/settings.json";
const AGENT_MANAGED = "config/scheduler/tasks.json";
const EDITABLE_BODY = '{\n  "theme": "dark"\n}';
const AGENT_BODY = '{\n  "tasks": []\n}';

// CodeMirror 6 exposes a contenteditable (`.cm-content`), not a
// <textarea>, so Playwright's `.fill()` / `toHaveValue` don't apply.
// Select-all then `insertText` replaces the doc in one transaction
// (no per-keystroke auto-indent / bracket close), so the editor's doc
// — and the emitted v-model — is exactly `value`.
async function setEditorContent(page: Page, value: string): Promise<void> {
  const content = page.getByTestId("files-json-editor").locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(value);
}

async function mockJsonFiles(page: Page) {
  await page.route(
    (url) => url.pathname === API_ROUTES.files.dir,
    (route) => {
      const path = new URL(route.request().url()).searchParams.get("path") ?? "";
      if (path === "") {
        return route.fulfill({
          json: { name: "", path: "", type: "dir", children: [{ name: "config", path: "config", type: "dir" }] },
        });
      }
      if (path === "config") {
        return route.fulfill({
          json: {
            name: "config",
            path: "config",
            type: "dir",
            children: [
              { name: "settings.json", path: EDITABLE, type: "file", size: EDITABLE_BODY.length },
              { name: "scheduler", path: "config/scheduler", type: "dir" },
            ],
          },
        });
      }
      if (path === "config/scheduler") {
        return route.fulfill({
          json: {
            name: "scheduler",
            path: "config/scheduler",
            type: "dir",
            children: [{ name: "tasks.json", path: AGENT_MANAGED, type: "file", size: AGENT_BODY.length }],
          },
        });
      }
      return route.fulfill({ json: { name: path, path, type: "dir", children: [] } });
    },
  );

  await page.route(
    (url) => url.pathname === API_ROUTES.files.content && url.searchParams.get("path") === EDITABLE,
    (route) => route.fulfill({ json: { kind: "text", path: EDITABLE, content: EDITABLE_BODY, size: EDITABLE_BODY.length, modifiedMs: Date.now() } }),
  );
  await page.route(
    (url) => url.pathname === API_ROUTES.files.content && url.searchParams.get("path") === AGENT_MANAGED,
    (route) => route.fulfill({ json: { kind: "text", path: AGENT_MANAGED, content: AGENT_BODY, size: AGENT_BODY.length, modifiedMs: Date.now() } }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
  await mockJsonFiles(page);
});

test.describe("Files Explorer — JSON inline editor (#833)", () => {
  test("editable JSON: edit → save round-trips through PUT, server-validated", async ({ page }) => {
    const puts: { path: string; content: string }[] = [];
    await page.route(
      (url) => url.pathname === API_ROUTES.files.content,
      async (route, req) => {
        if (req.method() === "PUT") {
          const body = req.postDataJSON() as { path: string; content: string };
          // Mirror the server: invalid JSON → 400.
          try {
            JSON.parse(body.content);
          } catch (err) {
            await route.fulfill({ status: 400, json: { error: `Invalid JSON: ${(err as Error).message}` } });
            return;
          }
          puts.push(body);
          await route.fulfill({ json: { path: body.path, size: body.content.length, modifiedMs: Date.now() } });
          return;
        }
        await route.fallback();
      },
    );

    await page.goto(`/files/${EDITABLE}`);

    const editBtn = page.getByTestId("files-json-edit-btn");
    await expect(editBtn).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await editBtn.click();

    // CodeMirror 6 renders a contenteditable, not a <textarea> — it
    // seeds from EDITABLE_BODY (assert a token, not exact innerText).
    await expect(page.getByTestId("files-json-editor")).toContainText('"theme"');
    await setEditorContent(page, '{\n  "theme": "light"\n}');
    await page.getByTestId("files-json-save-btn").click();

    await expect(() => {
      expect(puts).toHaveLength(1);
      expect(puts[0].path).toBe(EDITABLE);
      expect(puts[0].content).toBe('{\n  "theme": "light"\n}');
    }).toPass({ timeout: 5 * ONE_SECOND_MS });

    // Successful save exits edit mode (read-only pre returns).
    await expect(page.getByTestId("files-json-editor")).toBeHidden();
    await expect(page.getByTestId("files-json-edit-btn")).toBeVisible();
  });

  test("invalid JSON: Save is disabled client-side with an inline hint (no server round-trip)", async ({ page }) => {
    let putCount = 0;
    await page.route(
      (url) => url.pathname === API_ROUTES.files.content,
      async (route, req) => {
        if (req.method() === "PUT") {
          putCount += 1;
          await route.fulfill({ status: 400, json: { error: "should never be reached" } });
          return;
        }
        await route.fallback();
      },
    );

    await page.goto(`/files/${EDITABLE}`);
    await page.getByTestId("files-json-edit-btn").click();
    await setEditorContent(page, "{ broken");

    // Client guard: Save disabled + visible "Invalid JSON" hint, and
    // the editor stays open so the user can fix it. The server check
    // remains as defence in depth (covered by test_filesPutRoute.ts).
    await expect(page.getByTestId("files-json-save-btn")).toBeDisabled();
    await expect(page.getByTestId("files-json-invalid-hint")).toBeVisible();
    await expect(page.getByTestId("files-json-editor")).toBeVisible();

    // Fixing the JSON re-enables Save (no PUT ever fired while invalid).
    await setEditorContent(page, '{ "ok": true }');
    await expect(page.getByTestId("files-json-save-btn")).toBeEnabled();
    expect(putCount).toBe(0);
  });

  test("Undo / Redo buttons reflect history and round-trip an edit", async ({ page }) => {
    await page.goto(`/files/${EDITABLE}`);
    await page.getByTestId("files-json-edit-btn").click();

    const undoBtn = page.getByTestId("files-json-undo-btn");
    const redoBtn = page.getByTestId("files-json-redo-btn");
    // Fresh editor: nothing to undo or redo.
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    await setEditorContent(page, '{ "edited": 1 }');
    await expect(undoBtn).toBeEnabled();

    await undoBtn.click();
    await expect(page.getByTestId("files-json-editor")).not.toContainText('"edited"');
    await expect(redoBtn).toBeEnabled();

    await redoBtn.click();
    await expect(page.getByTestId("files-json-editor")).toContainText('"edited"');
  });

  test("agent-managed JSON shows no Edit button", async ({ page }) => {
    await page.goto(`/files/${AGENT_MANAGED}`);
    // Wait for the JSON pretty-print to render, then assert the Edit
    // button is absent (editPolicy = agent-managed).
    await expect(page.getByText('"tasks"')).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
    await expect(page.getByTestId("files-json-edit-btn")).toHaveCount(0);
  });
});
