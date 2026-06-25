// E2E for the session-tab row (SessionTabBar.vue): verifies that
// each existing session now shows a visible label under the role
// icon so users can tell sessions apart at a glance, and that
// supplemental indicators (unread dot, origin glyph) render on
// the tabs that carry those flags.

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";

test.describe("session tab bar — visible per-tab info", () => {
  test("shows a short label under the role icon on each tab", async ({ page }) => {
    await mockAllApis(page, { sessions: [SESSION_A, SESSION_B] });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    // Assert on the distinguishing suffix ("session A" / "session B")
    // rather than the shared "Hello from" prefix — otherwise the test
    // would pass even if the tabs got swapped and each rendered the
    // wrong session's label.
    await expect(tabA).toContainText("session A");
    await expect(tabB).toContainText("session B");

    // Tab tooltip keeps the full preview for users who want more.
    await expect(tabA).toHaveAttribute("title", SESSION_A.preview ?? "");
    await expect(tabB).toHaveAttribute("title", SESSION_B.preview ?? "");
  });

  test("shows an unread dot on inactive tabs that have unread replies", async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        { ...SESSION_A, hasUnread: true },
        { ...SESSION_B, hasUnread: false },
      ],
    });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    // Dot is an aria-labeled span inside the tab.
    await expect(tabA.getByLabel("New reply")).toBeVisible();
    await expect(tabB.getByLabel("New reply")).toBeHidden();
  });

  test("shows an origin glyph for non-human-started sessions", async ({ page }) => {
    await mockAllApis(page, {
      sessions: [
        { ...SESSION_A, origin: "scheduler" },
        { ...SESSION_B, origin: "bridge" },
      ],
    });
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();

    const tabA = page.getByTestId(`session-tab-${SESSION_A.id}`);
    const tabB = page.getByTestId(`session-tab-${SESSION_B.id}`);

    await expect(tabA.getByLabel("Started by scheduler")).toBeVisible();
    await expect(tabB.getByLabel("Started by bridge")).toBeVisible();
  });

  test("unread count surfaces on the Chat button after the user leaves /chat", async ({ page }) => {
    // The session-tab bar is chat-only, so its per-tab unread dots
    // unmount off /chat. The aggregate unread count instead rides the
    // always-visible Chat button (SessionCountBadges), so the user can
    // still tell replies are waiting from any page — without that, the
    // unread signal would vanish the moment they navigate away.
    await mockAllApis(page, {
      sessions: [
        { ...SESSION_A, hasUnread: true },
        { ...SESSION_B, hasUnread: true },
      ],
    });

    const chatBtn = page.getByTestId("plugin-launcher-chat");

    // On /chat, the Chat button already carries the unread badge.
    await page.goto("/chat");
    await expect(page.getByText("MulmoClaude")).toBeVisible();
    await expect(chatBtn.getByTestId("session-count-unread")).toBeVisible();

    // Navigate off chat. The tab bar (and its per-tab dots) unmounts,
    // but the unread badge on the Chat button persists — at least one
    // session is still unread.
    await page.goto("/wiki");
    await expect(page.getByTestId(`session-tab-${SESSION_B.id}`)).toBeHidden();
    await expect(chatBtn.getByTestId("session-count-unread")).toBeVisible();
  });
});
