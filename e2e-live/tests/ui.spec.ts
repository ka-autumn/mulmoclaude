import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  clearNotifierEntry,
  deleteSession,
  getCurrentSessionId,
  listNotifierEntries,
  sendChatMessage,
  startBridgeOriginAgentRun,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForSessionIdle,
} from "../fixtures/live-chat.ts";

const L17_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const L18_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L19_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const L20_TIMEOUT_MS = ONE_MINUTE_MS;
// pluginPresentForm.* keys exist; the regression shape is one of
// them leaking into the rendered DOM when a translation lookup
// misses. Asserting "no `pluginPresentForm.` substring is visible
// inside the rendered form" catches that without coupling to any
// specific locale.
const PRESENT_FORM_RAW_KEY_PREFIX = "pluginPresentForm.";

// Each scenario is independent — L-19 spins up its own chat session,
// L-20 stays on a static route — so run them in parallel to cut wall
// time. Same justification as media.spec.ts / wiki-nav.spec.ts.
test.describe.configure({ mode: "parallel" });

/**
 * Pull `sessionId` off a notifier entry's opaque `pluginData`. Used
 * by L-17 to identify entries produced by the legacy
 * `publishNotification()` wrapper (see
 * `server/events/notifications.ts` — `LegacyNotifierPluginData.sessionId`
 * is set when the original caller passed `opts.sessionId`, which is
 * exactly the shape the PR #818 commented-out block produces). Returns
 * `null` when the entry's pluginData is missing, not an object, or
 * carries no string `sessionId` — so it's safe to chain into the L-17
 * filter without intermediate null checks.
 */
function pluginDataSessionId(pluginData: unknown): string | null {
  if (pluginData === null || typeof pluginData !== "object") return null;
  const { sessionId } = pluginData as { sessionId?: unknown };
  return typeof sessionId === "string" ? sessionId : null;
}

test.describe("ui (real LLM / static)", () => {
  test("L-17: bridge-origin agent run はベルバッジを点灯させない (B-50)", async ({ page }) => {
    test.setTimeout(L17_TIMEOUT_MS);
    // Covers B-50 ("二重通知"): a non-human-origin agent run (the
    // typical real-world trigger is a bridge message landing) used to
    // light up BOTH the notification bell (via `publishNotification()`
    // in `runAgentInBackground`'s finally block) AND the Session
    // History side panel's unread badge (via `endRun()` flipping
    // `session.hasUnread = true`). Two badges for one event was the
    // duplicate-notification user report — fixed by PR #818
    // (`fix/skip-bell-on-bridge-completion`) commenting out the
    // `publishNotification(...)` block. See `server/api/routes/agent.ts`
    // around line 985.
    //
    // The regression we want to catch: someone uncomments that block
    // (or re-introduces equivalent logic) and the bell starts ticking
    // again on every bridge / scheduler / skill turn.
    //
    // Strategy: POST `/api/agent` directly from the browser with
    // `origin: "bridge"` — this is the *only* origin Playwright can
    // produce without a real bridge WebSocket connection, and
    // /api/agent already accepts the field (server/api/routes/agent.ts
    // line 121, 219). The UI button flow (`startNewSession` +
    // `sendChatMessage`) always produces `origin: "human"`, which
    // never enters the buggy code path — so the test must bypass the
    // UI for the publish trigger. Then wait for the agent run to
    // finish (`waitForSessionIdle`), and assert the active notifier
    // entry count is unchanged. Works under both backends — fake-echo
    // (`MULMOCLAUDE_FAKE_AGENT=1`) and real Claude — because the
    // origin gate in agent.ts is upstream of any LLM call.
    await page.goto("/");
    const bell = page.getByTestId("notification-bell");
    await expect(bell, "notification-bell must mount on the top chrome").toBeVisible();

    // Snapshot active entries pre-run. We don't compare the full
    // id-set blindly (Codex iter-1 review): an unrelated background
    // publisher firing during the test window — ghost-bell recovery
    // or the todo plugin's action lifecycle — would
    // add new ids and false-fail the assertion. Instead, we look for
    // the *specific shape* PR #818 commented out: a
    // `publishNotification({ kind: NOTIFICATION_KINDS.agent, sessionId:
    // chatSessionId })` from agent.ts's finally block. That call ends
    // up at `engine.publish` with `pluginPkg === "agent"` (via
    // `legacyKindToPluginPkg`) and `pluginData.sessionId` carrying the
    // bridge run's session id (via `LegacyNotifierPluginData`). No
    // other publisher carries OUR specific session id, so the filter
    // is immune to test-window noise without losing precision on the
    // exact regression shape.
    const baselineEntries = await listNotifierEntries(page);
    const baselineIds = new Set(baselineEntries.map((entry) => entry.id));

    let bridgeSessionId: string | null = null;
    let spuriousNotifierIds: string[] = [];
    try {
      // The prompt is intentionally innocuous: we don't care what the
      // agent says, only that `runAgentInBackground`'s finally block
      // runs with `params.origin === "bridge"`. "General" is the
      // canonical role that exists in every workspace fixture.
      bridgeSessionId = await startBridgeOriginAgentRun(page, "Say hi.", "general");
      await waitForSessionIdle(page, bridgeSessionId);

      // B-50 regression assertion. Look only at entries that match
      // BOTH the agent-kind pluginPkg AND our specific bridge session
      // id — see snapshot comment above for why this filter is the
      // PR #818 regression's precise shape.
      const postEntries = await listNotifierEntries(page);
      spuriousNotifierIds = postEntries
        .filter((entry) => !baselineIds.has(entry.id))
        .filter((entry) => entry.pluginPkg === "agent" && pluginDataSessionId(entry.pluginData) === bridgeSessionId)
        .map((entry) => entry.id);
      expect(
        spuriousNotifierIds,
        "bridge-origin agent completion must NOT add notifier entries tagged with our session id — B-50 regression (agent.ts publishNotification re-enabled?)",
      ).toEqual([]);
    } finally {
      // Defensive cleanup: if the regression IS real, the spurious
      // entries would otherwise survive in
      // `~/mulmoclaude/data/notifier/active.json` and pollute every
      // subsequent run's bell. Clear in failure-tolerant fashion so
      // a single clear failure doesn't mask the assertion error.
      for (const entryId of spuriousNotifierIds) {
        await clearNotifierEntry(page, entryId).catch(() => {});
      }
      if (bridgeSessionId !== null) await deleteSession(page, bridgeSessionId);
    }
  });

  test("L-18: presentForm の i18n キーが raw 文字列として DOM に漏れない", async ({ page }) => {
    // fake-echo detects `presentForm` in the prompt + the `id='...'
    // label='...'` shape, posts to /api/form (the same endpoint the
    // MCP bridge uses for real Claude), and emits the result as the
    // tool_call_result. The View mounts off the artifact.
    test.setTimeout(L18_TIMEOUT_MS);
    // Covers B-34: when presentForm was promoted from external
    // plugin to built-in, the i18n keys (pluginPresentForm.submit
    // / .submitted / .progress / ...) were not migrated to the
    // shared dictionary, so the raw key strings rendered verbatim
    // in place of the translated copy. The fix (PR #845) wired
    // them up; the canary here is the absence of the raw-key
    // prefix anywhere inside the rendered presentForm view.
    //
    // Strategy: ask the agent to render a presentForm via the tool
    // (single text field, no validation) so the form mounts with
    // the static labels (submit button, progress counter) plus any
    // LLM-authored field copy. Whichever route the agent picks
    // (deferred ToolSearch + presentForm or direct call), the
    // resulting view is what users see, and that's the surface we
    // assert on.
    const userPrompt =
      "Use the presentForm tool to display a single-field form titled 'Quick check'. Add one required text field with id='nickname', label='Nickname', and a short description. No other fields. Do not submit it for me.";
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, userPrompt);
      // Capture the session id BEFORE the form-mount assertion
      // (codex iter-1 leak fix): if presentForm never mounts the
      // assertion below times out, but the chat session was
      // already created the moment sendChatMessage's POST landed.
      // Waiting on the URL pattern is the same shape roles.spec.ts
      // uses for early capture and is bounded by the default nav
      // timeout (60s), so a stuck session creation surfaces as a
      // distinct waitForURL failure rather than leaking the
      // session into history.
      await page.waitForURL(/\/chat\/[0-9a-f-]+/);
      sessionIdForCleanup = getCurrentSessionId(page);

      // The form view is the tool-result render; mount-time is
      // bounded by a single LLM round-trip, so ONE_MINUTE_MS is
      // ample. We wait for it before the assistant turn fully
      // finishes — Claude often emits closing prose AFTER the
      // tool call lands, and that prose is not where B-34 hid.
      const formView = page.getByTestId("present-form-view");
      await expect(formView, "presentForm view must render after the tool call").toBeVisible({ timeout: ONE_MINUTE_MS });

      // B-34 canary — the i18n key prefix must not appear in the
      // rendered text. `not.toContainText` reads the visible text
      // of the matched element; raw `t("pluginPresentForm.submit")`
      // would spill the literal "pluginPresentForm.submit" here.
      await expect(formView, "presentForm DOM must not contain raw i18n keys (B-34 canary)").not.toContainText(PRESENT_FORM_RAW_KEY_PREFIX);

      // Drain the assistant turn so trace / video record the full
      // tool round-trip rather than cutting off mid-stream once
      // the assertion above lands.
      await waitForAssistantResponseComplete(page);
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });

  test("L-19: stack layout で 1 ターン後 reload しても stack-scroll が再描画される", async ({ page }) => {
    // Any completed turn (real Claude or fake-echo) seeds the stack;
    // the assertion is on the reload-restore behavior, not on the
    // LLM's reasoning.
    test.setTimeout(L19_TIMEOUT_MS);
    // Covers B-31: tool-call history used to drop on reload because
    // the stack view's `toolResults` was rebuilt from the in-memory
    // turn stream rather than the persisted session record. The fix
    // hydrates from the session jsonl on mount, so reload should keep
    // `stack-scroll` mounted (and `stack-empty` hidden). A single-word
    // prompt is enough — even the assistant's textResponse reply
    // counts as a stack entry, so we don't need to coerce a tool
    // call to populate the panel.
    //
    // The default canvas layout is `single` (App.vue gates StackView
    // on `layoutMode === 'stack'`), so `stack-scroll` only mounts
    // after the user opts into stack mode. We seed the localStorage
    // key before the first navigation so both the initial render and
    // the post-reload render land in stack layout — that matches the
    // human-side reproduction path for B-31 (a stack-mode user notices
    // their turns disappearing on reload).
    const userPrompt = "Reply with the single word: stack";
    let sessionIdForCleanup: string | null = null;
    try {
      // addInitScript runs before every navigation (including reload),
      // so the stack preference survives the page.reload() below
      // without re-injecting after the second navigation.
      await page.addInitScript(() => {
        window.localStorage.setItem("canvas_layout_mode", "stack");
      });
      await startNewSession(page);
      await sendChatMessage(page, userPrompt);
      await waitForAssistantResponseComplete(page);
      sessionIdForCleanup = getCurrentSessionId(page);

      // Pre-reload: the assistant's reply must have at least one
      // entry in the stack (textResponse view). If this fails the
      // bug is upstream of B-31 (stack never populated in the first
      // place), so the assertion message stays distinct from the
      // post-reload one for diagnosability.
      await expect(page.getByTestId("stack-scroll"), "stack must be populated after the first turn (pre-reload)").toBeVisible();
      await expect(page.getByTestId("stack-empty"), "stack-empty must be hidden once a turn has landed").toBeHidden();

      await page.reload();

      // Post-reload: B-31's regression shape — the stack flips back
      // to the empty placeholder because hydration didn't refill
      // toolResults. Assert both the positive (stack still mounted)
      // and the negative (placeholder didn't reappear) so we catch
      // either side of the regression.
      await expect(page.getByTestId("stack-scroll"), "stack must rehydrate from the session record after reload — B-31 canary").toBeVisible();
      await expect(page.getByTestId("stack-empty"), "stack-empty must stay hidden after reload — B-31 canary").toBeHidden();
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });

  test("L-20: 旧形式 /files?path=foo.md は新形式 /files/foo.md に書き換わる", async ({ page }) => {
    test.setTimeout(L20_TIMEOUT_MS);
    // Covers B-30 (URL-shape side): the legacy query-string form
    // `/files?path=…` must be silently rewritten to the new path
    // form `/files/…` by the router guard. Reload is a safety
    // net — the rewrite is `replace: true` so it should land in
    // history once and stay; we re-check after reload to make sure
    // the guard does not bounce the URL on every navigation.
    //
    // No file actually has to exist at the target path — we are
    // testing the router guard in isolation, not the file fetch.
    // `e2e-live-l20-nonexistent.md` is intentionally not seeded so
    // the cleanup story stays trivial (nothing to remove).
    const targetFile = "e2e-live-l20-nonexistent.md";
    await page.goto(`/files?path=${encodeURIComponent(targetFile)}`);
    await expect(page).toHaveURL(new RegExp(`/files/${targetFile}$`));
    await expect(page).not.toHaveURL(/\?path=/);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/files/${targetFile}$`));
    await expect(page).not.toHaveURL(/\?path=/);
  });
});
