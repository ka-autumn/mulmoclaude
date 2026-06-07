// Docker-sandbox-only e2e-live scenarios (L-23 / L-26 / L-28 / L-30).
//
// Every test here gates on `getSandboxStatus(page) !== null` because
// the assertions only make sense when the dev server was booted with
// the Docker sandbox enabled (i.e. `DISABLE_SANDBOX` unset AND Docker
// reachable). Specs are skipped — not failed — when the sandbox is
// off so a developer running `DISABLE_SANDBOX=1 yarn dev` can still
// invoke the parent `yarn test:e2e:live` without spurious red.
//
// None of these scenarios are fake-friendly:
//   - L-23 reads the real host MCP catalog (no fake seam).
//   - L-26 / L-28 dispatch through the agent → Docker container →
//     real CLI (`gh auth status` etc.). fake-echo can't fabricate a
//     `Bash` tool result.
//   - L-30 itself does not need the LLM (host-side discovery only),
//     but the sandbox-enabled gate it shares with the rest of the
//     file means it cannot run in the fake-echo CI matrix anyway.
// → The spec file is intentionally NOT registered in
//   `.github/workflows/e2e_live_no_llm.yaml`'s matrix (see
//   `docs/e2e-live-testing.md` — "Skipping the right way" / "CI
//   matrix"). Each test also opts out per-test via the standard
//   `E2E_LIVE_NO_LLM` env gate so an ad-hoc invocation with that env
//   set still skips loudly rather than spinning the LLM.

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { isErrorWithCode } from "../../server/utils/types.ts";
import {
  bashCommandFromCall,
  deleteSession,
  getCurrentSessionId,
  getMcpToolsList,
  getSandboxStatus,
  listSkillsViaApi,
  openSkillsPanel,
  placeBrokenSymlinkSkill,
  placeProjectSkill,
  readSessionToolCalls,
  readSessionToolResults,
  removeBrokenSymlinkSkill,
  removeProjectSkill,
  type SandboxStatusSnapshot,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForAssistantTurn,
} from "../fixtures/live-chat.ts";

// Filesystem error codes that mean "this host's filesystem refuses
// to create a user-space symlink" rather than "the symlink would
// have been broken" — surfaces on Windows without Developer Mode /
// admin, on some bind-mounted Docker volumes, on read-only mounts
// (EROFS), and on filesystems that lack symlink support (EPERM /
// EACCES) or reject the syscall entirely (ENOTSUP). L-30 is
// meaningless on these hosts because the regression shape it
// protects (broken symlinks crashing the discovery loop) cannot be
// set up — surface as `test.skip` with the error code so a CI run
// on such a host doesn't false-red. EROFS added in Codex iter-2.
const SYMLINK_UNSUPPORTED_CODES = new Set(["EPERM", "EACCES", "ENOTSUP", "EROFS"]);

// Mirror the host server's dotenv load so the spec process can read
// the same `X_BEARER_TOKEN` (and any future docker-relevant env) the
// server saw at boot. `server/index.ts:1` calls `import "dotenv/config"`
// from the repo root cwd; yarn / node don't auto-load .env, so the
// spec runner would otherwise read `process.env` without the .env
// overlay and L-23's precondition would mis-skip on hosts that do
// have the credential. Sourcery review on PR #1462 surfaced this:
// gating the assertion on the very flag we're validating silently
// hid catalog bugs, so we now gate on the host-side env directly.
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPEC_DIR, "..", "..");
loadDotenv({ path: path.join(REPO_ROOT, ".env") });

// Docker-only tests dispatch real CLI work through the sandbox
// container (`gh auth status`, agent resume, etc.) which is slower
// than a typical chat turn. Two minutes is the same budget the
// settings.spec.ts spawn canary uses for "boot a process and wait for
// it to land" assertions — short enough to surface a regression
// quickly, generous enough that a cold Docker container start doesn't
// false-flake the run.
const DOCKER_SCENARIO_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

// L-23-specific: X MCP catalog is a single GET (no agent turn), so
// the heavier per-scenario timeout is overkill. Keep the budget tight
// so a regression where /api/mcp-tools hangs (e.g. server stall) fails
// fast instead of burning two minutes.
const MCP_CATALOG_TIMEOUT_MS = ONE_MINUTE_MS;

// Gate every test on the actual sandbox status. Returns the snapshot
// when enabled so callers can drill further (L-28 checks the
// `sshAgent`/`mounts` shape to gate gh-auth scenarios). When the
// sandbox is disabled, `test.skip` aborts the test with a message
// that names the env var the developer needs to flip.
async function requireDockerSandbox(page: Page): Promise<SandboxStatusSnapshot> {
  // Visit the SPA first so `<meta name="mulmoclaude-auth">` is in the
  // DOM — `getSandboxStatus` reads the bearer from that tag via
  // page.evaluate. Without the goto, page.evaluate runs on `about:blank`
  // and the fetch goes out unauthenticated.
  await page.goto("/");
  const status = await getSandboxStatus(page);
  test.skip(status === null, "Docker sandbox is disabled — unset DISABLE_SANDBOX and restart `yarn dev` to run this spec.");
  if (status === null) throw new Error("unreachable after test.skip");
  return status;
}

test.describe.configure({ mode: "parallel" });

test.describe("docker sandbox (real workspace)", () => {
  test("L-23: X MCP tools surface as enabled when X_BEARER_TOKEN is set on the host (B-01)", async ({ page }) => {
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — docker spec needs a real host MCP catalog (no fake seam).");
    test.setTimeout(MCP_CATALOG_TIMEOUT_MS);
    await requireDockerSandbox(page);

    // Sourcery review iter-1 (PR #1462): the precondition must be
    // independent of the `enabled` flag we're asserting on. Skipping
    // on `!xPost.enabled` would silently hide a catalog bug that
    // reported `enabled: false` despite the env being set. Probe
    // `process.env.X_BEARER_TOKEN` directly — dotenv at the top of
    // this file loads the same `.env` the host server reads at boot,
    // so this gate mirrors the host's env reachability without
    // shadowing the assertion target.
    test.skip(!process.env.X_BEARER_TOKEN, "`X_BEARER_TOKEN` is not configured in the workspace .env — L-23 has nothing to assert without the credential.");

    const tools = await getMcpToolsList(page);
    const xPost = tools.find((tool) => tool.name === "readXPost");
    expect(xPost, "MCP catalog must include readXPost").toBeDefined();
    if (xPost === undefined) throw new Error("unreachable after expect");
    expect(xPost.requiredEnv, "readXPost should still gate on X_BEARER_TOKEN").toContain("X_BEARER_TOKEN");

    // B-01 core: `readXPost` enabled ⇒ the host server process saw
    // `X_BEARER_TOKEN` AND the Docker sandbox is on. The B-01 era
    // failure mode was the catalog dropping the tool because the
    // sandbox couldn't see the env — modern arch keeps MCP tools
    // in-process on the host, but the catalog reachability assertion
    // still serves as the canary for any regression that re-isolates
    // the MCP environment from the host. The `searchX` tool shares the
    // same gate, so assert both stay in lockstep.
    expect(xPost.enabled, "readXPost must be enabled when X_BEARER_TOKEN is set + sandbox is on").toBe(true);
    const searchXTool = tools.find((tool) => tool.name === "searchX");
    expect(searchXTool?.enabled, "searchX must be enabled in lockstep with readXPost (shared X_BEARER_TOKEN gate)").toBe(true);
  });

  test("L-26: session created under the sandbox survives a reload — no 'No conversation found' (B-04)", async ({ page }) => {
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — docker resume must exercise the real claude-code backend in-container.");
    test.setTimeout(DOCKER_SCENARIO_TIMEOUT_MS);
    await requireDockerSandbox(page);

    // B-04 (PR #85 fallout): the sandbox moved the in-container
    // workspace path from `/workspace` to `/home/node/mulmoclaude`,
    // and resume started reading from the wrong dir → "No
    // conversation found with session ID". The end-to-end shape that
    // proves the path math agrees end-to-end is identical to L-11 —
    // open a session, take a turn, reload, confirm the user prompt
    // re-renders — but we run it under the sandbox so a path regression
    // in the in-container side surfaces here instead of in the L-11
    // suite (which runs under either mode and would only flake on
    // sandbox-on workspace drift).
    const nonce = randomUUID().slice(0, 6);
    const promptText = `Reply with the single word: ok-${nonce}.`;
    let sessionId: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, promptText);
      await waitForAssistantResponseComplete(page);
      sessionId = getCurrentSessionId(page);
      expect(sessionId, "session id must be present after first turn").not.toBeNull();
      if (sessionId === null) throw new Error("unreachable after expect");

      // Reload the same chat URL. The SPA fetches /api/sessions/<id>
      // (which reads the in-container jsonl path) → if the path math
      // is wrong, the server returns the B-04 error string and the
      // SPA renders an empty / error panel. Both assertions below
      // catch that:
      //   - the user prompt must re-render (transcript hydration ⇔
      //     server CAN read the session file)
      //   - the catch-all "No conversation found" error must NOT
      //     surface anywhere on the page
      await page.reload();
      // `.first()` mirrors L-11's pattern — the prompt re-renders in
      // both the sidebar preview and the transcript bubble after
      // rehydration, so the locator would otherwise hit strict-mode.
      await expect(page.getByText(promptText).first(), "user prompt must re-render from server-side jsonl on reload").toBeVisible({
        timeout: ONE_MINUTE_MS,
      });
      await expect(page.getByText(/No conversation found/i), "B-04 error string must not surface on reload").toHaveCount(0);
      expect(getCurrentSessionId(page), "session id must survive reload").toBe(sessionId);
    } finally {
      if (sessionId !== null) await deleteSession(page, sessionId);
    }
  });

  test("L-28: agent runs `gh auth status` inside the sandbox and the host's gh credential reaches the container (B-06)", async ({ page }) => {
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs the real Bash tool dispatch through the sandbox.");
    test.setTimeout(DOCKER_SCENARIO_TIMEOUT_MS);
    const status = await requireDockerSandbox(page);

    // B-06 fix (PR #327): the sandbox can mount the user's gh creds
    // via `SANDBOX_MOUNT_CONFIGS=gh` OR forward the host SSH agent
    // via `SANDBOX_SSH_AGENT_FORWARD=1`. If neither is wired up the
    // sandbox is correctly isolated from host creds and the scenario
    // is not the one we're testing — skip with a message naming both
    // env vars so a developer sees how to wire it up.
    const hasGhCreds = status.mounts.includes("gh") || status.sshAgent;
    test.skip(
      !hasGhCreds,
      "Sandbox has no gh credential bridge — set SANDBOX_MOUNT_CONFIGS=gh and/or SANDBOX_SSH_AGENT_FORWARD=1 and restart `yarn dev` to run L-28.",
    );

    // The agent must actually invoke `Bash` — without the tool_call
    // assertion (added in iter-1 for Codex), the model would
    // synthesize "Logged in to github.com" from prior knowledge and
    // the text body alone would false-pass. The container hostname
    // (random per-run docker id) is genuinely unpredictable from
    // training data, so making it part of the requested output forces
    // a real `Bash` invocation. We then chain `gh auth status` after
    // it in the same Bash call so both run together; the assertion
    // matches on either form.
    const nonce = randomUUID().slice(0, 6);
    const prompt = [
      `Probe id ${nonce}. Use the Bash tool to run this exact one-liner inside the sandbox:`,
      `cat /etc/hostname && echo --- && gh auth status`,
      `In your reply, copy the tool's verbatim stdout, then on a new line write "PROBE_DONE_${nonce}".`,
      `The hostname value is a random Docker container ID you cannot know without executing the tool.`,
      `Do not narrate around the output.`,
    ].join(" ");
    let sessionId: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, prompt);
      // `waitForAssistantTurn` (strict variant) waits for the
      // thinking-indicator to first appear then go hidden. The plain
      // `waitForAssistantResponseComplete` falls through immediately
      // when the indicator isn't yet mounted — that masks a race for
      // jsonl-based assertions: `readSessionToolCalls` would see
      // `length === 0` before the agent appended its first
      // `tool_call` line and L-28 would mis-report a missing Bash
      // dispatch as the iter-1 false-pass guard catching a regression
      // when in fact the test was just early. See the docstring on
      // `waitForAssistantTurn` in `live-chat.ts` for the same pattern
      // applied to L-31 / L-32.
      await waitForAssistantTurn(page);
      sessionId = getCurrentSessionId(page);
      expect(sessionId, "session id must be present after the gh-auth turn").not.toBeNull();
      if (sessionId === null) throw new Error("unreachable after expect");

      // Codex review iter-1 (PR #1462): the LLM can synthesize "Logged
      // in to github.com" from prior knowledge / instruction-following
      // even if it never invoked the Bash tool. Anchoring only to the
      // assistant body would silently green a regression where the
      // credential bridge broke. Pin the assertion to the agent's
      // `tool_call` jsonl first — a `Bash` call whose `command` arg
      // includes `gh auth status` is the only proof that the agent
      // actually probed the container's gh state.
      const toolCalls = await readSessionToolCalls(sessionId);
      const ghAuthCalls = toolCalls.filter((call) => {
        const command = bashCommandFromCall(call);
        return command !== null && /\bgh\s+auth\s+status\b/.test(command);
      });
      // Dump the actual dispatched tool names + bash commands when
      // the assertion misses — without this the trace just shows
      // "Received: 0" and triage is blind. The summary is bounded
      // (slice first 8 calls + first 80 chars of each bash command)
      // so a long agent loop doesn't drown the report.
      const summary = toolCalls
        .slice(0, 8)
        .map((call) => {
          const cmd = bashCommandFromCall(call);
          return cmd === null ? call.toolName : `${call.toolName}(${cmd.slice(0, 80)})`;
        })
        .join(", ");
      expect(
        ghAuthCalls.length,
        `agent must have dispatched at least one \`Bash\` call running \`gh auth status\`. Observed ${toolCalls.length} tool_call event(s): [${summary}]`,
      ).toBeGreaterThan(0);

      // Codex review iter-2 (PR #1462): even with the dispatch check
      // above, success/failure was previously decided from the
      // assistant body — a model that ran Bash but then paraphrased
      // the output could still false-pass when the credential bridge
      // actually broke. Anchor the decision to the **real tool output
      // body** by pairing each `gh auth status` Bash dispatch with
      // its `tool_call_result` via `toolUseId`. The result content is
      // gh's verbatim stdout/stderr from inside the sandbox — the
      // only signal that proves the credential reached the container.
      const ghAuthCallIds = new Set(ghAuthCalls.map((call) => call.toolUseId));
      const allResults = await readSessionToolResults(sessionId);
      const ghAuthResults = allResults.filter((result) => ghAuthCallIds.has(result.toolUseId));
      expect(
        ghAuthResults.length,
        `each \`gh auth status\` Bash call must have produced a tool_call_result (got ${ghAuthResults.length} for ${ghAuthCallIds.size} call(s))`,
      ).toBe(ghAuthCallIds.size);
      // gh's stdout is comfortably under the 4096-char inline
      // threshold (MAX_INLINE_CONTENT_CHARS in tool-trace/classify.ts),
      // so `content` should always carry the body. A `contentRef`-
      // only result would mean the classifier started spilling small
      // outputs to disk and the spec needs to read that file too —
      // surface that loudly rather than silently masking the body.
      const ghAuthBodies: string[] = [];
      for (const result of ghAuthResults) {
        expect(
          result.content,
          `\`gh auth status\` tool_call_result must carry inline content; got contentRef-only result ${JSON.stringify(result)}`,
        ).not.toBeNull();
        if (result.content !== null) ghAuthBodies.push(result.content);
      }
      // gh's success message has stayed stable across recent versions
      // ("✓ Logged in to github.com account <name> ..."), so the
      // substring match holds even when the gh version inside the
      // container differs from the host's.
      const hasLogin = ghAuthBodies.some((body) => /Logged in to github\.com/i.test(body));
      expect(
        hasLogin,
        `at least one \`gh auth status\` tool_call_result must contain "Logged in to github.com" (real gh stdout, not assistant rendering). Bodies: ${JSON.stringify(ghAuthBodies.map((body) => body.slice(0, 200)))}`,
      ).toBe(true);
      // B-06 regression shape: credential isolation would surface
      // gh's "not logged into any hosts" line in the real tool body
      // (wording varies between gh versions — older drops "GitHub",
      // newer keeps it).
      const hasNegative = ghAuthBodies.some((body) => /not logged into any (?:GitHub )?hosts/i.test(body));
      expect(
        hasNegative,
        `\`gh auth status\` tool_call_result must not contain "not logged into any hosts" (credential bridge regression). Bodies: ${JSON.stringify(ghAuthBodies.map((body) => body.slice(0, 200)))}`,
      ).toBe(false);

      // Sanity: the assistant body still surfaces gh's success line
      // — kept as a UI rendering check (the SPA must show the result,
      // not just receive it on the SSE stream). NOT the load-bearing
      // assertion any more; the load-bearing check is the
      // `tool_call_result` body above (Codex iter-2). Anchored to
      // `[data-testid="text-response-assistant-body"]` so a stale
      // "Logged in" preview from a reused workspace's sidebar can't
      // false-green this either.
      const latestAssistantBody = page.getByTestId("text-response-assistant-body").last();
      await expect(latestAssistantBody, "agent must have produced an assistant reply for L-28").toBeVisible({ timeout: ONE_MINUTE_MS });
      await expect(latestAssistantBody, "assistant body must echo gh's success line (UI rendering sanity)").toContainText(/Logged in to github\.com/i, {
        timeout: ONE_MINUTE_MS,
      });
    } finally {
      if (sessionId !== null) await deleteSession(page, sessionId);
    }
  });

  test("L-30: dangling symlink under .claude/skills/<slug> is silently skipped, valid sibling still surfaces (B-08 discovery resilience)", async ({
    page,
  }, testInfo) => {
    // L-30 itself does not invoke the LLM — discovery is host-side
    // (`server/workspace/skills/discovery.ts:collectSkillsFromDir`)
    // and `/api/skills` is served from the Express process regardless
    // of which agent backend runs. The skip mirrors the file-level
    // E2E_LIVE_NO_LLM stance so an ad-hoc developer invocation with
    // the env set still aborts loudly rather than half-running this
    // file's tests in different modes.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — docker.spec.ts is excluded from the fake-echo matrix wholesale.");
    test.setTimeout(MCP_CATALOG_TIMEOUT_MS);
    await requireDockerSandbox(page);

    // B-08 shape: a `<workspace>/.claude/skills/<slug>` symlink whose
    // target is missing inside the sandbox (the report originated with
    // host-relative `~/ss/llm/skills/...` links bind-mounted into a
    // container) used to throw out of the discovery loop and drop the
    // entire skill list. The fix in `collectSkillsFromDir` swallows the
    // per-entry `stat()` failure and `continue`s — so a dangling
    // symlink should silently disappear without taking siblings with
    // it. This canary seeds both shapes (one broken, one valid) and
    // asserts the sibling still surfaces in `/skills` while the
    // dangling slot never does.
    //
    // No LLM, no agent turn — pure filesystem + `/api/skills` round
    // trip via the same UI path L-22 uses (`/skills` → `skill-item-*`
    // testid). Wall time is whatever `/skills` takes to hydrate.
    //
    // Cleanup: per-finally rm on both seeds. The broken symlink is
    // removed via `removeBrokenSymlinkSkill` (lstat-guarded against an
    // unlikely race where a parallel run replaced the link with a real
    // dir) and the sibling via `removeProjectSkill` (recursive rm of
    // its dir). Slug derived from `testInfo.project.name` (sanitized
    // via `slugifyForProjectScope` to survive future project entries
    // that aren't already kebab-case) + a per-run nonce, so parallel
    // browser projects don't collide on the same slot.
    const fixture = buildL30Fixture(testInfo);

    try {
      await seedL30FixtureOrSkip(fixture);
      await assertSkillsDiscoveryState(page, fixture);
    } finally {
      await cleanupL30Fixture(fixture);
    }
  });
});

// ── L-30 helpers ────────────────────────────────────────────────────

interface L30Fixture {
  danglingSlug: string;
  siblingSlug: string;
  siblingDescription: string;
  siblingMarker: string;
  missingTarget: string;
}

/**
 * Lower-case the input, replace every non-`[a-z0-9]` run with `-`,
 * collapse repeated separators, and trim leading/trailing hyphens.
 * Used to make Playwright project names safe for `isValidSlug`
 * (`server/utils/slug.ts`) before we embed them in `.claude/skills/`
 * directory names — current projects (`chromium`) already satisfy the
 * rule, but a future addition like `Chromium HiDPI` would otherwise
 * make L-30 fail in `placeProjectSkill` before ever reaching the
 * resilience assertions (CodeRabbit iter-1 review, comment 387).
 */
function slugifyForProjectScope(raw: string): string {
  // Collapse non-alphanumeric runs with a regex (single greedy
  // quantifier on a character class, no backtracking risk), then trim
  // leading/trailing hyphens with a manual loop — `sonarjs/slow-regex`
  // flags even `^-+` / `-+$` patterns despite their anchor bound, so
  // the repo convention (`server/utils/slug.ts:disambiguateSlug`) is to
  // sidestep the rule with a linear scan rather than per-line suppress.
  const collapsed = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  while (start < collapsed.length && collapsed[start] === "-") start++;
  let end = collapsed.length;
  while (end > start && collapsed[end - 1] === "-") end--;
  return collapsed.slice(start, end);
}

function buildL30Fixture(testInfo: TestInfo): L30Fixture {
  const projectSlug = slugifyForProjectScope(testInfo.project.name);
  const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  return {
    danglingSlug: `e2e-live-l30-dangling-${projectSlug}-${nonce}`,
    siblingSlug: `e2e-live-l30-sibling-${projectSlug}-${nonce}`,
    siblingDescription: `L-30 sibling skill ${nonce}`,
    // Marker only has to make the sibling SKILL.md distinguishable
    // from a real user-authored skill; we don't run the skill, so the
    // body just needs to satisfy the frontmatter+body shape that
    // `placeProjectSkill` produces and `parseSkillFrontmatter` reads.
    siblingMarker: `L30-SIBLING-${nonce}`,
    // Nonce-stamped under the OS tmpdir so the target is guaranteed
    // absent (no real file at that path) and parallel runs cannot
    // collide on the same fake target. The directory is never created
    // — that's the whole point of the test.
    missingTarget: path.join(tmpdir(), `mulmoclaude-e2e-l30-missing-${nonce}`),
  };
}

/**
 * Seed both halves of the L-30 fixture. On a host that refuses the
 * `symlink` syscall (Windows w/o Developer Mode, read-only bind
 * mounts) this calls `test.skip` and never returns — the unreachable
 * `throw` after the skip is purely for TypeScript narrowing.
 *
 * Cleanup safety: this helper deliberately does NOT track which of
 * the two seeds landed. If `placeBrokenSymlinkSkill` succeeded but
 * `placeProjectSkill` then threw, the caller still calls
 * `cleanupL30Fixture` in its `finally` — both `removeBrokenSymlinkSkill`
 * (lstat-guarded, ENOENT-tolerant) and `removeProjectSkill` (recursive
 * rm with `force: true`) are idempotent on a missing slot, so always
 * calling them is the simpler shape (Codex GHA + CodeRabbit iter-2:
 * the earlier `symlinkSeeded` flag never made it back to the caller
 * when seeding partially failed, leaking the dangling slot).
 */
async function seedL30FixtureOrSkip(fixture: L30Fixture): Promise<void> {
  try {
    await placeBrokenSymlinkSkill(fixture.danglingSlug, fixture.missingTarget);
  } catch (err) {
    if (isErrorWithCode(err) && SYMLINK_UNSUPPORTED_CODES.has(err.code ?? "")) {
      test.skip(true, `host filesystem refused the symlink syscall (${err.code}) — L-30 cannot seed its broken-symlink fixture on this host.`);
      throw err;
    }
    throw err;
  }
  await placeProjectSkill(fixture.siblingSlug, fixture.siblingDescription, fixture.siblingMarker);
}

/**
 * Two-layer discovery assertion orchestrator: pin the server contract
 * first via `/api/skills`, then verify the SPA rendering matches.
 * Splitting the checks this way means a manageSkills view-template
 * regression that hid the sibling row (or surfaced a broken-link
 * placeholder) cannot mask a server-path break and vice versa
 * (Codex iter-1). Each layer lives in its own helper to honour the
 * CLAUDE.md "functions under 20 lines" rule (CodeRabbit iter-2).
 */
async function assertSkillsDiscoveryState(page: Page, fixture: L30Fixture): Promise<void> {
  await assertSkillsDiscoveryApiState(page, fixture);
  await assertSkillsDiscoveryUiState(page, fixture);
}

/**
 * (a-api) `expect.poll` waits out the small window between
 * `placeProjectSkill` returning and the discovery loop's next call
 * observing the new file (no cache per `discovery.ts`, but the call
 * itself races with our write). Asserts the sibling is listed AND the
 * dangling slot is omitted in the same poll sample so neither leg can
 * transiently mask the other.
 */
async function assertSkillsDiscoveryApiState(page: Page, fixture: L30Fixture): Promise<void> {
  await expect
    .poll(
      async () => {
        const skills = await listSkillsViaApi(page);
        const names = new Set(skills.map((row) => row.name));
        return { hasSibling: names.has(fixture.siblingSlug), hasDangling: names.has(fixture.danglingSlug) };
      },
      {
        message: "GET /api/skills must list the valid sibling and omit the dangling-symlink slot",
        timeout: ONE_MINUTE_MS,
      },
    )
    .toEqual({ hasSibling: true, hasDangling: false });
}

/**
 * (a-ui) Rendering sanity: with the API state above already green,
 * this only fails on a client-side regression in
 * `manageSkills/View.vue` (e.g. row template stopped honoring
 * `skill.name`). (b) `toHaveCount(0)` for the dangling slot retries
 * against Playwright's auto-waiting harness so an in-flight render
 * that hasn't yet populated rows is given time before failing.
 */
async function assertSkillsDiscoveryUiState(page: Page, fixture: L30Fixture): Promise<void> {
  await openSkillsPanel(page);
  const siblingRow = page.getByTestId(`skill-item-${fixture.siblingSlug}`);
  await expect(siblingRow, "valid sibling skill must surface in the Skills settings tab — proves discovery survived the dangling symlink").toBeVisible({
    timeout: ONE_MINUTE_MS,
  });
  const danglingRow = page.getByTestId(`skill-item-${fixture.danglingSlug}`);
  await expect(danglingRow, "dangling symlink slot must not surface as a skill row").toHaveCount(0);
}

/**
 * Always-on cleanup. Both helpers are idempotent on a missing slot,
 * so it's safe to call this even when one or both of the seeds never
 * landed — that's how we close the partial-seed leak path Codex GHA
 * and CodeRabbit flagged in iter-2.
 */
async function cleanupL30Fixture(fixture: L30Fixture): Promise<void> {
  await removeBrokenSymlinkSkill(fixture.danglingSlug);
  await removeProjectSkill(fixture.siblingSlug);
}
