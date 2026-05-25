// L-FRESH-BOOT: real first-run-user smoke for mulmoclaude.
//
// Spawns a fully isolated dev server (HOME + workspace + port all
// overridden) and walks the boot path the way an actual new user
// would — empty `~/mulmoclaude/`, empty `~/.claude/skills/`, fresh
// session token, single LLM round-trip — without touching the
// developer's running `yarn dev` or any host-side state.
//
// The plan source for this scenario lives in
// `plans/feat-e2e-live.md` (search for "L-FRESH-BOOT").

import { existsSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { SESSION_URL_PATTERN, getCurrentSessionId } from "../fixtures/live-chat.ts";
import { ISOLATED_SERVER_DEFAULT_BOOT_BUDGET_MS, assertHostUntouched, spawnIsolatedDevServer, stopIsolatedDevServer } from "../fixtures/isolated-dev-server.ts";

// Whole-spec timeout: the spec includes a Vite build (cold) + a
// server boot + a real LLM round-trip. Boot budget covers the
// build + listen; the 1-turn LLM dispatch reuses the per-role
// 2-minute observation from L-06..L-09 plus headroom for the
// fresh-workspace MCP catalog warmup that L-06 doesn't pay.
const FRESH_BOOT_TIMEOUT_MS = ISOLATED_SERVER_DEFAULT_BOOT_BUDGET_MS + 5 * ONE_MINUTE_MS;
const SINGLE_TURN_TIMEOUT_MS = 3 * ONE_MINUTE_MS;

// Fresh-user smoke spec spawns a heavyweight subprocess and binds an
// isolated port. Serial-only because parallel boots would multiply
// CPU / RAM / port pressure for no diagnostic gain — the assertion
// targets are independent of suite parallelism.
test.describe.configure({ mode: "serial" });

test.describe("fresh-user smoke (real LLM)", () => {
  test("L-FRESH-BOOT: 空 workspace + 空 HOME から 1 ターン完走", async ({ page }, testInfo) => {
    test.setTimeout(FRESH_BOOT_TIMEOUT_MS);

    // The marker is decoded by the LLM verbatim from the prompt. Per
    // L-06 / L-22 the "single word: X" pattern is the most reliable
    // way to get a deterministic echo without burning a tool call.
    const nonce = `${Date.now().toString(36)}-${testInfo.workerIndex}`;
    const marker = `okfresh-${nonce}`;

    const server = await spawnIsolatedDevServer({ testId: testInfo.title });
    try {
      // (a) /api/health responds. `spawnIsolatedDevServer` already
      // polled `/api/health` until it returned 200 — we re-issue
      // here so the Playwright trace shows the green light verbatim
      // (caller-visible proof, not just a successful spawn helper).
      // `/api/health` is bearer-protected, so we pass the pinned
      // token the helper generated; without it the route 401s and
      // the spec would fail mid-air on what looks like an auth bug.
      const healthResponse = await page.request.get(`${server.baseUrl}/api/health`, {
        headers: { Authorization: `Bearer ${server.authToken}` },
      });
      expect(healthResponse.ok(), "/api/health must respond 200 after fresh boot").toBe(true);

      // (b) Workspace dir structure was auto-initialised. We check
      // a small representative set rather than every dir to keep
      // the assertion grep-able when the layout shifts — these are
      // the three buckets a first-time user always sees populate:
      // conversations/ (chat persistence), config/ (settings +
      // helps), and the runtime `.session-token` write that proves
      // bearer auth is wired before the SPA loads.
      for (const rel of ["conversations/chat", "config/helps"]) {
        const abs = path.join(server.workspaceDir, rel);
        expect(existsSync(abs), `${rel} should be auto-created inside the fresh workspace`).toBe(true);
      }
      expect(
        existsSync(path.join(server.workspaceDir, ".session-token")),
        ".session-token should be written into the fresh workspace before the listener accepts traffic",
      ).toBe(true);

      // (c) Bearer token is substituted into the served index.html
      // `<meta name="mulmoclaude-auth">`. Hit `/` once via
      // `page.request` so we read the HTTP body without paying the
      // full SPA hydrate cost, and grep the meta tag directly. The
      // placeholder string MUST be gone — if it stayed, every API
      // call would 401 and the 1-turn assertion below would mask
      // the real failure (silent auth bug masquerading as agent
      // timeout).
      const indexResponse = await page.request.get(`${server.baseUrl}/`);
      expect(indexResponse.status(), "GET / should serve index.html with HTTP 200").toBe(200);
      const html = await indexResponse.text();
      const metaMatch = /<meta\s+name="mulmoclaude-auth"\s+content="([^"]*)"/.exec(html);
      expect(metaMatch, "<meta name=mulmoclaude-auth> tag must be present in served index.html").not.toBeNull();
      const tokenInHtml = metaMatch === null ? "" : metaMatch[1];
      expect(tokenInHtml.length, "auth token content attribute must not be empty").toBeGreaterThan(0);
      expect(tokenInHtml.includes("__MULMOCLAUDE_AUTH_TOKEN__"), "placeholder must be replaced with the real bearer token before serving").toBe(false);

      // (d) Drive a one-turn chat through the SPA. We use the same
      // testids the other live specs use (`new-session-btn`,
      // `user-input`, `send-btn`, `thinking-indicator`,
      // `text-response-assistant-body`) so any future test-id
      // rename pulls this spec along automatically.
      await page.goto(`${server.baseUrl}/`);
      await page.getByTestId("new-session-btn").click();
      await page.waitForURL(SESSION_URL_PATTERN, { timeout: ONE_MINUTE_MS });
      const sessionId = getCurrentSessionId(page);
      expect(sessionId, "URL should settle on /chat/<id> after new-session-btn click").not.toBeNull();

      await page.getByTestId("user-input").fill(`Reply with the single word: ${marker}`);
      await page.getByTestId("send-btn").click();
      await expect(
        page.getByTestId("text-response-assistant-body").last(),
        "assistant body must echo the marker — proves the full boot → agent → response loop",
      ).toContainText(marker, { timeout: SINGLE_TURN_TIMEOUT_MS });
      await expect(page.getByTestId("thinking-indicator")).toBeHidden({ timeout: 30 * ONE_SECOND_MS });
    } finally {
      // Stop the server BEFORE the host-untouched check — a stray
      // late write (PostToolUse hook, shutdown hook, etc.) needs to
      // be allowed to land in the temp workspace so we can prove it
      // did not escape. `stopIsolatedDevServer` waits for SIGTERM
      // grace before SIGKILL fallback.
      await stopIsolatedDevServer(server);

      // (e) Host paths untouched. The strongest isolation contract
      // — if any of `~/mulmoclaude/` or `~/.claude/skills/` has a
      // newer mtime than the pre-spawn baseline, the override
      // failed somewhere (probably a `homedir()` call that
      // bypassed the env). Tests that catch this early avoid a
      // class of bugs where the user's real workspace gets
      // silently mutated across CI runs.
      await assertHostUntouched(server.hostBaselines);
    }
  });
});
