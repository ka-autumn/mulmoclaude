// Live-mode helpers for e2e-live. Mirrors the surface of
// `e2e/fixtures/chat.ts` for the shared interactions, but does NOT
// install any API mocks — the real Claude API runs end-to-end. Use
// these helpers from specs in `e2e-live/tests/`.

import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Download, type FrameLocator, type Page, expect } from "@playwright/test";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { readSessionJsonl } from "../../server/utils/files/session-io.ts";
import { readTextUnder } from "../../server/utils/files/workspace-io.ts";
import { isValidSlug } from "../../server/utils/slug.ts";
import { isErrorWithCode, isRecord } from "../../server/utils/types.ts";
import { API_ROUTES } from "../../src/config/apiRoutes.ts";

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

export async function deleteProjectSkillViaUi(page: Page, slug: string, timeoutMs: number = ONE_MINUTE_MS): Promise<void> {
  assertValidSkillSlug(slug);
  await page.goto("/skills");
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
      `deleteProjectSkillViaUi: row [skill-item-${slug}] never appeared in /skills within ${SKILL_ROW_PRESENCE_TIMEOUT_MS}ms — skipping UI delete (fs follow-up still rms both trees)`,
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
  await expect(skillRow, "deleted skill row must disappear from /skills listing").toBeHidden({ timeout: timeoutMs });
}

/**
 * Built-in editor tool name as the SDK exposes it (no MCP prefix).
 * Specs match against this when asserting that the agent reached for
 * the filesystem editor — used by L-31 to verify the post-#1298
 * skill-bridge dispatch shape (agent writes to `data/skills/...`,
 * NOT to `.claude/skills/...`).
 */
export const WRITE_TOOL_NAME = "Write";

// Path of an agent Write that targets a staging skill body. Anchored
// to `/SKILL.md` (`(start|<sep>)data<sep>skills<sep><slug><sep>SKILL.md$`)
// so a Write to `data/skills/<slug>/README.md` does NOT match — the
// bridge only mirrors the canonical filename, and asserting on it is
// what proves the bridge will fire. Slug pattern matches the bridge's
// own `SLUG_RE`. Tolerates both POSIX and Windows separators since
// path normalisation depends on how the SDK serialises the arg.
// The `(?:^|[/\\])` prefix accepts bare cwd-relative paths
// (`data/skills/<slug>/SKILL.md` — the form the mc-manage-skills
// SKILL.md instructs the agent to use) as well as separator-prefixed
// (`./data/...` / absolute) variants. Codex iter-2 review on this PR.
// eslint-disable-next-line security/detect-unsafe-regex -- the slug clause is bounded by the path tail (slug ≤ 64 chars per server/utils/slug.ts) and the input is the agent-supplied file_path the Claude SDK already validated; no pathological backtracking surface.
const STAGING_SKILL_WRITE_PATH_RE = /(?:^|[/\\])data[/\\]skills[/\\]([a-z0-9]+(?:-[a-z0-9]+)*)[/\\]SKILL\.md$/;

/**
 * Extract the staging-skill slug from a `Write` tool call's
 * `file_path` arg. Returns `null` when the call isn't a `Write`,
 * the path doesn't sit under `data/skills/<slug>/SKILL.md`, the
 * slug fails the canonical kebab-case rule, OR the resolved path
 * is not under THIS workspace's staging dir (the regex alone is
 * tail-anchored, so a write to `/some/other/root/data/skills/...`
 * would otherwise match). Specs in L-31 use this to assert that
 * mc-manage-skills routed the agent into the bridge staging path
 * rather than into `.claude/skills/` (which would indicate the
 * bridge SKILL.md was ignored — the regression #1298 fixed).
 *
 * The agent's `Write` `file_path` arg is sometimes absolute (some
 * host normalisations) and sometimes cwd-relative; both must
 * resolve to OUR workspace's `data/skills/<slug>/SKILL.md` to be
 * considered a hit. Codex iter-1 review on this PR — without the
 * resolve+compare guard the canary could false-positive on a write
 * outside the workspace and silently report green.
 */
export function stagingSkillSlugFromWriteCall(call: ToolCallTraceRecord): string | null {
  if (call.toolName !== WRITE_TOOL_NAME) return null;
  if (!isRecord(call.args)) return null;
  const filePath = call.args.file_path;
  if (typeof filePath !== "string") return null;
  const match = STAGING_SKILL_WRITE_PATH_RE.exec(filePath);
  if (!match) return null;
  const [, slug] = match;
  // Re-validate against the full server rule. The regex enforces
  // kebab-case shape but not the length bound `isValidSlug` adds
  // (1-120 chars per server/utils/slug.ts). Without this gate the
  // L-31 canary could green on a Write whose slug the backend would
  // reject — catching that mismatch at the test layer keeps the
  // signal honest. CodeRabbit review on PR #1345.
  if (!isValidSlug(slug)) return null;
  const expectedPath = resolveWorkspacePath(`data/skills/${slug}/SKILL.md`);
  const candidatePath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(workspaceRoot(), filePath);
  return candidatePath === expectedPath ? slug : null;
}

/**
 * One `tool_call` record as persisted by `server/workspace/tool-trace`.
 * Specs filter on `toolName` and pull selected fields from `args`
 * (`file_path`, ...) — the trace shape is wider than this slice but
 * the spec only needs the dispatch-level info.
 */
export interface ToolCallTraceRecord {
  toolName: string;
  args: unknown;
}

interface ToolCallJsonlLine {
  type?: unknown;
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
  if (typeof parsed.toolName !== "string") return null;
  return { toolName: parsed.toolName, args: parsed.args };
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
 * Predicate-asymmetry note (codex iter-2): the summary `isRunning`
 * we read here is `live.isRunning || pendingGenerations.length>0`
 * (server/api/routes/sessions.ts:150), but `DELETE /api/sessions/:id`
 * only checks `getSession()?.isRunning` proper (line 401), without
 * pendingGenerations. We intentionally wait on the STRICTER summary
 * predicate because:
 *   * the summary is the only `isRunning`-shaped field exposed on
 *     the public API today — querying just `live.isRunning` would
 *     need a server-side endpoint addition
 *   * waiting too long is the safe direction (we never delete
 *     before the server is ready); waiting too SHORT is the
 *     regression we are explicitly closing
 *   * for every spec in this suite, the test already waits for
 *     the user-visible artifact to render (Download Movie button
 *     for L-04, etc.) before reaching cleanup — by then
 *     pendingGenerations is empty in practice, so the stricter
 *     predicate doesn't add measurable wall time
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

// Probe shape returned by the in-page evaluate. We carry both the
// HTTP outcome and the session-running flag so the polling site can
// distinguish "API healthy + session still busy" (retry quietly)
// from "API failed" (surface as a real assertion failure inside
// `toPass`, with the offending status / error message in the
// log). Without this split, a 401/5xx or a network blip silently
// looks like "session is still running" and the poller waits the
// full timeout before falling through to the swallowed UI cleanup
// — exactly the silent failure the original wait was added to fix.
type SessionIdleProbe = { ok: true; stillRunning: boolean } | { ok: false; reason: string };

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
    const data = (await res.json()) as { sessions?: { id: string; isRunning?: boolean }[] };
    // Fail closed on a malformed payload (codex iter-4: missing /
    // null / non-array `sessions` field would otherwise let
    // `?.find()` return undefined → stillRunning=false → cleanup
    // proceeds without ever proving the server is idle, reopening
    // the same silent 409 race the helper exists to close).
    if (!Array.isArray(data.sessions)) {
      return { ok: false as const, reason: `GET ${listUrl} returned an unexpected payload (no sessions array)` };
    }
    const session = data.sessions.find((row) => row.id === sid);
    return { ok: true as const, stillRunning: session?.isRunning === true };
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
    expect(probe.stillRunning, `session ${sessionId} should report isRunning=false before delete`).toBe(false);
  }
}

async function waitForSessionIdle(page: Page, sessionId: string, timeoutMs: number = SESSION_IDLE_TIMEOUT_MS): Promise<void> {
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
    // signal, but `live.isRunning || pendingGenerations` lingers a
    // little longer on the server. Skipping this wait is exactly
    // the regression that surfaced as a silent 409 inside the
    // route handler while the UI dance reported success.
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
