import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

interface Settings {
  extraAllowedTools: string[];
}
interface McpEntry {
  id: string;
  spec:
    | { type: "http"; url: string; headers?: Record<string, string>; enabled?: boolean }
    | {
        type: "stdio";
        command: string;
        args?: string[];
        env?: Record<string, string>;
        enabled?: boolean;
      };
}
interface ConfigState {
  settings: Settings;
  mcp: { servers: McpEntry[] };
}

// Install a server-backed mock that reflects PUT writes so the UI's
// re-read assertion (open → edit → save → close → reopen → verify)
// actually exercises the round-trip.
async function mockConfigApi(
  page: Page,
  initial: ConfigState = {
    settings: { extraAllowedTools: [] },
    mcp: { servers: [] },
  },
): Promise<{ state: ConfigState }> {
  await mockAllApis(page);
  const state: ConfigState = JSON.parse(JSON.stringify(initial));

  await page.route(
    (url) => url.pathname === "/api/config",
    (route) => {
      const method = route.request().method();
      if (method === "GET") {
        return route.fulfill({ json: state });
      }
      if (method === "PUT") {
        // Atomic endpoint: payload is { settings, mcp } together.
        const body = route.request().postDataJSON() as {
          settings: Settings;
          mcp: { servers: McpEntry[] };
        };
        state.settings = body.settings;
        state.mcp = { servers: body.mcp.servers };
        return route.fulfill({ json: state });
      }
      return route.fallback();
    },
  );

  await page.route(
    (url) => url.pathname === "/api/config/settings",
    (route) => {
      const body = route.request().postDataJSON() as Settings;
      state.settings = body;
      return route.fulfill({ json: state });
    },
  );

  await page.route(
    (url) => url.pathname === "/api/config/mcp",
    (route) => {
      const body = route.request().postDataJSON() as {
        servers: McpEntry[];
      };
      state.mcp = { servers: body.servers };
      return route.fulfill({ json: state });
    },
  );

  return { state };
}

// Open the Settings modal and wait for the async loadConfig() fetch
// to complete — otherwise a fast user fill() can be overwritten when
// the GET response lands. Mirrors the production UX (user sees the
// modal already populated when they start typing).
async function openSettingsModal(page: Page): Promise<void> {
  await page.locator('[data-testid="settings-btn"]').click();
  await expect(page.locator('[data-testid="settings-modal"]')).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.describe("Settings modal", () => {
  test("opens and closes via the gear button", async ({ page }) => {
    await mockConfigApi(page);
    await page.goto("/chat");

    await expect(page.locator('[data-testid="settings-modal"]')).not.toBeVisible();
    await openSettingsModal(page);
    await page.locator('[data-testid="settings-close-btn"]').click();
    await expect(page.locator('[data-testid="settings-modal"]')).not.toBeVisible();
  });

  test("persists extraAllowedTools across open/close", async ({ page }) => {
    const { state } = await mockConfigApi(page);
    await page.goto("/chat");

    await openSettingsModal(page);
    const textarea = page.locator('[data-testid="settings-tools-textarea"]');
    await textarea.fill("mcp__claude_ai_Gmail\nmcp__claude_ai_Google_Calendar");

    // Tools tab has its own Save button — Save does not auto-close
    // the modal anymore; the user closes it explicitly.
    await page.locator('[data-testid="settings-tools-save-btn"]').click();
    await expect.poll(() => state.settings.extraAllowedTools).toEqual(["mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Calendar"]);

    await page.locator('[data-testid="settings-close-btn"]').click();
    await expect(page.locator('[data-testid="settings-modal"]')).not.toBeVisible();

    // Reopen → textarea must repopulate from the mocked server.
    await openSettingsModal(page);
    await expect(textarea).toHaveValue("mcp__claude_ai_Gmail\nmcp__claude_ai_Google_Calendar");
  });

  test("flags non-standard tool names with a warning", async ({ page }) => {
    await mockConfigApi(page);
    await page.goto("/chat");

    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tools-textarea"]').fill("mcp__claude_ai_Gmail\nrm -rf /");
    await expect(page.getByText(/look non-standard/)).toBeVisible();
  });

  test("backdrop click closes the modal", async ({ page }) => {
    await mockConfigApi(page);
    await page.goto("/chat");

    await openSettingsModal(page);
    // Click in the corner of the backdrop — clicking the centre would
    // land on the inner dialog (which has @click.stop) and be swallowed.
    await page.locator('[data-testid="settings-modal-backdrop"]').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('[data-testid="settings-modal"]')).not.toBeVisible();
  });
});

// Skills and Roles relocated from the top-bar launcher into the
// Settings modal's Management group. These tabs mount the full
// management surfaces (no standalone /skills or /roles route anymore).
test.describe("Settings modal — Management tabs (Skills / Roles)", () => {
  test("Skills tab mounts the manageSkills surface", async ({ page }) => {
    await mockConfigApi(page);
    await page.goto("/chat");

    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-skills"]').click();
    // The catalog accordion is always rendered, even on an empty
    // workspace — it's the stable mount anchor for the Skills surface.
    await expect(page.locator('[data-testid="skill-section-catalog"]')).toBeVisible();
  });

  test("Roles tab mounts the roles manager", async ({ page }) => {
    await mockConfigApi(page);
    await page.goto("/chat");

    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-roles"]').click();
    await expect(page.locator('[data-testid="roles-view-root"]')).toBeVisible();
  });
});

test.describe("Settings MCP tab — HTTP servers (Phase 2a)", () => {
  test("adds an HTTP server via the form", async ({ page }) => {
    const { state } = await mockConfigApi(page);
    await page.goto("/chat");

    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-mcp"]').click();
    await expect(page.locator('[data-testid="mcp-empty"]')).toBeVisible();

    await page.locator('[data-testid="mcp-add-btn"]').click();
    await page.locator('[data-testid="mcp-draft-id"]').fill("gmail");
    // http is the default radio selection
    await page.locator('[data-testid="mcp-draft-url"]').fill("https://gmail.mcp.claude.com/mcp");
    await page.locator('[data-testid="mcp-draft-add"]').click();

    await expect(page.locator('[data-testid="mcp-server-gmail"]')).toBeVisible();

    // MCP mutations auto-persist — no Save button required.
    await expect.poll(() => state.mcp.servers.length).toBe(1);
    expect(state.mcp.servers[0]?.id).toBe("gmail");
    expect(state.mcp.servers[0]?.spec.type).toBe("http");

    await page.locator('[data-testid="settings-close-btn"]').click();
    await expect(page.locator('[data-testid="settings-modal"]')).not.toBeVisible();
  });

  test("rejects an invalid server id", async ({ page }) => {
    await mockConfigApi(page);
    await page.goto("/chat");

    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-mcp"]').click();
    await page.locator('[data-testid="mcp-add-btn"]').click();
    // Uppercase first letter is rejected by the UI guard.
    await page.locator('[data-testid="mcp-draft-id"]').fill("Gmail");
    await page.locator('[data-testid="mcp-draft-url"]').fill("https://gmail.mcp.claude.com/mcp");
    await page.locator('[data-testid="mcp-draft-add"]').click();

    await expect(page.locator('[data-testid="mcp-draft-error"]')).toContainText(/lowercase/);
  });

  test("rejects a non-http URL", async ({ page }) => {
    await mockConfigApi(page);
    await page.goto("/chat");

    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-mcp"]').click();
    await page.locator('[data-testid="mcp-add-btn"]').click();
    await page.locator('[data-testid="mcp-draft-id"]').fill("bad");
    await page.locator('[data-testid="mcp-draft-url"]').fill("ftp://x/mcp");
    await page.locator('[data-testid="mcp-draft-add"]').click();

    await expect(page.locator('[data-testid="mcp-draft-error"]')).toContainText(/http/);
  });

  test("rejects a duplicate id", async ({ page }) => {
    await mockConfigApi(page, {
      settings: { extraAllowedTools: [] },
      mcp: {
        servers: [{ id: "gmail", spec: { type: "http", url: "https://x" } }],
      },
    });
    await page.goto("/chat");
    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-mcp"]').click();
    await page.locator('[data-testid="mcp-add-btn"]').click();
    await page.locator('[data-testid="mcp-draft-id"]').fill("gmail");
    await page.locator('[data-testid="mcp-draft-url"]').fill("https://y/mcp");
    await page.locator('[data-testid="mcp-draft-add"]').click();
    await expect(page.locator('[data-testid="mcp-draft-error"]')).toContainText(/already exists/);
  });

  test("removes an existing server", async ({ page }) => {
    const { state } = await mockConfigApi(page, {
      settings: { extraAllowedTools: [] },
      mcp: {
        servers: [{ id: "gmail", spec: { type: "http", url: "https://x/mcp" } }],
      },
    });
    await page.goto("/chat");
    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-mcp"]').click();
    await page.locator('[data-testid="mcp-remove-gmail"]').click();
    // MCP mutations auto-persist — no Save button required.
    await expect.poll(() => state.mcp.servers.length).toBe(0);
    await page.locator('[data-testid="settings-close-btn"]').click();
    await expect(page.locator('[data-testid="settings-modal"]')).not.toBeVisible();
  });
});

test.describe("Settings MCP tab — stdio + Docker warnings (Phase 2b)", () => {
  test("adds a stdio server with npx + args", async ({ page }) => {
    const { state } = await mockConfigApi(page);
    await page.goto("/chat");
    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-mcp"]').click();

    await page.locator('[data-testid="mcp-add-btn"]').click();
    await page.locator('[data-testid="mcp-draft-id"]').fill("files");
    await page.locator('[data-testid="mcp-draft-type-stdio"]').check();
    await page.locator('[data-testid="mcp-draft-command"]').selectOption("npx");
    await page.locator('[data-testid="mcp-draft-args"]').fill("-y\n@modelcontextprotocol/server-filesystem\n/workspace/docs");
    await page.locator('[data-testid="mcp-draft-add"]').click();

    await expect(page.locator('[data-testid="mcp-server-files"]')).toBeVisible();
    // MCP mutations auto-persist — no Save button required.
    await expect.poll(() => state.mcp.servers[0]?.spec.type).toBe("stdio");
    await page.locator('[data-testid="settings-close-btn"]').click();
    await expect(page.locator('[data-testid="settings-modal"]')).not.toBeVisible();
  });
});

// Catalog config form (#823 Phase 2). Notion is the canonical
// example: 1 secret field (NOTION_API_KEY) interpolated into
// the recommended `NOTION_TOKEN` env var (per the official
// @notionhq/notion-mcp-server README). Walks the full
// toggle → form → validate → install round-trip and asserts
// the env arrives at the persistence layer with the
// placeholder resolved.
test.describe("Settings MCP tab — catalog config (Phase 2)", () => {
  test("config-required entry shows form, validates, and installs with resolved env", async ({ page }) => {
    const { state } = await mockConfigApi(page);
    await page.goto("/chat");
    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-mcp"]').click();

    // Toggle Notion on — form opens, server is NOT yet installed
    // (the toggle stays unchecked until the form submits, so we
    // use click() rather than check() — the latter asserts the
    // post-action checked state and would fail intentionally here).
    await page.locator('[data-testid="mcp-catalog-toggle-notion"]').click();
    await expect(page.locator('[data-testid="mcp-catalog-config-form-notion"]')).toBeVisible();
    await expect(page.locator('[data-testid="mcp-server-notion"]')).not.toBeVisible();

    // Submit empty → required-field error highlights the missing key.
    await page.locator('[data-testid="mcp-catalog-config-install-notion"]').click();
    await expect(page.locator('[data-testid="mcp-catalog-config-error-notion"]')).toContainText("NOTION_API_KEY");

    // Fill the key and install → server appears, env carries the
    // resolved token under NOTION_TOKEN (the recommended shape).
    await page.locator('[data-testid="mcp-catalog-config-input-notion-NOTION_API_KEY"]').fill("secret_test_token_xyz");
    await page.locator('[data-testid="mcp-catalog-config-install-notion"]').click();
    await expect(page.locator('[data-testid="mcp-catalog-config-form-notion"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="mcp-server-notion"]')).toBeVisible();

    await expect.poll(() => state.mcp.servers.find((entry) => entry.id === "notion")?.spec.type).toBe("stdio");
    const installed = state.mcp.servers.find((entry) => entry.id === "notion");
    if (!installed || installed.spec.type !== "stdio") throw new Error("notion server not persisted as stdio");
    expect(installed.spec.env?.NOTION_TOKEN).toBe("secret_test_token_xyz");

    // Toggle off → server is removed.
    await page.locator('[data-testid="mcp-catalog-toggle-notion"]').uncheck();
    await expect(page.locator('[data-testid="mcp-server-notion"]')).not.toBeVisible();
    await expect.poll(() => state.mcp.servers.length).toBe(0);

    await page.locator('[data-testid="settings-close-btn"]').click();
  });

  test("config-free catalog entry installs immediately on toggle (regression check)", async ({ page }) => {
    // Phase 1 entries with empty configSchema must still install
    // synchronously — Phase 2 should not have regressed that path.
    const { state } = await mockConfigApi(page);
    await page.goto("/chat");
    await openSettingsModal(page);
    await page.locator('[data-testid="settings-tab-mcp"]').click();

    await page.locator('[data-testid="mcp-catalog-toggle-memory"]').check();
    // No form rendered for config-free entries.
    await expect(page.locator('[data-testid="mcp-catalog-config-form-memory"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="mcp-server-memory"]')).toBeVisible();
    await expect.poll(() => state.mcp.servers.length).toBe(1);

    await page.locator('[data-testid="settings-close-btn"]').click();
  });
});
