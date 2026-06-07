// Shared API mock helpers for Playwright tests.
//
// IMPORTANT: Playwright matches routes in REVERSE registration order
// (last registered is checked first). So we register the catch-all
// FIRST and specific routes AFTER, ensuring specific handlers take
// priority.

import type { Page, Route } from "@playwright/test";
import { SESSION_A, SESSION_B, makeSessionEntries, type SessionFixture } from "./sessions";

function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

function urlStartsWith(prefix: string): (url: URL) => boolean {
  return (url) => url.pathname.startsWith(prefix);
}

/** Pull the `action` field out of a `/api/notifier` POST body. The
 *  prime() flow sends `{action: "list"}` then `{action: "listHistory"}`;
 *  the bell's user actions send `{action: "clear" | "cancel", id}`. */
function parseDispatchAction(body: string | null): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as { action?: unknown };
    return typeof parsed.action === "string" ? parsed.action : undefined;
  } catch {
    return undefined;
  }
}

const DEFAULT_ROLES: unknown[] = [];

const DEFAULT_HEALTH = {
  status: "OK",
  geminiAvailable: true,
  sandboxEnabled: false,
};

export interface MockApiOptions {
  sessions?: SessionFixture[];
}

export async function mockAllApis(page: Page, opts: MockApiOptions = {}): Promise<void> {
  const sessions = opts.sessions ?? [SESSION_A, SESSION_B];

  // Catch-all FIRST (checked last by Playwright)
  await page.route(urlStartsWith("/api/"), (route: Route) => {
    const method = route.request().method();
    const url = route.request().url();
    console.warn(`[mock] unhandled: ${method} ${url}`);
    return route.fulfill({
      status: 501,
      json: { error: "Unhandled mocked API route", method, url },
    });
  });

  // Specific routes AFTER (checked first by Playwright)
  await page.route(urlEndsWith("/api/health"), (route) => route.fulfill({ json: DEFAULT_HEALTH }));

  // `/api/sandbox` mirrors the real server's empty-object contract
  // when the sandbox is off (#329). Tests that need the enabled
  // branch override this route BEFORE calling mockAllApis —
  // Playwright checks last-registered-first.
  await page.route(urlEndsWith("/api/sandbox"), (route) => route.fulfill({ json: {} }));

  await page.route(urlEndsWith("/api/roles"), (route) => route.fulfill({ json: DEFAULT_ROLES }));

  // Pinned launcher shortcuts. Stateful within a page: GET returns the
  // current list, PUT replaces it and echoes back — so pin/unpin specs
  // exercise the full round-trip (and App.vue's boot GET stays quiet)
  // without a backend. Specs needing a seeded list override before
  // mockAllApis (Playwright checks last-registered-first).
  let shortcutsState: unknown[] = [];
  await page.route(urlEndsWith("/api/shortcuts"), (route) => {
    const method = route.request().method();
    if (method === "PUT") {
      try {
        const body = JSON.parse(route.request().postData() ?? "{}") as { shortcuts?: unknown[] };
        shortcutsState = Array.isArray(body.shortcuts) ? body.shortcuts : [];
      } catch {
        shortcutsState = [];
      }
      return route.fulfill({ json: { shortcuts: shortcutsState } });
    }
    if (method === "GET") return route.fulfill({ json: { shortcuts: shortcutsState } });
    return route.fallback();
  });

  await page.route(urlEndsWith("/api/sessions"), (route) => {
    if (route.request().method() === "GET") {
      // Envelope shape from #205. Any test that wants to simulate
      // a diff can override this route with its own handler — the
      // catch-all always returns the full list and an empty
      // deletedIds, which is the first-call / cold-start answer.
      return route.fulfill({
        json: { sessions, cursor: "v1:0", deletedIds: [] },
      });
    }
    return route.fallback();
  });

  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.pathname !== "/api/sessions",
    (route) => {
      const method = route.request().method();
      // POST /api/sessions/:id/mark-read
      if (method === "POST") {
        return route.fulfill({ json: { ok: true } });
      }
      // GET /api/sessions/:id
      if (method !== "GET") return route.fallback();
      const sessionId = route.request().url().split("/api/sessions/").pop() ?? "";
      const match = sessions.find((session) => session.id === sessionId);
      if (match) {
        return route.fulfill({ json: makeSessionEntries(match.id) });
      }
      return route.fulfill({ status: 404, json: { error: "not found" } });
    },
  );

  // Defensive defaults for the broader runtime-plugin surface — the
  // boot path queries these on every page load. Empty responses are
  // safe for tests that don't exercise plugin install / diagnostics.
  await page.route(urlEndsWith("/api/plugins/runtime/list"), (route) => route.fulfill({ json: [] }));
  await page.route(urlEndsWith("/api/plugins/diagnostics"), (route) => route.fulfill({ json: [] }));

  // Notifier engine — every page load primes via list + listHistory.
  // Empty defaults keep specs that don't care about notifications
  // quiet (no 501s, no [mock] unhandled warnings); specs that do care
  // override with a more specific page.route() before mockAllApis.
  await page.route(urlEndsWith("/api/notifier"), (route) => {
    // Server only accepts POST. A non-POST request reaching this
    // mock means a caller is using the wrong verb — let the request
    // fall through so the real failure surfaces in the test instead
    // of being papered over by the mock returning 200.
    if (route.request().method() !== "POST") return route.fallback();
    const action = parseDispatchAction(route.request().postData());
    if (action === "listHistory") return route.fulfill({ json: { history: [] } });
    if (action === "clear" || action === "cancel") return route.fulfill({ json: { ok: true } });
    return route.fulfill({ json: { entries: [] } });
  });

  // Server returns a plain array of { name, enabled, requiredEnv, prompt }
  // (see server/mcp-tools/index.ts). The old object-wrapped shape used
  // here was wrong but hidden by the client's try/catch swallowing the
  // .filter TypeError on non-array responses.
  await page.route(urlStartsWith("/api/mcp-tools"), (route) => route.fulfill({ json: [] }));

  // SuggestionsPanel calls /api/skills on every panel open. Default to
  // an empty list so tests that don't care about skills don't trip the
  // [mock] unhandled warning.
  await page.route(urlEndsWith("/api/skills"), (route) => route.fulfill({ json: { skills: [] } }));

  await page.route(urlStartsWith("/api/chat-index"), (route) => route.fulfill({ json: {} }));

  await page.route(urlEndsWith("/api/files/tree"), (route) =>
    route.fulfill({
      json: { name: "", path: "", type: "dir", children: [] },
    }),
  );

  // Lazy-expand endpoint (Phase 2 of #200). Returns an empty dir by
  // default; specific tests override with their own fixtures (see
  // e2e/tests/file-explorer.spec.ts).
  await page.route(urlEndsWith("/api/files/dir"), (route) =>
    route.fulfill({
      json: { name: "", path: "", type: "dir", children: [] },
    }),
  );

  // Default Settings response. Per-test specs (e.g. settings.spec.ts)
  // can override with a later page.route() which wins due to
  // Playwright's reverse-order matching.
  await page.route(urlEndsWith("/api/config"), (route) =>
    route.fulfill({
      json: { settings: { extraAllowedTools: [] }, mcp: { servers: [] } },
    }),
  );

  // Default agent mock — returns 202 (fire-and-forget). Tests that
  // need to deliver events should register their own route + WS mock
  // AFTER calling mockAllApis.
  await page.route(urlEndsWith("/api/agent"), (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 202,
      json: { chatSessionId: "mock-session" },
    });
  });

  // Agent cancel endpoint
  await page.route(urlEndsWith("/api/agent/cancel"), (route) => route.fulfill({ json: { ok: true } }));
}
