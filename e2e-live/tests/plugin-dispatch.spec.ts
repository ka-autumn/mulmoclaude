import { randomUUID } from "node:crypto";

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { deleteSession, readSessionToolCalls, sendChatMessage, setupRoleSession, waitForAssistantTurn } from "../fixtures/live-chat.ts";
import { isRecord } from "../../server/utils/types.ts";

// Per-test wall-time budget. Some specs do two LLM turns (add +
// chat-driven delete), so the ceiling is a little roomier than the
// L-21 / L-21B 3-minute budget that only runs a single turn.
const DISPATCH_TIMEOUT_MS = 5 * ONE_MINUTE_MS;

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
// the 7 specs in this file: nonce-stamp a per-test marker, pick the
// simplest role that exposes the tool, send a prompt that names the
// tool by literal AND embeds the marker so it lands in the saved
// data, wait for the agent turn, read the per-session jsonl trace,
// assert >=1 tool_call record matches the expected MCP-prefixed
// tool name, then ask the SAME chat session to delete what was
// just created (where the plugin exposes a delete action). Skip
// on `E2E_LIVE_NO_LLM=1` (fake-echo cannot route MCP dispatch).
//
// Why jsonl-only and not a View-mount assertion: 3 of the 7 plugins
// here have no top-level chat-inline View testid (todo / markdown /
// spreadsheet), 1 mounts a generic SchedulerView shared with the
// standalone route (calendar), and 1 is narrate-only from chat
// (accounting createBook does not mount the openBook envelope).
// A uniform jsonl assertion gives one shape across all 7 — adding
// View testids per plugin is a separate refactor (out of scope
// for this canary PR).
//
// Why cleanup is a second chat turn (todo / calendar / accounting):
// these plugins expose a delete action through the same MCP tool,
// so asking the LLM to delete what it just created exercises the
// full add+delete round-trip via the LLM API — same surface area
// the test is meant to canary. A bug in the delete action shows up
// as leftover marker data after the run, surfaced visibly to the
// developer. Filesystem-level deletion would bypass the tool path
// entirely and lose that coverage. The 4 artifact-plugin specs
// (md / xls / svg / html) skip the cleanup turn because their
// `present*` tools have no delete counterpart — every saved file
// is meant to persist as a workspace artifact. The marker in the
// saved content keeps test-authored artifacts identifiable in
// `/files` so the developer can manually purge them later.
//
// Why per-test nonce: parallel runs and pre-existing user state
// must not collide with cleanup. A nonce-stamped marker also
// guarantees that any leftover artifact is unambiguously
// attributable to this test (`L-DISPATCH-MD-canary-<nonce>` in the
// markdown body / SVG title / spreadsheet sheet name).
//
// Specs run in parallel — each owns a fresh session pair and a
// unique nonce-stamped marker, so there is no cross-spec state.
test.describe.configure({ mode: "parallel" });

interface PluginDispatchCase {
  /** Test id, used in the test title and as the cleanup-side debug tag. */
  testId: string;
  /** Built-in role id whose `availablePlugins` lists this plugin. */
  role: string;
  /** Plain MCP tool name as declared in the plugin's `definition.ts`. */
  toolName: string;
  /**
   * Marker string the test asks the LLM to embed in the saved
   * artifact (todo text / event title / document body / cell value /
   * SVG <title> / HTML body / book name). Used by `cleanupPrompt`
   * to scope deletion to exactly this test's data.
   */
  marker: string;
  /** Prompt body, designed to land the tool in one turn with no narration. */
  prompt: string;
  /**
   * Optional follow-up prompt that asks the SAME session to delete
   * the marker-stamped item. Present for plugins whose tool exposes
   * a delete action (todo / calendar / accounting); omitted for the
   * 4 `present*` artifact plugins where no delete tool exists.
   */
  cleanupPrompt?: string;
  /**
   * Required when `cleanupPrompt` is set: the literal value of the
   * MCP tool's `action` argument the cleanup turn MUST invoke
   * (`delete` for todo / calendar, `deleteBook` for accounting).
   * Used by the post-cleanup assertion to prove the agent actually
   * dispatched the delete branch — without it the cleanup turn
   * could narrate / ToolSearch / silently no-op and still let the
   * spec pass green (Codex iter-2 review).
   */
  expectedCleanupAction?: string;
}

/** Per-test unique marker suffix (epoch ms + 6 hex chars). */
function makeMarker(testId: string): string {
  return `${testId}-canary-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

/**
 * Asserts the per-session jsonl trace contains >=1 `tool_call` record
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
 * Count tool_calls already recorded against this session that
 * target the MCP-prefixed `toolName` with `args.action` equal to
 * `expectedAction`. Used as a baseline before the cleanup turn so
 * the post-cleanup assertion is turn-scoped: instead of "is there
 * any delete call in session history" (which an earlier add turn
 * could accidentally satisfy if it dispatched a delete pre-cleanup),
 * we assert "the cleanup turn dispatched ≥1 NEW delete call".
 * Codex iter-3 flagged this distinction.
 */
async function countToolActionCalls(sessionId: string, toolName: string, expectedAction: string): Promise<number> {
  const expectedName = `${MCP_PREFIX}${toolName}`;
  const calls = await readSessionToolCalls(sessionId);
  return calls.filter((call) => call.toolName === expectedName && isRecord(call.args) && call.args.action === expectedAction).length;
}

/**
 * Post-cleanup-turn assertion: prove the cleanup turn ITSELF (not
 * just session history) dispatched ≥1 tool_call to the same MCP
 * tool with `args.action` equal to the expected delete literal.
 * Without this gate the cleanup turn could narrate / ToolSearch
 * loop / no-op and leave the marker behind, but the test still
 * passes — Codex iter-2 hit that hole. Iter-3 refined the gate to
 * compare against a baseline taken BEFORE the cleanup prompt was
 * sent, so an earlier delete dispatched in the same session cannot
 * satisfy the assertion.
 */
async function expectDeleteActionDispatched(sessionId: string, toolName: string, expectedAction: string, baselineCount: number): Promise<void> {
  const expectedName = `${MCP_PREFIX}${toolName}`;
  const calls = await readSessionToolCalls(sessionId);
  const sameToolCalls = calls.filter((call) => call.toolName === expectedName);
  const totalDeleteCalls = sameToolCalls.filter((call) => isRecord(call.args) && call.args.action === expectedAction).length;
  const newDeleteCalls = totalDeleteCalls - baselineCount;
  expect(
    newDeleteCalls,
    `expected the cleanup turn to dispatch at least one ${expectedName} tool_call with args.action='${expectedAction}' (saw actions in session: ${
      sameToolCalls.map((call) => (isRecord(call.args) ? String(call.args.action ?? "<no-action>") : "<non-object-args>")).join(", ") || "<no-matching-tool>"
    }, baseline pre-cleanup=${baselineCount})`,
  ).toBeGreaterThan(0);
}

/**
 * Drive one plugin's canary: switch into the role that exposes the
 * tool, send the prompt, drain the turn, assert dispatch landed.
 * If a cleanup prompt is provided, snapshot the existing
 * delete-action call count, send the cleanup prompt as a second
 * turn in the same session, drain that turn, then assert the
 * cleanup turn dispatched at least one NEW delete-action call (so
 * a pre-existing delete in session history cannot satisfy it).
 * The session pair is always deleted in `finally`, regardless of
 * whether either turn passed.
 */
async function runDispatchCase(page: Page, kase: PluginDispatchCase): Promise<void> {
  test.setTimeout(DISPATCH_TIMEOUT_MS);
  const sessionsToCleanup: string[] = [];
  try {
    const sessionId = await setupRoleSession(page, kase.role, sessionsToCleanup);
    await sendChatMessage(page, kase.prompt);
    await waitForAssistantTurn(page);
    await expectToolDispatched(sessionId, kase.toolName);
    if (kase.cleanupPrompt !== undefined && kase.expectedCleanupAction !== undefined) {
      const baselineDeleteCount = await countToolActionCalls(sessionId, kase.toolName, kase.expectedCleanupAction);
      await sendChatMessage(page, kase.cleanupPrompt);
      await waitForAssistantTurn(page);
      await expectDeleteActionDispatched(sessionId, kase.toolName, kase.expectedCleanupAction, baselineDeleteCount);
    }
  } finally {
    for (const sid of sessionsToCleanup) {
      await deleteSession(page, sid);
    }
  }
}

test.describe("plugin dispatch (real LLM, one-turn canaries)", () => {
  test.skip(process.env.E2E_LIVE_NO_LLM === "1", "needs real LLM dispatch (fake-echo backend cannot route MCP tool calls)");

  test("L-DISPATCH-TODO: Personal role + manageTodoList が一ターンで dispatch される", async ({ page }) => {
    const marker = makeMarker("L-DISPATCH-TODO");
    await runDispatchCase(page, {
      testId: "L-DISPATCH-TODO",
      role: "personal",
      toolName: "manageTodoList",
      marker,
      prompt: [
        `Use the \`manageTodoList\` tool to add one todo whose text is EXACTLY '${marker}' (verbatim, no edits).`,
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
      cleanupPrompt: [
        `Now delete every todo whose text equals EXACTLY '${marker}'.`,
        "Use the manageTodoList tool with action='delete' (look it up via ToolSearch if needed).",
        "Do not narrate the result.",
      ].join(" "),
      expectedCleanupAction: "delete",
    });
  });

  test("L-DISPATCH-CAL: Personal role + manageCalendar が一ターンで dispatch される", async ({ page }) => {
    const marker = makeMarker("L-DISPATCH-CAL");
    await runDispatchCase(page, {
      testId: "L-DISPATCH-CAL",
      role: "personal",
      toolName: "manageCalendar",
      marker,
      prompt: [
        `Use the \`manageCalendar\` tool to add a calendar event whose title is EXACTLY '${marker}' (verbatim) on 2099-12-31.`,
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
      cleanupPrompt: [
        `Now delete every calendar event whose title equals EXACTLY '${marker}'.`,
        "Use the manageCalendar tool with action='delete'.",
        "Do not narrate the result.",
      ].join(" "),
      expectedCleanupAction: "delete",
    });
  });

  test("L-DISPATCH-MD: General role + presentDocument が一ターンで dispatch される", async ({ page }) => {
    const marker = makeMarker("L-DISPATCH-MD");
    await runDispatchCase(page, {
      testId: "L-DISPATCH-MD",
      role: "general",
      toolName: "presentDocument",
      marker,
      prompt: [
        `Use the \`presentDocument\` tool to render this markdown verbatim: '# ${marker}'.`,
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
      // presentDocument has no delete tool; the saved
      // `artifacts/documents/<YYYY>/<MM>/*.md` is a persistent
      // workspace artifact, identifiable by the marker in its body.
    });
  });

  test("L-DISPATCH-XLS: Office role + presentSpreadsheet が一ターンで dispatch される", async ({ page }) => {
    const marker = makeMarker("L-DISPATCH-XLS");
    await runDispatchCase(page, {
      testId: "L-DISPATCH-XLS",
      role: "office",
      toolName: "presentSpreadsheet",
      marker,
      prompt: [
        `Use the \`presentSpreadsheet\` tool to render one sheet named '${marker}' with header [Month, Sales] and one row [Jan, 100].`,
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
      // presentSpreadsheet has no delete tool — see L-DISPATCH-MD note.
    });
  });

  test("L-DISPATCH-SVG: Artist role + presentSVG が一ターンで dispatch される", async ({ page }) => {
    const marker = makeMarker("L-DISPATCH-SVG");
    await runDispatchCase(page, {
      testId: "L-DISPATCH-SVG",
      role: "artist",
      toolName: "presentSVG",
      marker,
      prompt: [
        `Use the \`presentSVG\` tool to render this SVG verbatim: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${marker}</title><rect width="10" height="10" fill="red"/></svg>'.`,
        "Do not use any other tool. Do not narrate the result.",
      ].join(" "),
      // presentSVG has no delete tool — see L-DISPATCH-MD note.
    });
  });

  test("L-DISPATCH-HTML: Office role + presentHtml が一ターンで dispatch される", async ({ page }) => {
    const marker = makeMarker("L-DISPATCH-HTML");
    await runDispatchCase(page, {
      testId: "L-DISPATCH-HTML",
      role: "office",
      toolName: "presentHtml",
      marker,
      prompt: [
        `Use the \`presentHtml\` tool to render this HTML verbatim: '<!doctype html><html><body><h1>${marker}</h1></body></html>'.`,
        "Do not use presentDocument. Do not use any other tool. Do not narrate the result.",
      ].join(" "),
      // presentHtml has no delete tool — see L-DISPATCH-MD note.
    });
  });

  test("L-DISPATCH-ACCT: Accounting role + manageAccounting が一ターンで dispatch される", async ({ page }) => {
    const marker = makeMarker("L-DISPATCH-ACCT");
    await runDispatchCase(page, {
      testId: "L-DISPATCH-ACCT",
      role: "accounting",
      toolName: "manageAccounting",
      marker,
      prompt: [
        `Use the \`manageAccounting\` tool with action='createBook' to create a new book whose name is EXACTLY '${marker}' (verbatim), currency='USD', country='US'.`,
        "Do not call openBook afterwards. Do not use any other tool. Do not narrate the result.",
      ].join(" "),
      cleanupPrompt: [
        `Now delete the book whose name equals EXACTLY '${marker}'.`,
        "Use the manageAccounting tool with action='getBooks' first to find the bookId, then action='deleteBook' with confirm=true.",
        "Do not narrate the result.",
      ].join(" "),
      expectedCleanupAction: "deleteBook",
    });
  });
});
