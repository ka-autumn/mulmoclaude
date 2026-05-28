import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { deleteSession, readSessionToolCalls, sendChatMessage, setupRoleSession, waitForAssistantTurn } from "../fixtures/live-chat.ts";

// Per-test wall-time budget for a single one-turn dispatch canary.
// Empirically real-LLM one-turn tool calls land well under 90s; the
// 3-minute ceiling matches the rest of skills.spec.ts so a slow run
// fails as a timeout (recoverable rerun) rather than as a flaky
// assertion timeout (silent flake).
const DISPATCH_TIMEOUT_MS = 3 * ONE_MINUTE_MS;

// MCP prefix the host bridge prepends to every plugin-owned tool
// when the agent enumerates its tool catalog (see
// `server/agent/prompt.ts` MCP_PREFIX_HINT). Asserting on the
// prefixed form is what makes these canaries catch regressions where
// the bridge drops a plugin from the catalog, or re-prefixes it
// under a different server name — both shapes have shipped before
// and only the prefixed-name assertion catches them.
const MCP_PREFIX = "mcp__mulmoclaude__";

// One-turn dispatch canary covering plugins that have never had an
// e2e-live test before (see `plans/feat-e2e-live.md` §「未踏 plugin
// の 1 ターン dispatch test 棚卸し」). The shape is uniform across
// the file: pick the simplest role that exposes the tool, send a
// prompt that names the tool by literal, wait for the agent turn,
// read the per-session jsonl trace, assert ≥1 tool_call record
// matches the expected MCP-prefixed tool name. Skip on
// `E2E_LIVE_NO_LLM=1` (fake-echo cannot route MCP dispatch).
//
// Why jsonl-only and not a View-mount assertion: 3 of the 8 plugins
// here have no top-level chat-inline View testid (todo / markdown /
// spreadsheet), 1 mounts a generic SchedulerView shared with the
// standalone route (calendar / automations), and 1 is narrate-only
// from chat (accounting createBook does not mount the openBook
// envelope). A uniform jsonl assertion gives one shape across all 8
// — adding View testids per plugin is a separate refactor (out of
// scope for this canary PR).
//
// Specs run in parallel — each owns a fresh session pair and a
// nonce-stamped marker (where the tool args carry a marker), so
// there is no cross-spec state.
test.describe.configure({ mode: "parallel" });

interface PluginDispatchCase {
  /** Test id, used in the test title and as the cleanup-side debug tag. */
  testId: string;
  /** Built-in role id whose `availablePlugins` lists this plugin. */
  role: string;
  /** Plain MCP tool name as declared in the plugin's `definition.ts`. */
  toolName: string;
  /** Prompt body, designed to land the tool in one turn with no narration. */
  prompt: string;
}

/**
 * Asserts the per-session jsonl trace contains ≥1 `tool_call` record
 * for the MCP-prefixed `toolName`. Read after `waitForAssistantTurn`
 * has resolved — the jsonl flushes per-event and is empty until the
 * first record lands, so the gate is required to avoid a fast-path
 * race against an indicator that detached before the agent fired.
 */
async function expectToolDispatched(sessionId: string, toolName: string): Promise<void> {
  const expectedName = `${MCP_PREFIX}${toolName}`;
  const calls = await readSessionToolCalls(sessionId);
  const matched = calls.filter((call) => call.toolName === expectedName);
  expect(
    matched.length,
    `expected at least one ${expectedName} tool_call in jsonl trace (saw: ${calls.map((call) => call.toolName).join(", ") || "<none>"})`,
  ).toBeGreaterThan(0);
}

/**
 * Drive one plugin's canary: switch into the role that exposes the
 * tool, send the prompt, drain the turn, assert dispatch landed.
 * Each call drains its own sessions in `finally` so a mid-test throw
 * still cleans up both the auto-created General-side session and
 * the role-switched session.
 */
async function runDispatchCase(page: Page, kase: PluginDispatchCase): Promise<void> {
  test.setTimeout(DISPATCH_TIMEOUT_MS);
  const sessionsToCleanup: string[] = [];
  try {
    const sessionId = await setupRoleSession(page, kase.role, sessionsToCleanup);
    await sendChatMessage(page, kase.prompt);
    await waitForAssistantTurn(page);
    await expectToolDispatched(sessionId, kase.toolName);
  } finally {
    for (const sid of sessionsToCleanup) {
      await deleteSession(page, sid);
    }
  }
}

test.describe("plugin dispatch (real LLM, one-turn canaries)", () => {
  test.skip(process.env.E2E_LIVE_NO_LLM === "1", "needs real LLM dispatch (fake-echo backend cannot route MCP tool calls)");

  test("L-DISPATCH-TODO: Personal role + manageTodoList が一ターンで dispatch される", async ({ page }) => {
    await runDispatchCase(page, {
      testId: "L-DISPATCH-TODO",
      role: "personal",
      toolName: "manageTodoList",
      prompt: ["Use the `manageTodoList` tool to add one todo titled 'L-DISPATCH-TODO canary'.", "Do not use any other tool. Do not narrate the result."].join(
        " ",
      ),
    });
  });

  test("L-DISPATCH-CAL: Personal role + manageCalendar が一ターンで dispatch される", async ({ page }) => {
    await runDispatchCase(page, {
      testId: "L-DISPATCH-CAL",
      role: "personal",
      toolName: "manageCalendar",
      prompt: [
        "Use the `manageCalendar` tool to add a calendar event titled 'L-DISPATCH-CAL canary' on 2099-12-31.",
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
    });
  });

  // manageAutomations is intentionally NOT covered here: per the
  // comment in `src/config/roles.ts:252` (settings-role split into
  // three preset skills) the `manageAutomations` MCP tool is no
  // longer in any built-in role's `availablePlugins`, so an LLM
  // cannot dispatch it from a normal chat session. A one-turn
  // dispatch canary for it would need a custom role gate change
  // — out of scope for this PR. Tracked in plan §「未踏 plugin
  // の 1 ターン dispatch test 棚卸し」 as 対象外, same status as
  // manageRoles / manageSource. The /automations route + view-mount
  // are already covered by L-HAPPY-TOUR step 11.

  test("L-DISPATCH-MD: General role + presentDocument が一ターンで dispatch される", async ({ page }) => {
    await runDispatchCase(page, {
      testId: "L-DISPATCH-MD",
      role: "general",
      toolName: "presentDocument",
      prompt: [
        "Use the `presentDocument` tool to render this markdown verbatim: '# L-DISPATCH-MD canary'.",
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
    });
  });

  test("L-DISPATCH-XLS: Office role + presentSpreadsheet が一ターンで dispatch される", async ({ page }) => {
    await runDispatchCase(page, {
      testId: "L-DISPATCH-XLS",
      role: "office",
      toolName: "presentSpreadsheet",
      prompt: [
        "Use the `presentSpreadsheet` tool to render one sheet with header [Month, Sales] and one row [Jan, 100].",
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
    });
  });

  test("L-DISPATCH-SVG: Artist role + presentSVG が一ターンで dispatch される", async ({ page }) => {
    await runDispatchCase(page, {
      testId: "L-DISPATCH-SVG",
      role: "artist",
      toolName: "presentSVG",
      prompt: [
        'Use the `presentSVG` tool to render this SVG verbatim: \'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>\'.',
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
    });
  });

  test("L-DISPATCH-HTML: Office role + presentHtml が一ターンで dispatch される", async ({ page }) => {
    await runDispatchCase(page, {
      testId: "L-DISPATCH-HTML",
      role: "office",
      toolName: "presentHtml",
      prompt: [
        "Use the `presentHtml` tool to render this HTML verbatim: '<!doctype html><html><body><h1>L-DISPATCH-HTML canary</h1></body></html>'.",
        "Do not use presentDocument. Do not use any other tool. Do not narrate the result.",
      ].join(" "),
    });
  });

  test("L-DISPATCH-ACCT: Accounting role + manageAccounting が一ターンで dispatch される", async ({ page }) => {
    await runDispatchCase(page, {
      testId: "L-DISPATCH-ACCT",
      role: "accounting",
      toolName: "manageAccounting",
      prompt: [
        "Use the `manageAccounting` tool with action='createBook' to create a new book named 'L-DISPATCH-ACCT canary', currency='USD', country='US'.",
        "Do not call openBook afterwards. Do not use any other tool. Do not narrate the result.",
      ].join(" "),
    });
  });
});
