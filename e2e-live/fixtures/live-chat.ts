// Live-mode helpers for e2e-live. Mirrors the surface of
// `e2e/fixtures/chat.ts` for the shared interactions, but does NOT
// install any API mocks — the real Claude API runs end-to-end. Use
// these helpers from specs in `e2e-live/tests/`.

import { randomUUID } from "node:crypto";
import { cp, copyFile, lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Download, type FrameLocator, type Page, expect } from "@playwright/test";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { readSessionJsonl } from "../../server/utils/files/session-io.ts";
import { readTextUnder } from "../../server/utils/files/workspace-io.ts";
import { isValidSlug } from "../../server/utils/slug.ts";
import { isErrorWithCode, isRecord } from "../../server/utils/types.ts";
import type { NotifierEntry } from "../../server/notifier/types.ts";
import { API_ROUTES } from "../../src/config/apiRoutes.ts";

import { stagingSkillSlugFromWritePath } from "./staging-skill-path.ts";

/**
 * Canonical SPA session URL pattern. Both `e2e-live/fixtures/`
 * helpers and `e2e-live/tests/*.spec.ts` route waits assert against
 * `/chat/<uuid-ish>`; centralising the regex here prevents the two
 * sides from drifting apart (Sourcery review on PR #1345 caught the
 * duplicate before it caused real divergence).
 */
export const SESSION_URL_PATTERN = /\/chat\/[0-9a-f-]+/;

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the user's mulmoclaude workspace. Honours the env override
 * the server itself respects so the tests still work when a custom
 * workspace is in use.
 *
 * Caveat: if you set `MULMOCLAUDE_WORKSPACE` in your shell to point
 * tests at a sandbox dir, `unset` it before running mulmoclaude
 * itself — fixture cleanup writes inside whatever this resolves to,
 * and a stale env in the parent shell will silently target the
 * wrong workspace.
 */
function workspaceRoot(): string {
  return process.env.MULMOCLAUDE_WORKSPACE ?? path.join(homedir(), "mulmoclaude");
}

/**
 * Resolve a workspace-relative path to an absolute path inside the
 * workspace root, refusing anything that escapes the root via `..`
 * or absolute paths. Defensive guard so a mistyped fixture target
 * cannot delete arbitrary files on the host.
 */
function resolveWorkspacePath(workspaceRel: string): string {
  const root = path.resolve(workspaceRoot());
  const target = path.resolve(root, workspaceRel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Workspace-relative path escapes workspace root: ${workspaceRel}`);
  }
  return target;
}

/**
 * Copy a fixture file (relative to `e2e-live/fixtures/`) into the
 * workspace at the given relative path. Creates intermediate dirs.
 * Returns the absolute destination path so the spec can pass it on
 * to {@link removeFromWorkspace} for cleanup. The destination
 * filename should be unique per spec to avoid stomping on real
 * user data.
 */
export async function placeFixtureInWorkspace(fixtureRel: string, workspaceRel: string): Promise<string> {
  const src = path.join(FIXTURES_DIR, fixtureRel);
  const dst = resolveWorkspacePath(workspaceRel);
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(src, dst);
  return dst;
}

/** Best-effort delete; never throws if the file is already gone. */
export async function removeFromWorkspace(workspaceRel: string): Promise<void> {
  await rm(resolveWorkspacePath(workspaceRel), { force: true });
}

/**
 * Write `body` to a workspace-relative file, creating intermediate
 * dirs. Like {@link placeFixtureInWorkspace} but for inline content
 * (no source file on disk to copy from). Returns the absolute path so
 * the spec can hand it to {@link removeFromWorkspace} for cleanup.
 */
export async function placeWorkspaceFile(workspaceRel: string, body: string): Promise<string> {
  const dst = resolveWorkspacePath(workspaceRel);
  await mkdir(path.dirname(dst), { recursive: true });
  await writeFile(dst, body, "utf8");
  return dst;
}

/**
 * Read the raw text of a workspace-relative file. Returns `null` when
 * the file does not exist so the caller can distinguish "absent" from
 * "empty string" without ad-hoc try/catch. Used by snapshot/restore
 * flows that round-trip a real user file across a test (e.g.
 * `config/settings.json` in the L-SETTINGS-EFFORT spec).
 */
export async function readWorkspaceFile(workspaceRel: string): Promise<string | null> {
  const target = resolveWorkspacePath(workspaceRel);
  try {
    return await readFile(target, "utf8");
  } catch (err) {
    if (isErrorWithCode(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Drop a wiki page directly onto disk at `data/wiki/pages/<slug>.md`.
 * The wiki view fetches /api/wiki?slug=<slug> on navigate, which
 * reads the same file — so seeding the file is enough to make a page
 * accessible via the standalone /wiki/pages/<slug> route. Spec-unique
 * slugs only; do not stomp real user pages.
 */
export async function placeWikiPage(slug: string, body: string): Promise<void> {
  const target = resolveWorkspacePath(`data/wiki/pages/${slug}.md`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body, "utf8");
}

export async function removeWikiPage(slug: string): Promise<void> {
  await removeFromWorkspace(`data/wiki/pages/${slug}.md`);
}

const WIKI_INDEX_REL = "data/wiki/index.md";

/**
 * Replace `data/wiki/index.md` with the given content for the
 * duration of a test, returning the original content so the caller
 * can restore it in `finally`. Returns `null` when the file did
 * not exist (so `restoreWikiIndex(null)` deletes the synthetic
 * file we are about to create); returns the empty string when the
 * file existed but was legitimately empty (so the empty file is
 * preserved, not deleted, on cleanup). Codex review iter-1 caught
 * the prior overload of "" as the missing-file sentinel — using
 * `string | null` keeps "existed-but-empty" and "did not exist"
 * distinguishable.
 *
 * The wiki index is a single shared workspace file, so any spec
 * that mutates it must run serially with respect to other index
 * writers — keep L-16 the only test that touches this file or
 * fence newcomers behind `test.describe.configure({ mode: "serial" })`.
 */
export async function replaceWikiIndex(newContent: string): Promise<string | null> {
  const target = resolveWorkspacePath(WIKI_INDEX_REL);
  let original: string | null = null;
  try {
    original = await readFile(target, "utf8");
  } catch {
    // index.md did not exist — leave original as null so
    // restoreWikiIndex deletes the file we are about to create.
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, newContent, "utf8");
  return original;
}

/**
 * Restore (or delete) `data/wiki/index.md`. Pass the value returned
 * by `replaceWikiIndex` — `null` means "delete the file we created
 * (it did not exist before)", any string (including "") means
 * "write this back verbatim". Best-effort: never throws so a passing
 * test does not turn red on a flaky cleanup.
 */
export async function restoreWikiIndex(originalContent: string | null): Promise<void> {
  const target = resolveWorkspacePath(WIKI_INDEX_REL);
  try {
    if (originalContent === null) {
      await rm(target, { force: true });
      return;
    }
    await writeFile(target, originalContent, "utf8");
  } catch (err) {
    console.warn(`restoreWikiIndex: failed to restore ${WIKI_INDEX_REL}`, err);
  }
}

/** Open the wiki index route directly. */
export async function navigateToWikiIndex(page: Page): Promise<void> {
  await page.goto("/wiki");
}

/**
 * Validate a project-skill slug before letting it near the
 * filesystem. Reuses the same `isValidSlug` rule the server uses
 * for skills / sources / wiki — lowercase ASCII, digits, hyphens,
 * 1..120 chars, no leading/trailing or consecutive hyphens. This
 * is the entry guard the helpers below rely on; without it a
 * caller could pass `foo/../bar` and `removeProjectSkill` would
 * resolve to `.claude/skills/bar` and recursively delete that
 * different directory (codex review iter-1 over-delete risk).
 * Throws so the calling test fails loudly rather than silently
 * targeting the wrong path.
 */
function assertValidSkillSlug(slug: string): void {
  if (!isValidSlug(slug)) {
    throw new Error(`placeProjectSkill / removeProjectSkill: invalid slug ${JSON.stringify(slug)} — must satisfy server/utils/slug.ts isValidSlug`);
  }
}

/**
 * Seed a project-scope skill at `<workspace>/.claude/skills/<slug>/SKILL.md`.
 * The mulmoclaude server's skill discovery does fresh readdir/stat
 * on every list call (no cache), so the seeded file is visible to
 * the next `GET /api/skills` without a server restart.
 *
 * Slug must satisfy `isValidSlug` (no path separators, no traversal
 * tokens). Spec-unique slugs only; never stomp a real
 * user-authored skill.
 */
export async function placeProjectSkill(slug: string, description: string, body: string): Promise<void> {
  assertValidSkillSlug(slug);
  const target = resolveWorkspacePath(`.claude/skills/${slug}/SKILL.md`);
  await mkdir(path.dirname(target), { recursive: true });
  const content = ["---", `description: ${description}`, "---", "", body, ""].join("\n");
  await writeFile(target, content, "utf8");
}

/**
 * Best-effort fs-level delete of a seeded skill. Removes both the
 * canonical `.claude/skills/<slug>/` and the staging
 * `data/skills/<slug>/` (the latter is a no-op when it does not
 * exist — true for L-22-style direct seeds via {@link placeProjectSkill},
 * non-trivial for L-31 / L-32 where the agent wrote to staging and
 * the bridge mirrored it across).
 *
 * Prefer {@link deleteProjectSkillViaUi} for normal test teardown:
 * it routes through `DELETE /api/skills/:name` which keeps the
 * server-side skill registry in sync. Use this fs-level helper only
 * as a safety-net follow-up (the UI / API never touch the staging
 * dir, so it must still be cleaned to keep the bridge from
 * re-mirroring on a stale Write event).
 */
export async function removeProjectSkill(slug: string): Promise<void> {
  assertValidSkillSlug(slug);
  const canonicalDir = resolveWorkspacePath(`.claude/skills/${slug}`);
  const stagingDir = resolveWorkspacePath(`data/skills/${slug}`);
  await rm(canonicalDir, { recursive: true, force: true });
  await rm(stagingDir, { recursive: true, force: true });
}

/**
 * fs-restore a launcher preset's `.claude/skills/<slug>/` from its
 * canonical `data/skills/catalog/preset/<slug>/` source. The catalog
 * subdir is launcher-managed (overwritten on every boot by
 * `syncPresetSkills`), so copying from it produces the same content
 * that {@link starPresetViaCatalog | starring via the UI} would
 * deposit. Used by L-33B's `finally` to restore an originally-
 * starred preset when the test threw before the UI star path
 * completed (otherwise the up-front fs-unstar would leave the
 * workspace in a destroyed state). `cp` is recursive + force so
 * the helper is idempotent and won't error on a slot that's already
 * populated. Slug must satisfy `isValidSlug` to keep this from
 * accepting `..`-style traversal even though both endpoints are
 * inside the workspace.
 *
 * NOTE: this restores the launcher-canonical content. A user with
 * unsaved local edits to `.claude/skills/<slug>/SKILL.md` would
 * lose them — same destructive shape as `syncActivePresetSkills`
 * at boot, so the trade-off matches normal preset lifecycle.
 */
export async function copyPresetCatalogToActive(slug: string): Promise<void> {
  assertValidSkillSlug(slug);
  // `path.join` for cross-platform safety per CLAUDE.md
  // ("Build paths with node:path; never concatenate with '/'").
  // Other helpers in this file predate the rule and still use
  // template literals; a sweep is out of scope here (CodeRabbit
  // iter-2).
  const src = resolveWorkspacePath(path.join("data", "skills", "catalog", "preset", slug));
  const dst = resolveWorkspacePath(path.join(".claude", "skills", slug));
  await cp(src, dst, { recursive: true, force: true });
}

/**
 * Seed a project-skill slot whose entry is a symlink pointing at a
 * non-existent path. The discovery loop in
 * `server/workspace/skills/discovery.ts:collectSkillsFromDir` calls
 * `stat()` (not `lstat`) on every entry so a real symlink is
 * transparently followed; when the target is missing `stat()` throws
 * ENOENT and the entry is skipped. L-30 (B-08) drives that branch
 * end-to-end to prove a dangling symlink (e.g. a host-relative
 * `~/ss/llm/skills/...` link that disappears inside the sandbox)
 * cannot crash discovery for the sibling skills sitting alongside it.
 *
 * Caller picks `target` (no implicit `/tmp` use) so the test can
 * choose a path that's guaranteed missing even with parallel runs
 * (e.g. nonce-stamped under `os.tmpdir()`). Slug must satisfy
 * `isValidSlug` for the same reasons as {@link placeProjectSkill}.
 */
export async function placeBrokenSymlinkSkill(slug: string, target: string): Promise<void> {
  assertValidSkillSlug(slug);
  const linkPath = resolveWorkspacePath(`.claude/skills/${slug}`);
  await mkdir(path.dirname(linkPath), { recursive: true });
  await symlink(target, linkPath);
}

/**
 * Best-effort delete for {@link placeBrokenSymlinkSkill}. Uses `lstat`
 * to confirm the slot is still a symlink before `rm`-ing it — guards
 * against an unlikely race where a parallel run replaced the link with
 * a real dir we shouldn't touch. Silent no-op when the slot is gone.
 */
export async function removeBrokenSymlinkSkill(slug: string): Promise<void> {
  assertValidSkillSlug(slug);
  const linkPath = resolveWorkspacePath(`.claude/skills/${slug}`);
  try {
    const stat = await lstat(linkPath);
    if (!stat.isSymbolicLink()) return;
  } catch (err) {
    if (isErrorWithCode(err) && err.code === "ENOENT") return;
    throw err;
  }
  await rm(linkPath, { force: true });
}

/**
 * Delete a project-scope skill via the user-facing UI flow:
 * navigate to `/skills`, click the row, click the delete button,
 * accept the native `confirm()`, and wait for the row to disappear
 * from the listing. Internally hits `DELETE /api/skills/:name`
 * (`server/api/routes/skills.ts`) which `unlink`s
 * `.claude/skills/<slug>/SKILL.md` and `rmdir`s the dir, then the
 * normal config-refresh hook deregisters the skill — so unlike the
 * raw fs delete this keeps the in-memory registry honest and the
 * `/skills` listing fresh.
 *
 * What it does NOT do: clean the staging
 * `<workspace>/data/skills/<slug>/` dir. That path is owned by the
 * skill bridge (#1298) and the server-side delete deliberately does
 * not touch it. Test cleanups MUST follow this with a
 * {@link removeProjectSkill} call so a stale staging dir cannot
 * round-trip through the bridge into a future test's view.
 *
 * No-op when the row never appears (skill already cleaned up by an
 * earlier finally pass, or never landed). Returns silently on a
 * missing row so finally clauses do not fail-cascade on cleanup
 * order surprises.
 */
// 30s for the row to appear after the navigation: covers a slow
// initial /api/skills fetch on a workspace with many skills + an
// unlucky network jitter. Codex iter-1 review on this PR — the
// previous 5s value silently false-resolved to "row absent" on a
// slow listing fetch, skipping the UI delete and leaving the
// in-memory skill registry to drift until the next config refresh.
const SKILL_ROW_PRESENCE_TIMEOUT_MS = 30 * ONE_SECOND_MS;

/**
 * Open a Settings-modal management tab and wait for its surface to
 * mount. Loads `/chat` first so the top-chrome gear button is present:
 * the old standalone `/skills` / `/roles` routes used to load the app
 * shell implicitly, and callers may invoke this before touching the UI
 * at all (e.g. right after seeding a skill on disk).
 */
async function openSettingsTab(page: Page, tabId: "skills" | "roles", rootTestId: string, rootLabel: string): Promise<void> {
  await page.goto("/chat");
  await page.getByTestId("settings-btn").click();
  await expect(page.getByTestId("settings-modal"), "settings modal must open").toBeVisible({ timeout: ONE_MINUTE_MS });
  await page.getByTestId(`settings-tab-${tabId}`).click();
  await expect(page.getByTestId(rootTestId), rootLabel).toBeVisible({ timeout: ONE_MINUTE_MS });
}

/**
 * Open the Skills management surface. Skills moved out of the standalone
 * `/skills` route into the Settings modal (Management group), so the
 * live-mode path is now: gear button → Skills tab. Resolves once the
 * always-rendered catalog accordion is visible inside the modal.
 */
export async function openSkillsPanel(page: Page): Promise<void> {
  await openSettingsTab(page, "skills", "skill-section-catalog", "skills catalog section must mount inside the modal");
}

/** Open the Roles management surface (Settings modal → Roles tab). */
export async function openRolesPanel(page: Page): Promise<void> {
  await openSettingsTab(page, "roles", "roles-view-root", "roles view must mount inside the modal");
}

/** Close the Settings modal via its header ✕. No-op if already closed. */
export async function closeSettingsModal(page: Page): Promise<void> {
  if (
    !(await page
      .getByTestId("settings-modal")
      .isVisible()
      .catch(() => false))
  )
    return;
  await page.getByTestId("settings-close-btn").click();
  await expect(page.getByTestId("settings-modal")).toBeHidden({ timeout: ONE_MINUTE_MS });
}

/**
 * Invoke a skill the only way the UI still offers it: type its
 * `/<slug>` slash command as the first turn of a fresh chat. (The
 * in-view Run button was removed when Skills moved into the Settings
 * modal.) Dismisses the modal if open, starts a new session, sends the
 * command, and returns the new session id once `/chat/<id>` settles.
 */
export async function invokeSkillViaSlashCommand(page: Page, slug: string): Promise<string> {
  assertValidSkillSlug(slug);
  await closeSettingsModal(page);
  await startNewSession(page);
  await sendChatMessage(page, `/${slug}`);
  await page.waitForURL(SESSION_URL_PATTERN, { timeout: ONE_MINUTE_MS });
  const sessionId = getCurrentSessionId(page);
  if (sessionId === null) throw new Error(`invokeSkillViaSlashCommand: session id did not settle after sending /${slug}`);
  return sessionId;
}

export async function deleteProjectSkillViaUi(page: Page, slug: string, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  assertValidSkillSlug(slug);
  await openSkillsPanel(page);
  const skillRow = page.getByTestId(`skill-item-${slug}`);
  try {
    await expect(skillRow).toBeVisible({ timeout: SKILL_ROW_PRESENCE_TIMEOUT_MS });
  } catch {
    // Row absent after the wait → skill is not in the listing
    // (either the test never created it or a previous finally
    // already cleaned it). Treat as success so cleanup stays
    // idempotent, but log so a missed UI delete is visible to
    // anyone reading the run log — silent fast-paths here are how
    // registry-staleness bugs sneak in.
    console.warn(
      `deleteProjectSkillViaUi: row [skill-item-${slug}] never appeared in the Skills settings tab within ${SKILL_ROW_PRESENCE_TIMEOUT_MS}ms — skipping UI delete (fs follow-up still rms both trees)`,
    );
    return;
  }
  await skillRow.click();
  // `window.confirm()` resolves synchronously when fired, so the
  // dialog handler MUST be installed before the click — a late
  // listener misses the prompt and the click hangs the page.
  page.once("dialog", (dialog) => {
    dialog.accept().catch(() => {
      /* ignore: page may have closed during cleanup */
    });
  });
  await page.getByTestId("skill-delete-btn").click();
  await expect(skillRow, "deleted skill row must disappear from the Skills settings listing").toBeHidden({ timeout: timeoutMs });
}

/**
 * Built-in editor tool name as the SDK exposes it (no MCP prefix).
 * Specs match against this when asserting that the agent reached for
 * the filesystem editor — used by L-31 to verify the post-#1298
 * skill-bridge dispatch shape (agent writes to `data/skills/...`,
 * NOT to `.claude/skills/...`).
 */
export const WRITE_TOOL_NAME = "Write";

/**
 * Extract the staging-skill slug from a `Write` tool call's
 * `file_path` arg. Returns `null` when the call isn't a `Write` to
 * `<workspace>/data/skills/<slug>/SKILL.md`. Specs in L-31 use this to
 * assert that mc-manage-skills routed the agent into the bridge
 * staging path rather than into `.claude/skills/` (which would
 * indicate the bridge SKILL.md was ignored — the regression #1298
 * fixed).
 *
 * The host/sandbox dual-root path matching (and the false-positive
 * guard for writes outside the workspace) lives in the pure,
 * unit-tested {@link stagingSkillSlugFromWritePath}.
 */
export function stagingSkillSlugFromWriteCall(call: ToolCallTraceRecord): string | null {
  if (call.toolName !== WRITE_TOOL_NAME) return null;
  if (!isRecord(call.args)) return null;
  const filePath = call.args.file_path;
  if (typeof filePath !== "string") return null;
  return stagingSkillSlugFromWritePath(filePath, workspaceRoot());
}

/**
 * One `tool_call` record as persisted by `server/workspace/tool-trace`.
 * Specs filter on `toolName` and pull selected fields from `args`
 * (`file_path`, ...) — the trace shape is wider than this slice but
 * the spec only needs the dispatch-level info. `toolUseId` carries the
 * per-invocation key so callers can pair a `tool_call` with the
 * matching `tool_call_result` returned by `readSessionToolResults`.
 */
export interface ToolCallTraceRecord {
  toolUseId: string;
  toolName: string;
  args: unknown;
}

interface ToolCallJsonlLine {
  type?: unknown;
  toolUseId?: unknown;
  toolName?: unknown;
  args?: unknown;
}

function parseToolCallLine(line: string): ToolCallTraceRecord | null {
  if (line.length === 0) return null;
  let parsed: ToolCallJsonlLine;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed.type !== "tool_call") return null;
  if (typeof parsed.toolUseId !== "string") return null;
  if (typeof parsed.toolName !== "string") return null;
  return { toolUseId: parsed.toolUseId, toolName: parsed.toolName, args: parsed.args };
}

/**
 * Read the per-session jsonl event log and return every `tool_call`
 * record in dispatch order. Specs use this to assert the agent
 * reached for a specific tool (or, conversely, that it did NOT reach
 * for `Write` against `.claude/skills/`). Delegates the path math
 * and ENOENT swallow to `readSessionJsonl`
 * (`server/utils/files/session-io.ts`) so we stay in lockstep with
 * the server-side jsonl location and don't reinvent the
 * `<workspace>/conversations/chat/<id>.jsonl` layout in two places
 * (Sourcery review on PR #1345). Returns `[]` when the jsonl is
 * missing — agent routes only flush the file once the first event
 * is recorded, so an early read can race ahead of the first tool
 * call. The caller is expected to gate this on
 * {@link waitForAssistantTurn}.
 */
export async function readSessionToolCalls(sessionId: string): Promise<ToolCallTraceRecord[]> {
  const raw = await readSessionJsonl(sessionId, workspaceRoot());
  if (raw === null) return [];
  const calls: ToolCallTraceRecord[] = [];
  for (const line of raw.split("\n")) {
    const record = parseToolCallLine(line);
    if (record !== null) calls.push(record);
  }
  return calls;
}

/**
 * One `tool_call_result` record as persisted alongside `tool_call`
 * events (see `server/workspace/tool-trace/index.ts:handleToolCallResult`).
 * Pair with the originating call via {@link ToolCallTraceRecord.toolUseId}.
 *
 * The server classifier writes either `content` (inline, ≤ 4096 chars
 * per `MAX_INLINE_CONTENT_CHARS`) or `contentRef` (pointer to a file
 * on disk for larger / special results) — never both. `content` is
 * `null` when the result was spilled to a file and `contentRef`
 * carries the path; specs that need the body for assertions should
 * `expect(content).not.toBeNull()` to fail loudly if a future tool
 * starts producing oversized output that breaks their assumption.
 */
export interface ToolCallResultRecord {
  toolUseId: string;
  toolName: string;
  /** Inline body when the result fit under the inline threshold. */
  content: string | null;
  /** Pointer to a workspace-relative path when the result was spilled out-of-band. */
  contentRef: string | null;
}

interface ToolCallResultJsonlLine {
  type?: unknown;
  toolUseId?: unknown;
  toolName?: unknown;
  content?: unknown;
  contentRef?: unknown;
}

function parseToolCallResultLine(line: string): ToolCallResultRecord | null {
  if (line.length === 0) return null;
  let parsed: ToolCallResultJsonlLine;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (parsed.type !== "tool_call_result") return null;
  if (typeof parsed.toolUseId !== "string") return null;
  if (typeof parsed.toolName !== "string") return null;
  const content = typeof parsed.content === "string" ? parsed.content : null;
  const contentRef = typeof parsed.contentRef === "string" ? parsed.contentRef : null;
  // Server contract from `server/workspace/tool-trace/index.ts`
  // writes exactly one of `content` / `contentRef` per row. Reject
  // rows that carry both or neither so a future schema drift can't
  // pose as a valid result downstream (CodeRabbit review on PR #1462).
  if ((content === null) === (contentRef === null)) return null;
  return { toolUseId: parsed.toolUseId, toolName: parsed.toolName, content, contentRef };
}

/**
 * Read every `tool_call_result` record from the per-session jsonl in
 * write order. Specs use this together with {@link readSessionToolCalls}
 * to assert not just that a tool was dispatched but that the result
 * carries the expected payload — L-28 (PR #1462 Codex iter-2) anchors
 * the gh-auth success/failure decision on the real `Bash` result body
 * so the LLM cannot hallucinate "Logged in to github.com" into the
 * assistant body after a failed credential bridge.
 */
export async function readSessionToolResults(sessionId: string): Promise<ToolCallResultRecord[]> {
  const raw = await readSessionJsonl(sessionId, workspaceRoot());
  if (raw === null) return [];
  const results: ToolCallResultRecord[] = [];
  for (const line of raw.split("\n")) {
    const record = parseToolCallResultLine(line);
    if (record !== null) results.push(record);
  }
  return results;
}

/**
 * Snapshot the slug names currently sitting under
 * `<workspace>/.claude/skills/`. Returned as a Set so a post-test
 * delta filter is cheap; missing directory yields an empty set so a
 * fresh workspace doesn't trip the helper. Used by L-32 to identify
 * skill dirs that the test caused (Claude picks the slug) without
 * stomping on a parallel run's seeded skills.
 */
export async function snapshotProjectSkillSlugs(): Promise<Set<string>> {
  const skillsDir = resolveWorkspacePath(".claude/skills");
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    // ENOENT → fresh workspace with no project-scope skills yet;
    // canonical detection via the shared `isErrorWithCode` guard
    // (Sourcery review on PR #1345) rather than a local re-roll.
    if (isErrorWithCode(err) && err.code === "ENOENT") return new Set();
    throw err;
  }
  return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

/**
 * Read the SKILL.md body of the named project skill. Returns `null`
 * when the file is absent (e.g. cleanup race in a parallel suite),
 * so the caller can treat absence as "not ours" without distinguishing
 * it from a read failure. Delegates to `readTextUnder`
 * (`server/utils/files/workspace-io.ts`) which already swallows
 * ENOENT to `null` and resolves the path under the given root —
 * Sourcery review on PR #1345 noted the local copy was duplicating
 * shared workspace-io behaviour.
 *
 * Slug must satisfy `isValidSlug`. `readTextUnder` is documented as
 * "internal fixed paths only — no `..` traversal guard"
 * (workspace-io.ts:69), so a malformed slug like `../../etc/passwd`
 * would otherwise read an arbitrary file under the workspace root.
 * Returns `null` (rather than throwing) on an invalid slug because
 * L-32 cleanup feeds slugs straight from `readdir`, and a
 * user-created dir whose name fails the strict rule should be
 * skipped silently rather than aborting the whole cleanup loop.
 * CodeRabbit review on PR #1345.
 */
export async function readProjectSkillBody(slug: string): Promise<string | null> {
  if (!isValidSlug(slug)) return null;
  return readTextUnder(workspaceRoot(), `.claude/skills/${slug}/SKILL.md`);
}

const WIKI_PAGE_BODY_SELECTOR = '[data-testid="wiki-page-body"]';

/**
 * Open a wiki page directly via its standalone route. The SPA's wiki
 * router fetches /api/wiki?slug=... and renders the page body into
 * `[data-testid="wiki-page-body"]` (the v-html surface inside
 * `WikiPageBody.vue`). Used as the entry point for L-W-S-* specs.
 */
export async function navigateToWikiPage(page: Page, slug: string): Promise<void> {
  await page.goto(`/wiki/pages/${encodeURIComponent(slug)}`);
}

/**
 * Generic "the SPA landed on the wiki page for `slug` and the body
 * hydrated with `marker`" assertion. Collapses the three boilerplate
 * checks every wiki-navigation spec repeats:
 *
 *   1. URL pathname ends with `/wiki/pages/<encoded-slug>` — the SPA
 *      router pushed the expected path. The predicate compares the
 *      encoded suffix as a literal string, side-stepping the
 *      `encodeURIComponent` regex-safety pitfall (encodeURIComponent
 *      preserves `.`, `(`, `)`, `*`, all of which are regex
 *      metacharacters — splicing the encoded slug into a `RegExp`
 *      would silently overmatch for any caller whose slug includes
 *      those chars).
 *   2. `WIKI_PAGE_BODY_SELECTOR` contains `marker` — the page body
 *      actually rendered (vs. an empty shell or a 404 view).
 *   3. URL does NOT match `/chat` — sentinel for the B-23 / B-24
 *      regression shape where the catch-all router swallowed
 *      `/wiki/pages/<slug>` and bounced to the chat surface.
 *
 * Per-test sentinels that are NOT generic (e.g. L-15b's #1194
 * collision negative `not.toContainText(sourceMarker)`, L-WIKI-PIPE's
 * `not.toHaveURL(/%7C/)` alias-leak guard) stay inline at the call
 * site so the spec narrative around those bugs is readable — this
 * helper only owns the three checks every wiki landing test shares.
 */
export async function expectWikiPageBody(page: Page, slug: string, marker: string): Promise<void> {
  const expectedPathSuffix = `/wiki/pages/${encodeURIComponent(slug)}`;
  await expect(page).toHaveURL((url) => url.pathname.endsWith(expectedPathSuffix));
  await expect(page.locator(WIKI_PAGE_BODY_SELECTOR)).toContainText(marker);
  await expect(page).not.toHaveURL(/\/chat/);
}

/**
 * Wait for an `<img>` matching `imgSelector` to appear inside the
 * rendered wiki page body. Counterpart to `waitForImgInPresentHtml`
 * for the markdown surface — no iframe boundary, the body is a
 * direct DOM child of the page.
 */
export async function waitForImgInWiki(page: Page, imgSelector: string, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  await expect(body.locator(imgSelector)).toBeVisible({ timeout: timeoutMs });
}

/**
 * Read the unresolved `src` attribute of the first matching `<img>`
 * in the wiki body. Lets the caller assert the rewriter produced the
 * expected `/api/files/raw?path=...` path (or, for self-repair tests,
 * the final repaired URL).
 */
export async function readImgSrcInWiki(page: Page, imgSelector: string): Promise<string | null> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  const img = body.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.getAttribute("src");
}

/**
 * Read `naturalWidth` / `naturalHeight` of the first matching `<img>`
 * in the wiki body. Both 0 means the rewritten URL did not resolve to
 * a decodable image — that's the failure mode every L-W-S-* spec
 * guards against.
 */
export async function readImgNaturalSizeInWiki(page: Page, imgSelector: string): Promise<{ width: number; height: number } | null> {
  const body = page.locator(WIKI_PAGE_BODY_SELECTOR);
  const img = body.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return { width: 0, height: 0 };
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
}

/**
 * Pull the chat session id out of the current URL. Returns null if
 * the page is not on a /chat/<id> route (e.g. before the first
 * navigation, or while sitting on /wiki).
 */
export function getCurrentSessionId(page: Page): string | null {
  const match = /\/chat\/([^/?#]+)/.exec(page.url());
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Best-effort hard-delete a chat session via the same UI gesture a
 * human user performs — open the session row's kebab menu in the
 * sidebar history, click the red 削除 item, and accept the
 * `window.confirm` "このセッションを削除しますか？" prompt that the SPA
 * raises. Used as cleanup so the test does not leave debug sessions
 * piling up in the user's history.
 *
 * Without the `page.once("dialog", ...)` accept the prompt would
 * stay pending and the SPA would never call DELETE — that was the
 * silent-skip mode behind the leftover-history symptom we saw
 * before this change.
 *
 * Never throws. Cleanup failures (page already closed, sidebar
 * collapsed, session already gone) must not turn a passing test red.
 */
const DELETE_BUTTON_TIMEOUT_MS = 10_000;

// Opt-in QA hold-mode. When the runner sets E2E_LIVE_KEEP_SESSIONS=1
// every spec leaves its session intact in history so a human can
// inspect the residue (chat transcript, generated artifacts, plugin
// state) after the test finishes — pair with HEADED=1 for the
// "watch it drive, then poke at the result" flow. Cleanup falls to
// the user (sidebar kebab → 削除) once they're done.
//
// We gate inside deleteSession itself so every existing spec
// (L-01..L-14 and onwards) inherits the behaviour without any
// per-spec retrofit — every cleanup site already routes through
// here in a `finally { ... }` block.
const KEEP_SESSIONS_ENV = "E2E_LIVE_KEEP_SESSIONS";

function shouldKeepSessions(): boolean {
  return process.env[KEEP_SESSIONS_ENV] === "1";
}

/**
 * Poll `GET /api/sessions` until `session.isRunning` flips to false
 * for the given id. Bridges the gap between "the assistant
 * `thinking-indicator` went hidden" (the UI signal
 * `waitForAssistantResponseComplete` waits on) and "the server is
 * willing to accept the DELETE" — without this wait, the UI
 * cleanup click sequence races server state and the route returns
 * 409 silently from the UI's point of view, the test passes, and
 * the file stays on disk.
 *
 * Predicate-asymmetry resolution (#1195): we now poll the summary's
 * `liveIsRunning` field, which the server sets byte-identical to the
 * `DELETE /api/sessions/:id` 409 gate (`getSession()?.isRunning`,
 * server/api/routes/sessions.ts). The old broad `isRunning`
 * (`live.isRunning || pendingGenerations.length>0`) is still
 * exposed for the sidebar busy indicator but is NOT what we wait on
 * here — waiting on it could over-block through image/movie
 * post-processing even though DELETE was already safe. `false ⇒
 * DELETE accepted` is now an exact guarantee, not a conservative
 * over-approximation.
 *
 * Runs the fetch inside `page.evaluate` so the browser's bearer
 * header (read from `<meta name="mulmoclaude-auth">`) is reused
 * verbatim — no need to plumb the token into the test process.
 */
const SESSION_IDLE_TIMEOUT_MS = 30 * ONE_SECOND_MS;
// Per-attempt fetch deadline — short enough that a stuck request fails
// fast and the next interval in `toPass` can retry, instead of one
// hung attempt eating the whole `SESSION_IDLE_TIMEOUT_MS`. 5s is the
// same magnitude the server uses for subprocess probes
// (SUBPROCESS_PROBE_TIMEOUT_MS) so the choice stays consistent.
const SESSION_IDLE_PER_ATTEMPT_TIMEOUT_MS = 5 * ONE_SECOND_MS;
// Polling cadence for `toPass`. Mirrors a typical exponential-ish
// backoff (200 / 500 / 1000 ms) but expressed via ONE_SECOND_MS so
// no raw time literal lives in the helper (CLAUDE.md `Time: NEVER
// use raw numbers` rule).
const SESSION_IDLE_RETRY_INTERVALS_MS = [ONE_SECOND_MS / 5, ONE_SECOND_MS / 2, ONE_SECOND_MS];

// Probe shape returned by the in-page evaluate. We carry the HTTP
// outcome, the session-running flag, AND whether the session row
// was found in the list so the polling site can distinguish:
//
//   - "API healthy + session still busy"        → retry quietly
//   - "API healthy + session missing from list" → retry quietly
//     (the agent run might have only just been kicked off; the
//     sessions index updates after the first persist tick — without
//     this state, `.find()` returning undefined silently looked
//     like `stillRunning=false=idle` and let the caller proceed
//     before the server-side run had even started. CodeRabbit
//     review on PR #1508 caught this for the bridge-origin L-17
//     path, where the gap between `/api/agent` 202 and the session
//     becoming list-visible is wide enough to false-pass.)
//   - "API healthy + session done"              → exit the wait
//   - "API failed"                              → real assertion
//     failure inside `toPass`, with the offending status / error
//     message in the log
type SessionIdleProbe = { ok: true; found: boolean; stillRunning: boolean } | { ok: false; reason: string };

// In-page probe body — runs inside `page.evaluate`, so this function
// must be self-contained (no closure imports). Reads the bearer
// from `<meta name="mulmoclaude-auth">`, hits the sessions list with
// a per-attempt AbortSignal so a stuck request can't eat the whole
// `toPass` budget, and returns the discriminated `SessionIdleProbe`.
// Extracted out of `waitForSessionIdle` to keep that helper under
// the 20-line cap and make this body unit-testable in isolation
// (codex iter-3 nit).
async function probeSessionIdle(args: { sid: string; listUrl: string; perAttemptTimeoutMs: number }): Promise<SessionIdleProbe> {
  const { sid, listUrl, perAttemptTimeoutMs } = args;
  const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
  const token = meta?.getAttribute("content") ?? "";
  try {
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(perAttemptTimeoutMs),
    });
    if (!res.ok) return { ok: false as const, reason: `GET ${listUrl} returned HTTP ${res.status} ${res.statusText}` };
    const data = (await res.json()) as { sessions?: { id: string; liveIsRunning?: boolean }[] };
    // Fail closed on a malformed payload (codex iter-4: missing /
    // null / non-array `sessions` field would otherwise let
    // `?.find()` return undefined → stillRunning=false → cleanup
    // proceeds without ever proving the server is idle, reopening
    // the same silent 409 race the helper exists to close).
    if (!Array.isArray(data.sessions)) {
      return { ok: false as const, reason: `GET ${listUrl} returned an unexpected payload (no sessions array)` };
    }
    // Poll the NARROW predicate (#1195). `liveIsRunning` mirrors
    // the DELETE 409 gate exactly, so `false` proves DELETE will be
    // accepted — no over-waiting on lingering pendingGenerations
    // (the old broad `isRunning` could stay true through movie /
    // image post-processing even though DELETE was already safe).
    const session = data.sessions.find((row) => row.id === sid);
    if (session === undefined) return { ok: true as const, found: false, stillRunning: false };
    return { ok: true as const, found: true, stillRunning: session.liveIsRunning === true };
  } catch (err) {
    // Network drop / AbortSignal timeout / JSON parse throw — anything
    // that would otherwise surface as an opaque page.evaluate failure
    // outside `toPass`'s retry semantics. Funnel it back as a
    // structured failure so the assertion message names the cause.
    return { ok: false as const, reason: `GET ${listUrl} threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Translate a single probe result into Playwright assertions inside
// `toPass`. Throws on probe failure (so `toPass` retries on the next
// interval) and on `stillRunning=true` (so we keep waiting for the
// server to release the session). Pure post-evaluate function — no
// page interaction — so the assertion shape stays trivially testable.
function assertSessionProbeIdle(probe: SessionIdleProbe, sessionId: string): void {
  expect(probe.ok, probe.ok ? "session probe ok" : `session probe failed for ${sessionId}: ${probe.reason}`).toBe(true);
  if (probe.ok) {
    // Both `found=false` (session not yet visible in the list) and
    // `stillRunning=true` (session in flight) keep us in the toPass
    // retry loop. Only when the session is BOTH visible AND idle do
    // we exit — that's the only state in which the run has actually
    // completed end-to-end. CodeRabbit review on PR #1508.
    expect(probe.found, `session ${sessionId} not yet visible in /api/sessions list — retrying`).toBe(true);
    expect(probe.stillRunning, `session ${sessionId} should report isRunning=false before delete`).toBe(false);
  }
}

export async function waitForSessionIdle(page: Page, sessionId: string, timeoutMs: number = SESSION_IDLE_TIMEOUT_MS): Promise<void> {
  // Resolve the sessions-list URL once on the test process side via
  // the canonical `API_ROUTES.sessions.list` constant
  // (src/config/apiRoutes.ts) so this helper stays coupled to the
  // app's route registry — if the path is renamed, the build
  // catches the consumer here instead of letting the poll silently
  // 404 itself into a swallowed best-effort warn. Pass the resolved
  // URL string into page.evaluate's argument map so the in-page
  // closure has nothing to import from a Node-only module.
  const sessionsListUrl = API_ROUTES.sessions.list;
  const probeArgs = { sid: sessionId, listUrl: sessionsListUrl, perAttemptTimeoutMs: SESSION_IDLE_PER_ATTEMPT_TIMEOUT_MS };
  await expect(async () => {
    const probe: SessionIdleProbe = await page.evaluate(probeSessionIdle, probeArgs);
    assertSessionProbeIdle(probe, sessionId);
  }).toPass({ timeout: timeoutMs, intervals: SESSION_IDLE_RETRY_INTERVALS_MS });
}

export async function deleteSession(page: Page, sessionId: string): Promise<void> {
  if (page.isClosed()) return;
  if (shouldKeepSessions()) {
    // QA-mode breadcrumb so the runner can confirm the gate fired.
    console.log(`[${KEEP_SESSIONS_ENV}=1] keeping session ${sessionId} for inspection`);
    return;
  }
  try {
    // Step away from /chat/<id> first — the server's isRunning
    // guard rejects DELETE on whichever session the page is
    // currently sitting on (it's still in the active store right
    // after the assistant turn). Routing to "/" detaches the
    // SPA's hold so the cleanup flow lands on a quiescent record.
    if (page.url().includes(`/chat/${sessionId}`)) {
      await page.goto("/");
    }
    // Then wait for the SERVER side to agree the session is no
    // longer running — `thinking-indicator` going hidden is a UI
    // signal, but the server's live.isRunning lingers a little
    // longer. waitForSessionIdle polls `liveIsRunning` (#1195),
    // which matches the DELETE 409 gate exactly. Skipping this
    // wait is the regression that surfaced as a silent 409 inside
    // the route handler while the UI dance reported success.
    await waitForSessionIdle(page, sessionId);
    // The session-row kebab menu lives inside the session-history
    // side panel, which is collapsed by default. Open it via the
    // toggle button (testid switches between -off and -on) before
    // looking up the row.
    const toggleOff = page.getByTestId("session-history-toggle-off");
    if ((await toggleOff.count()) > 0 && (await toggleOff.isVisible())) {
      await toggleOff.click();
    }
    const menuButton = page.getByTestId(`session-row-menu-${sessionId}`);
    await menuButton.click({ timeout: DELETE_BUTTON_TIMEOUT_MS });
    // Auto-accept the SPA's `window.confirm("このセッションを削除しますか？")`
    // prompt that fires from the delete button's @click handler.
    page.once("dialog", (dialog) => {
      dialog.accept().catch(() => undefined);
    });
    const deleteButton = page.getByTestId(`session-row-delete-${sessionId}`);
    await deleteButton.click({ timeout: DELETE_BUTTON_TIMEOUT_MS });
  } catch (err) {
    // best-effort: page closing, sidebar collapsed, session already gone, etc.
    console.warn(`deleteSession: UI cleanup skipped for session ${sessionId}`, err);
  }
}

const PRESENT_HTML_IFRAME_SELECTOR = '[data-testid="present-html-iframe"]';

/** Open the app root and start a fresh chat session. */
export async function startNewSession(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("new-session-btn").click();
}

/**
 * Snapshot every session id the server currently knows about. Used
 * as the baseline for {@link startGuaranteedNewSession}'s
 * "new-id-only" filter so a session that already existed on the
 * server (and so could be the bootstrap-resume target) is filtered
 * out even when the URL captured priorSessionId reads as `null`.
 * Runs inside `page.evaluate` so the `<meta name="mulmoclaude-auth">`
 * bearer is picked up the same way the live-mode UI fetches do.
 *
 * Fail-fast on every failure mode (network drop, non-200, malformed
 * payload). An empty baseline is NOT a safe fallback — it lets
 * `startGuaranteedNewSession` accept a bootstrap-resumed
 * `/chat/<existing>` as the "new" session, exactly the race the
 * helper was added to close. Surfacing the underlying failure with
 * a descriptive message lets the test fail fast with a diagnostic
 * pointing at the real cause (server down, auth meta missing, etc.)
 * instead of silently producing the wrong session id and failing
 * downstream on an unrelated assertion. CodeRabbit + Codex GHA
 * review on PR #1345.
 */
interface SessionListProbe {
  ok: boolean;
  ids?: string[];
  reason?: string;
}

async function fetchExistingSessionIds(page: Page): Promise<Set<string>> {
  const route = API_ROUTES.sessions.list;
  const probe: SessionListProbe = await page.evaluate(async (sessionsListUrl) => {
    const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
    const token = meta?.getAttribute("content") ?? "";
    try {
      const res = await fetch(sessionsListUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        return { ok: false, reason: `GET ${sessionsListUrl} returned HTTP ${res.status} ${res.statusText}` };
      }
      const data = (await res.json()) as { sessions?: { id: string }[] };
      if (!Array.isArray(data.sessions)) {
        return { ok: false, reason: `GET ${sessionsListUrl} returned an unexpected payload (no sessions array)` };
      }
      return { ok: true, ids: data.sessions.map((session) => session.id) };
    } catch (err) {
      return { ok: false, reason: `GET ${sessionsListUrl} threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  }, route);
  if (!probe.ok || probe.ids === undefined) {
    throw new Error(
      `fetchExistingSessionIds: failed to baseline server sessions — ${probe.reason ?? "unknown error"}. An empty baseline would reopen the bootstrap-resume race in startGuaranteedNewSession.`,
    );
  }
  return new Set(probe.ids);
}

const SESSION_ID_FROM_PATH_RE = /\/chat\/([0-9a-f-]+)/;

/**
 * Like {@link startNewSession} but waits until the URL settles on a
 * `/chat/<id>` that did NOT exist on the server before the click,
 * and returns the freshly-created session id.
 *
 * Why this exists: `page.goto("/")` triggers the SPA's
 * "resume the most-recent session" redirect when one exists, so the
 * URL can already match `/chat/<old-id>` before the click. A naive
 * `await page.waitForURL(SESSION_URL_PATTERN)` after that passes
 * immediately on the *stale* URL, and a subsequent
 * `getCurrentSessionId(page)` returns the old session id — any
 * follow-up assertion that reads tool-trace by session id then
 * reads from the wrong file and sees zero matches.
 *
 * A naive "compare against priorSessionId captured between
 * `goto("/")` and the click" still races: App.vue's bootstrap
 * `resumeOrCreateChatSession()` runs asynchronously, so right after
 * `goto` the URL may still read as `/` even though a redirect to
 * `/chat/<existing>` is in flight; the post-click wait then accepts
 * that bootstrap landing as the "new" id (Codex iter-5 review on
 * PR #1345). To close that race we use the server's own session
 * list as the baseline — any id present in that snapshot is, by
 * definition, not the session this click created, so we skip past
 * it. The only id that survives the filter is the freshly-created
 * one.
 */
export async function startGuaranteedNewSession(page: Page): Promise<string> {
  await page.goto("/");
  // Wait for App.vue's bootstrap navigation to settle BEFORE
  // capturing the pre-click landing or snapshotting the baseline.
  // `resumeOrCreateChatSession` lands on `/chat/<resumed>` (populated
  // workspace) or `/chat/<bootstrap>` (clean workspace via
  // `createNewSession`); either way the URL settles on
  // `/chat/<id>`.
  await page.waitForURL(SESSION_URL_PATTERN);
  // Two complementary filters for the post-click wait:
  //
  // (1) `priorSessionId` — the URL right after bootstrap settles.
  //     The post-click predicate refuses to resolve on this id, so
  //     a `waitForURL` evaluation that runs while the URL still
  //     reads as the pre-click value cannot return the stale id.
  //
  // (2) `baselineIds` — every session id the server has on disk
  //     before our click. Filters out lookalike ids that may
  //     appear during the click (e.g. a parallel test creating a
  //     session, or any subsequent navigation that lands on
  //     another existing chat).
  //
  // Filter (1) is the load-bearing one for the bootstrap race
  // Codex flagged on iter-4 of cross-review: `/api/sessions` is
  // disk-backed (readdir on `conversations/chat/*.jsonl`), so even
  // after the URL settles the bootstrap session may not yet appear
  // in baseline. Without (1), the predicate could resolve on the
  // pre-click URL the moment it's evaluated and return the stale
  // bootstrap id. Filter (2) stays as a defense-in-depth layer for
  // the populated-workspace case.
  const priorSessionId = getCurrentSessionId(page);
  if (priorSessionId === null) {
    throw new Error("startGuaranteedNewSession: SESSION_URL_PATTERN settled but getCurrentSessionId returned null — URL pattern likely drifted");
  }
  const baselineIds = await fetchExistingSessionIds(page);
  await page.getByTestId("new-session-btn").click();
  await page.waitForURL((url) => {
    const match = SESSION_ID_FROM_PATH_RE.exec(url.pathname);
    if (!match) return false;
    const [, candidateId] = match;
    return candidateId !== priorSessionId && !baselineIds.has(candidateId);
  });
  const newSessionId = getCurrentSessionId(page);
  if (newSessionId === null) {
    throw new Error("startGuaranteedNewSession: URL did not settle on /chat/<id> after new-session-btn click");
  }
  return newSessionId;
}

/** Fill the chat input and click send. */
export async function sendChatMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("user-input").fill(text);
  await page.getByTestId("send-btn").click();
}

/**
 * Switch the active role via the dropdown. App.vue's `onRoleChange`
 * spins up a fresh session in the new role on chat pages, so callers
 * are expected to capture the new session id (after the next user
 * turn) for cleanup. Idempotent: calling with the already-active role
 * still works because the dropdown emits `change` on every selection.
 */
export async function selectRole(page: Page, roleId: string): Promise<void> {
  await page.getByTestId("role-selector-btn").click();
  await page.getByTestId(`role-option-${roleId}`).click();
}

/**
 * Start a fresh General-role session, switch to `roleId` (which the
 * chat page handles by spawning a second session — see
 * App.vue#onRoleChange). Only the role-switched session id is pushed
 * onto the caller's cleanup array. Returns the role-switched session
 * id (the one the spec sends prompts at).
 *
 * Uses `startGuaranteedNewSession` rather than `startNewSession` +
 * `waitForURL(SESSION_URL_PATTERN)` to close the stale-session race
 * documented at {@link startGuaranteedNewSession}: in a populated
 * workspace the SPA's bootstrap can resume into `/chat/<existing>`,
 * and treating that id as a fresh baseline would let a subsequent
 * `selectRole` short-circuit (same role → no new session spawned).
 * The role-switched id is still fresh-by-construction (selectRole
 * always spawns a new chat on the chat page), but the General-side
 * baseline must be the one we just created — never a resumed
 * pre-test session.
 *
 * The General-side baseline session is intentionally NOT pushed onto
 * the cleanup array: no chat turn is ever sent against it, so the
 * server never flushes a jsonl record and `/api/sessions` never
 * lists it. `deleteSession` against an unlisted id stalls inside
 * `waitForSessionIdle` until the 30s `toPass` budget expires and
 * emits a "not yet visible in /api/sessions list — retrying" warn
 * for every spec that uses this helper. Skipping the push removes
 * that noise without changing any on-disk state.
 *
 * Lifted from `skills.spec.ts` (L-21B) when `plugin-dispatch.spec.ts`
 * needed the same dance for 7 plugin canaries; keeping it in
 * live-chat.ts prevents the duplication mentioned in CLAUDE.md
 * "shared utilities — check before reinventing".
 */
export async function setupRoleSession(page: Page, roleId: string, sessionsToCleanup: string[]): Promise<string> {
  const generalSessionId = await startGuaranteedNewSession(page);
  await selectRole(page, roleId);
  await page.waitForURL((url) => SESSION_URL_PATTERN.test(url.pathname) && !url.pathname.endsWith(generalSessionId));
  const roleSessionId = getCurrentSessionId(page);
  if (roleSessionId === null) {
    throw new Error(`setupRoleSession: getCurrentSessionId returned null after selectRole(${roleId}) — URL pattern likely drifted`);
  }
  sessionsToCleanup.push(roleSessionId);
  await expect(page.getByTestId("role-selector-btn"), `role chip must reflect ${roleId} after switch`).toHaveAttribute("data-role", roleId);
  return roleSessionId;
}

/**
 * Wait for an `<img>` matching the selector to appear *inside* the
 * presentHtml iframe. The iframe element itself is appended to the
 * DOM before its srcdoc finishes rendering, so a plain `iframe`
 * `toBeVisible` check returns too early — we have to reach into
 * the frame and wait for the actual rendered child.
 */
export async function waitForImgInPresentHtml(page: Page, imgSelector: string, timeoutMs: number = ONE_MINUTE_MS): Promise<FrameLocator> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  await expect(frame.locator(imgSelector)).toBeVisible({ timeout: timeoutMs });
  return frame;
}

/**
 * Wait for Claude to finish its full turn — the `thinking-indicator`
 * disappears when the assistant has stopped streaming. Without this
 * the test would end the moment any earlier assertion passes, and
 * the trace / video would cut off mid-response, hiding any later
 * regression that only surfaces after the iframe is rendered (for
 * example a text reply that fails because of a downstream error).
 *
 * If the indicator was never rendered (response was instant) this
 * still resolves cleanly because Playwright's `toBeHidden` treats
 * a detached element as hidden.
 */
export async function waitForAssistantResponseComplete(page: Page, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  await expect(page.getByTestId("thinking-indicator")).toBeHidden({ timeout: timeoutMs });
}

const THINKING_INDICATOR_VISIBLE_TIMEOUT_MS = 30 * ONE_SECOND_MS;

/**
 * Stricter variant of {@link waitForAssistantResponseComplete} that
 * additionally proves the agent actually started before waiting for
 * it to finish. The default helper falls through immediately when
 * `thinking-indicator` is still absent from the DOM (Playwright's
 * `toBeHidden` treats a detached element as hidden) — fine for
 * specs that have a UI-side gate of their own (`chart-card-0`,
 * `text-response-assistant-body`) but a silent race for specs
 * whose only assertion lives in the session jsonl or filesystem:
 * `readSessionToolCalls` / `snapshotProjectSkillSlugs` runs before
 * the agent has appended a single `tool_call` line, sees
 * `length === 0` / no diff, and the spec fails even though the
 * agent ran successfully a few hundred ms later.
 *
 * Use this instead of `waitForAssistantResponseComplete` whenever
 * the assertion target is the tool-trace jsonl or another
 * out-of-band signal and there is no fail-safe `toContainText`
 * polling downstream that would mask the early-return.
 */
export async function waitForAssistantTurn(page: Page, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  const indicator = page.getByTestId("thinking-indicator");
  // Treat `timeoutMs` as the TOTAL budget across both phases:
  // visible-phase wait is capped at `THINKING_INDICATOR_VISIBLE_TIMEOUT_MS`
  // (or `timeoutMs` if it's smaller), and the hidden-phase wait
  // gets whatever budget remains after the visible wait actually
  // returns. Without this elapsed-tracking the helper could spend
  // up to `visibleTimeoutMs + timeoutMs` worst-case, overshooting
  // the caller's contract. CodeRabbit / Codex review on PR #1345.
  const start = Date.now();
  const visibleTimeoutMs = Math.min(THINKING_INDICATOR_VISIBLE_TIMEOUT_MS, timeoutMs);
  await expect(indicator, "thinking-indicator must appear after sendChatMessage — proves the agent actually started").toBeVisible({
    timeout: visibleTimeoutMs,
  });
  const elapsedMs = Date.now() - start;
  const hiddenTimeoutMs = Math.max(0, timeoutMs - elapsedMs);
  await expect(indicator, "thinking-indicator must hide when the assistant turn ends").toBeHidden({ timeout: hiddenTimeoutMs });
}

/**
 * Read the unresolved `src` attribute of the first matching `<img>`
 * inside the presentHtml iframe. We use Playwright's `frameLocator`
 * + `getAttribute` rather than `page.evaluate` + `contentDocument`
 * because the srcdoc iframe is recreated whenever Vue updates the
 * `srcdoc` prop. A `contentDocument` reference held by an in-page
 * `evaluate` block can land on the previous (empty) document and
 * miss the rendered child entirely, even after the iframe element
 * is "visible" in the DOM. `frameLocator` re-resolves the live
 * frame each time, matching the wait helper above.
 *
 * Reading the unresolved attribute (not `img.src`) lets assertions
 * check the rewritten path verbatim instead of the absolute
 * resolved URL the browser computes.
 */
export async function readImgSrcInPresentHtml(page: Page, imgSelector: string): Promise<string | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.getAttribute("src");
}

/**
 * Read `naturalWidth` and `naturalHeight` for an `<img>` inside the
 * presentHtml iframe. Both are 0 when the image is broken (404,
 * blocked by sandbox, etc.), so the caller can assert that the
 * rewritten URL actually resolves to a real, decodable image.
 */
export async function readImgNaturalSize(page: Page, imgSelector: string): Promise<{ width: number; height: number } | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  return await img.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return { width: 0, height: 0 };
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
}

/**
 * Detect whether the in-iframe onerror self-repair (PR #974) fired
 * on an `<img>`. The repair script tags the element with
 * `data-image-repair-tried="1"` before rewriting `src` to
 * `/artifacts/images/<rest>`, so the marker's presence after the
 * image has loaded is a direct signal that the original LLM-emitted
 * src was broken and the browser silently rescued it.
 *
 * Without this check, an LLM regression that emits a path containing
 * the `artifacts/images/` segment behind a wrong prefix would still
 * pass `naturalWidth > 0` because self-repair masks the 404. Reading
 * the marker preserves the suite's ability to catch convention drift.
 */
export async function readImgRepairAttempted(page: Page, imgSelector: string): Promise<boolean | null> {
  const frame = page.frameLocator(PRESENT_HTML_IFRAME_SELECTOR).first();
  const img = frame.locator(imgSelector).first();
  if ((await img.count()) === 0) return null;
  const marker = await img.getAttribute("data-image-repair-tried");
  return marker !== null;
}

const GENERATE_IMAGE_VIEW_SELECTOR = '[data-testid="generate-image-view"]';

/**
 * Wait for the generateImage canvas view to render an `<img>` — i.e.
 * the LLM called the tool, the server returned an `imageData` path,
 * and the SPA mounted ImageView with a non-empty `resolvedSrc`. Use
 * before reading src / naturalWidth so the spec does not race the
 * ImageView placeholder ("No image yet").
 */
export async function waitForGeneratedImage(page: Page, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  const view = page.locator(GENERATE_IMAGE_VIEW_SELECTOR);
  await expect(view.locator("img").first()).toBeVisible({ timeout: timeoutMs });
}

/**
 * Read the unresolved `src` attribute of the generated image. After
 * PR #969 / #972 introduced the `/artifacts/images/` static mount,
 * `resolveImageSrcFresh` produces `/artifacts/images/<path>?v=<bump>`,
 * so the caller can assert the prefix to catch regressions in the
 * image storage / resolve chain.
 */
export async function readGeneratedImageSrc(page: Page): Promise<string | null> {
  const img = page.locator(GENERATE_IMAGE_VIEW_SELECTOR).locator("img").first();
  if ((await img.count()) === 0) return null;
  return await img.getAttribute("src");
}

/**
 * Read `naturalWidth` / `naturalHeight` of the generated image. Both
 * 0 means the static mount returned a non-decodable response (404,
 * empty file, wrong MIME) — that is the failure mode we want to
 * detect end-to-end, paralleling the iframe-side `readImgNaturalSize`.
 */
export async function readGeneratedImageNaturalSize(page: Page): Promise<{ width: number; height: number } | null> {
  const img = page.locator(GENERATE_IMAGE_VIEW_SELECTOR).locator("img").first();
  if ((await img.count()) === 0) return null;
  return await img.evaluate((node) => {
    if (!(node instanceof HTMLImageElement)) return { width: 0, height: 0 };
    return { width: node.naturalWidth, height: node.naturalHeight };
  });
}

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");
const PDF_EOF = Buffer.from("%%EOF", "ascii");
// PDF spec writes %%EOF in the last few hundred bytes; widen to
// 2 KiB so trailing whitespace, line endings, or `<startxref>`
// blocks don't shift it past our search window.
const PDF_EOF_TAIL_BYTES = 2048;

/**
 * Read a Playwright `Download` into memory and check that it is a
 * real PDF rather than an HTML error page or a truncated stream.
 * Validates both the `%PDF-` header and the `%%EOF` tail marker,
 * so a connection that drops mid-response is rejected. Returns
 * the buffer so the caller can run extra assertions (file size,
 * inline image search, etc.).
 */
export async function readPdfDownload(download: Download): Promise<Buffer> {
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Download has no on-disk path; was failOnStatusCode triggered?");
  }
  const buf = await readFile(downloadPath);
  if (!buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    const head = buf.subarray(0, 64).toString("utf8");
    throw new Error(`Downloaded file is not a PDF (first bytes: ${JSON.stringify(head)})`);
  }
  const tail = buf.subarray(Math.max(0, buf.length - PDF_EOF_TAIL_BYTES));
  if (tail.indexOf(PDF_EOF) === -1) {
    throw new Error(`Downloaded PDF appears truncated (missing %%EOF marker, length ${buf.length})`);
  }
  return buf;
}

// presentMulmoScript downloads always land as `<id>.mp4` (see
// downloadMovie in plugins/presentMulmoScript/View.vue), and the
// MP4 container always tags bytes 4..7 with the `ftyp` box marker
// regardless of brand (isom / mp42 / etc.). Checking that marker
// rejects HTML error pages, empty stubs, and any other format that
// might slip through if the route accidentally returned a different
// payload.
const MP4_FTYP = Buffer.from("ftyp", "ascii");

/**
 * Read a Playwright `Download` for a mulmoScript movie and check
 * that it is a real MP4. Validates the `ftyp` box at offset 4, so an
 * HTML error response or a near-empty stub fails fast. Returns the
 * buffer so the caller can layer additional assertions (size floor,
 * stream parsing, etc.).
 */
export async function readMovieDownload(download: Download): Promise<Buffer> {
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error("Download has no on-disk path; was failOnStatusCode triggered?");
  }
  const buf = await readFile(downloadPath);
  if (buf.length < 8) {
    throw new Error(`Downloaded movie too small to inspect (${buf.length} bytes)`);
  }
  if (!buf.subarray(4, 8).equals(MP4_FTYP)) {
    const head = buf.subarray(0, 16).toString("hex");
    throw new Error(`Downloaded file is not an MP4 (expected 'ftyp' at offset 4, got hex: ${head})`);
  }
  return buf;
}

// ── Shared in-page authed JSON fetch ────────────────────────────────

/**
 * Discriminated probe result for an `<meta name="mulmoclaude-auth">`
 * authed GET. Carrying the failure reason on the `ok: false` branch
 * lets the caller format a single self-describing error message
 * without an additional layer of branching. Body is `unknown` so each
 * caller validates / narrows it via its own parser — keeps this
 * helper a transport-only primitive.
 */
export type AuthedJsonProbe = { ok: true; body: unknown } | { ok: false; reason: string };

/**
 * Run an authed JSON GET inside the page context and return the
 * decoded body. Shared by every helper that hits an internal API the
 * SPA itself proxies — `getSandboxStatus`, `getMcpToolsList`, etc.
 * (CodeRabbit + Sourcery review on PR #1462). Each wrapper stays a
 * thin route + parser; the probe orchestration lives here once.
 *
 * Returns a discriminated union so transport / non-2xx / decode
 * failures surface as `ok: false` with a descriptive reason rather
 * than masked as a missing body — the caller decides whether to
 * throw, skip, or retry.
 */
export async function fetchAuthedJsonViaPage(page: Page, url: string): Promise<AuthedJsonProbe> {
  return await page.evaluate(async (target): Promise<AuthedJsonProbe> => {
    const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
    const token = meta?.getAttribute("content") ?? "";
    try {
      const res = await fetch(target, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { ok: false, reason: `GET ${target} returned HTTP ${res.status} ${res.statusText}` };
      const body = (await res.json()) as unknown;
      return { ok: true, body };
    } catch (err) {
      return { ok: false, reason: `GET ${target} threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  }, url);
}

/**
 * Authed JSON POST counterpart to {@link fetchAuthedJsonViaPage}. Runs
 * inside the page context so it reuses the SPA's bearer token (the
 * `<meta name="mulmoclaude-auth">` tag) and same-origin base URL — for
 * specs that drive a host mutation endpoint the UI itself proxies
 * (e.g. POST /api/roles/manage) as deterministic setup / teardown
 * instead of through a brittle multi-field form.
 */
export async function postAuthedJsonViaPage(page: Page, url: string, body: unknown): Promise<AuthedJsonProbe> {
  return await page.evaluate(
    async ({ target, payload }): Promise<AuthedJsonProbe> => {
      const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
      const token = meta?.getAttribute("content") ?? "";
      try {
        const res = await fetch(target, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) return { ok: false, reason: `POST ${target} returned HTTP ${res.status} ${res.statusText}` };
        const decoded = (await res.json()) as unknown;
        return { ok: true, body: decoded };
      } catch (err) {
        return { ok: false, reason: `POST ${target} threw: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    { target: url, payload: body },
  );
}

// ── Docker sandbox state probes ─────────────────────────────────────

/**
 * Snapshot of GET /api/sandbox. The server returns `{}` when the
 * Docker sandbox is disabled (`DISABLE_SANDBOX=1` or Docker not
 * reachable), and `{ sshAgent, mounts }` when enabled — see
 * `server/api/sandboxStatus.ts`. `getSandboxStatus` returns `null` for
 * the disabled case so docker-only specs can branch with a single
 * equality check.
 */
export interface SandboxStatusSnapshot {
  /** True iff the host SSH agent socket is forwarded into the container. */
  sshAgent: boolean;
  /** Allowlisted config mount names that successfully attached (e.g. `["gh"]`). */
  mounts: string[];
}

/**
 * Fetch the sandbox-auth snapshot the SPA's LockStatusPopup consumes.
 * Returns `null` when the server reports the sandbox is disabled (body
 * is the empty object `{}`), letting docker-only specs `test.skip` on
 * a single nullish check. Throws on transport / decode failures rather
 * than masking them as "disabled" — a network blip should fail the
 * test loudly, not silently send it down the skip path.
 */
export async function getSandboxStatus(page: Page): Promise<SandboxStatusSnapshot | null> {
  const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.sandbox);
  if (!probe.ok) throw new Error(`getSandboxStatus: ${probe.reason}`);
  if (!isRecord(probe.body)) throw new Error(`getSandboxStatus: unexpected payload ${JSON.stringify(probe.body)}`);
  return parseSandboxBody(probe.body);
}

function parseSandboxBody(body: Record<string, unknown>): SandboxStatusSnapshot | null {
  // Server contract: `{}` ⇒ disabled, `{ sshAgent, mounts }` ⇒ enabled.
  // Treat any body lacking BOTH fields as the disabled signal, but a
  // body carrying ONE of them malformed is an unexpected payload we
  // surface loudly so a future server-side schema change can't silently
  // false-pass the skip gate.
  const hasSsh = "sshAgent" in body;
  const hasMounts = "mounts" in body;
  if (!hasSsh && !hasMounts) return null;
  const { sshAgent, mounts } = body;
  if (typeof sshAgent !== "boolean" || !Array.isArray(mounts)) {
    throw new Error(`getSandboxStatus: unexpected payload ${JSON.stringify(body)}`);
  }
  const cleanMounts: string[] = [];
  for (const item of mounts) {
    if (typeof item !== "string") throw new Error(`getSandboxStatus: mounts contains non-string ${JSON.stringify(item)}`);
    cleanMounts.push(item);
  }
  return { sshAgent, mounts: cleanMounts };
}

// ── MCP tool catalog probes ─────────────────────────────────────────

/**
 * One row from GET /api/mcp-tools — the catalog the SPA settings panel
 * uses to surface which built-in MCP tools (`readXPost`, `searchX`,
 * `notify`) are wired up. `enabled` reflects host-side `requiredEnv`
 * presence (see `isMcpToolEnabled` in `server/agent/mcp-tools/index.ts`).
 */
export interface McpToolSnapshot {
  name: string;
  enabled: boolean;
  requiredEnv: string[];
}

/**
 * Fetch the live MCP tool catalog with `enabled` flags. L-23 uses this
 * to confirm the X bridge tools surface as enabled when the user has
 * `X_BEARER_TOKEN` set — that's the host-side env reachability check
 * (B-01's modern incarnation, now that MCP tools run in-process on the
 * host server rather than inside the Docker container).
 */
export async function getMcpToolsList(page: Page): Promise<McpToolSnapshot[]> {
  const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.mcpTools.list);
  if (!probe.ok) throw new Error(`getMcpToolsList: ${probe.reason}`);
  if (!Array.isArray(probe.body)) throw new Error(`getMcpToolsList: ${API_ROUTES.mcpTools.list} returned non-array payload`);
  return probe.body.map((row, idx) => parseMcpToolRow(row, idx));
}

/**
 * One row in the `/api/skills` listing. Specs only need the name to
 * test for presence / absence (L-30 dangling-symlink resilience uses
 * this), so the helper keeps the parsed shape minimal — `description`
 * and `source` come back as `string | null` rather than the strict
 * server type so a future schema add-on doesn't bite the spec.
 */
export interface SkillListEntry {
  name: string;
}

/**
 * Fetch the server's view of `/api/skills` directly, bypassing the
 * SPA's `/skills` listing route. Used by L-30 (B-08 discovery
 * resilience) to pin the server contract before falling through to
 * the UI assertion — proves the discovery loop itself surfaced the
 * sibling and skipped the dangling slot, independent of any rendering
 * idiosyncrasies in `manageSkills/View.vue`.
 */
export async function listSkillsViaApi(page: Page): Promise<SkillListEntry[]> {
  const probe = await fetchAuthedJsonViaPage(page, API_ROUTES.skills.list.url);
  if (!probe.ok) throw new Error(`listSkillsViaApi: ${probe.reason}`);
  if (!isRecord(probe.body)) throw new Error(`listSkillsViaApi: unexpected payload ${JSON.stringify(probe.body)}`);
  const { skills } = probe.body;
  if (!Array.isArray(skills)) throw new Error(`listSkillsViaApi: skills field is not an array (got ${JSON.stringify(skills)})`);
  return skills.map((row, idx) => parseSkillListRow(row, idx));
}

/**
 * Pure parser for one `/api/skills` row. Exported so unit tests can
 * exercise the validation contract directly (CodeRabbit iter-1 review
 * — keeps "pure logic in exported helpers for testability" per
 * CLAUDE.md, without routing through Playwright / page plumbing).
 */
export function parseSkillListRow(row: unknown, idx: number): SkillListEntry {
  if (!isRecord(row)) throw new Error(`skillsList[${idx}] is not an object`);
  const { name } = row;
  if (typeof name !== "string") throw new Error(`skillsList[${idx}].name is not a string`);
  return { name };
}

function parseMcpToolRow(row: unknown, idx: number): McpToolSnapshot {
  if (!isRecord(row)) throw new Error(`mcpToolsList[${idx}] is not an object`);
  const { name, enabled, requiredEnv } = row;
  if (typeof name !== "string") throw new Error(`mcpToolsList[${idx}].name is not a string`);
  if (typeof enabled !== "boolean") throw new Error(`mcpToolsList[${idx}].enabled is not a boolean`);
  if (!Array.isArray(requiredEnv)) throw new Error(`mcpToolsList[${idx}].requiredEnv is not an array`);
  const cleanRequiredEnv: string[] = [];
  for (const item of requiredEnv) {
    if (typeof item !== "string") throw new Error(`mcpToolsList[${idx}].requiredEnv contains non-string ${JSON.stringify(item)}`);
    cleanRequiredEnv.push(item);
  }
  return { name, enabled, requiredEnv: cleanRequiredEnv };
}

// ── Tool call arg extractors ────────────────────────────────────────

/**
 * Extract the `command` arg from a `Bash` tool call's args. Returns
 * `null` when the call isn't a Bash dispatch or the args don't carry
 * a string command — L-28 uses this to assert the agent actually ran
 * `gh auth status` rather than synthesizing the "Logged in to
 * github.com" string from prior knowledge (Codex iter-1 review on
 * PR #1462: the model can produce plausible CLI output without ever
 * invoking the tool, so anchoring the assertion to a real `Bash`
 * tool_call closes that false-pass path).
 */
export function bashCommandFromCall(call: ToolCallTraceRecord): string | null {
  if (call.toolName !== "Bash") return null;
  if (!isRecord(call.args)) return null;
  const { command } = call.args;
  return typeof command === "string" ? command : null;
}

// ── Notifier list probe (used by the L-17 bell-count canary) ────────

type NotifierListProbe = { ok: true; entries: NotifierEntry[] } | { ok: false; reason: string };

/**
 * Snapshot the active notifier entries via the always-on
 * `{ action: "list" }` dispatch. L-17 calls this twice — once before
 * triggering a bridge-origin agent run, once after — to assert the
 * bell entry count is unchanged. Filtering by entry id avoids being
 * fooled by background publishers (ghost-bell recovery, todo
 * action-lifecycle bells) that the dev server may emit during the test window.
 */
export async function listNotifierEntries(page: Page): Promise<NotifierEntry[]> {
  const probe: NotifierListProbe = await page.evaluate(async (url): Promise<NotifierListProbe> => {
    const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
    const token = meta?.getAttribute("content") ?? "";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      if (!res.ok) return { ok: false, reason: `list returned HTTP ${res.status}` };
      const body = (await res.json()) as { entries?: NotifierEntry[] };
      if (!Array.isArray(body.entries)) return { ok: false, reason: `list missing entries[]: ${JSON.stringify(body)}` };
      return { ok: true, entries: body.entries };
    } catch (err) {
      return { ok: false, reason: `list threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  }, API_ROUTES.notifier.dispatch);
  if (!probe.ok) throw new Error(`listNotifierEntries: ${probe.reason}`);
  return probe.entries;
}

/**
 * Clear a notifier entry by id via the always-on `{ action: "clear" }`
 * dispatch. Used by the L-17 cleanup path: if the B-50 regression
 * ever fires (bell ticks unexpectedly during a bridge-origin run),
 * the spurious entry would otherwise survive across runs in
 * `~/mulmoclaude/data/notifier/active.json` and pollute the bell.
 */
export async function clearNotifierEntry(page: Page, entryId: string): Promise<void> {
  const result = await page.evaluate(
    async ({ url, targetId }) => {
      const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
      const token = meta?.getAttribute("content") ?? "";
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "clear", id: targetId }),
        });
        if (!res.ok) return { ok: false as const, reason: `clear ${targetId} returned HTTP ${res.status}` };
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, reason: `clear ${targetId} threw: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    { url: API_ROUTES.notifier.dispatch, targetId: entryId },
  );
  if (!result.ok) throw new Error(`clearNotifierEntry: ${result.reason}`);
}

// ── Bridge-origin agent run (used by the L-17 B-50 canary) ─────────

type StartAgentProbe = { ok: true; chatSessionId: string } | { ok: false; reason: string };

/**
 * Kick off an agent run with `origin: "bridge"` by POSTing directly
 * to `/api/agent` via the in-page bearer token. Returns the
 * `chatSessionId` the server assigned. Unlike `startNewSession +
 * sendChatMessage` (which mirror the UI button flow and always
 * produce `origin: "human"`), this helper is the *only* way to drive
 * a non-human-origin agent run from a Playwright browser without a
 * real bridge WebSocket connection. /api/agent already accepts
 * `origin` in its body (server/api/routes/agent.ts line 121, 219) —
 * the typed `AgentBody` omits it for the UI's sake, but Express
 * passes the full JSON body through, and `startChat` validates and
 * propagates `origin` via `isSessionOrigin`.
 *
 * L-17 uses this to reach the agent.ts finally block that gates
 * `publishNotification(...)` on `origin !== SESSION_ORIGINS.human` —
 * the exact code path PR #818 commented out for B-50. A future
 * regression that re-enables that block would tick the bell on this
 * bridge-origin run; the L-17 assertion catches it.
 */
export async function startBridgeOriginAgentRun(page: Page, message: string, roleId: string): Promise<string> {
  const chatSessionId = randomUUID();
  const probe: StartAgentProbe = await page.evaluate(
    async ({ url, body }): Promise<StartAgentProbe> => {
      const meta = document.querySelector('meta[name="mulmoclaude-auth"]');
      const token = meta?.getAttribute("content") ?? "";
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, reason: `POST ${url} returned HTTP ${res.status}: ${text.slice(0, 200)}` };
        const parsed = JSON.parse(text) as { chatSessionId?: unknown };
        if (typeof parsed.chatSessionId !== "string") return { ok: false, reason: `unexpected /api/agent response: ${text}` };
        return { ok: true, chatSessionId: parsed.chatSessionId };
      } catch (err) {
        return { ok: false, reason: `POST ${url} threw: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    { url: API_ROUTES.agent.run, body: { chatSessionId, message, roleId, origin: "bridge" } },
  );
  if (!probe.ok) throw new Error(`startBridgeOriginAgentRun: ${probe.reason}`);
  return probe.chatSessionId;
}
