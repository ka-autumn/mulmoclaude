import { randomUUID } from "node:crypto";

import { type Locator, type Page, type Response, expect, test } from "@playwright/test";

import { API_ROUTES } from "../../src/config/apiRoutes.ts";
import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { isRecord } from "../../server/utils/types.ts";
import {
  type AuthedJsonProbe,
  deleteSession,
  fetchAuthedJsonViaPage,
  postAuthedJsonViaPage,
  readWorkspaceFile,
  sendChatMessage,
  setupRoleSession,
  waitForAssistantTurn,
} from "../fixtures/live-chat.ts";

// L-JOURNEY-* — "the feature actually works end-to-end via the real
// LLM" net (plans/feat-e2e-live.md §「最優先方針 (2026-05-30)」). Two
// existing layers leave a gap this file closes:
//
//   - plugin-dispatch.spec.ts (L-DISPATCH-*) proves the agent
//     dispatched a manage* tool, but asserts ONLY on the per-session
//     jsonl trace + the workspace DB file. Its own header notes it
//     deliberately skips a View-mount assertion ("adding View testids
//     per plugin is a separate refactor").
//   - journey-todo.spec.ts (L-JOURNEY-TODO) drives a feature through
//     its UI add button — but a pure UI click → REST → reload journey
//     is reproducible under mock e2e, so it does not exercise the
//     real LLM path that is the whole reason e2e-live exists.
//
// These three journeys are the missing middle: drive the *add* from
// chat (real LLM tool dispatch) and then assert the mutation is
// REFLECTED IN THE VIEW the user looks at, then run an
// add↔delete (or add→persist→delete) lifecycle. The marker only
// appears in the View if the LLM dispatch landed AND the View
// rendered it, so the View assertion subsumes the dispatch check.
//
// Per the 2026-05-30 design principle: add is always LLM-driven.
// calendar / todo / accounting expose a role-gated manage* tool;
// collections have NO manage* tool — the mc-clients preset skill
// teaches the agent to add a client by Write-ing a workspace JSON
// file, so the COLLECTION journey nets a path the others don't
// (skill-driven file I/O reflected by <CollectionView>). Deletes mix
// UI (calendar / collection) and LLM (todo / accounting) so the suite
// canaries both teardown paths.
//
// Skip on E2E_LIVE_NO_LLM=1 — the fake-echo backend cannot route MCP
// tool calls, so no add would ever land. Each test owns a fresh
// session + a per-test nonce-stamped marker, so the three run in
// parallel without colliding (each touches a different workspace DB).
test.describe.configure({ mode: "parallel" });

// Roomy per-test budget: each journey runs two real LLM turns
// (add + delete) plus a View navigation, so the ceiling matches the
// 5-minute window plugin-dispatch.spec.ts settles on for its
// two-turn cases.
const JOURNEY_TIMEOUT_MS = 5 * ONE_MINUTE_MS;
// How long to wait for a View to reflect an LLM mutation after the
// agent turn ends. The file write is already flushed (waitForAssistantTurn
// gates on the turn ending), so this only covers the SPA's on-mount /
// poll fetch + render — 30s gives slow CI workers headroom without
// masking a real "never rendered" regression.
const VIEW_REFLECT_TIMEOUT_MS = 30 * ONE_SECOND_MS;
// Cap on a todo-plugin runtime dispatch (checkbox toggle) flushing to
// disk before the reload, mirroring journey-todo.spec.ts.
const TODO_DISPATCH_FLUSH_TIMEOUT_MS = 10 * ONE_SECOND_MS;

// `useTodos` routes every mutation through the host's
// POST /api/plugins/runtime/<pkg>/dispatch; anchor the flush gate on
// this fragment pair so unrelated SSE / metrics traffic is ignored.
const RUNTIME_DISPATCH_URL_FRAGMENT = "/api/plugins/runtime/";
const TODO_PLUGIN_SLUG_FRAGMENT = "todo-plugin";

// Accounting book DB (mirrors plugin-dispatch.spec.ts). The inline
// chat View collapses once a newer turn lands, so the delete leg is
// confirmed against this source-of-truth file (read-only) rather than
// the View.
const ACCOUNTING_CONFIG_REL = "data/accounting/config.json";

// Per-test unique marker (epoch ms + 6 hex). Mirrors
// plugin-dispatch.spec.ts so a stray artifact left by a failed run is
// unambiguously attributable to this test, and parallel runs / a
// concurrent plugin-dispatch spec never collide on the shared DB.
function makeMarker(testId: string): string {
  return `${testId}-${Date.now()}-${randomUUID().slice(0, 6)}`;
}

// Cleanup convention (matches plugin-dispatch.spec.ts's runDispatchCase):
// each test's lifecycle DELETES its row in the `try` body via the
// server (UI gesture / LLM tool), so the happy path leaves nothing
// behind. `finally` only deletes the chat sessions. On an EARLY
// failure (before the delete leg) the nonce-stamped row is left in the
// shared workspace DB — deliberately. The alternative, an fs
// read-modify-write prune in `finally`, is NOT atomic and can clobber
// a concurrent spec's write to the same DB (lost update — Codex iter-2
// must-fix), which is strictly worse than an identifiable leak: the
// marker is unique per test, so it never confuses a parallel run
// (every spec filters by its own marker) and is trivially greppable
// for manual purge. A write-safe prune would have to round-trip each
// plugin's own delete endpoint — disproportionate plumbing for
// best-effort teardown, and a divergence from the suite convention.
//
// COLLECTION nuance: a client is a per-item file
// (data/clients/items/<id>.json), NOT a row in a shared array, so a
// finally prune there WOULD be race-free (an unlink can't clobber a
// concurrent spec's other item). It still matches this session-only
// convention for consistency: the happy-path UI delete already leaves
// nothing, and an early-failure leak is a single nonce-named file
// (id derived from the marker) — identifiable and greppable.
test.describe("L-JOURNEY-* (real LLM add → View reflection → lifecycle)", () => {
  test.skip(
    process.env.E2E_LIVE_NO_LLM === "1",
    "these journeys assert on a real LLM turn (MCP dispatch / skill file-write / custom-role agent run) — fake-echo can't produce them",
  );

  test("L-JOURNEY-CAL: chat で予定を add → /calendar に反映 → UI から delete", async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const marker = makeMarker("L-JOURNEY-CAL");
    const sessions: string[] = [];
    try {
      await setupRoleSession(page, "personal", sessions);
      await sendChatMessage(page, calendarAddPrompt(marker));
      await waitForAssistantTurn(page);

      await openCalendarList(page);
      const event = calendarEventByMarker(page, marker);
      await expect(event, "the LLM-added event must reflect in the calendar list view").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });

      await deleteCalendarEventViaUi(page, event);
      await expect(calendarEventByMarker(page, marker), "the UI delete must remove the event from the list").toHaveCount(0, {
        timeout: VIEW_REFLECT_TIMEOUT_MS,
      });
    } finally {
      for (const sid of sessions) await deleteSession(page, sid);
    }
  });

  test("L-JOURNEY-TODO-LLM: chat で todo を add → /todos に反映 → check が reload で残る → chat で delete", async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const marker = makeMarker("L-JOURNEY-TODO-LLM");
    const sessions: string[] = [];
    try {
      const sessionId = await setupRoleSession(page, "personal", sessions);
      await sendChatMessage(page, todoAddPrompt(marker));
      await waitForAssistantTurn(page);

      await assertTodoCardReflectedAndPersisted(page, marker);
      await deleteTodoFromChat(page, sessionId, marker);

      await openTodos(page);
      await expect(todoCardByMarker(page, marker), "the LLM delete must remove the card from /todos").toHaveCount(0, {
        timeout: VIEW_REFLECT_TIMEOUT_MS,
      });
    } finally {
      for (const sid of sessions) await deleteSession(page, sid);
    }
  });

  test("L-JOURNEY-ACCT: chat で帳簿を作成して開く → switcher に反映 → chat で delete → DB から消える", async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const marker = makeMarker("L-JOURNEY-ACCT");
    const sessions: string[] = [];
    try {
      await setupRoleSession(page, "accounting", sessions);
      await sendChatMessage(page, accountingCreatePrompt(marker));
      await waitForAssistantTurn(page);
      await assertBookActiveInSwitcher(page, marker);

      // Delete is a second LLM turn. That collapses the openBook
      // envelope above (inline plugin views render expanded only while
      // they are the latest turn), so the View's deleted-notice can't
      // be observed in place — confirm the lifecycle on the workspace
      // DB the View hydrates from instead (deterministic, read-only).
      await sendChatMessage(page, accountingDeletePrompt(marker));
      await waitForAssistantTurn(page);
      await assertBookDeletedFromDb(marker);
    } finally {
      for (const sid of sessions) await deleteSession(page, sid);
    }
  });

  test("L-JOURNEY-COLLECTION: chat で client を add → /collections に反映 → UI から delete", async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const marker = makeMarker("L-JOURNEY-COLLECTION");
    const sessions: string[] = [];
    try {
      await setupRoleSession(page, "personal", sessions);
      await sendChatMessage(page, clientAddPrompt(marker));
      await waitForAssistantTurn(page);

      await openClientsCollection(page);
      const row = clientRowByMarker(page, marker);
      await expect(row, "the skill-written client record must reflect as a row in the collection view").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });

      await deleteClientViaUi(page, row);
      await expect(clientRowByMarker(page, marker), "the UI delete must remove the row from the collection").toHaveCount(0, {
        timeout: VIEW_REFLECT_TIMEOUT_MS,
      });
    } finally {
      for (const sid of sessions) await deleteSession(page, sid);
    }
  });

  test("L-JOURNEY-ROLE: custom role を作成 → selector に出て実 LLM が回る → delete で消える", async ({ page }) => {
    test.setTimeout(JOURNEY_TIMEOUT_MS);
    const marker = makeMarker("L-JOURNEY-ROLE");
    const role = customRoleFixture(marker);
    const sessions: string[] = [];
    // Unlike the shared-array DBs the other journeys touch (calendar /
    // todo / accounting items.json), a role is its own file
    // (config/roles/<id>.json) keyed by an id we chose — so a leaked
    // role both pollutes the live selector AND can be pruned race-free
    // by id. Track create/delete so `finally` cleans up a role left by
    // an early failure (CodeRabbit).
    let roleCreated = false;
    let roleDeleted = false;
    try {
      // Load the app first so the authed POST has the SPA's bearer-token
      // meta tag and a same-origin base — page.evaluate(fetch) on the
      // initial about:blank would have neither.
      await page.goto("/");
      await createCustomRole(page, role);
      roleCreated = true;

      // setupRoleSession switches the chat to the custom role: it
      // clicks role-option-<id> (which throws if the new role never
      // surfaced in the live selector) and asserts the role chip's
      // data-role — so this one call IS the "custom role reflected in
      // the selector AND selectable" net. Its startGuaranteedNewSession
      // does a full page.goto("/") AFTER the create above, which
      // re-mounts useRoles() and re-fetches the list (so the new role is
      // in the dropdown); selectRole then auto-waits for role-option-<id>.
      await setupRoleSession(page, role.id, sessions);

      // The real LLM turn under a WORKSPACE-defined role — the coverage
      // roles.spec.ts (built-in roles only) leaves open: a user-created
      // role drives the agent loop end-to-end without crashing it.
      await sendChatMessage(page, "Reply with a one-sentence greeting.");
      await waitForAssistantTurn(page);

      // Lifecycle delete via the same endpoint the /roles UI calls, then
      // confirm against the source-of-truth role list — the selector is
      // transient chrome, so GET /api/roles is the deterministic check
      // (same rationale as L-JOURNEY-ACCT confirming on the DB file).
      await deleteCustomRole(page, role.id);
      roleDeleted = true;
      await assertRoleAbsentFromApi(page, role.id);
    } finally {
      // Race-free per-file prune of a role left by an early failure: the
      // delete is scoped to our unique id, so it can't clobber a
      // parallel spec (unlike the shared-array DBs the other journeys
      // deliberately leave to the session-only convention).
      if (roleCreated && !roleDeleted && !page.isClosed()) {
        await deleteCustomRole(page, role.id).catch((err) => {
          console.warn(`L-JOURNEY-ROLE: best-effort role cleanup skipped for ${role.id}`, err);
        });
      }
      for (const sid of sessions) await deleteSession(page, sid);
    }
  });
});

// ---------------------------------------------------------------------------
// calendar (manageCalendar — Personal role)
// ---------------------------------------------------------------------------

function calendarAddPrompt(marker: string): string {
  return [
    `Use the \`manageCalendar\` tool with action='add' to add a calendar event whose title is EXACTLY '${marker}' (verbatim) on 2099-12-31.`,
    "Do not use show / update / any other action. Do not use any other tool. Do not narrate the result.",
  ].join(" ");
}

// List view (not month) so a far-future event is in scope: the list
// renders every item regardless of date, whereas month/week only show
// the visible period.
async function openCalendarList(page: Page): Promise<void> {
  await page.goto("/calendar");
  await expect(page.getByTestId("scheduler-view-root"), "/calendar must mount the scheduler view").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });
  await page.getByTestId("scheduler-view-mode-list").click();
}

function calendarEventByMarker(page: Page, marker: string): Locator {
  return page.getByTestId("scheduler-event-item").filter({ hasText: marker });
}

async function deleteCalendarEventViaUi(page: Page, event: Locator): Promise<void> {
  // The per-row delete (✕) button reveals on hover (opacity-0 →
  // group-hover) and fires a window.confirm before it dispatches the
  // delete. Install the dialog acceptor BEFORE the click — confirm()
  // resolves synchronously, so a late listener misses the prompt and
  // hangs the click.
  page.once("dialog", (dialog) => {
    dialog.accept().catch(() => undefined);
  });
  await event.hover();
  await event.locator('[data-testid^="scheduler-item-delete-"]').click();
}

// ---------------------------------------------------------------------------
// todo (manageTodoList — Personal role, runtime plugin)
// ---------------------------------------------------------------------------

function todoAddPrompt(marker: string): string {
  return [
    `Use the \`manageTodoList\` tool with action='add' to add one todo whose text is EXACTLY '${marker}' (verbatim, no edits).`,
    "Do not use show / any other action. Do not use any other tool. Do not narrate the result.",
  ].join(" ");
}

function todoDeletePrompt(marker: string): string {
  return [
    `Now delete every todo whose text equals EXACTLY '${marker}'.`,
    "Use the manageTodoList tool with action='delete' (look it up via ToolSearch if needed). Do not narrate the result.",
  ].join(" ");
}

async function openTodos(page: Page): Promise<void> {
  await page.goto("/todos");
  await expect(page.getByTestId("todo-view-root"), "/todos must mount").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });
}

function todoCardByMarker(page: Page, marker: string): Locator {
  return page.locator('[data-testid^="todo-card-"]').filter({ hasText: marker }).first();
}

// Open /todos, prove the LLM-added card rendered, tick its checkbox,
// wait for the runtime dispatch to flush, then reload and assert both
// the card and its checked state survived — the round trip through
// the todo-plugin REST + workspace JSON the View hydrates from.
async function assertTodoCardReflectedAndPersisted(page: Page, marker: string): Promise<void> {
  await openTodos(page);
  const card = todoCardByMarker(page, marker);
  await expect(card, "the LLM-added todo must reflect as a kanban card").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });

  const checkbox = card.locator('input[type="checkbox"]').first();
  const flushed = waitForTodoDispatch(page);
  await checkbox.check();
  await flushed;
  await expect(checkbox, "the checked state flips immediately").toBeChecked();

  await page.reload();
  await expect(page.getByTestId("todo-view-root")).toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });
  const cardAfter = todoCardByMarker(page, marker);
  await expect(cardAfter, "the todo persists across reload").toBeVisible();
  await expect(cardAfter.locator('input[type="checkbox"]').first(), "the checked state persists across reload").toBeChecked();
}

function waitForTodoDispatch(page: Page): Promise<Response> {
  return page.waitForResponse(
    (resp) =>
      resp.url().includes(RUNTIME_DISPATCH_URL_FRAGMENT) && resp.url().includes(TODO_PLUGIN_SLUG_FRAGMENT) && resp.request().method() === "POST" && resp.ok(),
    { timeout: TODO_DISPATCH_FLUSH_TIMEOUT_MS },
  );
}

// Re-enter the chat session (the View navigation detached it) and ask
// the agent to delete the marker — a second real LLM turn so the
// todo journey canaries the delete dispatch path too, not just add.
async function deleteTodoFromChat(page: Page, sessionId: string, marker: string): Promise<void> {
  await page.goto(`/chat/${sessionId}`);
  await sendChatMessage(page, todoDeletePrompt(marker));
  await waitForAssistantTurn(page);
}

// ---------------------------------------------------------------------------
// accounting (manageAccounting — Accounting role)
// ---------------------------------------------------------------------------

// Headline assertion: the LLM-created book is reflected in the live
// View's switcher. The accounting plugin has no standalone route — its
// view only mounts via the openBook envelope inline in chat.
async function assertBookActiveInSwitcher(page: Page, marker: string): Promise<void> {
  const app = page.getByTestId("accounting-app").last();
  await expect(app, "openBook must mount the accounting view inline in the chat").toBeVisible({ timeout: VIEW_REFLECT_TIMEOUT_MS });
  // The book-select is a native <select> bound to activeBookId, so the
  // SELECTED option (`option:checked`) is the active book — assert
  // against that, not the whole select (whose text contains every
  // book's option and would false-green if another book were active).
  await expect(
    app.getByTestId("accounting-book-select").locator("option:checked"),
    "the LLM-created book must be the ACTIVE book in the switcher",
  ).toContainText(marker, { timeout: VIEW_REFLECT_TIMEOUT_MS });
}

function accountingCreatePrompt(marker: string): string {
  return [
    `Use the \`manageAccounting\` tool with action='createBook' to create a book whose name is EXACTLY '${marker}' (verbatim), currency='USD', country='US'.`,
    "Then call the same tool with action='openBook' for that book so its view mounts in the chat.",
    "Do not use any other tool. Do not narrate the result.",
  ].join(" ");
}

function accountingDeletePrompt(marker: string): string {
  return [
    `Now delete the book whose name equals EXACTLY '${marker}'.`,
    "Use the manageAccounting tool with action='getBooks' to find its bookId, then action='deleteBook' with confirm=true. Do not narrate the result.",
  ].join(" ");
}

// Poll the accounting DB until the marker book is gone — the server
// write can lag the assistant turn ending by a beat. Read-only, so it
// never races a concurrent write (other specs use distinct book names).
async function assertBookDeletedFromDb(marker: string): Promise<void> {
  await expect(async () => {
    const raw = await readWorkspaceFile(ACCOUNTING_CONFIG_REL);
    // File gone entirely is the strongest form of "book absent".
    if (raw === null) return;
    // Fail CLOSED on corrupt / schema-drifted JSON (Codex iter-1
    // must-fix): a parse / shape failure throws, which inside `toPass`
    // keeps retrying (tolerating a transient mid-write read) and then
    // fails at the timeout rather than silently passing the delete
    // check on a broken DB.
    const names = parseBookNamesStrict(raw);
    expect(names, `book '${marker}' must be gone from ${ACCOUNTING_CONFIG_REL} after the LLM deleteBook turn`).not.toContain(marker);
  }).toPass({ timeout: VIEW_REFLECT_TIMEOUT_MS });
}

function parseBookNamesStrict(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${ACCOUNTING_CONFIG_REL} is not valid JSON after deleteBook (corrupt DB): ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.books)) {
    throw new Error(`${ACCOUNTING_CONFIG_REL} did not have the expected { books: [...] } shape after deleteBook`);
  }
  // Fail closed per-entry too (CodeRabbit): a malformed row (non-object
  // or non-string `name`) must throw, not silently become "" — else a
  // corrupted books[] could let `not.toContain(marker)` false-pass.
  return parsed.books.map((book, idx) => {
    if (!isRecord(book) || typeof book.name !== "string") {
      throw new Error(`${ACCOUNTING_CONFIG_REL} has an invalid books[${idx}] entry after deleteBook; expected { name: string }`);
    }
    return book.name;
  });
}

// ---------------------------------------------------------------------------
// collections (presentCollection — Personal role, mc-clients preset skill)
// ---------------------------------------------------------------------------

// The mc-clients preset skill (server/workspace/skills-preset/mc-clients/)
// is synced into every workspace on boot. Unlike the manage* plugins,
// collections have no add tool — the skill tells the agent to derive an
// id and Write the record to data/clients/items/<id>.json. The host's
// <CollectionView> reads those same files, so a row appearing in the
// view proves the skill-driven file write landed AND rendered.
const CLIENTS_COLLECTION_SLUG = "mc-clients";

function clientAddPrompt(marker: string): string {
  return [
    `Add one client to the ${CLIENTS_COLLECTION_SLUG} clients collection whose name is EXACTLY '${marker}' (verbatim, do not edit it).`,
    "Use the mc-clients skill: derive an id and Write the record to data/clients/items/<id>.json.",
    "Do not add any other client. Do not use presentForm. Reply with a one-line confirmation only.",
  ].join(" ");
}

// The standalone /collections/<slug> route mounts <CollectionView>. Its
// header "+ Add" button (canCreate is always true for this non-singleton
// collection) is the stable "the collection loaded" gate — the view has
// no single root testid, and waiting on the row directly can't tell a
// not-yet-rendered row from a failed mount.
async function openClientsCollection(page: Page): Promise<void> {
  await page.goto(`/collections/${CLIENTS_COLLECTION_SLUG}`);
  await expect(page.getByTestId("collections-add-item"), `/collections/${CLIENTS_COLLECTION_SLUG} must mount the collection view`).toBeVisible({
    timeout: VIEW_REFLECT_TIMEOUT_MS,
  });
}

// The agent derives the id slug itself, so filter by the marker (the
// verbatim `name` cell), not by the id — same reflection check the
// other journeys use.
function clientRowByMarker(page: Page, marker: string): Locator {
  return page.locator('[data-testid^="collections-row-"]').filter({ hasText: marker });
}

// Click the marker row to open its read-only detail panel, hit Remove,
// then accept the host ConfirmModal (a testid'd modal, not
// window.confirm). Only one row is open at a time, so the detail panel
// and its remove button need no per-id scoping.
async function deleteClientViaUi(page: Page, row: Locator): Promise<void> {
  await row.click();
  await expect(page.getByTestId("collections-detail"), "clicking the row opens the read-only detail panel").toBeVisible({
    timeout: VIEW_REFLECT_TIMEOUT_MS,
  });
  await page.getByTestId("collections-detail-remove").click();
  await page.getByTestId("host-confirm-ok").click();
}

// ---------------------------------------------------------------------------
// roles (custom role lifecycle — UI-add path, no LLM dispatch tool)
// ---------------------------------------------------------------------------

// `manageRoles` is in no built-in role's availablePlugins, so a custom
// role cannot be added by the LLM — the only add path is the /roles
// form (POST /api/roles/manage). Driving that multi-field form is
// mock-e2e territory (pure UI → REST, no LLM); the e2e-live-worthy part
// is that a WORKSPACE-defined custom role then surfaces in the live
// selector and drives a REAL agent turn (the built-in-only roles.spec.ts
// never exercises a user-created role). So create / delete go through
// the same REST endpoint the form calls, deterministically, as
// setup / teardown — and the test focuses on the selector reflection +
// the real LLM turn.
interface CustomRoleFixture {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  availablePlugins: string[];
  queries: string[];
}

const CUSTOM_ROLE_PROMPT = "You are a throwaway role used by an automated end-to-end test. Answer briefly.";

// The marker (testId-epochMs-hex) already matches the server's role-id
// rule /^[a-zA-Z0-9_-]+$/, so it doubles as the unique id and the
// displayed name. availablePlugins is empty on purpose: the agent keeps
// its base tools, and the turn only needs to complete — we're testing
// that a custom role boots and runs, not any specific plugin.
function customRoleFixture(marker: string): CustomRoleFixture {
  return { id: marker, name: marker, icon: "person", prompt: CUSTOM_ROLE_PROMPT, availablePlugins: [], queries: [] };
}

async function createCustomRole(page: Page, role: CustomRoleFixture): Promise<void> {
  const res = await postAuthedJsonViaPage(page, API_ROUTES.roles.manage, { action: "create", role });
  assertManageSuccess(res, `create role ${role.id}`);
}

async function deleteCustomRole(page: Page, roleId: string): Promise<void> {
  const res = await postAuthedJsonViaPage(page, API_ROUTES.roles.manage, { action: "delete", roleId });
  assertManageSuccess(res, `delete role ${roleId}`);
}

// Fail CLOSED: a transport error OR a { success: false } body must
// throw, so a silently-rejected create can't let the test proceed to a
// false-green selector / turn assertion.
function assertManageSuccess(res: AuthedJsonProbe, label: string): void {
  if (!res.ok) throw new Error(`${label}: ${res.reason}`);
  if (!isRecord(res.body) || res.body.success !== true) {
    const detail = isRecord(res.body) && typeof res.body.error === "string" ? res.body.error : JSON.stringify(res.body);
    throw new Error(`${label}: /api/roles/manage did not return success — ${detail}`);
  }
}

// Poll the custom-role list until the marker role is gone — the delete
// write can lag the POST response by a beat. Read-only, so it never
// races a concurrent spec (each test owns a unique role id).
async function assertRoleAbsentFromApi(page: Page, roleId: string): Promise<void> {
  await expect(async () => {
    const res = await fetchAuthedJsonViaPage(page, API_ROUTES.roles.list);
    if (!res.ok) throw new Error(res.reason);
    expect(parseRoleIdsStrict(res.body), `custom role '${roleId}' must be gone from ${API_ROUTES.roles.list} after delete`).not.toContain(roleId);
  }).toPass({ timeout: VIEW_REFLECT_TIMEOUT_MS });
}

// GET /api/roles returns the custom-role array directly. Fail closed on
// a shape drift (non-array, or an entry missing a string id) so a
// malformed payload throws rather than false-passing not.toContain.
function parseRoleIdsStrict(body: unknown): string[] {
  if (!Array.isArray(body)) {
    throw new Error(`${API_ROUTES.roles.list} did not return an array of roles`);
  }
  return body.map((role, idx) => {
    if (!isRecord(role) || typeof role.id !== "string") {
      throw new Error(`${API_ROUTES.roles.list} has an invalid roles[${idx}] entry; expected { id: string }`);
    }
    return role.id;
  });
}
