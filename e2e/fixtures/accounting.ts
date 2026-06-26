// Helpers for the accounting plugin E2E tests.
//
// `mockAccountingApi` registers a `/api/accounting` route handler that
// keeps a small in-memory state across action dispatches so the View
// can drive a realistic create-book / set-opening / add-entries flow
// without standing up the real server. The state lives inside the
// closure — call `mockAccountingApi(page)` once per test.

import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { ACCOUNTING_ACTIONS, type SupportedCountryCode } from "@mulmoclaude/accounting-plugin/shared";
import { isValidCalendarDate } from "@mulmoclaude/accounting-plugin/server";

interface FakeBook {
  id: string;
  name: string;
  currency: string;
  country?: SupportedCountryCode;
  createdAt: string;
}

interface FakeAccount {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
}

interface FakeLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  memo?: string;
  /** Counterparty tax-registration ID (JP T-number, EU VAT ID, …).
   *  Mirrors `JournalLine.taxRegistrationId` in
   *  server/accounting/types.ts so the mock dispatcher round-trips
   *  the same shape the production REST handler does. */
  taxRegistrationId?: string;
}

interface FakeEntry {
  id: string;
  date: string;
  kind: "normal" | "opening" | "void" | "void-marker";
  lines: FakeLine[];
  memo?: string;
  voidedEntryId?: string;
  voidReason?: string;
  replacesEntryId?: string;
  createdAt: string;
}

/** Minimal shapes for the report mocks. Mirror the public response
 *  shapes from `server/accounting/report.ts` closely enough that the
 *  client renders rows; tests only populate the fields they assert on. */
export interface BalanceSheetRowMock {
  accountCode: string;
  accountName: string;
  balance: number;
}
export interface BalanceSheetSectionMock {
  type: "asset" | "liability" | "equity";
  rows: BalanceSheetRowMock[];
  total: number;
}
export interface BalanceSheetMock {
  asOf?: string;
  sections: BalanceSheetSectionMock[];
  imbalance?: number;
}
export interface ProfitLossRowMock {
  accountCode: string;
  accountName: string;
  amount: number;
}
export interface ProfitLossMock {
  from?: string;
  to?: string;
  income: { rows: ProfitLossRowMock[]; total: number };
  expense: { rows: ProfitLossRowMock[]; total: number };
  netIncome?: number;
}

/** Mirror of the `getTimeSeries` response — see
 *  `server/accounting/timeSeries.ts`. The mock returns an empty
 *  `points: []` by default; tests that need a populated series
 *  inject one via `mockAccountingApi`'s `reports.timeSeries` slot. */
export interface TimeSeriesPointMock {
  label: string;
  from: string;
  to: string;
  value: number;
}

interface AccountingState {
  books: FakeBook[];
  accountsByBook: Map<string, FakeAccount[]>;
  entriesByBook: Map<string, FakeEntry[]>;
  /** Optional canned report data injected via `mockAccountingApi`'s
   *  `reports` option. Lets tests render non-empty Balance Sheet /
   *  P&L tables without standing up the real aggregation pipeline. */
  reports?: { balanceSheet?: BalanceSheetMock; profitLoss?: ProfitLossMock; timeSeries?: TimeSeriesPointMock[] };
}

const SEED_ACCOUNTS: FakeAccount[] = [
  { code: "1000", name: "Cash", type: "asset" },
  // 1400 ships seeded so the JournalEntryForm e2e can exercise the
  // tax-account branch (the per-line taxRegistrationId input is
  // gated by `isTaxAccountCode`, which only matches 14xx —
  // see src/plugins/accounting/components/accountNumbering.ts).
  { code: "1400", name: "Sales Tax Receivable", type: "asset" },
  { code: "2000", name: "Accounts payable", type: "liability" },
  // 2400 ships seeded so the e2e can pin the negative case: 24xx
  // (output-tax) lines must NOT surface the T-number column. Without
  // this code in the seed the test could only assert "non-tax stays
  // hidden", which doesn't catch a regression that re-broadens
  // `isTaxAccountCode` to include 24xx.
  { code: "2400", name: "Sales Tax Payable", type: "liability" },
  { code: "3000", name: "Equity", type: "equity" },
  { code: "4000", name: "Sales", type: "income" },
  { code: "5000", name: "Rent expense", type: "expense" },
];

interface DispatchBody {
  action: string;
  [key: string]: unknown;
}

interface MockResponse {
  status: number;
  body: unknown;
}

type ActionHandler = (state: AccountingState, body: DispatchBody) => MockResponse;

function makeState(): AccountingState {
  return { books: [], accountsByBook: new Map(), entriesByBook: new Map() };
}

function uniqueId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

const ok = (body: unknown): MockResponse => ({ status: 200, body });
const err = (status: number, message: string): MockResponse => ({ status, body: { error: message } });
const missingBookId = (): MockResponse => err(400, "bookId is required");

/** Resolve the book id the way the real service does (see
 *  `resolveBookId` in `server/accounting/service.ts`): require an
 *  explicit string `bookId` (else 400) AND require it to exist in
 *  state (else 404). Returning a `MockResponse` for the unhappy
 *  paths lets the fixture mirror production's status-code shape so
 *  e2e flows that exercise stale / typo'd ids see the real 404
 *  rather than a silent 200 with empty data. */
function resolveBookId(state: AccountingState, body: DispatchBody): string | MockResponse {
  if (typeof body.bookId !== "string") return missingBookId();
  if (!state.books.some((book) => book.id === body.bookId)) {
    return err(404, `book ${JSON.stringify(body.bookId)} not found`);
  }
  return body.bookId;
}

function handleOpenBook(state: AccountingState, body: DispatchBody): MockResponse {
  // Mirrors the server's required-bookId contract — see
  // server/api/routes/accounting.ts handleOpenBook.
  if (typeof body.bookId !== "string" || body.bookId === "") return missingBookId();
  if (!state.books.some((book) => book.id === body.bookId)) {
    return err(404, `book ${JSON.stringify(body.bookId)} not found`);
  }
  const initialTab = typeof body.initialTab === "string" ? body.initialTab : undefined;
  return ok({ kind: "accounting-app", bookId: body.bookId, initialTab, books: state.books });
}

function handleGetBooks(state: AccountingState): MockResponse {
  return ok({ books: state.books });
}

function handleCreateBook(state: AccountingState, body: DispatchBody): MockResponse {
  const name = typeof body.name === "string" ? body.name : "Test book";
  const currency = typeof body.currency === "string" ? body.currency : "USD";
  // The mock mirrors the production service's enum guard so e2e tests
  // exercising bad codes see the real 400 instead of a silent success.
  const country = typeof body.country === "string" ? (body.country as SupportedCountryCode) : undefined;
  const book: FakeBook = {
    id: uniqueId("book"),
    name,
    currency,
    ...(country ? { country } : {}),
    createdAt: new Date().toISOString(),
  };
  state.books.push(book);
  state.accountsByBook.set(book.id, [...SEED_ACCOUNTS]);
  state.entriesByBook.set(book.id, []);
  return ok({ bookId: book.id, book });
}

function handleUpdateBook(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const target = state.books.find((book) => book.id === resolved);
  if (!target) return err(404, `book ${JSON.stringify(resolved)} not found`);
  if (typeof body.name === "string" && body.name.trim() !== "") target.name = body.name;
  if (typeof body.country === "string") {
    if (body.country === "") delete target.country;
    else target.country = body.country as SupportedCountryCode;
  }
  return ok({ bookId: resolved, book: { ...target } });
}

function handleDeleteBook(state: AccountingState, body: DispatchBody): MockResponse {
  const bookId = typeof body.bookId === "string" ? body.bookId : "";
  if (body.confirm !== true) return err(400, "deleteBook requires confirm: true");
  const idx = state.books.findIndex((book) => book.id === bookId);
  if (idx < 0) return err(404, `book ${JSON.stringify(bookId)} not found`);
  const target = state.books[idx];
  state.books.splice(idx, 1);
  state.accountsByBook.delete(bookId);
  state.entriesByBook.delete(bookId);
  return ok({ deletedBookId: bookId, deletedBookName: target.name });
}

function handleGetAccounts(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  return ok({ bookId: resolved, accounts: state.accountsByBook.get(resolved) ?? [] });
}

function voidedIdsFrom(entries: readonly FakeEntry[]): string[] {
  const set = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "void-marker" && entry.voidedEntryId) set.add(entry.voidedEntryId);
  }
  return Array.from(set).sort();
}

function handleGetJournalEntries(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const entries = state.entriesByBook.get(resolved) ?? [];
  return ok({ bookId: resolved, entries, voidedEntryIds: voidedIdsFrom(entries) });
}

interface BatchEntryInput {
  date?: unknown;
  lines?: unknown;
  memo?: unknown;
  replacesEntryId?: unknown;
}

function handleAddEntries(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const inputs = Array.isArray(body.entries) ? (body.entries as BatchEntryInput[]) : [];
  if (inputs.length === 0) return err(400, "addEntries: entries must be a non-empty array");
  const built: FakeEntry[] = inputs.map((item) => {
    const entry: FakeEntry = {
      id: uniqueId("entry"),
      date: typeof item.date === "string" ? item.date : "2026-04-01",
      kind: "normal",
      lines: Array.isArray(item.lines) ? (item.lines as FakeLine[]) : [],
      memo: typeof item.memo === "string" ? item.memo : undefined,
      createdAt: new Date().toISOString(),
    };
    if (typeof item.replacesEntryId === "string" && item.replacesEntryId !== "") {
      entry.replacesEntryId = item.replacesEntryId;
    }
    return entry;
  });
  const list = state.entriesByBook.get(resolved) ?? [];
  list.push(...built);
  state.entriesByBook.set(resolved, list);
  return ok({ bookId: resolved, entries: built });
}

function buildVoidMemo(target: FakeEntry, reason: string | undefined): string {
  // Mirror the real service contract from
  // `server/accounting/journal.ts#voidMemo`: entry-level memo →
  // first line memo → date-only fallback. Picking memo from any
  // line (e.g. via `find(...)`) would diverge from production.
  const memoSource = target.memo ?? target.lines[0]?.memo ?? null;
  const base = memoSource ? `void of '${memoSource}' on ${target.date}` : `void of entry on ${target.date}`;
  return reason && reason.trim() !== "" ? `${base}: ${reason}` : base;
}

function handleVoidEntry(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const list = state.entriesByBook.get(resolved) ?? [];
  const targetId = typeof body.entryId === "string" ? body.entryId : "";
  const target = list.find((entry) => entry.id === targetId);
  if (!target) return err(404, `entry ${JSON.stringify(targetId)} not found`);
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  const voidDate = typeof body.voidDate === "string" ? body.voidDate : "2026-04-30";
  const reverse: FakeEntry = {
    id: uniqueId("entry"),
    date: voidDate,
    kind: "void",
    lines: target.lines.map((line) => ({
      accountCode: line.accountCode,
      debit: line.credit,
      credit: line.debit,
      memo: line.memo,
      // Mirror the production void path — the counterparty
      // tax-registration ID survives onto the reversing line so
      // the audit trail isn't broken by a void.
      taxRegistrationId: line.taxRegistrationId,
    })),
    memo: buildVoidMemo(target, reason),
    voidedEntryId: target.id,
    voidReason: reason,
    createdAt: new Date().toISOString(),
  };
  const marker: FakeEntry = {
    id: uniqueId("entry"),
    date: voidDate,
    kind: "void-marker",
    lines: [],
    voidedEntryId: target.id,
    voidReason: reason,
    createdAt: new Date().toISOString(),
  };
  list.push(reverse, marker);
  state.entriesByBook.set(resolved, list);
  return ok({ bookId: resolved, reverseEntry: reverse, markerEntry: marker });
}

function handleGetOpening(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const list = state.entriesByBook.get(resolved) ?? [];
  return ok({ bookId: resolved, opening: list.find((entry) => entry.kind === "opening") ?? null });
}

function handleSetOpening(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const opening: FakeEntry = {
    id: uniqueId("entry"),
    date: typeof body.asOfDate === "string" ? body.asOfDate : "2026-01-01",
    kind: "opening",
    lines: (body.lines as FakeLine[]) ?? [],
    memo: typeof body.memo === "string" ? body.memo : "Opening balances",
    createdAt: new Date().toISOString(),
  };
  const list = state.entriesByBook.get(resolved) ?? [];
  list.push(opening);
  state.entriesByBook.set(resolved, list);
  return ok({ bookId: resolved, openingEntry: opening, replacedExisting: false });
}

function handleGetReport(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const kind = typeof body.kind === "string" ? body.kind : "balance";
  if (kind === "pl") {
    const injected = state.reports?.profitLoss;
    return ok({
      bookId: resolved,
      profitLoss: injected ?? { from: "2026-04-01", to: "2026-04-30", income: { rows: [], total: 0 }, expense: { rows: [], total: 0 }, netIncome: 0 },
    });
  }
  if (kind === "ledger") {
    return ok({ bookId: resolved, ledger: { accountCode: "1000", accountName: "Cash", rows: [], closingBalance: 0 } });
  }
  const injected = state.reports?.balanceSheet;
  return ok({ bookId: resolved, balanceSheet: injected ?? { asOf: "2026-04-30", sections: [], imbalance: 0 } });
}

const TIME_SERIES_METRICS = ["revenue", "expense", "netIncome", "accountBalance"] as const;
const TIME_SERIES_GRANULARITIES = ["month", "quarter", "year"] as const;

interface ValidatedTimeSeriesArgs {
  metric: string;
  granularity: string;
  from: string;
  toDate: string;
  accountCode: string | undefined;
}

/** Returns the validated args or an early-exit MockResponse. Pulled
 *  out of `handleGetTimeSeries` so the latter stays under the
 *  cognitive-complexity threshold. */
function validateGetTimeSeriesBody(body: DispatchBody): ValidatedTimeSeriesArgs | MockResponse {
  const metric = typeof body.metric === "string" ? body.metric : "";
  const granularity = typeof body.granularity === "string" ? body.granularity : "";
  const from = typeof body.from === "string" ? body.from : "";
  const toDate = typeof body.to === "string" ? body.to : "";
  const accountCode = typeof body.accountCode === "string" ? body.accountCode : undefined;
  if (!(TIME_SERIES_METRICS as readonly string[]).includes(metric)) {
    return err(400, `getTimeSeries: metric must be one of ${TIME_SERIES_METRICS.join(", ")}`);
  }
  if (!(TIME_SERIES_GRANULARITIES as readonly string[]).includes(granularity)) {
    return err(400, `getTimeSeries: granularity must be one of ${TIME_SERIES_GRANULARITIES.join(", ")}`);
  }
  if (!isValidCalendarDate(from)) return err(400, "getTimeSeries: from must be a valid YYYY-MM-DD calendar date");
  if (!isValidCalendarDate(toDate)) return err(400, "getTimeSeries: to must be a valid YYYY-MM-DD calendar date");
  if (from > toDate) return err(400, "getTimeSeries: from must be on or before to");
  if (metric === "accountBalance" && !accountCode) {
    return err(400, "getTimeSeries: accountCode is required when metric is accountBalance");
  }
  if (metric !== "accountBalance" && accountCode) {
    return err(400, "getTimeSeries: accountCode is only allowed when metric is accountBalance");
  }
  return { metric, granularity, from, toDate, accountCode };
}

/** Mirror of the real `getTimeSeries` validation surface in
 *  `server/accounting/service.ts` — enough to keep an LLM-driven
 *  flow that calls `getTimeSeries` (e.g. via the new "Chart my
 *  quarterly revenue …" sample query) from tripping the
 *  `unhandled mock action` 400. By default returns an empty
 *  `points: []`; tests that need a populated series inject one via
 *  `mockAccountingApi`'s `reports.timeSeries` option. */
function handleGetTimeSeries(state: AccountingState, body: DispatchBody): MockResponse {
  const resolved = resolveBookId(state, body);
  if (typeof resolved !== "string") return resolved;
  const validated = validateGetTimeSeriesBody(body);
  if ("status" in validated) return validated;
  const { metric, granularity, from, toDate, accountCode } = validated;
  const response: Record<string, unknown> = {
    bookId: resolved,
    metric,
    granularity,
    from,
    to: toDate,
    points: state.reports?.timeSeries ?? [],
  };
  if (accountCode) response.accountCode = accountCode;
  return ok(response);
}

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  [ACCOUNTING_ACTIONS.openBook]: handleOpenBook,
  [ACCOUNTING_ACTIONS.getBooks]: handleGetBooks,
  [ACCOUNTING_ACTIONS.createBook]: handleCreateBook,
  [ACCOUNTING_ACTIONS.updateBook]: handleUpdateBook,
  [ACCOUNTING_ACTIONS.deleteBook]: handleDeleteBook,
  [ACCOUNTING_ACTIONS.getAccounts]: handleGetAccounts,
  [ACCOUNTING_ACTIONS.getJournalEntries]: handleGetJournalEntries,
  [ACCOUNTING_ACTIONS.addEntries]: handleAddEntries,
  [ACCOUNTING_ACTIONS.voidEntry]: handleVoidEntry,
  [ACCOUNTING_ACTIONS.getOpeningBalances]: handleGetOpening,
  [ACCOUNTING_ACTIONS.setOpeningBalances]: handleSetOpening,
  [ACCOUNTING_ACTIONS.getReport]: handleGetReport,
  [ACCOUNTING_ACTIONS.getTimeSeries]: handleGetTimeSeries,
  [ACCOUNTING_ACTIONS.rebuildSnapshots]: (state, body) => {
    const resolved = resolveBookId(state, body);
    if (typeof resolved !== "string") return resolved;
    return ok({ bookId: resolved, rebuilt: [] });
  },
};

function dispatch(state: AccountingState, body: DispatchBody): MockResponse {
  const handler = ACTION_HANDLERS[body.action];
  if (!handler) return err(400, `unhandled mock action ${JSON.stringify(body.action)}`);
  return handler(state, body);
}

/** Minimal shape for pre-seeding journal lines. Mirrors `FakeLine`
 *  but stays exported so test specs can build `entries` without
 *  reaching into the fixture's internal types. */
export interface SeedJournalLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  memo?: string;
  taxRegistrationId?: string;
}

/** Minimal shape for pre-seeding a journal entry into the mock state.
 *  `kind` defaults to "normal" — opening / void entries are produced
 *  by their own dispatch handlers and rarely need to be hand-seeded.
 *  Use this when the test's assertion is on what the View does with
 *  an entry that already exists (e.g. auto-selection driven by a
 *  session-transcript tool result), not on the addEntries dispatch
 *  path itself. */
export interface SeedJournalEntry {
  id: string;
  date: string;
  kind?: "normal" | "opening" | "void" | "void-marker";
  lines?: readonly SeedJournalLine[];
  memo?: string;
}

export interface AccountingSeedBook {
  id: string;
  name: string;
  currency?: string;
  country?: SupportedCountryCode;
  /** Pre-seed an empty opening entry so the View's opening-gate
   *  doesn't kick in and hide the journal / newEntry tabs. The View
   *  treats any opening entry — even one with zero lines — as
   *  satisfying the gate. Tests that drive flows past the gate set
   *  this to true so they can land directly on those tabs. */
  withEmptyOpening?: boolean;
  /** Pre-seed normal journal entries on the book. Pushed after the
   *  empty-opening row so the journal renders in the same order as
   *  a real append: opening first, then these. */
  entries?: readonly SeedJournalEntry[];
}

/** Register a mock /api/accounting route on `page`. The mock keeps
 *  in-memory state so multi-step flows (createBook → addEntries →
 *  voidEntry) work end-to-end. Returns the state so tests can
 *  pre-seed before navigation. Pass `opts.books` to seed the state
 *  with pre-existing books — useful for tests that need to drive
 *  `openBook` against a real bookId without first running through
 *  the createBook flow. */
export async function mockAccountingApi(
  page: Page,
  opts: {
    books?: readonly AccountingSeedBook[];
    reports?: { balanceSheet?: BalanceSheetMock; profitLoss?: ProfitLossMock; timeSeries?: TimeSeriesPointMock[] };
  } = {},
): Promise<AccountingState> {
  const state = makeState();
  if (opts.reports) state.reports = opts.reports;
  for (const seed of opts.books ?? []) {
    state.books.push({
      id: seed.id,
      name: seed.name,
      currency: seed.currency ?? "USD",
      ...(seed.country ? { country: seed.country } : {}),
      createdAt: new Date().toISOString(),
    });
    state.accountsByBook.set(seed.id, [...SEED_ACCOUNTS]);
    const entries: FakeEntry[] = [];
    if (seed.withEmptyOpening) {
      entries.push({
        id: uniqueId("entry"),
        date: "2026-04-01",
        kind: "opening",
        lines: [],
        createdAt: new Date().toISOString(),
      });
    }
    for (const seedEntry of seed.entries ?? []) {
      entries.push({
        id: seedEntry.id,
        date: seedEntry.date,
        kind: seedEntry.kind ?? "normal",
        lines: (seedEntry.lines ?? []).map((line) => ({ ...line })),
        memo: seedEntry.memo,
        createdAt: new Date().toISOString(),
      });
    }
    state.entriesByBook.set(seed.id, entries);
  }
  await page.route(
    (url) => url.pathname === "/api/accounting",
    async (route: Route) => {
      const body = (route.request().postDataJSON() ?? {}) as DispatchBody;
      const result = dispatch(state, body);
      await route.fulfill({ status: result.status, json: result.body });
    },
  );
  return state;
}

/** Build the accounting-app tool_result envelope that mounts
 *  `<AccountingApp>` in the canvas. Drop into a session's entries
 *  array exactly like presentChart / presentSpreadsheet results. */
export function makeAccountingToolResult(opts: { bookId?: string | null; initialTab?: string } = {}): Record<string, unknown> {
  return {
    type: "tool_result",
    source: "tool",
    result: {
      uuid: "accounting-result-1",
      toolName: "manageAccounting",
      message: "Accounting app ready",
      data: { kind: "accounting-app", bookId: opts.bookId ?? null, initialTab: opts.initialTab },
    },
  };
}

/** Build a `manageAccounting(addEntries)` tool_result envelope. The
 *  shape mirrors what `server/api/routes/accounting.ts` returns when
 *  the LLM dispatches addEntries: `data: { action, bookId, entries }`
 *  with each entry carrying a server-stamped id. The View reads this
 *  to surface the just-posted row in JournalList. */
export function makeAccountingAddEntriesToolResult(opts: {
  bookId: string;
  entries: readonly { id: string; date: string }[];
  uuid?: string;
}): Record<string, unknown> {
  return {
    type: "tool_result",
    source: "tool",
    result: {
      uuid: opts.uuid ?? "accounting-add-entries-result-1",
      toolName: "manageAccounting",
      message: `Posted ${opts.entries.length} journal ${opts.entries.length === 1 ? "entry" : "entries"}.`,
      data: {
        action: ACCOUNTING_ACTIONS.addEntries,
        bookId: opts.bookId,
        entries: opts.entries.map((entry) => ({ id: entry.id, date: entry.date })),
      },
    },
  };
}

/** Generic factory for any `manageAccounting(<action>)` tool_result
 *  envelope. Mirrors the route handler's wrapped shape: `data` carries
 *  `action` + `bookId` + the action-specific fields the View consumes
 *  (markerEntry for voidEntry, account for upsertAccount, book for
 *  updateBook, …). Use this when a test only needs to assert the
 *  view-routing branch — for addEntries-shaped envelopes prefer the
 *  typed helper above. */
export function makeAccountingActionToolResult(opts: {
  action: string;
  bookId: string;
  data?: Record<string, unknown>;
  message?: string;
  uuid?: string;
}): Record<string, unknown> {
  return {
    type: "tool_result",
    source: "tool",
    result: {
      uuid: opts.uuid ?? `accounting-${opts.action}-result-1`,
      toolName: "manageAccounting",
      message: opts.message ?? `Accounting ${opts.action} ready.`,
      data: { action: opts.action, bookId: opts.bookId, ...(opts.data ?? {}) },
    },
  };
}
