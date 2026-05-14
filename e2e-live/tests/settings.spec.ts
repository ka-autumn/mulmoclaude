import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { isRecord } from "../../server/utils/types.ts";
import {
  deleteSession,
  getCurrentSessionId,
  placeWorkspaceFile,
  readWorkspaceFile,
  removeFromWorkspace,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";

const execFileAsync = promisify(execFile);

const L_SETTINGS_EFFORT_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
// The spawn-verification test fires one real LLM turn (a single-word
// prompt) and races a `ps` poll against it. 3 minutes covers Claude
// rate-limited cold starts without burning wall time on the happy
// path (the inner poll exits as soon as the process appears).
const L_SETTINGS_EFFORT_SPAWN_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const PS_POLL_TIMEOUT_MS = 30 * ONE_SECOND_MS;
const PS_POLL_INTERVALS_MS = [ONE_SECOND_MS / 2, ONE_SECOND_MS, 2 * ONE_SECOND_MS];

// Distinctive substring that survives in `ps` output for every claude
// process mulmoclaude spawns — `mcp__mulmoclaude` lands in the
// `--allowedTools` argument and nowhere else on the host (a user's
// own Claude Code CLI in a different terminal does not carry it).
// Used to filter our spawn out of the global process list.
const MULMOCLAUDE_CLAUDE_MARKER = "mcp__mulmoclaude";

// `config/settings.json` is a single workspace-wide file shared by
// every chat session, so two specs mutating it concurrently would
// race the snapshot/restore dance below. Keep this describe serial,
// and fence any future settings-mutating spec the same way (the wiki
// `index.md` precedent in wiki-nav.spec.ts uses the same discipline).
test.describe.configure({ mode: "serial" });

const SETTINGS_REL = "config/settings.json";

// Pull `effortLevel` out of a raw settings.json blob. Returns
// `unknown` so the call site keeps full control over the expectation
// shape — `expect(value).toBe("low")` and `expect(value).toBeUndefined()`
// both work without an upstream cast.
function readEffortLevel(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new Error(`settings.json is not a JSON object: ${raw.slice(0, 80)}`);
  }
  return value.effortLevel;
}

// Parse the snapshot of the user's pre-test settings.json into a
// mutable object we can layer our seed onto. Missing / malformed /
// non-object inputs degrade to the minimal valid shape so the test
// still has a deterministic seed — but a real well-formed file flows
// through here unchanged, preserving every field the user owns
// (codex iter-1 reduces seed blast radius from total-clobber to
// `{ ...original, effortLevel }`).
function parseOriginalOrDefaults(original: string | null): Record<string, unknown> {
  if (original === null) return { extraAllowedTools: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(original);
  } catch {
    return { extraAllowedTools: [] };
  }
  if (!isRecord(parsed)) return { extraAllowedTools: [] };
  return { ...parsed };
}

// Build the seed payload by merging only `effortLevel` onto the
// snapshot — every other user-owned field round-trips through the
// test untouched. If the host process is SIGKILLed between seed and
// finally, the residue on disk still contains the user's real data
// rather than a synthetic minimal stub.
function seedWithEffort(original: string | null, effortLevel: string): string {
  const merged = parseOriginalOrDefaults(original);
  merged.effortLevel = effortLevel;
  return `${JSON.stringify(merged, null, 2)}\n`;
}

// Restore (or delete) the user's pre-test settings file. Unlike the
// other live-chat cleanup helpers, this one MUST NOT swallow errors:
// `config/settings.json` is real user data, not synthetic test
// state, so a failed restore leaves the user's file corrupted /
// missing. A loud failure beats a silent one — Codex iter-1 flagged
// the prior console.warn path as a green-while-broken trap.
async function restoreSettings(original: string | null): Promise<void> {
  if (original === null) {
    await removeFromWorkspace(SETTINGS_REL);
    return;
  }
  await placeWorkspaceFile(SETTINGS_REL, original);
}

// One mulmoclaude-spawned claude subprocess, identified by pid so a
// caller can distinguish processes that existed before the test from
// new ones spawned during it.
interface MulmoclaudeClaudeProcess {
  pid: number;
  cmd: string;
}

// `ps -o pid=,command=` emits `<pid><whitespace><command>` per line.
// The whitespace run before the command is variable width (right-aligned
// pid column on macOS); we split on the first non-digit boundary rather
// than a regex to keep the parse linear and to satisfy sonarjs/slow-regex
// without contorting the pattern.
function parsePsLine(line: string): MulmoclaudeClaudeProcess | null {
  const trimmed = line.trimStart();
  if (trimmed.length === 0) return null;
  const digitEnd = trimmed.search(/\D/);
  if (digitEnd <= 0) return null;
  const pid = Number(trimmed.slice(0, digitEnd));
  if (!Number.isFinite(pid)) return null;
  const cmd = trimmed.slice(digitEnd).trimStart();
  if (cmd.length === 0) return null;
  return { pid, cmd };
}

// Read the process table and return every claude subprocess mulmoclaude
// spawned. `-A` includes processes from all users; cross-user noise
// (and the user's own concurrent Claude Code CLI in another terminal)
// is filtered out by the `mcp__mulmoclaude` marker that only mulmoclaude
// passes via `--allowedTools`. `-ww` requests non-truncated args on
// Linux; macOS ps already prints full args when stdout is a pipe.
//
// Wrapped in try/catch so a `ps` invocation failure (binary missing,
// permission denied) surfaces with the test context attached — without
// this, the raw `ENOENT` from `execFile` makes the failure hard to
// triage (CodeRabbit iter-2 nit).
async function findMulmoclaudeClaudeProcesses(): Promise<MulmoclaudeClaudeProcess[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("ps", ["-A", "-ww", "-o", "pid=,command="]));
  } catch (err) {
    throw new Error(`Failed to run ps while polling for mulmoclaude-spawned claude: ${err instanceof Error ? err.message : String(err)}`);
  }
  const procs: MulmoclaudeClaudeProcess[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.includes(MULMOCLAUDE_CLAUDE_MARKER)) continue;
    const parsed = parsePsLine(line);
    if (parsed !== null) procs.push(parsed);
  }
  return procs;
}

test.describe("settings (real disk / static)", () => {
  test("L-SETTINGS-EFFORT — Model タブで effortLevel が settings.json と双方向に同期する", async ({ page }) => {
    test.setTimeout(L_SETTINGS_EFFORT_TIMEOUT_MS);
    // Covers PR #1332 / #1323 — the UI ↔ disk wire for `effortLevel`.
    // The buildCliArgs unit test (test/agent/test_agent_config.ts)
    // and the config-route integration test
    // (test/routes/test_configRoute.ts) already cover their seams,
    // but neither exercises the Vue ref two-way binding, the
    // @change auto-save, or the null-as-clear sentinel through a
    // real browser. A regression here is the class of bug those
    // unit tests cannot catch (e.g. the select silently desyncing
    // from `storedEffort.value` on race, or the cleared draft
    // omitting the null sentinel and leaking the previous value
    // through `{...existing, ...patch}`).
    //
    // We snapshot the real on-disk settings.json so the user's
    // production state round-trips through this test untouched.

    const original = await readWorkspaceFile(SETTINGS_REL);

    try {
      // ── Phase 1: seed disk → reload → UI reflects ──
      // Establishes the load path independently from the save path
      // tested in Phase 2. A hand-edit of settings.json with
      // `effortLevel: "max"` must surface as the active selection
      // when the Model tab mounts. `seedWithEffort` merges onto the
      // snapshot rather than overwriting it so the user's other
      // fields (googleMapsApiKey / photoExif / ...) round-trip
      // through the test untouched, and a SIGKILL between here and
      // `finally` would still leave real user data on disk instead
      // of a synthetic minimal stub.
      await placeWorkspaceFile(SETTINGS_REL, seedWithEffort(original, "max"));

      await page.goto("/");
      await page.getByTestId("settings-btn").click();
      await expect(page.getByTestId("settings-modal")).toBeVisible();
      await page.getByTestId("settings-tab-model").click();

      const select = page.getByTestId("settings-model-effort-select");
      await expect(select, "Model tab must reflect on-disk effortLevel=max on mount").toHaveValue("max");

      // ── Phase 2: change via UI to "low" → @change auto-save → file updated ──
      // The @change handler fires save(), which PUTs the patch and
      // — on resolve — flips `storedEffort.value` to the saved
      // value. The status strip is the user-visible "save landed"
      // signal; we wait on it so the subsequent file read does not
      // race the in-flight PUT (which would also race the server's
      // atomic write).
      await select.selectOption("low");
      await expect(page.getByTestId("settings-model-status"), "status strip must reflect the saved level").toContainText("low", { timeout: ONE_MINUTE_MS });

      const afterLow = await readWorkspaceFile(SETTINGS_REL);
      if (afterLow === null) {
        throw new Error(`settings.json went missing after auto-save (UI claimed success, server dropped the file?)`);
      }
      expect(readEffortLevel(afterLow), "effortLevel must be 'low' on disk after UI change").toBe("low");

      // ── Phase 3: clear via empty option → file key absent ──
      // The empty option sends `{ effortLevel: null }`; the route
      // handler honours the sentinel by `delete merged.effortLevel`
      // after the spread (see server/api/routes/config.ts). The
      // regression shape we close is the previous value leaking
      // through `{...existing, ...patch}` when the patch is normalised
      // to drop the null — that's why we assert key-absent, not just
      // "value not 'low'".
      await select.selectOption("");
      await expect(page.getByTestId("settings-model-status"), "status strip must flip away from the prior level after clear").not.toContainText("low", {
        timeout: ONE_MINUTE_MS,
      });

      const afterClear = await readWorkspaceFile(SETTINGS_REL);
      if (afterClear === null) {
        throw new Error(`settings.json went missing after clear (the file itself must survive — only the field is dropped)`);
      }
      expect(readEffortLevel(afterClear), "effortLevel key must be absent on disk after clear (null sentinel honoured)").toBeUndefined();
    } finally {
      await restoreSettings(original);
    }
  });

  test("L-SETTINGS-EFFORT-SPAWN — settings.json の effortLevel が spawn される claude 引数に乗る", async ({ page }) => {
    test.setTimeout(L_SETTINGS_EFFORT_SPAWN_TIMEOUT_MS);
    // Closes the last hop the sibling L-SETTINGS-EFFORT spec cannot
    // see: even if the file holds the right value and the route
    // round-trip is healthy, a regression that disconnects
    // `loadSettings().effortLevel` from `buildCliArgs` (or drops
    // the `--effort` push) would still ship green. We trigger a
    // real spawn and inspect `ps` for the flag.
    //
    // The chat is intentionally a one-word echo so the LLM round-trip
    // is short and cheap — we only need the spawn window open for a
    // few seconds. The `ps` poll narrows to our own spawn via the
    // `mcp__mulmoclaude` marker so any concurrent Claude Code CLI
    // session the user runs in another terminal is filtered out.

    const original = await readWorkspaceFile(SETTINGS_REL);
    let sessionIdForCleanup: string | null = null;

    try {
      // Seed effortLevel="low" directly on disk. The save path is
      // already proven by L-SETTINGS-EFFORT; here we only care about
      // the load → spawn-arg chain, so a direct file write is the
      // tightest harness.
      await placeWorkspaceFile(SETTINGS_REL, seedWithEffort(original, "low"));

      await startNewSession(page);

      // Snapshot the set of mulmoclaude-spawned claude processes that
      // already exist BEFORE we trigger our own spawn. The assertion
      // below scopes itself to PIDs missing from this set so an
      // unrelated session — eg. a tab the developer left open from a
      // previous chat where settings.json carried a different
      // effortLevel — cannot couple this test to its arg list
      // (codex GHA iter-2: "every match must be low" was too strict).
      const baselinePids = new Set((await findMulmoclaudeClaudeProcesses()).map((proc) => proc.pid));

      // Start the ps poll BEFORE firing the chat so the polling loop
      // is already running by the time the server spawns claude. On
      // a fast Anthropic API turn (cache hit, short reply), the
      // entire process lifetime can be <1s — kicking the poll off
      // post-send risks missing it (codex iter-3). Early iterations
      // find nothing and retry; the first iteration after spawn
      // succeeds.
      //
      // We hold the returned promise without awaiting yet, and
      // attach a no-op catch so a transient rejection during the
      // pre-spawn window does not surface as an unhandled rejection
      // at the node level. The authoritative `await psPolling`
      // below still throws on real failure (the underlying promise
      // is unchanged by `.catch()`).
      const psPolling = expect(async () => {
        const procs = await findMulmoclaudeClaudeProcesses();
        const newProcs = procs.filter((proc) => !baselinePids.has(proc.pid));
        expect(newProcs, "this test must spawn at least one new mulmoclaude claude process").not.toEqual([]);
        // Only NEW processes (PIDs not in the pre-send baseline) need
        // to carry the flag — pre-existing processes loaded a stale
        // settings.json and their args reflect that older state.
        for (const proc of newProcs) {
          expect(proc.cmd, `newly-spawned claude must carry --effort low; saw pid ${proc.pid}: ${proc.cmd}`).toMatch(/--effort\s+low(\s|$)/);
        }
      }).toPass({ timeout: PS_POLL_TIMEOUT_MS, intervals: PS_POLL_INTERVALS_MS });
      psPolling.catch(() => undefined);

      await sendChatMessage(page, "Reply with the single word: ok.");
      // Capture the session id as soon as the URL flips — cleanup
      // must work even if the poll assertion below fails.
      await page.waitForURL(/\/chat\/[0-9a-f-]+/);
      sessionIdForCleanup = getCurrentSessionId(page);

      // Now await the poll. The toPass loop has been running since
      // before sendChatMessage; by here, either it has already
      // observed the spawn, or it will observe it within the
      // remaining timeout window.
      await psPolling;

      // Drain the assistant turn so trace / video capture the full
      // round-trip rather than cutting mid-stream.
      await waitForAssistantResponseComplete(page);
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
      await restoreSettings(original);
    }
  });
});
