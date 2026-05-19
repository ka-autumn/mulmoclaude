// Component test for the Encore dispatch handler.
//
// Drives `dispatch()` end-to-end through setup → query → amend →
// markStepDone against an isolated tmpdir workspace. Targets the
// real handler module (no HTTP, no MCP bridge) so a failing test
// points at a bug in the handler, schema, or io layer rather than
// transport.
//
// Per-test isolation:
//   - `WORKSPACE_PATHS.encore` is redefined to a tmpdir so on-disk
//     obligation/cycle/ticket files don't leak across cases.
//   - The notifier engine is pointed at tmpdir paths via
//     `_setFilePathsForTesting` so the bell writes go nowhere
//     observable to the user.
// Bell state is asserted by reading the notifier engine's
// active.json directly (we can't stub the ESM-namespace import of
// encoreNotifier inside dispatch / tick).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import { dispatch, type EncoreDispatchResult } from "../../server/encore/dispatch.js";
import { _setFilePathsForTesting, listFor } from "../../server/notifier/engine.js";
import { _resetLockForTesting } from "../../server/encore/lock.js";
import { runTick } from "../../server/encore/tick.js";

let savedEncoreDescriptor: PropertyDescriptor | undefined;
let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "encore-component-"));
  savedEncoreDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "encore");
  Object.defineProperty(WORKSPACE_PATHS, "encore", {
    ...savedEncoreDescriptor,
    value: path.join(workspaceRoot, "data/plugins/encore"),
  });
  _setFilePathsForTesting({
    active: path.join(workspaceRoot, "notifier-active.json"),
    history: path.join(workspaceRoot, "notifier-history.json"),
  });
  _resetLockForTesting();
});

afterEach(() => {
  if (savedEncoreDescriptor) Object.defineProperty(WORKSPACE_PATHS, "encore", savedEncoreDescriptor);
  rmSync(workspaceRoot, { recursive: true, force: true });
});

const hisayoDefinition = {
  version: 1,
  displayName: "Daily payment — Hisayo",
  type: "payment",
  currency: "JPY",
  cadence: { type: "daily" },
  targets: [
    {
      id: "hisayo",
      displayName: "Hisayo",
      defaults: { method: "Cash" },
    },
  ],
  steps: [
    {
      id: "pay",
      displayName: "Pay",
      deadline: "cycle-deadline",
      firingPlan: [{ at: "cycle-start", severity: "info" }],
      fields: ["amount", "method", "paidOn"],
    },
  ],
  formSchema: {
    fields: [
      { name: "amount", type: "number", label: "Amount paid (JPY)", required: true },
      { name: "method", type: "string", label: "Payment method" },
      { name: "paidOn", type: "date", label: "Payment date" },
    ],
  },
};

interface SetupResult extends EncoreDispatchResult {
  obligationId?: string;
  cycleId?: string;
}

interface QueryCycle {
  cycleId: string;
  state: { status: string };
}

interface QueryObligation {
  obligationId: string;
  dsl: { displayName: string; status: string };
  cycles: QueryCycle[];
}

interface QueryResult extends EncoreDispatchResult {
  obligations?: QueryObligation[];
}

describe("Encore dispatch — component tests", () => {
  it("setup writes obligation + first cycle and kicks the tick", async () => {
    const result = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    assert.equal(result.ok, true, `setup failed: ${result.message}`);
    assert.ok(result.obligationId, "setup should return obligationId");
    assert.ok(result.cycleId, "setup should return cycleId");
    // Tick fired a notification — visible via the host notifier
    // engine's plugin-scoped list.
    const entries = await listFor("encore");
    assert.equal(entries.length, 1, `expected exactly 1 bell entry, got ${entries.length}`);
    // DSL severity "info" maps to host severity "nudge" so we can
    // always emit lifecycle: "action" (host rejects action+info).
    // Every Encore bell entry MUST be action-lifecycle so the plugin
    // owns the clear, not the bell.
    assert.equal(entries[0].severity, "nudge");
    assert.equal(entries[0].lifecycle, "action");
    assert.match(entries[0].navigateTarget ?? "", /^\/encore\?pendingId=/);
  });

  it("query (no obligationId) returns every obligation", async () => {
    await dispatch({ kind: "setup", definition: hisayoDefinition });
    const result = (await dispatch({ kind: "query" })) as QueryResult;
    assert.equal(result.ok, true, `query failed: ${result.message}`);
    const { obligations } = result;
    if (!obligations) throw new Error("query should return obligations[]");
    assert.equal(obligations.length, 1);
    assert.equal(obligations[0].dsl.displayName, "Daily payment — Hisayo");
    assert.equal(obligations[0].cycles.length, 1);
  });

  it("query for a specific obligationId returns just that one", async () => {
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const result = (await dispatch({ kind: "query", obligationId: setup.obligationId, range: "all" })) as QueryResult;
    assert.equal(result.ok, true, `query failed: ${result.message}`);
    const { obligations } = result;
    if (!obligations) throw new Error("query should return obligations[]");
    assert.equal(obligations.length, 1);
    assert.equal(obligations[0].obligationId, setup.obligationId);
  });

  it("amendDefinition pauses the obligation", async () => {
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const result = await dispatch({
      kind: "amendDefinition",
      obligationId: setup.obligationId,
      definition: { status: "paused" },
    });
    assert.equal(result.ok, true, `amendDefinition failed: ${result.message}`);
    const queried = (await dispatch({ kind: "query", obligationId: setup.obligationId })) as QueryResult;
    const { obligations } = queried;
    if (!obligations) throw new Error("query should return obligations[]");
    assert.equal(obligations[0].dsl.status, "paused");
  });

  it("amendDefinition refreshes the bell with the new title (in-place update — same id)", async () => {
    // Pre-update-API behaviour: `amendDefinition` set
    // `invalidateAllBells: true`, which cleared every bell for the
    // cycle and republished, dumping `cleared` records into history
    // and allocating a fresh notificationId per bell. With the
    // engine's `update` op, the reconciler's trim path now detects
    // title drift and patches each bell in place — same id, no
    // history record. This test asserts the new contract.
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const before = await listFor("encore");
    assert.equal(before.length, 1, "setup should publish one bell entry");
    const originalId = before[0].id;
    assert.match(before[0].title, /Hisayo/);

    await dispatch({
      kind: "amendDefinition",
      obligationId: setup.obligationId,
      definition: { displayName: "Daily payment — Renamed Person" },
    });

    const after = await listFor("encore");
    assert.equal(after.length, 1, `expected exactly one bell entry after amend, got ${after.length}`);
    assert.equal(after[0].id, originalId, "in-place update must preserve the notificationId");
    assert.match(after[0].title, /Renamed Person/, `expected new title to contain "Renamed Person", got: ${after[0].title}`);

    // Verify the no-history-pollution side of the new contract.
    const { listHistory } = await import("../../server/notifier/engine.js");
    const history = (await listHistory()).filter((entry) => entry.pluginPkg === "encore");
    assert.equal(history.length, 0, "title-only amend must not write to notifier history");
  });

  it("amendDefinition recovers from a stale activeNotificationId (bell empty, cycle file holds an id)", async () => {
    // Reproduces the user-reported case: the host bell got emptied
    // out-of-band (e.g. via the old FYI auto-clear-on-click
    // behavior, or a server restart with an empty active.json), but
    // the cycle file still records the old activeNotificationId.
    // Without the amend-time reset, the next tick would short-
    // circuit (sees activeNotificationId !== null → assumes the
    // bell still has it → never re-fires).
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const before = await listFor("encore");
    assert.equal(before.length, 1);

    // Drain the host bell behind Encore's back.
    const { clear: hostClear } = await import("../../server/notifier/engine.js");
    await hostClear(before[0].id);
    assert.equal((await listFor("encore")).length, 0, "manually cleared the host bell");

    // Now amendDefinition should detect the stale id, null it out,
    // and re-fire fresh.
    await dispatch({
      kind: "amendDefinition",
      obligationId: setup.obligationId,
      definition: { displayName: "Daily payment — Recovered" },
    });
    const after = await listFor("encore");
    assert.equal(after.length, 1, `bell should be repopulated after amend, got ${after.length}`);
    assert.match(after[0].title, /Recovered/);
  });

  it("snooze defers the bell and persists a snoozedSteps marker that survives the same-turn tick", async () => {
    // Reproduces the bug github-actions flagged: previous snooze
    // ran the tick immediately after dropping the ticket, which
    // saw the step as un-fired and re-published. Now snooze must:
    //   1. Clear the bell (drop the ticket).
    //   2. Persist a snoozedSteps[stepId] marker.
    //   3. NOT republish during the same turn.
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const { cycleId } = setup;
    if (!cycleId) throw new Error("setup should return cycleId");
    const before = await listFor("encore");
    assert.equal(before.length, 1, "setup should publish one bell entry");

    const pendingDir = path.join(workspaceRoot, "data/plugins/encore/tickets");
    const entries = await fsPromises.readdir(pendingDir);
    const ticket = JSON.parse(await fsPromises.readFile(path.join(pendingDir, entries[0]), "utf8")) as { pendingId: string };

    await dispatch({
      kind: "snooze",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
      pendingId: ticket.pendingId,
    });

    // Bell must be empty AND must stay empty — even after the next
    // explicit tick within the snooze window (we don't advance the
    // clock in this test, so the snooze should hold).
    const after = await listFor("encore");
    assert.equal(after.length, 0, `bell must clear after snooze; got ${after.length}`);

    // The cycle file should carry the snoozedSteps marker.
    const cyclePath = path.join(workspaceRoot, "data/plugins/encore/obligations", setup.obligationId ?? "", `${cycleId}.md`);
    const cycleRaw = await fsPromises.readFile(cyclePath, "utf8");
    assert.match(cycleRaw, /snoozedSteps:[\s\S]*?pay:/, "cycle file should contain snoozedSteps.pay marker");
  });

  it("snooze re-fires at exactly T+24h, not the day after (lock for the date-vs-timestamp regression)", async () => {
    // Drives runTick() directly with a fake `now` so we can assert
    // the 24h boundary precisely. Without this, the previous bug
    // (lexical compare of snoozedUntil ISO timestamp against
    // date-only `todayIso`) wouldn't be caught — the over-block
    // was by ~24h and only visible at sub-day clock granularity.
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const { cycleId } = setup;
    if (!cycleId) throw new Error("setup should return cycleId");
    const pendingDir = path.join(workspaceRoot, "data/plugins/encore/tickets");
    const initialPending = await fsPromises.readdir(pendingDir);
    const initialTicket = JSON.parse(await fsPromises.readFile(path.join(pendingDir, initialPending[0]), "utf8")) as { pendingId: string };

    // Snooze. The handler stamps `snoozedSteps.pay = now + 24h` on
    // the cycle file; the bell clears. Capture `now` so we can
    // construct precise boundary timestamps below.
    const snoozedAt = new Date();
    await dispatch({
      kind: "snooze",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
      pendingId: initialTicket.pendingId,
    });
    assert.equal((await listFor("encore")).length, 0, "bell must clear immediately after snooze");

    // Tick at T+23h — must still be snoozed.
    const oneHour = 60 * 60 * 1000;
    await runTick({ now: new Date(snoozedAt.getTime() + 23 * oneHour) });
    const at23h = await listFor("encore");
    assert.equal(at23h.length, 0, `bell must stay empty at T+23h (snooze hasn't expired); got ${at23h.length}`);

    // Tick at T+24h+1s — snooze has expired, the tick must re-fire
    // even though it's still calendar-the-same-day as the snooze.
    await runTick({ now: new Date(snoozedAt.getTime() + 24 * oneHour + 1000) });
    const at24h = await listFor("encore");
    assert.equal(at24h.length, 1, `bell must re-fire at T+24h+1s; got ${at24h.length}`);
  });

  it("amendDefinition rejects a `type` change", async () => {
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    await assert.rejects(
      dispatch({ kind: "amendDefinition", obligationId: setup.obligationId, definition: { type: "service" } }),
      /changing `type` is not allowed/,
    );
  });

  it("setup accepts `definition` as a JSON-encoded string (LLM tolerance)", async () => {
    // The LLM commonly JSON.stringify's the `definition` argument.
    // Rejecting that with "expected object, received string" reads
    // as a schema problem and the LLM tends to retry with the same
    // shape. The handler now coerces string → object via JSON.parse
    // before validation so both wire forms work identically.
    const result = (await dispatch({ kind: "setup", definition: JSON.stringify(hisayoDefinition) })) as SetupResult;
    assert.equal(result.ok, true, `setup-from-string failed: ${result.message}`);
    assert.ok(result.obligationId);
    assert.ok(result.cycleId);
  });

  it("setup rejects `definition` strings that aren't valid JSON with a clear message", async () => {
    await assert.rejects(dispatch({ kind: "setup", definition: "{not json" }), /not valid JSON/);
  });

  it("setup rejects `definition` strings that decode to a non-object", async () => {
    await assert.rejects(dispatch({ kind: "setup", definition: "[1,2,3]" }), /must be an object[\s\S]*got array/);
  });

  it("amendDefinition accepts `definition` as a JSON-encoded string (LLM tolerance)", async () => {
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const result = await dispatch({
      kind: "amendDefinition",
      obligationId: setup.obligationId,
      definition: JSON.stringify({ status: "paused" }),
    });
    assert.equal(result.ok, true, `amend-from-string failed: ${result.message}`);
  });

  it("defineEncore without obligationId creates a new obligation (setup path)", async () => {
    // The new structural tool. No obligationId → server-side
    // `handleDefineEncore` routes to `handleSetup`. End state matches
    // the legacy `{ kind: "setup", definition }` flow.
    const result = (await dispatch({ kind: "defineEncore", dsl: hisayoDefinition })) as SetupResult;
    assert.equal(result.ok, true, `defineEncore (setup) failed: ${result.message}`);
    assert.ok(result.obligationId, "defineEncore setup should return obligationId");
    assert.ok(result.cycleId, "defineEncore setup should return cycleId");
    const entries = await listFor("encore");
    assert.equal(entries.length, 1, "first cycle's bell should have fired");
  });

  it("defineEncore with obligationId amends the named obligation (amend path)", async () => {
    const created = (await dispatch({ kind: "defineEncore", dsl: hisayoDefinition })) as SetupResult;
    // Guard: if SetupResult's shape regresses and obligationId is
    // missing, the subsequent amend call would silently fall through
    // to the setup branch (obligationId: undefined) and this test
    // would pass for the wrong reason.
    assert.ok(created.obligationId, "defineEncore setup should return obligationId");
    const result = await dispatch({
      kind: "defineEncore",
      obligationId: created.obligationId,
      dsl: { displayName: "Daily payment — Renamed via defineEncore" },
    });
    assert.equal(result.ok, true, `defineEncore (amend) failed: ${result.message}`);
    const queried = (await dispatch({ kind: "query", obligationId: created.obligationId })) as QueryResult;
    const { obligations } = queried;
    if (!obligations) throw new Error("query should return obligations[]");
    assert.equal(obligations[0].dsl.displayName, "Daily payment — Renamed via defineEncore");
  });

  it('defineEncore with `obligationId: ""` rejects at parse time (not opaque 500)', async () => {
    // Boundary test for the `z.string().trim().min(1).optional()`
    // schema guard. Without it, an empty string would pass
    // `!== undefined` in handleDefineEncore and route to amend, where
    // `obligationIndexPath("")` throws from `assertSafeSegment` and
    // bubbles as an internal error instead of a structured 4xx.
    await assert.rejects(dispatch({ kind: "defineEncore", obligationId: "", dsl: hisayoDefinition }), /invalid args[\s\S]*obligationId/);
  });

  it("defineEncore with whitespace-only `obligationId` rejects at parse time", async () => {
    // The `.trim()` in front of `.min(1)` covers the case where the
    // LLM passes "   " (length-3 string that satisfies `.min(1)`
    // alone but is empty after trim). Without `.trim()`, the value
    // would route to amend and crash inside `assertSafeSegment` (the
    // safe-segment regex rejects leading whitespace) as a non-
    // EncoreError internal failure.
    await assert.rejects(dispatch({ kind: "defineEncore", obligationId: "   ", dsl: hisayoDefinition }), /invalid args[\s\S]*obligationId/);
  });

  it("defineEncore accepts dsl as a JSON-encoded string (same tolerance as setup/amend)", async () => {
    // The coercion path from PR #1433 applies to defineEncore too,
    // because handleDefineEncore reuses handleSetup/handleAmend
    // which run the existing coerceDefinitionToObject helper.
    const result = (await dispatch({ kind: "defineEncore", dsl: JSON.stringify(hisayoDefinition) })) as SetupResult;
    assert.equal(result.ok, true, `defineEncore from string failed: ${result.message}`);
    assert.ok(result.obligationId);
  });

  it("setup on a duplicate displayName rejects with 409 + recovery hint", async () => {
    // Replaces the old auto-numbering (`-2`, `-3`) behavior. The
    // recovery hint tells the LLM the exact obligationId to pass for
    // amend — so if the LLM intended amend but forgot the id, it can
    // self-correct without producing a duplicate.
    await dispatch({ kind: "defineEncore", dsl: hisayoDefinition });
    await assert.rejects(dispatch({ kind: "defineEncore", dsl: hisayoDefinition }), (err: unknown) => {
      const error = err as { status?: number; message?: string };
      assert.equal(error.status, 409, `expected 409, got status ${error.status}`);
      assert.match(error.message ?? "", /already exists/);
      assert.match(error.message ?? "", /defineEncore with obligationId/);
      return true;
    });
  });

  it('setup 409 also fires via the legacy `kind: "setup"` wire shape', async () => {
    // Backward compat — the legacy entry point goes through the
    // same `requireUniqueObligationId` helper, so the 409 is
    // consistent regardless of which tool the call came from.
    await dispatch({ kind: "setup", definition: hisayoDefinition });
    await assert.rejects(dispatch({ kind: "setup", definition: hisayoDefinition }), /already exists/);
  });

  // Note: there is intentionally NO test that invokes
  // `dispatch({ kind: "resolveNotification" })`. That path calls
  // `startChat`, which (a) writes a real session file under
  // ~/mulmoclaude/conversations/chat/<uuid>.json — workspacePath
  // isn't redirectable in tests — and (b) spawns the Claude agent
  // process, which then runs real LLM turns. Both are unacceptable
  // side-effects from a component test. The "bell entry survives a
  // click" invariant is fully captured by the lifecycle assertion
  // in the first test (severity=nudge, lifecycle=action together
  // mean the host bell physically cannot auto-clear on click — see
  // server/notifier/engine.ts and the NotificationBell.vue
  // navigateAndClose logic).

  it("markStepDone on a bundled notification keeps the bell alive until ALL targets close", async () => {
    // Two-target obligation → setup bundles into a single bell entry
    // covering both. Closing one target must NOT clear the shared
    // bell (the other target still needs a chat to resolve it).
    // Caught in PR review by github-actions and codex.
    const twoTargetDef = {
      ...hisayoDefinition,
      displayName: "Daily payments — bundled",
      targets: [
        { id: "alice", displayName: "Alice" },
        { id: "bob", displayName: "Bob" },
      ],
    };
    const setup = (await dispatch({ kind: "setup", definition: twoTargetDef })) as SetupResult;
    const before = await listFor("encore");
    assert.equal(before.length, 1, "two targets must bundle into one bell entry");

    // Read the ticket — should list both targets.
    const pendingDir = path.join(workspaceRoot, "data/plugins/encore/tickets");
    const entries = await fsPromises.readdir(pendingDir);
    const ticketRaw = await fsPromises.readFile(path.join(pendingDir, entries[0]), "utf8");
    const ticket = JSON.parse(ticketRaw) as { pendingId: string; targets: string[] };
    assert.deepEqual([...ticket.targets].sort(), ["alice", "bob"]);

    const { cycleId } = setup;
    if (!cycleId) throw new Error("setup should return cycleId");

    // Close Alice. Bell MUST still have the entry; ticket MUST now
    // list only Bob.
    await dispatch({
      kind: "markStepDone",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "alice",
      stepId: "pay",
      values: { amount: 1000, paidOn: "2026-05-16" },
      pendingId: ticket.pendingId,
    });
    const afterAlice = await listFor("encore");
    assert.equal(afterAlice.length, 1, `bell must persist after partial close; got ${afterAlice.length}`);
    const ticketAfterAlice = JSON.parse(await fsPromises.readFile(path.join(pendingDir, entries[0]), "utf8")) as { targets: string[] };
    assert.deepEqual(ticketAfterAlice.targets, ["bob"], "ticket must drop alice from the bundle");

    // Close Bob — now everyone done, bell clears.
    await dispatch({
      kind: "markStepDone",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "bob",
      stepId: "pay",
      values: { amount: 2000, paidOn: "2026-05-16" },
      pendingId: ticket.pendingId,
    });
    const afterBob = await listFor("encore");
    assert.equal(afterBob.length, 0, "bell must clear when ALL targets are closed");
  });

  it("closing a cycle provisions the next cycle so recurrence continues", async () => {
    // Daily obligation, one target, one step. After markStepDone
    // the cycle closes — the next cycle file MUST exist so future
    // ticks have something to fire against. Without this, recurring
    // obligations stop after one cycle (caught in PR review by
    // github-actions and codex; nextSlot was orphaned in the
    // original landing).
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const { cycleId } = setup;
    if (!cycleId) throw new Error("setup should return cycleId");
    const pendingDir = path.join(workspaceRoot, "data/plugins/encore/tickets");
    const entries = await fsPromises.readdir(pendingDir);
    const ticket = JSON.parse(await fsPromises.readFile(path.join(pendingDir, entries[0]), "utf8")) as { pendingId: string };

    // Close the only step of the only target → cycle closes →
    // provisionNextCycle should fire.
    await dispatch({
      kind: "markStepDone",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
      values: { amount: 5000, paidOn: "2026-05-16" },
      pendingId: ticket.pendingId,
    });

    // List the obligation's cycle files — must be 2 now.
    const obligDir = path.join(workspaceRoot, "data/plugins/encore/obligations", setup.obligationId ?? "");
    const cycleFiles = (await fsPromises.readdir(obligDir)).filter((name) => name !== "index.md" && name.endsWith(".md")).sort();
    assert.equal(cycleFiles.length, 2, `expected closed cycle + new next cycle, got ${cycleFiles.length}: ${cycleFiles.join(", ")}`);
    // The next-cycle file should be lexicographically after the
    // closed one (next day's ISO date for daily).
    assert(cycleFiles[1] > cycleFiles[0], `next cycle should sort after the closed cycle (got ${cycleFiles.join(", ")})`);
  });

  it("markStepDone closes the step and clears the bell", async () => {
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    // After setup, the tick fired and a ticket exists.
    const pendingDir = path.join(workspaceRoot, "data/plugins/encore/tickets");
    const entries = await fsPromises.readdir(pendingDir);
    assert.equal(entries.length, 1, "expected one ticket");
    const ticketRaw = await fsPromises.readFile(path.join(pendingDir, entries[0]), "utf8");
    const ticket = JSON.parse(ticketRaw) as { pendingId: string; notificationId: string };

    const { cycleId } = setup;
    if (!cycleId) throw new Error("setup should return cycleId");

    const result = await dispatch({
      kind: "markStepDone",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
      values: { amount: 5000, paidOn: "2026-05-16" },
      pendingId: ticket.pendingId,
    });
    assert.equal(result.ok, true, `markStepDone failed: ${result.message}`);
    // Bell entry should be cleared.
    const remaining = await listFor("encore");
    assert.equal(remaining.length, 0, `expected bell to be empty after markStepDone, found ${remaining.length} entries`);
  });

  it("unsnooze republishes the bell in the same dispatch turn (no tick wait)", async () => {
    // The pre-reconciler architecture had no way to undo a snooze
    // before its 24h timer expired; the LLM had to call markStepDone
    // (falsely) or markTargetSkipped (falsely) or hand-edit the file.
    // Under the unified reconciler, unsnooze is the inverse of snooze
    // and the bell republishes in the same turn — the publish
    // happens inside the reconcile call that follows the unsnooze
    // mutator, not via a tick.
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const { cycleId } = setup;
    if (!cycleId) throw new Error("setup should return cycleId");
    const pendingDir = path.join(workspaceRoot, "data/plugins/encore/tickets");
    const initialEntries = await fsPromises.readdir(pendingDir);
    const initialTicket = JSON.parse(await fsPromises.readFile(path.join(pendingDir, initialEntries[0]), "utf8")) as { pendingId: string };

    await dispatch({
      kind: "snooze",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
      pendingId: initialTicket.pendingId,
    });
    assert.equal((await listFor("encore")).length, 0, "bell must clear after snooze");

    await dispatch({
      kind: "unsnooze",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
    });
    const after = await listFor("encore");
    assert.equal(after.length, 1, `bell must republish in the same turn as unsnooze; got ${after.length}`);
  });

  it("unsnooze on a step that wasn't snoozed is a no-op (no flicker)", async () => {
    // Idempotency. If the LLM calls unsnooze on a step that's not
    // currently snoozed, the existing bell must NOT flicker
    // (clear+republish would change the notification id and re-ring
    // the host bell). Verified by checking that the notification id
    // stays the same across the no-op unsnooze.
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const { cycleId } = setup;
    if (!cycleId) throw new Error("setup should return cycleId");
    const before = await listFor("encore");
    assert.equal(before.length, 1);
    const originalId = before[0].id;

    await dispatch({
      kind: "unsnooze",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
    });
    const after = await listFor("encore");
    assert.equal(after.length, 1, "bell count unchanged");
    assert.equal(after[0].id, originalId, "notification id must not change (no clear+republish flicker)");
  });

  it("snooze → unsnooze round-trip: bell present → gone → present", async () => {
    // End-to-end round-trip exercising both handlers through one
    // chat. The post-unsnooze bell is a freshly-published one (new
    // notification id), but it must be present.
    const setup = (await dispatch({ kind: "setup", definition: hisayoDefinition })) as SetupResult;
    const { cycleId } = setup;
    if (!cycleId) throw new Error("setup should return cycleId");
    const present1 = await listFor("encore");
    assert.equal(present1.length, 1, "stage 1: setup published bell");

    await dispatch({
      kind: "snooze",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
    });
    assert.equal((await listFor("encore")).length, 0, "stage 2: snooze cleared bell");

    await dispatch({
      kind: "unsnooze",
      obligationId: setup.obligationId,
      cycleId,
      targetId: "hisayo",
      stepId: "pay",
    });
    const present2 = await listFor("encore");
    assert.equal(present2.length, 1, "stage 3: unsnooze republished bell");
  });
});
