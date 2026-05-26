// Graph tab + per-page "Linked references" (backlinks) for the wiki
// plugin (#wiki-backlinks-graph).
//
// Both surfaces consume the `graph` action's {nodes, edges} payload:
//   - the Graph tab renders the force-directed map
//   - a page view derives its backlinks (incoming edges) client-side
//
// These tests mock /api/wiki so no backend/LLM is needed (same seam as
// wiki-navigation.spec.ts).

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

const INDEX_PAYLOAD = {
  action: "index",
  title: "Wiki Index",
  content: "# Wiki Index",
  pageEntries: [
    { title: "Onboarding", slug: "onboarding", description: "", tags: [] },
    { title: "Architecture", slug: "architecture", description: "", tags: [] },
  ],
};

function pagePayload(slug: string, title: string) {
  return { action: "page", title, pageName: slug, pageExists: true, content: `# ${title}\n\nBody of ${slug}.` };
}

// Architecture links to Onboarding, so Onboarding's backlinks = [Architecture].
const GRAPH_PAYLOAD = {
  action: "graph",
  title: "Wiki Graph",
  content: "",
  graph: {
    nodes: [
      { slug: "onboarding", title: "Onboarding" },
      { slug: "architecture", title: "Architecture" },
    ],
    edges: [{ from: "architecture", to: "onboarding" }],
  },
};

async function mockWikiApi(page: Page, graphPayload: unknown = GRAPH_PAYLOAD): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/wiki",
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        const slug = new URL(req.url()).searchParams.get("slug");
        if (slug === "onboarding") return route.fulfill({ json: { data: pagePayload("onboarding", "Onboarding") } });
        if (slug === "architecture") return route.fulfill({ json: { data: pagePayload("architecture", "Architecture") } });
        return route.fulfill({ json: { data: INDEX_PAYLOAD } });
      }
      const body = (req.postDataJSON() ?? {}) as { action?: string; pageName?: string };
      if (body.action === "graph") return route.fulfill({ json: { data: graphPayload } });
      if (body.action === "page" && body.pageName === "architecture") return route.fulfill({ json: { data: pagePayload("architecture", "Architecture") } });
      if (body.action === "page" && body.pageName) return route.fulfill({ json: { data: pagePayload(body.pageName, "Onboarding") } });
      return route.fulfill({ json: { data: INDEX_PAYLOAD } });
    },
  );
}

test.describe("wiki graph tab + backlinks", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
  });

  test("Graph tab renders the force graph canvas", async ({ page }) => {
    await mockWikiApi(page);
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-page-entry-onboarding")).toBeVisible();

    await page.getByTestId("wiki-tab-graph").click();

    await page.waitForURL(/\/wiki\/graph$/);
    await expect(page.getByTestId("wiki-graph-canvas")).toBeVisible();
  });

  test("Graph tab shows an empty state when there are no pages", async ({ page }) => {
    await mockWikiApi(page, { action: "graph", title: "Wiki Graph", content: "", graph: { nodes: [], edges: [] } });
    await page.goto("/wiki/graph");

    await expect(page.getByText("No links to graph yet.")).toBeVisible();
    await expect(page.getByTestId("wiki-graph-canvas")).toHaveCount(0);
  });

  test("a page view lists its backlinks and they navigate", async ({ page }) => {
    await mockWikiApi(page);
    await page.goto("/wiki/pages/onboarding");
    await expect(page.getByRole("heading", { level: 1, name: "Onboarding" })).toBeVisible();

    // Backlinks load lazily after the page renders.
    await expect(page.getByTestId("wiki-linked-references")).toBeVisible();
    const backlink = page.getByTestId("wiki-linked-reference-architecture");
    await expect(backlink).toHaveText("Architecture");

    await backlink.click();
    await page.waitForURL(/\/wiki\/pages\/architecture$/);
    await expect(page.getByRole("heading", { level: 1, name: "Architecture" })).toBeVisible();
  });

  test("a page with no backlinks shows no linked-references panel", async ({ page }) => {
    // Architecture has no incoming edges in GRAPH_PAYLOAD.
    await mockWikiApi(page);
    await page.goto("/wiki/pages/architecture");
    await expect(page.getByRole("heading", { level: 1, name: "Architecture" })).toBeVisible();
    await expect(page.getByTestId("wiki-linked-references")).toHaveCount(0);
  });
});
