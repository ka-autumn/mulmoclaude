import { randomUUID } from "node:crypto";
import path from "node:path";

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  SESSION_URL_PATTERN,
  type ToolCallTraceRecord,
  copyPresetCatalogToActive,
  deleteProjectSkillViaUi,
  deleteSession,
  getCurrentSessionId,
  placeProjectSkill,
  readProjectSkillBody,
  readSessionToolCalls,
  readWorkspaceFile,
  removeEncoreObligation,
  removeProjectSkill,
  selectRole,
  sendChatMessage,
  setupRoleSession,
  snapshotProjectSkillSlugs,
  stagingSkillSlugFromWriteCall,
  startGuaranteedNewSession,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForAssistantTurn,
} from "../fixtures/live-chat.ts";
import { isRecord } from "../../server/utils/types.ts";

const L21_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L21B_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L22_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L31_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L32_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L33_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L33B_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

// L-33B target: a launcher preset that's reliably NOT auto-starred
// in normal user workspaces. `mc-invoice` is bundled (lives in
// `server/workspace/skills-preset/mc-invoice/`) so its catalog row
// always renders, but it's a niche workflow rarely starred by
// default — minimising the chance that an L-33B run collides with
// a user who's actively relying on the preset between runs. The
// test fs-removes any existing star before exercising the UI and
// fs-removes again in `finally`, so the workspace ends in the same
// "unstarred" state regardless of where it started.
const L33B_PRESET_SLUG = "mc-invoice";

// L-33: launcher preset slug + a signature line from its bundled
// `SKILL.md`. Treated as pinned literals because the canary's whole
// premise is that this exact preset, with this exact wording, lands
// in the user's workspace after `syncPresetSkills`. A rename (e.g.
// `mc-cooking-coach` → `mc-recipe-keeper`) or a body rewrite that
// drops the signature line must trip the test loudly so the discovery
// chain — `server/workspace/skills-preset/<slug>/SKILL.md` →
// `data/skills/catalog/preset/<slug>/` → `.claude/skills/<slug>/` —
// stays observable end-to-end.
const L33_PRESET_SLUG = "mc-cooking-coach";
const L33_BODY_SIGNATURE = "bundled MulmoClaude preset skill";
// First-turn agent response after `/mc-cooking-coach` slash dispatch.
// The preset body opens with "Be the user's cooking-loving friend"
// and the workflows revolve around `recipe` / `レシピ` / `料理`. A
// faithful first turn references at least one. **`cook` is
// deliberately excluded** even though the body uses it: the token
// also appears in the slug `mc-cooking-coach` itself, so an agent
// that NEVER loaded the body could still echo "cooking" parsed from
// the slash command and false-pass the canary (Codex iter-1 review).
// `recipe` / `料理` / `レシピ` are body-specific and absent from the
// slash command, so a hit there is a stronger signal that the
// SKILL.md body actually conditioned the response.
const L33_COOKING_VOCAB_PATTERN = /recipe|料理|レシピ/i;

// Five LLM-dependent scenarios (L-21 chart dispatch, L-21B encore
// defineEncore dispatch, L-22 skill execution, L-31 bridge dispatch,
// L-32 end-to-end landing, L-33 preset chain) + one UI-only canary
// (L-33B catalog→Star rail). They share no state — run in parallel
// to cut wall time, mirroring the other category specs.
test.describe.configure({ mode: "parallel" });

// Fully-qualified MCP tool name for the encore plugin's defineEncore
// tool, as recorded in the session tool_call jsonl trace. The
// `mcp__<server>__` prefix is added by the host bridge (see
// `server/agent/prompt.ts` MCP_PREFIX_HINT and the agent's tool
// discovery path). Asserting on the prefixed name is what makes this
// a B-41 canary: in deferred-tools mode the LLM has to (a) see the
// MCP-prefixed identifier in its tool schema, (b) call it by that
// exact name. A regression that drops the tool from the deferred
// schema, or that re-prefixes it under a different server name,
// breaks the equality check on the next run.
const MCP_DEFINE_ENCORE_TOOL_NAME = "mcp__mulmoclaude__defineEncore";

// Predicate for L-21B: this `tool_call` record is a `defineEncore`
// invocation whose `args.dsl.displayName` matches the pinned
// `displayName`. Extracted as a helper so the assertion and any
// future debug logging look at the same shape — the `args` field is
// typed `unknown` on `ToolCallTraceRecord`, so the type-guards do
// real work here. Returns false on shape mismatch (rather than
// throwing) so a malformed trace line cannot crash the filter.
function defineEncoreCallTargetsDisplayName(call: ToolCallTraceRecord, displayName: string): boolean {
  if (!isRecord(call.args)) return false;
  const { dsl } = call.args;
  if (!isRecord(dsl)) return false;
  return dsl.displayName === displayName;
}

test.describe("skills (real LLM / static)", () => {
  test("L-21: Office role + presentChart で deferred-tool dispatch が成功し chart-canvas が描画される", async ({ page }) => {
    // fake-echo detects `presentChart`, parses `<Label> <value>`
    // pairs, posts to /api/chart, and emits the artifact as the
    // tool_call_result. View mounts from the saved chart.
    test.setTimeout(L21_TIMEOUT_MS);
    // Covers B-41: Claude CLI auto-flips into deferred-tools mode
    // when the registered tool count crosses its threshold (~18+),
    // and a regression in that path historically broke first-turn
    // tool dispatch across every role. L-03 already exercises this
    // through presentMulmoScript on the General role; L-21 is a
    // second canary on a different role/tool combination so a
    // regression that shears just one branch (e.g. `presentChart`
    // schema mis-published in deferred mode) is caught even when
    // the L-03 path keeps working. The chart plugin renders
    // quickly, has no external API dependency, and exposes a
    // stable `chart-card-0` / `chart-canvas-0` testid
    // (`src/plugins/chart/View.vue`).
    //
    // Why Office: General's `availablePlugins` (`src/config/roles.ts`)
    // does NOT include `presentChart` — Office, Tutor, Spreadsheet,
    // and Accounting do. The first iteration on this spec hit
    // exactly that: the LLM replied "I can't find a presentChart
    // tool" because the role gate hid it. Switching to Office
    // here keeps the canary on a role/tool pair where dispatch is
    // genuinely available.
    //
    // Prompt names the exact tool and forbids the alternatives so
    // the LLM does not wander to presentHtml or textResponse.
    const userPrompt = [
      "Use the `presentChart` tool to render a bar chart titled 'L-21 sales' with data Jan 100, Feb 150, Mar 120.",
      "Do not use presentHtml. Do not use any other tool. Do not narrate the result in text.",
    ].join(" ");
    const sessionsToCleanup: string[] = [];
    try {
      // selectRole spawns a fresh /chat/<id> in the new role on
      // chat pages (App.vue's onRoleChange). Mirroring the
      // roles.spec.ts cleanup pattern: capture both the auto-
      // created General session id and the role-switched Office
      // session id so neither leaks into history.
      await startNewSession(page);
      await page.waitForURL(SESSION_URL_PATTERN);
      const generalSessionId = getCurrentSessionId(page);
      if (generalSessionId === null) {
        throw new Error("getCurrentSessionId returned null after startNewSession + waitForURL — URL pattern likely drifted");
      }
      sessionsToCleanup.push(generalSessionId);
      await selectRole(page, "office");
      await page.waitForURL((url) => SESSION_URL_PATTERN.test(url.pathname) && !url.pathname.endsWith(generalSessionId));
      const officeSessionId = getCurrentSessionId(page);
      if (officeSessionId !== null && officeSessionId !== generalSessionId) {
        sessionsToCleanup.push(officeSessionId);
      }
      await expect(page.getByTestId("role-selector-btn"), "role chip must reflect office after switch").toHaveAttribute("data-role", "office");
      await sendChatMessage(page, userPrompt);
      // The chart tool result mounts ChartView, which renders one
      // `[data-testid="chart-card-${idx}"]` per chart spec. The
      // first card is enough — extra cards (rare LLM-authored
      // multi-chart payloads) do not invalidate the dispatch
      // signal. `chart-canvas-0` going visible proves both the
      // tool round-trip and the v-for hydration; an upstream
      // failure in deferred-tools mode would land us in a
      // textResponse view instead, with no chart-* testid in DOM.
      await expect(page.getByTestId("chart-card-0"), "chart card must mount after the tool call (B-41 canary)").toBeVisible({ timeout: 2 * ONE_MINUTE_MS });
      await expect(page.getByTestId("chart-canvas-0"), "chart canvas must hydrate (deferred-tool dispatch reached the view)").toBeVisible();

      await waitForAssistantResponseComplete(page);
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
    }
  });

  test("L-21B: Personal role + defineEncore で deferred-tool dispatch が agent に届き、 obligation が disk に書かれる", async ({ page }) => {
    // fake-echo backend can't simulate the MCP bridge path that
    // actually writes the obligation file; this canary needs the
    // real Claude SDK to dispatch the tool.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs deferred-tool dispatch + MCP bridge");
    test.setTimeout(L21B_TIMEOUT_MS);
    // Second B-41 canary, pinned on the encore plugin (PRs #1437 /
    // #1440 / #1441 / #1443 added defineEncore + the dashboard in
    // late April 2026). L-21 already proves deferred-tool dispatch
    // on `presentChart`; this spec exercises a STRUCTURALLY DIFFERENT
    // plugin so a regression that shears just one runtime plugin's
    // dispatch path does not slip through.
    //
    // What "structurally different" means here:
    //   - Two MCP tools share one apiNamespace (defineEncore +
    //     manageEncore). The defineEncore tool's parameters carry a
    //     full JSON Schema auto-derived from a runtime Zod validator
    //     (`z.toJSONSchema(EncoreDslInput)`). The chart plugin has
    //     no equivalent — a regression in how deferred mode publishes
    //     auto-derived schemas (vs. inline literals) shows up here.
    //   - `defineEncore`'s server handler intentionally omits `data`
    //     from its return envelope, so the MCP bridge in
    //     `server/agent/mcp-server.ts:451` deliberately does NOT
    //     push a visual ToolResult — defineEncore is narrate-only by
    //     design (the user-facing dashboard is reached via the launcher
    //     / bell click, not as an inline tool result). That means the
    //     L-21 assertion shape (View testid mounts after the tool
    //     call) cannot work here; the dispatch signal is the
    //     tool_call jsonl record and the on-disk obligation file.
    //
    // Why Personal: `availablePlugins` in `src/config/roles.ts:88`
    // is the only built-in role that has both `defineEncore` and
    // `manageEncore`. Office (L-21's choice) does not — running the
    // canary on the wrong role would surface as "I can't find a
    // defineEncore tool" and false-fail.
    //
    // Pinning the DSL: the encore DSL is too rich for the LLM to
    // compose reliably from a one-liner prompt (and reading the help
    // doc beforehand adds two Read calls of LLM jitter). The prompt
    // gives the agent the literal DSL it should pass. The displayName
    // carries the nonce so the slug
    // (`slugify(displayName)` → `l-21b-encore-canary-<nonce>`) is
    // unique per run and cleanup targets only this run's dir.
    //
    // Slug derivation: server-side `slugify` (server/encore/paths.ts)
    // lowercases, NFKD-normalises, replaces non-alphanumerics with
    // `-`, and trims. For ASCII inputs that are already kebab-shaped
    // ("L-21B Encore canary <nonce>"), the round-trip is deterministic
    // and reproducible test-side without an import — but if that
    // function ever changes shape the spec will miss its own dir and
    // fail loudly, which is the right failure mode for a canary.
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const displayName = `L-21B Encore canary ${nonce}`;
    const expectedSlug = `l-21b-encore-canary-${nonce}`;
    // `schedule:9999-12-31` (far future) keeps the firingPlan inert so
    // the setup-time `reconcileCycleNotifications` (server/encore/handlers/setup.ts)
    // sees no due phase, never calls `fireGroup`, and never writes a
    // `tickets/<pendingId>.json` or publishes a bell entry. Without
    // this guard, a `cycle-start` phase fires immediately on setup
    // and the resulting ticket is left behind by cleanup: the next
    // tick's `sweepStuckTickets` SKIPS tickets pointing at the
    // removed obligation (server/encore/tick.ts:140), and
    // `pruneOrphanTickets` only collects them after a 30-day age
    // threshold — that's a real leak window across spec runs. The
    // schema's `min(1)` on firingPlan still has to be satisfied, so
    // a single far-future phase is the minimum-bell-impact choice.
    const dsl = {
      version: 1,
      displayName,
      type: "service",
      cadence: { type: "daily" },
      targets: [{ id: "me", displayName: "Me" }],
      steps: [
        {
          id: "note",
          displayName: "Note",
          deadline: "cycle-deadline",
          firingPlan: [{ at: "schedule:9999-12-31", severity: "info" }],
          fields: ["note"],
        },
      ],
      formSchema: {
        fields: [{ name: "note", type: "text", label: "Notes", required: false }],
      },
    };
    const userPrompt = [
      "Use the `defineEncore` tool to set up a NEW service-type obligation.",
      "Pass this DSL object literal as the `dsl` argument (do NOT JSON-encode it, do NOT modify any value):",
      "```json",
      JSON.stringify(dsl, null, 2),
      "```",
      "Do not pass `obligationId` (this is a setup, not an amend).",
      "Do not read `config/helps/encore-dsl.md`. Do not use any other tool. Do not narrate the result in text.",
    ].join("\n");
    const sessionsToCleanup: string[] = [];
    try {
      // setupRoleSession captures both the auto-created General
      // session and the role-switched Personal session, pushing both
      // onto `sessionsToCleanup` as they appear so a mid-setup throw
      // still drains the General side in `finally`. Mirrors L-21's
      // dance between General and Office.
      const personalSessionId = await setupRoleSession(page, "personal", sessionsToCleanup);
      await sendChatMessage(page, userPrompt);
      // waitForAssistantTurn (not waitForAssistantResponseComplete) is
      // mandatory here. The assertions read disk and a jsonl trace;
      // the fast-path race the strict-gate helper guards (returning
      // immediately when the thinking indicator's detached element
      // resolves before the agent actually fired) would let the
      // assertion pass against an empty trace on a no-op turn. Same
      // reasoning the L-31 / L-32 specs document for their post-#1298
      // bridge canaries.
      await waitForAssistantTurn(page, 2 * ONE_MINUTE_MS);

      // Signal 1: the agent reached for `mcp__mulmoclaude__defineEncore`.
      // The host bridge prefixes plugin tools with `mcp__<server>__`,
      // so the trace records the fully-qualified MCP name (not the
      // bare `defineEncore`). A B-41 regression that drops the tool
      // from the deferred dispatcher's schema would leave this list
      // empty (the agent never sees / never picks the tool); a
      // textResponse fallback that paraphrases success without
      // actually calling the tool would also miss this assertion.
      const calls = await readSessionToolCalls(personalSessionId);
      const matchingDefineCalls = calls.filter(
        (call) => call.toolName === MCP_DEFINE_ENCORE_TOOL_NAME && defineEncoreCallTargetsDisplayName(call, displayName),
      );
      expect(
        matchingDefineCalls.length,
        `agent must dispatch \`${MCP_DEFINE_ENCORE_TOOL_NAME}\` with the pinned displayName ${JSON.stringify(displayName)} — proves deferred-tool dispatch reached the encore plugin (B-41 canary)`,
      ).toBeGreaterThan(0);

      // Signal 2: the tool handler actually wrote the obligation
      // file. The MCP bridge path can complete with an error envelope
      // (`ok: false`) and the agent will still see a tool_call_result;
      // checking the on-disk artefact closes that gap by proving the
      // call landed at handleSetup and made it past schema validation.
      // `readWorkspaceFile` returns null on ENOENT, so the assertion
      // shape is "got a string body back" rather than a separate
      // existence check + read. The path is composed with `path.join`
      // per CLAUDE.md cross-platform rule (CodeRabbit review on PR #1493).
      const indexRel = path.join("data", "plugins", "encore", "obligations", expectedSlug, "index.md");
      const indexBody = await readWorkspaceFile(indexRel);
      expect(
        indexBody,
        `obligation index ${indexRel} must exist on disk — proves the dispatched tool call reached handleSetup and wrote the DSL (no schema validation rejection)`,
      ).not.toBeNull();
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
      // Best-effort fs cleanup — the encore dispatcher has no
      // "delete obligation" verb, and we never want a flake to
      // leak a row into the dashboard listing on the next run.
      // Catch lets the finally proceed past any unexpected throw
      // (e.g. the slug derivation drifted upstream and our id
      // never made it to disk) without masking the test's real
      // failure.
      try {
        await removeEncoreObligation(expectedSlug);
      } catch (err) {
        console.warn(`L-21B finally: removeEncoreObligation failed for ${expectedSlug}`, err);
      }
    }
  });

  test("L-22: 合成 skill を seed → Run → agent が skill body 通りに応答する (B-08 end-to-end)", async ({ page }, testInfo) => {
    test.setTimeout(L22_TIMEOUT_MS);
    // Covers B-08 end-to-end: a skill on disk has to (a) surface in
    // `/skills`, (b) load its body into the detail pane, AND (c)
    // be picked up by the Claude SDK when invoked as `/<slug>`. The
    // earlier draft of this spec stopped at (a)+(b) on the theory
    // that the dangling failure mode trips before (c) — true for
    // Docker dangling (real B-08), but in non-Docker mode (a)+(b)
    // are a happy-path smoke test only. Pressing Run lifts the
    // canary into a true end-to-end check: the skill row visible
    // proves nothing if the body never reaches the agent.
    //
    // Synthetic skill body: we instruct the agent to reply with a
    // unique marker (`L22-OK-<nonce>`). The marker has to be in the
    // assistant transcript for the test to pass — that means
    //   discovery → /api/skills list ✓
    //   /api/skills/:name detail ✓
    //   slash-command dispatch into agent ✓
    //   skill body actually conditioning the response ✓
    // all four had to work. A regression at any layer (Docker
    // dangling, `/<slug>` not registered, body not piped to the
    // agent prompt, etc.) collapses one of those into a fail with
    // a localised diagnostic.
    //
    // Picking a marker rather than a freeform reply keeps the
    // assertion deterministic: LLMs occasionally embellish ("Sure!
    // L22-OK-XYZ"), so we use `toContainText` which tolerates the
    // surrounding prose while still failing on a missing marker.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    // Slug must satisfy isValidSlug (lowercase / digit / hyphen).
    // randomUUID() is hex+hyphen, so the slice survives the rule.
    const skillSlug = `e2e-live-l22-${projectSlug}-${nonce}`;
    const description = `L-22 canary skill ${nonce}`;
    // Marker shape: ASCII-only, distinctive prefix, embedded nonce.
    // Lives both in the SKILL.md body (so the rendered detail can
    // be sanity-checked) and in the expected assistant reply (so
    // the run leg is verified). One string, two assertion sites.
    const replyMarker = `L22-OK-${nonce}`;
    const body = [
      "## L-22 canary skill",
      "",
      "Synthetic skill seeded by e2e-live for end-to-end verification.",
      "",
      `When invoked via the slash command, respond with this exact line and nothing else: ${replyMarker}`,
    ].join("\n");
    let sessionIdForCleanup: string | null = null;
    try {
      await placeProjectSkill(skillSlug, description, body);
      await page.goto("/skills");

      // Sanity layer (a)+(b): the row is keyed by the seeded slug.
      // If the workspace's `.claude/skills/` were unreadable
      // (dangling symlink, permission error, server cache miss),
      // the seeded file would not surface and the row would never
      // appear.
      const skillRow = page.getByTestId(`skill-item-${skillSlug}`);
      await expect(skillRow, "seeded project skill must appear in /skills list").toBeVisible({ timeout: ONE_MINUTE_MS });
      await skillRow.click();
      const bodyView = page.getByTestId("skill-body-rendered");
      await expect(bodyView, "detail body must hydrate (proves SKILL.md is readable)").toBeVisible({ timeout: ONE_MINUTE_MS });
      await expect(bodyView, "rendered body must echo the seeded marker").toContainText(replyMarker);

      // Layer (c): Run = `appApi.startNewChat('/<slug>')` — the
      // SPA navigates to /chat/<id> and the agent receives the
      // slash command as its first turn. Capture the new session
      // id immediately after the URL settles so cleanup runs even
      // if the assistant turn below times out.
      await page.getByTestId("skill-run-btn").click();
      await page.waitForURL(SESSION_URL_PATTERN);
      sessionIdForCleanup = getCurrentSessionId(page);

      await waitForAssistantResponseComplete(page, 2 * ONE_MINUTE_MS);

      // The assistant body must contain the marker. Anchor the
      // assertion to `text-response-assistant-body` so user-typed
      // bubbles, sidebar history previews, and the tool call
      // history pane are excluded by construction (`.last()` keeps
      // the locator strict-mode-safe in stack layout). If this
      // line fails, the chain broke in layer (c): the row + body
      // were fine but the slash-command path did not actually load
      // the skill into the agent's context.
      await expect(
        page.getByTestId("text-response-assistant-body").last(),
        "assistant must echo the marker — proves skill body reached the agent",
      ).toContainText(replyMarker, {
        timeout: 2 * ONE_MINUTE_MS,
      });
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
      await cleanupProjectSkill(page, skillSlug);
    }
  });

  test("L-31: General role + 「skill 化して」 で agent が data/skills/<slug>/SKILL.md に Write する (post-#1298 bridge dispatch canary)", async ({
    page,
  }, testInfo) => {
    // Needs the agent to actually Write SKILL.md to disk and the
    // bridge mirror hook to fire. fake-echo doesn't do filesystem
    // side-effects; real Claude only.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs Write tool + bridge hook");
    test.setTimeout(L31_TIMEOUT_MS);
    // Plumbing canary for the post-#1298 skill-creation surface.
    // The trio of changes that made this scenario fixable:
    //   - #1284 split the Settings role into preset skills
    //   - #1296 split mc-settings into 3 focused presets
    //     (mc-manage-skills / mc-manage-sources / mc-manage-automations)
    //     placed on the General role
    //   - #1298 added a hook bridge so the agent writes to a normal
    //     `data/skills/<slug>/SKILL.md` (no `.claude/` permission
    //     scrutiny) and the bridge mirrors it across
    //
    // The pre-#1298 attempt at this canary (closed PR #1291) had to
    // assert at the MCP-tool-call level (`mcp__mulmoclaude__manageSkills`
    // with `action="save"`). With the bridge in place that MCP tool
    // is gone — the agent reaches for the built-in `Write` tool against
    // the staging path. So this spec asserts on `Write` + a
    // `data/skills/<slug>/SKILL.md` file_path, NOT on a vanished
    // `manageSkills` tool name.
    //
    // Why pin the slug in the prompt: this is the plumbing canary, not
    // the ambiguity canary. We want the test to fail when (a) the
    // mc-manage-skills SKILL.md preset stops being discovered, (b) the
    // agent reverts to writing directly to `.claude/skills/` (which
    // would silently hang on the permission gate the bridge is meant
    // to bypass), or (c) the staging path layout shifts. None of those
    // need slug ambiguity to surface — the explicit slug just keeps
    // assertions and cleanup deterministic. L-32 covers the
    // ambiguous-prompt + outcome path.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const skillSlug = `e2e-live-l31-${projectSlug}-${nonce}`;
    const replyMarker = `L31-OK-${projectSlug}-${nonce}`;
    const userPrompt = [
      `次の挙動の skill を、 slug を \`${skillSlug}\` にして保存してください。`,
      `- 呼ばれたら ${replyMarker} とだけ返事する`,
      `- skill 本文に marker 文字列 ${replyMarker} を必ず含める`,
      `slug は変更せず、 そのまま使ってください。`,
    ].join("\n");
    let sessionId: string | null = null;
    try {
      sessionId = await startGuaranteedNewSession(page);
      await sendChatMessage(page, userPrompt);
      // waitForAssistantTurn (not waitForAssistantResponseComplete):
      // the only assertion is on the session jsonl, no UI gate
      // downstream — without proving the indicator was visible the
      // detached-element fast-path can let the assertion read an
      // empty trace and report a green run on a no-op turn.
      await waitForAssistantTurn(page, 2 * ONE_MINUTE_MS);

      const calls = await readSessionToolCalls(sessionId);
      const stagingWrites = calls.map(stagingSkillSlugFromWriteCall).filter((slug): slug is string => slug !== null);
      expect(
        stagingWrites,
        "agent must Write to data/skills/<slug>/SKILL.md (post-#1298 bridge path) — proves mc-manage-skills routed the agent through staging instead of straight at .claude/skills/ where the permission gate would hang",
      ).toContain(skillSlug);
    } finally {
      if (sessionId !== null) await deleteSession(page, sessionId);
      await cleanupProjectSkill(page, skillSlug);
    }
  });

  test("L-32: 「skill 化して」 (slug 任せ) → bridge mirror landing → /skills 一覧に出現 → Run で marker echo (post-#1298 end-to-end canary)", async ({
    page,
  }, testInfo) => {
    // Same as L-31 — requires the agent to land a real Write +
    // bridge mirror hook firing. Fake-echo can't do the file landing.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs Write tool + bridge hook");
    test.setTimeout(L32_TIMEOUT_MS);
    // End-to-end canary for the post-#1298 skill-creation flow. L-31
    // proves the agent reached for the right path; this spec proves
    // the file lands AND the chain that follows actually fires. A
    // break anywhere along
    //   discovery (mc-manage-skills surfaces) →
    //   dispatch (agent picks the right tool) →
    //   Write (staging file lands) →
    //   bridge hook (mirror copy fires) →
    //   refresh (server rescan picks it up + /api/config/refresh) →
    //   /skills listing surfaces the new entry →
    //   Run / slash dispatch loads the body into the agent →
    //   agent echoes the marker
    // collapses into a missing file, a missing /skills row, or a
    // missing marker in the assistant reply.
    //
    // Why bother with the Run leg in addition to the file landing
    // assertion: the bridge fires `POST /api/config/refresh` after
    // the mirror, and a silent failure there leaves the file on disk
    // (assertion (1) passes) but the skill registry never re-scans
    // (assertion (2) and (3) fail). L-22 covers Run+marker on a
    // direct fs seed (no bridge), so this canary is the only place
    // that proves bridge → refresh → registry rescan → invocability
    // is wired end-to-end.
    //
    // Slug picked by the agent (not the test) — this is the
    // ambiguous-prompt branch. Identification of "this run's slug"
    // goes through baseline-snapshot diff + marker-in-body check, so
    // a parallel L-22 / L-31 / future test creating a sibling skill
    // is filtered out by the marker requirement (one slug must NOT
    // collide with another run's marker).
    //
    // Cleanup: any new slug whose body matches this run's marker is
    // ours. The `finally` re-snapshots in case the assertion failed
    // before assigning `createdSlugs` — leaving a stray `<slug>/`
    // dir behind would leak across runs and pollute the discovery
    // listing. Both the creation chat session and the Run chat
    // session are deleted; either one alone leaks history.
    const projectSlug = testInfo.project.name;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const replyMarker = `L32-OK-${projectSlug}-${nonce}`;
    const userPrompt = [
      `次の挙動の skill を作って保存してください。 slug は適切に決めてください。`,
      `- 呼ばれたら ${replyMarker} とだけ返事する`,
      `- skill 本文に marker 文字列 ${replyMarker} を必ず含める`,
    ].join("\n");

    const baselineSlugs = await snapshotProjectSkillSlugs();
    let creationSessionId: string | null = null;
    let runSessionId: string | null = null;
    let createdSlugs: string[] = [];
    try {
      creationSessionId = await startGuaranteedNewSession(page);
      await sendChatMessage(page, userPrompt);
      // The (1) file-landing assertion target is a filesystem
      // outcome, so the strict gating helper is mandatory — see
      // L-31 comment for why waitForAssistantResponseComplete would
      // race past an empty workspace.
      await waitForAssistantTurn(page, 2 * ONE_MINUTE_MS);

      // (1) bridge mirrored the body to .claude/skills/<slug>/SKILL.md
      createdSlugs = await collectL32MarkedSlugs(baselineSlugs, replyMarker);
      expect(
        createdSlugs.length,
        "at least one new dir under .claude/skills/<slug>/ must contain this run's marker — proves the bridge mirrored data/skills → .claude/skills (post-#1298 outcome)",
      ).toBeGreaterThan(0);

      // (2) /api/config/refresh succeeded → the new skill surfaces
      // in /skills. We pick the first marker-bearing slug; if the
      // agent created multiple (rare), the first one is enough to
      // prove the registry refreshed — every dir was mirrored
      // through the same code path. The default helper is fine here
      // because we have a UI gate (`skill-item-<slug>` visibility)
      // that masks the fast-path race waitForAssistantTurn guards.
      const [runSlug] = createdSlugs;
      await page.goto("/skills");
      const skillRow = page.getByTestId(`skill-item-${runSlug}`);
      await expect(
        skillRow,
        "newly-bridged skill must surface in /skills — proves /api/config/refresh triggered the registry rescan after the mirror",
      ).toBeVisible({ timeout: ONE_MINUTE_MS });

      // (3) Run via the detail-pane button → slash dispatch →
      // agent loads the bridged SKILL.md body → echoes the marker.
      // Click order matches L-22's Run leg exactly so a regression
      // in the detail-pane / Run wiring trips both.
      await skillRow.click();
      await page.getByTestId("skill-run-btn").click();
      await page.waitForURL(SESSION_URL_PATTERN);
      runSessionId = getCurrentSessionId(page);
      await waitForAssistantResponseComplete(page, 2 * ONE_MINUTE_MS);
      await expect(
        page.getByTestId("text-response-assistant-body").last(),
        "assistant must echo the marker on Run — proves slash-dispatch loaded the bridged skill body into the agent context",
      ).toContainText(replyMarker, { timeout: 2 * ONE_MINUTE_MS });
    } finally {
      if (runSessionId !== null) await deleteSession(page, runSessionId);
      if (creationSessionId !== null) await deleteSession(page, creationSessionId);
      // Re-resolve in case the assertion failed before assigning
      // `createdSlugs` — a partial run still owns any dirs it left.
      const slugsToRemove = createdSlugs.length > 0 ? createdSlugs : await collectL32MarkedSlugs(baselineSlugs, replyMarker);
      // Per-slug try/catch so an unexpected throw from one cleanup
      // (e.g. removeProjectSkill rejects an out-of-band slug whose
      // dir name fails the strict isValidSlug rule) does not abort
      // the loop and leak the remaining slugs. Codex iter-1 review.
      for (const slug of slugsToRemove) {
        try {
          await cleanupProjectSkill(page, slug);
        } catch (err) {
          console.warn(`L-32 finally: cleanup failed for slug ${slug}, continuing with remaining slugs`, err);
        }
      }
    }
  });

  test("L-33: mc-cooking-coach preset が catalog → /skills → Run の chain で agent に届く (#1287 preset chain canary)", async ({ page }) => {
    // The slash command `/mc-cooking-coach` reaches the agent and the
    // bundled SKILL.md body conditions the first turn — neither half
    // is fakeable by fake-echo, which has no skill resolver.
    test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — needs slash dispatch + agent reasoning over a preset body");
    test.setTimeout(L33_TIMEOUT_MS);
    // End-to-end canary for the **launcher-bundled preset** chain
    // (#1287 split `cookingCoach` role → `mc-cooking-coach` preset
    // skill). L-22 covers a synthetic skill seeded directly via
    // `placeProjectSkill`, and L-32 covers an agent-authored skill
    // landed through the #1298 bridge. Neither exercises the
    // **launcher → catalog → active** rail, which is what gets
    // shipped to every fresh user via `syncPresetSkills`:
    //   `server/workspace/skills-preset/<slug>/SKILL.md`  (launcher tarball, read-only)
    //   → `<workspace>/data/skills/catalog/preset/<slug>/SKILL.md`  (boot-time copy by syncPresetSkills)
    //   → `<workspace>/.claude/skills/<slug>/SKILL.md`              (per-user star via syncActivePresetSkills / catalog UI)
    //   → `/<slug>` slash dispatch loads body into agent context
    //   → agent first-turn response references the body's persona/workflow
    //
    // A regression that drops the preset from the launcher tarball,
    // mangles `syncPresetSkills`'s tree copy (sibling assets path),
    // breaks the catalog→active star path, or shears the slash-command
    // resolver collapses one of these signals: missing catalog row,
    // missing project-skill row, missing signature line in the
    // rendered body, or a generic non-cooking first-turn response.
    //
    // Side-effect policy: `mc-cooking-coach` is a launcher preset
    // whose canonical state is "starred" (every shipped preset is
    // designed to be active by default in a fresh user's workspace).
    // If the user already has it starred we use the existing active
    // copy directly; if not, we star it via the catalog UI as a
    // one-time setup and **do not unstar** in finally — unstarring
    // would create user-visible state churn for no win, and the next
    // boot's `syncActivePresetSkills` would re-mirror the body
    // anyway. Only the Run-time chat session is reaped.
    const sessionsToCleanup: string[] = [];
    try {
      await page.goto("/skills");
      await ensurePresetStarred(page, L33_PRESET_SLUG);
      await verifyPresetBody(page, L33_PRESET_SLUG, L33_BODY_SIGNATURE);
      const sessionId = await runPresetAndCaptureSessionId(page);
      sessionsToCleanup.push(sessionId);
      await waitForAssistantResponseComplete(page, 2 * ONE_MINUTE_MS);

      // Body conditioned the first turn: the cooking-coach persona +
      // workflow vocabulary surfaces in the assistant's reply. The
      // assertion runs against `text-response-assistant-body.last()`
      // mirroring L-22/L-32 so sidebar/history pane noise is excluded
      // by construction. A regression that broke skill-body loading
      // (e.g. the resolver dropped the `mc-*` namespace) would land
      // on a generic acknowledgement that misses the entire pattern.
      await expect(
        page.getByTestId("text-response-assistant-body").last(),
        `assistant first turn after /${L33_PRESET_SLUG} must reference cooking vocabulary — proves SKILL.md body reached the agent context (preset chain canary, #1287)`,
      ).toContainText(L33_COOKING_VOCAB_PATTERN, { timeout: 2 * ONE_MINUTE_MS });
    } finally {
      for (const sid of sessionsToCleanup) {
        await deleteSession(page, sid);
      }
    }
  });

  test("L-33B: catalog → ☆ Star → /skills active row 出現 (catalog→active UI rail canary)", async ({ page }) => {
    test.setTimeout(L33B_TIMEOUT_MS);
    // L-33 verifies the FULL preset chain end-to-end (catalog → active
    // → /skills → /<slug> dispatch → LLM-conditioned response). But
    // L-33's `starPresetViaCatalog` path runs ONLY when the target
    // preset isn't already starred — and in normal dev / CI
    // environments `mc-cooking-coach` is starred from a previous
    // boot, so L-33 takes the disk-snapshot fast path every time and
    // the catalog→active UI is never actually clicked.
    //
    // L-33B is a smaller dedicated canary that ALWAYS exercises the
    // catalog→active UI rail:
    //   (a) fs-unstar the target preset (idempotent — no-op when the
    //       slot is already absent)
    //   (b) navigate /skills → catalog row visible + project-skill
    //       row count === 0 (pre-state assertion)
    //   (c) click the catalog row → click ☆ Star
    //   (d) wait for `skill-item-<slug>` to surface in /skills
    //       (proves starCatalogEntry copied `data/skills/catalog/preset/<slug>/`
    //       → `.claude/skills/<slug>/` AND the subsequent registry
    //       refresh picked it up)
    //   (e) finally: restore to the EXACT original starred state
    //       (snapshot at test start), so a user who actually uses
    //       mc-invoice doesn't lose their existing star
    //
    // No LLM dispatch / no agent turn — pure UI + filesystem chain.
    // That keeps it fast and lets the CI matrix run it without
    // `E2E_LIVE_NO_LLM` skipping; the regression net it adds is
    // independent of fake-echo's reach. mc-invoice is picked because
    // it's a launcher preset (catalog row guaranteed) that's rarely
    // starred by default.
    //
    // Symmetric state restoration (Codex iter-5 review): snapshot
    // the original starred state BEFORE touching disk. If the user /
    // CI had `mc-invoice` starred (they actually use it), `finally`
    // leaves it starred. If unstarred, `finally` fs-unstars whatever
    // the test added. Either way the workspace ends in the same
    // state it started — no silent destruction of a real user's
    // existing star.
    //
    // Concurrency note: L-33B mutates a shared, fixed slug. No other
    // e2e-live test currently touches mc-invoice and Playwright runs
    // each test once per file, so there's no actual race today. The
    // defensive `.or()` on Star vs "Starred" inside
    // `clickStarOnCatalogDetail` (Codex iter-5 review) is
    // forward-compat for a future webkit project / sibling spec that
    // also mutates catalog state.
    const wasOriginallyStarred = (await snapshotProjectSkillSlugs()).has(L33B_PRESET_SLUG);
    try {
      if (wasOriginallyStarred) {
        await removeProjectSkill(L33B_PRESET_SLUG);
      }
      await page.goto("/skills");
      await expectCatalogRowVisible(page, L33B_PRESET_SLUG);
      const skillRow = page.getByTestId(`skill-item-${L33B_PRESET_SLUG}`);
      await expect(skillRow, `${L33B_PRESET_SLUG} project-skill row must be absent before star — pre-test fs-unstar must have taken effect`).toHaveCount(0);
      // Reuse the L-33 helper: same defensive Star vs "Starred" .or()
      // pattern, same final `skill-item-<slug>` visibility assertion
      // (proves catalog→active rail wiring). Sharing the helper keeps
      // both canaries in lockstep — a future refactor to the star
      // UI testids only needs updating one site.
      await starPresetViaCatalog(page, L33B_PRESET_SLUG);
    } finally {
      // Reconcile to the EXACT original starred state by looking at
      // current disk (not just the original snapshot). The naive
      // "if !wasOriginallyStarred → unstar" pattern was destructive
      // in the edge case where the test threw between the up-front
      // fs-unstar and a successful UI star: an originally-starred
      // preset would be left unstarred (Codex GHA + CodeRabbit on
      // iter-1 PR review). The 4-cell reconcile table handles every
      // start/end combination:
      //   (orig=T, now=T): no-op (the click succeeded, fs already correct)
      //   (orig=T, now=F): re-star via fs cp from catalog (test threw
      //                    after our fs-unstar but before / during click)
      //   (orig=F, now=T): unstar (we starred via UI, clean up)
      //   (orig=F, now=F): no-op (either the early assert blocked our
      //                    own fs-unstar, or the test threw before click)
      // Both fs ops are idempotent so a transient failure between the
      // snapshot and the reconcile cannot corrupt the result.
      //
      // try/catch around the whole reconcile so a transient fs error
      // (catalog source missing, ENOSPC, IO hiccup) does NOT overwrite
      // an in-flight assertion failure from the `try` block. Playwright
      // surfaces only the last thrown error otherwise, masking the
      // real regression signal (Codex iter-2 review). Mirrors the
      // L-21B / L-32 cleanup pattern in this file.
      try {
        const isCurrentlyStarred = (await snapshotProjectSkillSlugs()).has(L33B_PRESET_SLUG);
        if (wasOriginallyStarred && !isCurrentlyStarred) {
          await copyPresetCatalogToActive(L33B_PRESET_SLUG);
        } else if (!wasOriginallyStarred && isCurrentlyStarred) {
          await removeProjectSkill(L33B_PRESET_SLUG);
        }
      } catch (err) {
        console.warn(`L-33B finally: state reconciliation failed for ${L33B_PRESET_SLUG}, original test error (if any) preserved`, err);
      }
    }
  });
});

/**
 * L-33 setup step: make sure `<slug>` is in `.claude/skills/` before
 * the spec opens the active-skill detail pane. The primary decision
 * uses {@link snapshotProjectSkillSlugs} (disk-authoritative) rather
 * than a `/skills` DOM count, which has its own load race — the
 * project-skill row often hasn't hydrated yet right after
 * `page.goto("/skills")`, so a DOM-count check would falsely report
 * "not starred" and then collide with a "Starred" badge in the
 * catalog detail pane. The Star path itself is defensive against the
 * Codex iter-1 race (a parallel worker stars between this snapshot
 * and the click) — see {@link starPresetViaCatalog}. Always asserts
 * the catalog row is present so a preset that's already starred from
 * a previous boot can't mask a fresh launcher→catalog regression.
 */
async function ensurePresetStarred(page: Page, slug: string): Promise<void> {
  await expectCatalogRowVisible(page, slug);
  const projectSlugs = await snapshotProjectSkillSlugs();
  if (projectSlugs.has(slug)) return;
  await starPresetViaCatalog(page, slug);
}

/**
 * Shared catalog-row visibility assertion. Used both by
 * {@link ensurePresetStarred} (L-33 setup) and L-33B (where the row
 * must surface even though the test goes on to fs-unstar + UI-star
 * from scratch). Extracted because the assertion shape AND the
 * "what does a failure here mean?" message are byte-identical at
 * both call sites — keeping them in sync via one helper avoids the
 * silent drift that prompted the catalog of shared helpers
 * (CLAUDE.md "Shared utilities" rule). Also satisfies the
 * code-style rule 1/4 (DRY: helper extraction when the same
 * pattern appears at 2+ sites).
 */
async function expectCatalogRowVisible(page: Page, slug: string): Promise<void> {
  await expect(
    page.getByTestId(`skill-catalog-item-${slug}`),
    `catalog list must include ${slug} — proves syncPresetSkills landed the launcher preset under data/skills/catalog/preset/`,
  ).toBeVisible({ timeout: ONE_MINUTE_MS });
}

/**
 * Drive the catalog UI through the star path a user takes (select
 * catalog row → click ☆ Star → wait for the active row to appear).
 * Defensive against the iter-1 race where a parallel worker stars
 * the preset between {@link ensurePresetStarred}'s disk snapshot and
 * this function: the detail pane could surface EITHER the ☆ Star
 * button (still un-starred) OR the disabled "Starred" indicator
 * (already starred by the other worker). Both are acceptable
 * outcomes — only click Star when it's the one actually rendered.
 * Each helper stays under CLAUDE.md's 20-line cap; a regression
 * that hangs the star path (#1335 PR-B follow-ups) trips the
 * closing visibility wait either way.
 */
async function starPresetViaCatalog(page: Page, slug: string): Promise<void> {
  await page.getByTestId(`skill-catalog-item-${slug}`).click();
  const starBtn = page.getByTestId("skill-catalog-detail-star-btn");
  const starredIndicator = page.getByTestId("skill-catalog-detail-starred");
  await expect(starBtn.or(starredIndicator), `catalog detail must surface either ☆ Star or "Starred" for ${slug}`).toBeVisible({ timeout: ONE_MINUTE_MS });
  // `isVisible()` (not `count() > 0`) so a future v-show refactor
  // that keeps both elements in the DOM but hides one cannot flip
  // this branch silently — current Vue v-if/v-else makes them
  // mutually exclusive in the DOM, but the visibility check stays
  // correct under either rendering strategy (Codex iter-2 review).
  if (!(await starredIndicator.isVisible())) {
    await starBtn.click();
  }
  await expect(
    page.getByTestId(`skill-item-${slug}`),
    `${slug} must surface in /skills after starring — proves catalog→active rail (.claude/skills/) is wired`,
  ).toBeVisible({ timeout: ONE_MINUTE_MS });
}

/**
 * Open the active-skill detail pane and assert the rendered body
 * contains the launcher signature line. Catches a sync regression
 * that corrupted the body (e.g. truncated copy, encoding mismatch)
 * but left the directory + filename intact — a passing
 * `skill-item-*` visibility check alone would not flag that.
 */
async function verifyPresetBody(page: Page, slug: string, signature: string): Promise<void> {
  const skillRow = page.getByTestId(`skill-item-${slug}`);
  await expect(skillRow, `${slug} project-skill row must be visible before opening detail pane`).toBeVisible({ timeout: ONE_MINUTE_MS });
  await skillRow.click();
  const bodyView = page.getByTestId("skill-body-rendered");
  await expect(bodyView, "preset body must hydrate (detail API + markdown render path)").toBeVisible({ timeout: ONE_MINUTE_MS });
  await expect(
    bodyView,
    `rendered body must echo the launcher signature ${JSON.stringify(signature)} — proves catalog→active copy preserved the SKILL.md text`,
  ).toContainText(signature, { timeout: ONE_MINUTE_MS });
}

/**
 * Click the active-skill Run button. The handler issues
 * `appApi.startNewChat('/<slug>')` which routes to /chat/<id> with
 * the slash command as the first user message. Capture the new
 * session id immediately for the spec's `finally` cleanup so a
 * downstream assertion timeout still reaps the chat.
 */
async function runPresetAndCaptureSessionId(page: Page): Promise<string> {
  await page.getByTestId("skill-run-btn").click();
  await page.waitForURL(SESSION_URL_PATTERN);
  const sessionId = getCurrentSessionId(page);
  if (sessionId === null) {
    throw new Error("runPresetAndCaptureSessionId: getCurrentSessionId returned null after waitForURL — SESSION_URL_PATTERN likely drifted");
  }
  return sessionId;
}

// Composite cleanup: prefer the user-facing UI delete (keeps the
// server registry / `/skills` listing in sync) but always finish
// with the fs-level rm so a UI hiccup or a stale staging dir cannot
// leak state into the next run. Order matters — the API path only
// touches the canonical dir; the staging dir under
// `data/skills/<slug>/` is owned by the bridge (#1298) and is not
// reachable from the UI, so the fs follow-up is mandatory.
async function cleanupProjectSkill(page: Page, slug: string): Promise<void> {
  try {
    await deleteProjectSkillViaUi(page, slug);
  } catch (err) {
    console.warn(`cleanupProjectSkill: UI delete failed for ${slug}, falling back to fs`, err);
  }
  await removeProjectSkill(slug);
}

// L-32 cleanup helper. Pulled out of the spec so the assertion site
// and the `finally` site share one predicate; otherwise drift between
// the two would silently leave skill dirs on disk after a failed run.
async function collectL32MarkedSlugs(baselineSlugs: Set<string>, replyMarker: string): Promise<string[]> {
  const after = await snapshotProjectSkillSlugs();
  const candidates = [...after].filter((slug) => !baselineSlugs.has(slug));
  const matches: string[] = [];
  for (const slug of candidates) {
    const body = await readProjectSkillBody(slug);
    if (body !== null && body.includes(replyMarker)) {
      matches.push(slug);
    }
  }
  return matches;
}
