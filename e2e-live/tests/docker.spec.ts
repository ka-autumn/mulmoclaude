// Docker-sandbox-only e2e-live scenarios (L-23 / L-26 / L-28).
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
// → The spec file is intentionally NOT registered in
//   `.github/workflows/e2e_live_no_llm.yaml`'s matrix (see
//   `docs/e2e-live-testing.md` — "Skipping the right way" / "CI
//   matrix"). Each test also opts out per-test via the standard
//   `E2E_LIVE_NO_LLM` env gate so an ad-hoc invocation with that env
//   set still skips loudly rather than spinning the LLM.

import { randomUUID } from "node:crypto";

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  deleteSession,
  getCurrentSessionId,
  getMcpToolsList,
  getSandboxStatus,
  type SandboxStatusSnapshot,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";

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

    // Pre-condition: the user actually has X creds wired up. When the
    // host has no `X_BEARER_TOKEN`, the catalog correctly reports
    // `enabled: false` and asserting on `enabled: true` would be a
    // misconfiguration false-positive (the bug B-01 fixed was about
    // the env *not propagating into the sandbox*, not about asserting
    // creds exist). Skip with a message naming the env var so the
    // developer sees why the docker spec didn't run.
    const tools = await getMcpToolsList(page);
    const xPost = tools.find((tool) => tool.name === "readXPost");
    expect(xPost, "MCP catalog must include readXPost").toBeDefined();
    if (xPost === undefined) throw new Error("unreachable after expect");
    expect(xPost.requiredEnv, "readXPost should still gate on X_BEARER_TOKEN").toContain("X_BEARER_TOKEN");
    test.skip(!xPost.enabled, "X_BEARER_TOKEN is not configured on the host — L-23 cannot prove docker env propagation without the credential.");

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

    // The agent should `Bash`-call `gh auth status` and surface the
    // output. Asking for verbatim quoting is the most stable shape to
    // assert on — `gh auth status` writes "✓ Logged in to github.com"
    // on success, and the assistant body's `toContainText` survives
    // arbitrary surrounding narration. If the host gh credential is
    // mounted but unauthenticated, gh prints "You are not logged into
    // any GitHub hosts" — that's the negative shape we don't want.
    const nonce = randomUUID().slice(0, 6);
    const prompt = [
      `L-28 sandbox gh-auth canary (${nonce}).`,
      "Use the Bash tool to run `gh auth status` (no arguments).",
      "Then quote gh's stdout and stderr verbatim in your reply.",
      "Do not narrate around the quote.",
    ].join(" ");
    let sessionId: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, prompt);
      await waitForAssistantResponseComplete(page);
      sessionId = getCurrentSessionId(page);

      // Anchor every assertion to the most recent assistant turn's
      // markdown body — `[data-testid="text-response-assistant-body"]`
      // is set in `textResponse/View.vue` only when `isAssistant=true`,
      // so user prompts and `session-item-<id>` sidebar history
      // previews are excluded by construction. `.last()` keeps the
      // locator strict-mode safe in stack layout (one assistant body
      // in the default single layout, but L-28 has no reason to assume
      // either) and pins to THIS turn, not any prior "Logged in" text
      // that might live in a reused workspace's sidebar (Codex iter-1).
      const latestAssistantBody = page.getByTestId("text-response-assistant-body").last();
      await expect(latestAssistantBody, "agent must have produced an assistant reply for L-28").toBeVisible({ timeout: ONE_MINUTE_MS });
      // Positive: gh's success message has stayed stable across recent
      // versions ("✓ Logged in to github.com account <name> ..."),
      // so the substring match holds even if the gh version inside the
      // container differs from the host's.
      await expect(latestAssistantBody, "gh auth status output must indicate the user is logged in to github.com").toContainText(/Logged in to github\.com/i, {
        timeout: ONE_MINUTE_MS,
      });
      // Negative: B-06 regression shape — credential isolation would
      // surface gh's "not logged into any hosts" line (the wording
      // varies between gh versions: older drops "GitHub", newer keeps
      // it, both end with `hosts`). The regex accepts either, but the
      // check is now scoped to the same assistant body so a stale
      // sidebar entry containing the negative phrase can't trip it.
      await expect(latestAssistantBody, "agent must not report a missing gh login when the credential is mounted").not.toContainText(
        /not logged into any (?:GitHub )?hosts/i,
      );
    } finally {
      if (sessionId !== null) await deleteSession(page, sessionId);
    }
  });
});
