import { randomUUID } from "node:crypto";

import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import {
  deleteProjectSkillViaUi,
  deleteSession,
  getCurrentSessionId,
  placeProjectSkill,
  readProjectSkillBody,
  readSessionToolCalls,
  removeProjectSkill,
  selectRole,
  sendChatMessage,
  snapshotProjectSkillSlugs,
  stagingSkillSlugFromWriteCall,
  startGuaranteedNewSession,
  startNewSession,
  waitForAssistantResponseComplete,
  waitForAssistantTurn,
} from "../fixtures/live-chat.ts";

const L21_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L22_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L31_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L32_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const SESSION_URL_PATTERN = /\/chat\/[0-9a-f-]+/;

// All four scenarios talk to the live LLM (L-21: chart tool dispatch,
// L-22: skill execution, L-31: mc-manage-skills bridge dispatch
// canary, L-32: end-to-end skill landing canary). They share no
// state — run in parallel to cut wall time, mirroring the other
// category specs.
test.describe.configure({ mode: "parallel" });

test.describe("skills (real LLM / static)", () => {
  test("L-21: Office role + presentChart で deferred-tool dispatch が成功し chart-canvas が描画される", async ({ page }) => {
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
});

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
