// Reconciler unit tests — state in, state out, no SSE.
//
// These tests exercise `reconcileCycleNotifications` directly. The
// dispatch-level tests in test_encore_dispatch.ts cover handler →
// reconciler wiring; here we pin down the reconciler's invariants
// in isolation so a future refactor that breaks them surfaces at
// the right place.
//
// Per-test isolation mirrors the dispatch test suite:
//   - `WORKSPACE_PATHS.encore` redirected to a tmpdir per test
//   - notifier engine pointed at tmpdir paths
//   - per-plugin lock reset between tests

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, promises as fsPromises } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { WORKSPACE_PATHS } from "../../server/workspace/paths.js";
import { _setFilePathsForTesting, clearForPlugin, listFor } from "../../server/notifier/engine.js";
import { _resetLockForTesting } from "../../server/encore/lock.js";
import { dispatch, type EncoreDispatchResult } from "../../server/encore/dispatch.js";
import { reconcileCycleNotifications } from "../../server/encore/reconcile.js";
import { parseCycleFile, recordStepSnooze, serializeCycleFile } from "../../server/encore/cycle.js";
import { runTick } from "../../server/encore/tick.js";

let savedEncoreDescriptor: PropertyDescriptor | undefined;
let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "encore-reconcile-"));
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

const twoTargetDef = {
  version: 1,
  displayName: "Daily payments — bundled",
  type: "payment",
  currency: "JPY",
  cadence: { type: "daily" },
  targets: [
    { id: "alice", displayName: "Alice" },
    { id: "bob", displayName: "Bob" },
  ],
  steps: [
    {
      id: "pay",
      displayName: "Pay",
      deadline: "cycle-deadline",
      firingPlan: [{ at: "cycle-start", severity: "info" }],
      fields: ["amount"],
    },
  ],
  formSchema: {
    fields: [{ name: "amount", type: "number", label: "Amount", required: true }],
  },
};

interface SetupResult extends EncoreDispatchResult {
  obligationId?: string;
  cycleId?: string;
}

async function readCycleRaw(obligationId: string, cycleId: string): Promise<string> {
  const cyclePath = path.join(workspaceRoot, "data/plugins/encore/obligations", obligationId, `${cycleId}.md`);
  return fsPromises.readFile(cyclePath, "utf8");
}

async function writeCycleRaw(obligationId: string, cycleId: string, raw: string): Promise<void> {
  const cyclePath = path.join(workspaceRoot, "data/plugins/encore/obligations", obligationId, `${cycleId}.md`);
  await fsPromises.writeFile(cyclePath, raw);
}

async function pendingDirEntries(): Promise<string[]> {
  const dir = path.join(workspaceRoot, "data/plugins/encore/tickets");
  return fsPromises.readdir(dir);
}

// ── notifier-boundary static-guard helpers ──────────────────────
//
// Walk each non-allowed source file under server/encore/, find lines
// that call encoreNotifier.{publish,clear}, and filter out hits
// inside the two documented allowed functions (handleOrphanResolve,
// pruneOneTicket). We track a tiny brace-depth machine to know when
// we've exited the allowed function body.

interface NotifierViolation {
  file: string;
  lineNumber: number;
  line: string;
}

const NOTIFIER_BOUNDARY_ALLOWED_FILES = new Set(["reconcile.ts", "notifier.ts"]);
const NOTIFIER_BOUNDARY_ALLOWED_FUNCTIONS = /async function (handleOrphanResolve|pruneOneTicket)\b/;
const NOTIFIER_CALL = /encoreNotifier\.(publish|clear)\b/;
// Skip single-line `//` and block-comment-continuation `*` lines so
// that documentation legitimately mentioning the API symbol (e.g.
// "calls `encoreNotifier.clear` directly because…") doesn't trip
// the call detector. Only actual call sites should fail this guard.
const COMMENT_LINE = /^\s*(?:\/\/|\*)/;

function countBraces(line: string): { opens: number; closes: number } {
  let opens = 0;
  let closes = 0;
  for (const char of line) {
    if (char === "{") opens += 1;
    else if (char === "}") closes += 1;
  }
  return { opens, closes };
}

// Mutable scope tracker for the allowed-function brace scanner. Once
// the scanner sees an allowed function declaration, it waits for the
// first `{` (body entry — handles multi-line headers), then exits
// when braceDepth returns to 0. The earlier "exit when braceDepth
// === 0 && opens > 0" was a bug — on a closing-brace-only line
// `opens === 0`, so the flag never reset and every line below the
// allowed function was silently skipped (caught by review on PR #1433).
interface AllowedScopeState {
  inAllowedFn: boolean;
  entered: boolean;
  braceDepth: number;
}

function makeScopeState(): AllowedScopeState {
  return { inAllowedFn: false, entered: false, braceDepth: 0 };
}

function advanceScope(state: AllowedScopeState, line: string): void {
  if (NOTIFIER_BOUNDARY_ALLOWED_FUNCTIONS.test(line)) {
    state.inAllowedFn = true;
    state.entered = false;
    state.braceDepth = 0;
  }
  if (!state.inAllowedFn) return;
  const { opens, closes } = countBraces(line);
  state.braceDepth += opens - closes;
  if (!state.entered && state.braceDepth > 0) state.entered = true;
  if (state.entered && state.braceDepth <= 0) {
    state.inAllowedFn = false;
    state.entered = false;
  }
}

function collectFileViolations(file: string, raw: string): NotifierViolation[] {
  const out: NotifierViolation[] = [];
  const lines = raw.split("\n");
  const scope = makeScopeState();
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    advanceScope(scope, line);
    if (scope.inAllowedFn) continue;
    if (COMMENT_LINE.test(line)) continue;
    if (NOTIFIER_CALL.test(line)) {
      out.push({ file, lineNumber: lineIdx + 1, line: line.trim() });
    }
  }
  return out;
}

function formatViolationList(violations: NotifierViolation[]): string {
  const detail = violations.map((entry) => `  ${entry.file}:${entry.lineNumber} ${entry.line}`).join("\n");
  return `unexpected encoreNotifier.publish/clear outside reconcile.ts and documented orphan-sweep paths:\n${detail}`;
}

describe("Encore reconciler — unit tests", () => {
  it("trim symmetry: closed + snoozed both trim the bundle, bell clears", async () => {
    // The load-bearing invariant. `isPairInBundle` must treat closed
    // and snoozed identically; otherwise the snooze handler's bell
    // would re-fire on the same dispatch turn (the pre-reconciler
    // bug that forced snooze to skip the tick).
    const setup = (await dispatch({ kind: "setup", definition: twoTargetDef })) as SetupResult;
    const { obligationId, cycleId } = setup;
    if (!obligationId || !cycleId) throw new Error("setup should return ids");

    // Setup published one bundled bell entry covering both targets.
    assert.equal((await listFor("encore")).length, 1, "setup should publish one bell entry");

    // Close Alice via markStepDone (writes completedSteps + reconciles
    // → ticket trims to [bob], bell stays).
    await dispatch({
      kind: "markStepDone",
      obligationId,
      cycleId,
      targetId: "alice",
      stepId: "pay",
      values: { amount: 1000 },
    });
    assert.equal((await listFor("encore")).length, 1, "bell must persist after closing one of two");

    // Snooze Bob via snooze handler (writes snoozedSteps + reconciles
    // → ticket trims to [], bell clears). If snoozed were NOT treated
    // as out-of-bundle, the bell would survive here.
    await dispatch({
      kind: "snooze",
      obligationId,
      cycleId,
      targetId: "bob",
      stepId: "pay",
    });
    assert.equal((await listFor("encore")).length, 0, "bell must clear when remaining target is snoozed");
  });

  it("idempotency: reconcile twice with no state change makes zero notifier calls the second time", async () => {
    const setup = (await dispatch({ kind: "setup", definition: twoTargetDef })) as SetupResult;
    const { obligationId, cycleId } = setup;
    if (!obligationId || !cycleId) throw new Error("setup should return ids");

    const before = await listFor("encore");
    assert.equal(before.length, 1);
    const originalId = before[0].id;

    // Second reconcile, no intervening state change.
    await reconcileCycleNotifications({ obligationId, cycleId, now: new Date() });
    const after = await listFor("encore");
    assert.equal(after.length, 1, "bell count should be unchanged");
    assert.equal(after[0].id, originalId, "notification id must be unchanged (no clear+republish)");
  });

  it("cycle-close transition: closing last open step provisions successor + clears closed cycle's bell", async () => {
    // Single-target single-step daily obligation. After markStepDone
    // the cycle closes; the reconciler must (a) clear the closed
    // cycle's bell+ticket, (b) provision the successor cycle file,
    // and (c) reconcile the successor (no-op for `cycle-start` phase
    // because tomorrow's start is still in the future, but the call
    // must happen — verified by the successor-fire assertion below).
    const oneTargetDef = {
      ...twoTargetDef,
      targets: [{ id: "alice", displayName: "Alice" }],
    };
    const setup = (await dispatch({ kind: "setup", definition: oneTargetDef })) as SetupResult;
    const { obligationId, cycleId } = setup;
    if (!obligationId || !cycleId) throw new Error("setup should return ids");

    await dispatch({
      kind: "markStepDone",
      obligationId,
      cycleId,
      targetId: "alice",
      stepId: "pay",
      values: { amount: 5000 },
    });

    // (a) closed cycle's bell cleared.
    const liveAfterClose = await listFor("encore");
    assert.equal(liveAfterClose.length, 0, `closed cycle's bell must clear (today's phase is gone, tomorrow's hasn't started); got ${liveAfterClose.length}`);

    // (b) successor file provisioned (cycleFiles count goes 1 → 2).
    const obligDir = path.join(workspaceRoot, "data/plugins/encore/obligations", obligationId);
    const cycleFiles = (await fsPromises.readdir(obligDir)).filter((name) => name !== "index.md").sort();
    assert.equal(cycleFiles.length, 2, `expected closed + successor cycle, got ${cycleFiles.join(", ")}`);
    assert(cycleFiles[1] > cycleFiles[0], `successor must sort after closed (got ${cycleFiles.join(", ")})`);

    // No tickets at all — closed cycle's was unlinked,
    // successor hasn't fired anything yet.
    assert.equal((await pendingDirEntries()).length, 0, "no tickets between cycles");

    // (c) advance `now` past the successor's cycle-start and
    // reconcile. The successor was already provisioned by the
    // close-time reconcile, so this call should fire its phase-0
    // notification.
    const successorCycleId = cycleFiles[1].replace(/\.md$/, "");
    const tomorrow = new Date(`${successorCycleId}T12:00:00Z`);
    await reconcileCycleNotifications({ obligationId, cycleId: successorCycleId, now: tomorrow });
    const liveTomorrow = await listFor("encore");
    assert.equal(liveTomorrow.length, 1, `successor should fire once now is past its cycle-start; got ${liveTomorrow.length}`);
  });

  it("ghost ticket: bell dismissed out-of-band → reconciler republishes preserving pendingId", async () => {
    // Simulates the host UI's manual-dismiss path (user clicks "X"
    // on the notification menu). The notifier's active.json loses
    // the bell, but the ticket on disk stays put — chat continuity
    // and the pendingId binding must survive. Next reconcile should
    // notice the bell is gone and republish using the ticket's
    // existing pendingId, with a fresh notificationId.
    const setup = (await dispatch({ kind: "setup", definition: twoTargetDef })) as SetupResult;
    const { obligationId, cycleId } = setup;
    if (!obligationId || !cycleId) throw new Error("setup should return ids");

    const before = await listFor("encore");
    assert.equal(before.length, 1, "setup should publish exactly one bell");
    const originalNotificationId = before[0].id;
    const ticketsBefore = await pendingDirEntries();
    assert.equal(ticketsBefore.length, 1, "setup should write exactly one ticket");
    const [ticketFilename] = ticketsBefore;

    // Snapshot the ticket so we can verify pendingId continuity after
    // republish. Reading the file directly avoids depending on dispatch
    // internals; the ticket file is the on-disk source of truth.
    const ticketPath = path.join(workspaceRoot, "data/plugins/encore/tickets", ticketFilename);
    const ticketRawBefore = await fsPromises.readFile(ticketPath, "utf8");
    const ticketBefore = JSON.parse(ticketRawBefore) as { pendingId: string; notificationId: string };

    // Simulate the host UI's manual dismiss: clear the bell directly
    // via the engine, WITHOUT touching the ticket file.
    await clearForPlugin("encore", originalNotificationId);
    assert.equal((await listFor("encore")).length, 0, "manual dismiss must remove the bell");
    assert.equal((await pendingDirEntries()).length, 1, "manual dismiss must NOT touch the ticket");

    // Next reconcile (e.g. hourly tick or server restart). Should
    // detect the ghost ticket and republish.
    await reconcileCycleNotifications({ obligationId, cycleId, now: new Date() });

    const after = await listFor("encore");
    assert.equal(after.length, 1, "reconcile must republish the bell after manual dismiss");
    assert.notEqual(after[0].id, originalNotificationId, "republished bell must have a fresh notificationId");

    const ticketsAfter = await pendingDirEntries();
    assert.equal(ticketsAfter.length, 1, "still exactly one ticket after republish");
    assert.equal(ticketsAfter[0], ticketFilename, "ticket filename (= pendingId) must be unchanged — that's the binding the chat depends on");
    const ticketRawAfter = await fsPromises.readFile(ticketPath, "utf8");
    const ticketAfter = JSON.parse(ticketRawAfter) as { pendingId: string; notificationId: string };
    assert.equal(ticketAfter.pendingId, ticketBefore.pendingId, "pendingId must survive republish");
    assert.equal(ticketAfter.notificationId, after[0].id, "ticket must point at the republished bell");
  });

  it("snooze expiry: snoozedSteps with past timestamp → reconciler republishes", async () => {
    const setup = (await dispatch({ kind: "setup", definition: twoTargetDef })) as SetupResult;
    const { obligationId, cycleId } = setup;
    if (!obligationId || !cycleId) throw new Error("setup should return ids");

    // Snooze both targets so the bell clears.
    await dispatch({ kind: "snooze", obligationId, cycleId, targetId: "alice", stepId: "pay" });
    await dispatch({ kind: "snooze", obligationId, cycleId, targetId: "bob", stepId: "pay" });
    assert.equal((await listFor("encore")).length, 0, "bell must clear after snoozing both targets");

    // Back-date both snoozes by parsing/mutating/re-serializing the
    // cycle file. Simulates time passing without monkeying with Date.
    // We MUST set the timestamps strictly before our reconcile `now`
    // so the reconciler treats them as expired.
    const raw = await readCycleRaw(obligationId, cycleId);
    const { state, body } = parseCycleFile(raw);
    const PAST = "2000-01-01T00:00:00.000Z";
    let backDated = state;
    backDated = recordStepSnooze(backDated, "alice", "pay", PAST);
    backDated = recordStepSnooze(backDated, "bob", "pay", PAST);
    await writeCycleRaw(obligationId, cycleId, serializeCycleFile(backDated, body));

    await reconcileCycleNotifications({ obligationId, cycleId, now: new Date() });
    const after = await listFor("encore");
    assert.equal(after.length, 1, `expected bell to re-fire once snoozes expired; got ${after.length}`);
  });

  it("amendDefinition (displayName edit): updates bell title in place — same id, no history", async () => {
    // Regression test for the migration off `invalidateAllBells`:
    // a title-only amend used to clear every bell for the cycle and
    // republish, dumping `cleared` records into history and giving
    // each bell a fresh notificationId. With the engine's `update`
    // op, the trim path now detects title drift and patches each
    // bell in place. Same id, no flicker, no audit noise.
    const setup = (await dispatch({ kind: "setup", definition: twoTargetDef })) as SetupResult;
    const { obligationId } = setup;
    if (!obligationId) throw new Error("setup should return obligationId");
    const before = await listFor("encore");
    assert.equal(before.length, 1);
    const originalId = before[0].id;
    const originalTitle = before[0].title;
    assert.ok(originalTitle.includes("Daily payments — bundled"), `seed title must include the original displayName; got ${JSON.stringify(originalTitle)}`);

    await dispatch({
      kind: "amendDefinition",
      obligationId,
      definition: { displayName: "Daily payments — RENAMED" },
    });

    const after = await listFor("encore");
    assert.equal(after.length, 1, "bell count must be unchanged");
    assert.equal(after[0].id, originalId, "notificationId must stay stable across a title-only amend");
    assert.ok(after[0].title.includes("RENAMED"), `bell title must reflect the new displayName; got ${JSON.stringify(after[0].title)}`);
    assert.ok(!after[0].title.includes("bundled"), "old title fragment must not leak through");

    const { listHistory } = await import("../../server/notifier/engine.js");
    const history = (await listHistory()).filter((entry) => entry.pluginPkg === "encore");
    assert.equal(history.length, 0, "title-amend must NOT pollute notifier history (regression from invalidateAllBells)");
  });

  it("amendDefinition is idempotent — re-running reconcile doesn't re-update unchanged bells", async () => {
    // The trim path's drift check compares ticket.title/body against
    // the recomputed bundle. After the first reconcile rewrites the
    // ticket with fresh title/body, subsequent reconciles see no
    // drift and short-circuit — no engine update calls, no log
    // noise. Catches a regression where the comparison is wrong
    // (e.g. always-update or always-skip).
    const setup = (await dispatch({ kind: "setup", definition: twoTargetDef })) as SetupResult;
    const { obligationId, cycleId } = setup;
    if (!obligationId || !cycleId) throw new Error("setup should return ids");

    await dispatch({
      kind: "amendDefinition",
      obligationId,
      definition: { displayName: "Round 1 rename" },
    });
    const firstPass = await listFor("encore");
    const firstId = firstPass[0].id;
    const firstTitle = firstPass[0].title;

    // Second reconcile with no DSL change between passes. The trim
    // path should see "ticket.title === desiredTitle" and skip.
    await reconcileCycleNotifications({ obligationId, cycleId, now: new Date() });
    const secondPass = await listFor("encore");
    assert.equal(secondPass[0].id, firstId, "idempotent reconcile must not churn the id");
    assert.equal(secondPass[0].title, firstTitle, "idempotent reconcile must not rewrite the title");
  });

  it("notifier boundary: only reconcile.ts + ticket-orphan sweep paths invoke encoreNotifier.{publish,clear}", async () => {
    // Programmatic enforcement of the acceptance criterion's grep
    // guarantee. The reconciler is the sole owner of bell state in
    // every state-driven code path. Two documented exceptions:
    //   - dispatch.ts `handleOrphanResolve` — user clicked a bell
    //     whose ticket was already swept; no reconcile target left.
    //   - tick.ts `pruneOneTicket` — age-based sweep clears the
    //     bell before unlinking the stale ticket so the next tick
    //     doesn't see "un-fired" and publish a duplicate.
    // Both fit the same pattern: "the ticket is about to disappear,
    // clear its bell counterpart directly because reconcile can't
    // reach a ticket-less bell."
    //
    // A regression where a normal handler calls encoreNotifier.clear
    // (instead of writing state + reconciling) is exactly the drift
    // this refactor exists to prevent — catching it here surfaces
    // the violation at PR time, not in a stale-bell bug report a
    // week later.
    const encoreDir = path.join(import.meta.dirname, "..", "..", "server", "encore");
    // Walk the top-level files AND the handlers/ subdirectory. The
    // refactor that split dispatch.ts (PR for P0.1 of the Codex
    // review) moved handleOrphanResolve into handlers/, so without
    // scanning that subdir a smuggled encoreNotifier call there
    // would slip past this guard.
    const candidateFiles: string[] = [];
    for (const name of await fsPromises.readdir(encoreDir)) {
      if (name.endsWith(".ts")) candidateFiles.push(name);
    }
    const handlersDir = path.join(encoreDir, "handlers");
    if ((await fsPromises.stat(handlersDir).catch(() => null))?.isDirectory()) {
      for (const name of await fsPromises.readdir(handlersDir)) {
        if (name.endsWith(".ts")) candidateFiles.push(path.join("handlers", name));
      }
    }
    const violations: NotifierViolation[] = [];
    for (const file of candidateFiles) {
      const basename = path.basename(file);
      if (NOTIFIER_BOUNDARY_ALLOWED_FILES.has(basename)) continue;
      const raw = await fsPromises.readFile(path.join(encoreDir, file), "utf8");
      violations.push(...collectFileViolations(file, raw));
    }
    assert.deepEqual(violations, [], formatViolationList(violations));
  });

  it("collectFileViolations: scope tracker exits the allowed function and catches violations placed below it", () => {
    // Regression test for the brace-depth scope bug. With the old
    // exit condition (`braceDepth === 0 && opens > 0`), the closing
    // `}` of an allowed function never reset `inAllowedFn`, so a
    // subsequent encoreNotifier.* call was silently skipped.
    const fixture = [
      `async function handleOrphanResolve() {`,
      `  await encoreNotifier.clear("inside-allowed");`, // ALLOWED
      `}`,
      `async function someOtherHandler() {`,
      `  await encoreNotifier.clear("smuggled");`, // MUST flag
      `}`,
    ].join("\n");
    const violations = collectFileViolations("fixture.ts", fixture);
    assert.equal(violations.length, 1, `expected exactly one violation (the smuggled call); got ${JSON.stringify(violations)}`);
    assert.match(violations[0].line, /smuggled/);
  });

  it("collectFileViolations: ignores documentation comments that mention encoreNotifier", () => {
    // The guard regex matches the literal `encoreNotifier.publish/clear`
    // string. Module-doc comments that legitimately reference the API
    // by name (e.g. INVARIANTS pointers, "calls X directly because…")
    // are NOT call sites and must not trip the guard.
    const fixture = [
      `// This handler may, in the orphan path, call encoreNotifier.clear directly.`,
      `/*`,
      ` * encoreNotifier.publish is the publish call; this is documentation only.`,
      ` */`,
      `async function someHandler() {`,
      `  return ok;`,
      `}`,
    ].join("\n");
    const violations = collectFileViolations("fixture.ts", fixture);
    assert.deepEqual(violations, [], `comment lines must not be flagged; got ${JSON.stringify(violations)}`);
  });

  it("inactive status: clears every bell + ticket for the obligation, no republish", async () => {
    const setup = (await dispatch({ kind: "setup", definition: twoTargetDef })) as SetupResult;
    const { obligationId } = setup;
    if (!obligationId) throw new Error("setup should return obligationId");
    assert.equal((await listFor("encore")).length, 1);

    // Flip status to paused via amend.
    await dispatch({
      kind: "amendDefinition",
      obligationId,
      definition: { status: "paused" },
    });

    const after = await listFor("encore");
    assert.equal(after.length, 0, "inactive obligation must have no bell entries");
    const tickets = await pendingDirEntries();
    assert.equal(tickets.length, 0, "inactive obligation must have no tickets");
  });

  it("runTick Phase 2: sweep revisits stuck tickets on non-latest cycles", async () => {
    // Regression test for the interaction noted in PR review: with
    // the new "keep ticket on clear failure" contract, a ticket
    // stranded on cycle N can outlive the next tick if Phase 1 only
    // visits the latest cycle (N+1). Phase 2's sweep walks every
    // ticket and reconciles its (obligationId, cycleId)
    // so the strand is retried every tick instead of waiting 30 days
    // for the age-based prune.
    //
    // Setup: create the obligation, then manually install a
    // closed-cycle file + a leftover ticket pointing at
    // it. Phase 1 (latest cycle reconcile) won't touch the closed
    // cycle's ticket; Phase 2 must.
    const oneTargetDef = {
      ...twoTargetDef,
      targets: [{ id: "alice", displayName: "Alice" }],
    };
    const setup = (await dispatch({ kind: "setup", definition: oneTargetDef })) as SetupResult;
    const { obligationId, cycleId: latestCycleId } = setup;
    if (!obligationId || !latestCycleId) throw new Error("setup should return ids");

    // Inject a closed predecessor cycle file (yesterday) directly on
    // disk, plus a stranded ticket pointing at it.
    const stuckCycleId = "2026-05-16";
    const stuckCycle = {
      cycleId: stuckCycleId,
      cycleStart: `${stuckCycleId}T00:00:00.000Z`,
      cycleDeadline: `${stuckCycleId}T23:59:59.999Z`,
      records: {
        alice: { completedSteps: { pay: `${stuckCycleId}T12:00:00.000Z` } }, // closed
      },
    };
    const stuckCyclePath = path.join(workspaceRoot, "data/plugins/encore/obligations", obligationId, `${stuckCycleId}.md`);
    await fsPromises.writeFile(stuckCyclePath, serializeCycleFile(stuckCycle, ""));

    const stuckTicket = {
      pendingId: "stuck-pending-id",
      obligationId,
      cycleId: stuckCycleId,
      notificationId: "stuck-notification-id", // no live bell entry — clear is a no-op
      stepId: "pay",
      targets: ["alice"],
      severity: "info",
      seedPrompt: "stuck",
      createdAt: new Date().toISOString(),
    };
    const ticketPath = path.join(workspaceRoot, "data/plugins/encore/tickets", "stuck-pending-id.json");
    await fsPromises.writeFile(ticketPath, JSON.stringify(stuckTicket, null, 2));

    // Sanity: the stuck ticket is on disk and the latest is unrelated.
    const beforeNames = await pendingDirEntries();
    assert(beforeNames.includes("stuck-pending-id.json"), "test setup: stuck ticket must be on disk");
    assert.notEqual(stuckCycleId, latestCycleId, "test setup: stuck cycle must differ from latest");

    await runTick({ now: new Date() });

    // Phase 2 reconciled (obligationId, stuckCycleId). All targets in
    // the stuck cycle are closed → bundle drained → clear (no-op,
    // succeeds) → ticket unlinked.
    const afterNames = await pendingDirEntries();
    assert(!afterNames.includes("stuck-pending-id.json"), `stuck ticket must be reaped by Phase 2 sweep; remaining: ${afterNames.join(", ")}`);
  });
});
