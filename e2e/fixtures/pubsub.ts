// Shared harness for driving the app's real pub/sub WebSocket from
// Playwright: mock `/api/agent`, accept the Socket.IO handshake, and
// relay a scripted sequence of `data` events on whichever
// `session.<id>` channel the client subscribes to. Used by the
// streaming auto-scroll regression and the stack map-grouping scroll
// regression — both exercise StackView's real watcher/DOM wiring.

import type { Page, Route } from "@playwright/test";

export function urlEndsWith(suffix: string): (url: URL) => boolean {
  return (url) => url.pathname === suffix;
}

interface MockSocket {
  send: (data: string) => void;
}

// Relay a sequence of pub/sub events to the mocked WebSocket with a
// small gap between each send so Vue re-renders between events.
const RENDER_GAP_MS = 20;

interface StreamOptions {
  // Delay before the first event is sent, after the client subscribes.
  // Use when the events must land AFTER an async transcript fetch has
  // populated the session, so they append rather than race the load.
  startDelayMs?: number;
}

async function streamEventsToSocket(webSocket: MockSocket, channel: string, events: readonly unknown[], opts: StreamOptions): Promise<void> {
  if (opts.startDelayMs) await new Promise((resolve) => setTimeout(resolve, opts.startDelayMs));
  for (const event of events) {
    webSocket.send(`42${JSON.stringify(["data", { channel, data: event }])}`);
    await new Promise((resolve) => setTimeout(resolve, RENDER_GAP_MS));
  }
  webSocket.send(`42${JSON.stringify(["data", { channel, data: { type: "session_finished" } }])}`);
}

function handleSocketFrame(text: string, webSocket: MockSocket, events: readonly unknown[], opts: StreamOptions): void {
  if (text === "2") {
    webSocket.send("3");
    return;
  }
  if (text === "40") {
    webSocket.send(`40${JSON.stringify({ sid: "mock-socket-sid" })}`);
    return;
  }
  if (!text.startsWith("42")) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(2));
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  const [name, arg] = parsed as [string, unknown];
  if (name !== "subscribe" || typeof arg !== "string" || !arg.startsWith("session.")) return;
  void streamEventsToSocket(webSocket, arg, events, opts);
}

// Accept the Socket.IO handshake and relay the scripted events on the
// session channel the client subscribes to.
async function mockPubSubSocket(page: Page, events: readonly unknown[], opts: StreamOptions): Promise<void> {
  await page.routeWebSocket(
    (url) => url.pathname.startsWith("/ws/pubsub"),
    (webSocket) => {
      const handshake = { sid: "mock-sid", upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1_000_000 };
      webSocket.send(`0${JSON.stringify(handshake)}`);
      webSocket.onMessage((msg) => handleSocketFrame(String(msg), webSocket, events, opts));
    },
  );
}

// Stub POST /api/agent so the client believes a run started.
async function mockAgentEndpoint(page: Page): Promise<void> {
  await page.route(urlEndsWith("/api/agent"), (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
  });
}

export async function mockAgentWithPubSub(page: Page, events: readonly unknown[], opts: StreamOptions = {}): Promise<void> {
  await mockPubSubSocket(page, events, opts);
  await mockAgentEndpoint(page);
}

/** Wait until scrollHeight stops growing for two consecutive samples,
 *  meaning streaming has finished and the DOM has settled. Throws on
 *  timeout so a never-settling stream surfaces as a clear failure
 *  rather than silently letting downstream assertions run on a moving
 *  target. */
export async function waitForScrollHeightStable(page: Page, testId: string, opts: { sampleGapMs?: number; maxWaitMs?: number } = {}): Promise<void> {
  const gap = opts.sampleGapMs ?? 300;
  const maxWait = opts.maxWaitMs ?? 10_000;
  const deadline = Date.now() + maxWait;
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const current = await page.getByTestId(testId).evaluate((elem) => elem.scrollHeight);
    if (current === last && current > 0) {
      stable++;
      if (stable >= 2) return;
    } else {
      stable = 0;
      last = current;
    }
    await page.waitForTimeout(gap);
  }
  throw new Error(`waitForScrollHeightStable: "${testId}" scrollHeight never stabilised within ${maxWait}ms`);
}

/** Read scrollTop + scrollHeight + clientHeight from a scroll container. */
export async function scrollMetrics(page: Page, testId: string): Promise<{ scrollTop: number; scrollHeight: number; clientHeight: number }> {
  return page.getByTestId(testId).evaluate((elem) => ({
    scrollTop: elem.scrollTop,
    scrollHeight: elem.scrollHeight,
    clientHeight: elem.clientHeight,
  }));
}
