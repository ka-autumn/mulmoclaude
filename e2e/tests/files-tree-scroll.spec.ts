// Tree pane auto-scrolls so the selected file row is visible after
// (a) deep-link mount and (b) in-app file→file navigation. Covers
// the bug where the selected row lived in the DOM but sat below the
// fold of the overflow-y-auto pane.

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Build a tree wide enough that the target row sits well below the
// pane's clientHeight. Two top-level dirs each with 40 files; the
// second dir's target file is at the bottom.
function buildWideTree() {
  const dirAFiles = Array.from({ length: 40 }, (_, i) => ({
    name: `a-${String(i).padStart(2, "0")}.md`,
    path: `dir-a/a-${String(i).padStart(2, "0")}.md`,
    type: "file" as const,
    size: 10,
  }));
  const dirBFiles = Array.from({ length: 40 }, (_, i) => ({
    name: `b-${String(i).padStart(2, "0")}.md`,
    path: `dir-b/b-${String(i).padStart(2, "0")}.md`,
    type: "file" as const,
    size: 10,
  }));
  return { dirAFiles, dirBFiles };
}

interface FileNode {
  name: string;
  path: string;
  type: "file";
  size: number;
}

function rootDirResponse() {
  return {
    name: "",
    path: "",
    type: "dir" as const,
    children: [
      { name: "dir-a", path: "dir-a", type: "dir" as const },
      { name: "dir-b", path: "dir-b", type: "dir" as const },
    ],
  };
}

function dirResponse(name: string, files: FileNode[]) {
  return { name, path: name, type: "dir" as const, children: files };
}

function emptyDirResponse(path: string) {
  return { name: path, path, type: "dir" as const, children: [] };
}

function handleDirRoute(route: Route, dirAFiles: FileNode[], dirBFiles: FileNode[]): Promise<void> {
  const path = new URL(route.request().url()).searchParams.get("path") ?? "";
  if (path === "") return route.fulfill({ json: rootDirResponse() });
  if (path === "dir-a") return route.fulfill({ json: dirResponse("dir-a", dirAFiles) });
  if (path === "dir-b") return route.fulfill({ json: dirResponse("dir-b", dirBFiles) });
  return route.fulfill({ json: emptyDirResponse(path) });
}

function handleContentRoute(route: Route): Promise<void> {
  return route.fulfill({
    json: {
      kind: "text",
      path: new URL(route.request().url()).searchParams.get("path") ?? "",
      content: "stub content",
      size: 12,
      modifiedMs: Date.now(),
    },
  });
}

async function mockTree(page: Page): Promise<void> {
  const { dirAFiles, dirBFiles } = buildWideTree();
  await page.route(
    (url) => url.pathname === "/api/files/dir",
    (route: Route) => handleDirRoute(route, dirAFiles, dirBFiles),
  );
  await page.route((url) => url.pathname === "/api/files/content", handleContentRoute);
}

// Wait for an expanded directory to be FULLY rendered (its first and
// last file rows both in the DOM). Each lazy-load batch pushes the
// selected row further down, so polling for the scroll position before
// the tree height has settled would race the reveal watcher even when
// the logic is correct.
async function expectDirFullyRendered(page: Page, dir: "a" | "b"): Promise<void> {
  await expect(page.locator(`[data-testid="file-tree-file-${dir}-00.md"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="file-tree-file-${dir}-39.md"]`)).toBeVisible();
}

async function expectSelectedRowInView(page: Page): Promise<void> {
  // The reveal effect re-fires on tree growth via a coalesced rAF, so
  // the final scroll only lands once the last lazy-load resolves and
  // its DOM patch flushes. The 15s ceiling is for slow CI runners —
  // logic is eventual-correct, this just gives the cascade headroom.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const selected = document.querySelector<HTMLElement>('[data-testid="files-view-root"] button[data-selected="true"]');
          const container = document.querySelector<HTMLElement>('[data-testid="files-view-root"] .overflow-y-auto');
          if (!selected || !container) return false;
          const selRect = selected.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          return selRect.top >= containerRect.top && selRect.bottom <= containerRect.bottom;
        }),
      { timeout: 15000 },
    )
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await mockAllApis(page);
  await mockTree(page);
});

test.describe("file tree auto-scroll to selection", () => {
  test("deep link to a file below the fold scrolls the tree to reveal it", async ({ page }) => {
    await page.goto("/files/dir-b/b-39.md");
    await expectDirFullyRendered(page, "b");
    await expectSelectedRowInView(page);
  });

  test("in-app navigation expands ancestors and scrolls to the new selection", async ({ page }) => {
    // Land on a row at the top of dir-a (which auto-expands via the
    // deep-link path). dir-b is still collapsed at this point.
    await page.goto("/files/dir-a/a-00.md");
    await expectDirFullyRendered(page, "a");

    // Simulate a markdown link navigating to a file in the still-
    // collapsed dir-b — this is the in-app file→file case the fix
    // targets. selectFile() updates state and pushes the route; the
    // ancestor expansion + scroll must follow without a remount.
    await page.evaluate(() => {
      window.history.pushState({}, "", "/files/dir-b/b-39.md");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await expectDirFullyRendered(page, "b");
    await expectSelectedRowInView(page);
  });
});
