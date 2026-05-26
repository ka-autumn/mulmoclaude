// E2E regression for session-wide map grouping in StackView (#1227 /
// Codex review on #1504).
//
// Two `mapControl` results that share a `groupId` collapse into ONE
// stack card (the View accumulates markers / routes). Grouping is
// session-wide, not contiguous: a card can sit between the two
// same-group calls. That broke two assumptions in StackView's scroll
// code, which had treated `toolResults` order as 1:1 with the rendered
// cards:
//
//   * scroll-spy could flip the active card back to the merged group
//     when a later member's uuid resolved to the group's earlier
//     element;
//   * the latest-result watcher always slammed scrollTop to the
//     bottom, even when the newest result merged into an EARLIER card.
//
// The decision logic is unit-tested in test_stackGrouping.ts. These two
// tests guard the real Vue watcher / DOM wiring (nextTick +
// scrollIntoView + scroll-suppression + the passive scroll-spy
// listener) for BOTH paths, over the non-contiguous `A(g1), B, C(g1)`
// shape that regressed.
//
// Sessions are PRELOADED via the transcript fetch (deterministic; live
// pub/sub events race the fetch and get overwritten). `mapControl`
// stands in for the cards because text-response tool results are folded
// into the assistant text stream rather than rendered as their own
// card.

import { test, expect, type Locator, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { mockAgentWithPubSub, waitForScrollHeightStable, scrollMetrics } from "../fixtures/pubsub";
import { SESSION_A } from "../fixtures/sessions";

import { ONE_SECOND_MS } from "../../server/utils/time.ts";

// With no Google Maps API key configured (the default e2e mock), the
// map View renders this placeholder — measurable height, no network.
const MAP_PLACEHOLDER = "API key not configured";
const SELECTED_CARD_CLASS = /border-blue-400/;
const SCROLL_SPY_TARGET = "scroll-spy target card";

function mapData(action: string, groupId: string) {
  return { action, location: "Tokyo", groupId };
}

function mapEntry(uuid: string, action: string, groupId: string) {
  return {
    type: "tool_result",
    source: "tool",
    result: { toolName: "mapControl", uuid, message: `Map operation ${action}`, data: mapData(action, groupId) },
  };
}

function textEntry(source: "user" | "assistant", message: string) {
  return { type: "text", source, message };
}

const META_ENTRY = { type: "session_meta", roleId: "general", sessionId: SESSION_A.id };

// Serve a custom transcript for SESSION_A; fall back to the default
// mock for any other session id.
async function serveTranscript(page: Page, entries: readonly unknown[]): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/sessions/${SESSION_A.id}`,
    (route) => (route.request().method() === "GET" ? route.fulfill({ json: entries }) : route.fallback()),
  );
}

// Stack layout is a localStorage preference; set it before navigating
// so the first render is already in stack mode.
async function openStackSession(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("canvas_layout_mode", "stack"));
  await page.goto(`/chat/${SESSION_A.id}`);
  await expect(page.getByText(MAP_PLACEHOLDER).first()).toBeVisible({ timeout: 5 * ONE_SECOND_MS });
}

// A stack card is a direct child of the scroll container; locate one by
// the text it contains.
function stackCard(page: Page, hasText: string | RegExp): Locator {
  return page.getByTestId("stack-scroll").locator("> div").filter({ hasText });
}

async function expectNotBottomPinned(page: Page): Promise<void> {
  const { scrollTop, scrollHeight, clientHeight } = await scrollMetrics(page, "stack-scroll");
  expect(scrollHeight).toBeGreaterThan(clientHeight); // container actually overflows
  const BOTTOM_TOLERANCE_PX = 50;
  expect(scrollHeight - scrollTop - clientHeight).toBeGreaterThan(BOTTOM_TOLERANCE_PX);
}

test.describe("StackView — session-wide map grouping (#1227)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    // Defensive: never hit the real Maps JS even if a key leaks in.
    await page.route(/maps\.googleapis\.com/, (route) => route.abort());
  });

  // ── latest-result auto-scroll path (`latestResultScrollKey` watcher) ──
  //
  // Preload A(g1) + B(g2); stream a live C(g1) AFTER the load settles (a
  // startDelayMs avoids racing the transcript fetch). C's arrival fires
  // the watcher with the newest result belonging to the EARLIER g1 card.
  // A tall turn between the two map cards separates them by more than a
  // viewport, so "scrolled to g1" and "bottom-pinned" are distinct.
  test("a newly streamed same-groupId result merges into its earlier card and scrolls there, not to the bottom", async ({ page }) => {
    const tallTurn = textEntry("assistant", "An assistant turn long enough to push the two map cards a viewport apart. ".repeat(80));
    const transcript = [
      META_ENTRY,
      textEntry("user", "Plan my Tokyo trip"),
      mapEntry("map-a", "showLocation", "trip-g1"),
      tallTurn,
      mapEntry("map-b", "showLocation", "other-g2"),
    ];
    const liveC = { type: "tool_result", result: { toolName: "mapControl", uuid: "map-c", message: "addMarker", data: mapData("addMarker", "trip-g1") } };
    const streamAfterLoadMs = 1200;

    await serveTranscript(page, transcript);
    await mockAgentWithPubSub(page, [liveC], { startDelayMs: streamAfterLoadMs });
    await openStackSession(page);
    await expect(page.getByText(MAP_PLACEHOLDER)).toHaveCount(2); // g1 = A, g2 = B

    await page.waitForTimeout(streamAfterLoadMs);
    await waitForScrollHeightStable(page, "stack-scroll");

    // C merged into the g1 card — still two cards, never three — and the
    // watcher scrolled to that (first) card rather than the bottom.
    await expect(page.getByText(MAP_PLACEHOLDER)).toHaveCount(2);
    await expect(page.getByText(MAP_PLACEHOLDER).first()).toBeInViewport();
    await expectNotBottomPinned(page);
  });

  // ── scroll-spy active-card path (`computeActiveUuidFromScroll`) ──
  //
  // Preload the full non-contiguous sequence A(g1), B(text), C(g1): the
  // g1 group (A, C) renders first, the B text card last. Scrolling to B
  // must select B — the regression resolved B's neighbour C back to the
  // group element above and wrongly selected the group instead.
  test("scrolling to the B card selects B, not the merged group whose member arrived after B", async ({ page }) => {
    const tallTargetText = `${SCROLL_SPY_TARGET}. `.repeat(120);
    const transcript = [
      META_ENTRY,
      textEntry("user", "Plan my Tokyo trip"),
      mapEntry("map-a", "showLocation", "trip-g1"),
      textEntry("assistant", tallTargetText),
      mapEntry("map-c", "addMarker", "trip-g1"),
    ];

    await serveTranscript(page, transcript);
    await openStackSession(page);
    await expect(page.getByText(MAP_PLACEHOLDER)).toHaveCount(1); // A + C merged into one g1 card

    // Let the load's auto-scroll + its suppression window clear, then
    // scroll to the bottom so the B card's top crosses the active line.
    await page.waitForTimeout(500);
    await page.getByTestId("stack-scroll").hover();
    await page.mouse.wheel(0, 6000);

    // Scroll-spy selected B (highlight ring), not the earlier g1 group
    // whose later member (C) sits above B in the flat result list.
    await expect(stackCard(page, SCROLL_SPY_TARGET)).toHaveClass(SELECTED_CARD_CLASS);
    await expect(stackCard(page, MAP_PLACEHOLDER)).not.toHaveClass(SELECTED_CARD_CLASS);
  });
});
