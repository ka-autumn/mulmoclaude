// Typed wrapper around POST /api/accounting. Centralises the action
// names and the response shapes so the View / sub-components don't
// repeat the cast at every call site.
//
// Every helper returns `ApiResult<T>` (the discriminated union mirrored
// in hostContext.ts) — callers pattern-match on `.ok`. There is no
// separate error-throwing path; all surfaces (network, HTTP, app
// validation) flow through the same shape. The actual network client is
// host-injected (see hostContext.ts) so the package stays host-agnostic.

import { hostApiCall as apiCall, type ApiResult } from "./hostContext";
import {
  ACCOUNTING_ACTIONS,
  ACCOUNTING_API,
  type SupportedCountryCode,
  type FiscalYearEnd,
  type TimeSeriesGranularity,
  type TimeSeriesMetric,
} from "../shared";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type JournalEntryKind = "normal" | "opening" | "void" | "void-marker";

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  note?: string;
  /** Soft-delete flag. When `false`, the account is hidden from
   *  entry/ledger dropdowns but stays visible in Manage Accounts
   *  and historical entries. */
  active?: boolean;
}

export interface JournalLine {
  accountCode: string;
  debit?: number;
  credit?: number;
  memo?: string;
  /** Counterparty's tax-authority-issued registration ID — JP
   *  T-number, EU VAT ID, UK VAT registration number, GSTIN, ABN,
   *  etc. See server/accounting/types.ts for the full doc. */
  taxRegistrationId?: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  kind: JournalEntryKind;
  lines: JournalLine[];
  memo?: string;
  voidedEntryId?: string;
  voidReason?: string;
  /** Set on the new entry posted via the "edit" flow — id of the
   *  original entry that was voided in the same operation. The
   *  void + new-entry pair is two sequential calls on the client,
   *  not an atomic transaction. */
  replacesEntryId?: string;
  createdAt: string;
}

export interface BookSummary {
  id: string;
  name: string;
  currency: string;
  /** ISO 3166-1 alpha-2 country code identifying the tax jurisdiction
   *  the book is kept under. Constrained to `SupportedCountryCode` —
   *  see `countries.ts`. Optional for backward compatibility with
   *  books created before the field was introduced. */
  country?: SupportedCountryCode;
  /** Which calendar-quarter end is the book's fiscal year end:
   *  Q1 → March 31, Q2 → June 30, Q3 → September 30, Q4 → December 31.
   *  Optional in the persisted shape for backward compatibility —
   *  read-side code treats absence as Q4 via `resolveFiscalYearEnd`.
   *  See `./fiscalYear.ts`. */
  fiscalYearEnd?: FiscalYearEnd;
  createdAt: string;
}

export interface OpenAppPayload {
  kind: "accounting-app";
  /** `null` when the workspace has zero books — the View renders the
   *  empty state and prompts for book creation. */
  bookId: string | null;
  initialTab?: string;
}

export interface AccountBalance {
  accountCode: string;
  netDebit: number;
}

export interface BalanceSheetSection {
  type: AccountType;
  rows: { accountCode: string; accountName: string; balance: number }[];
  total: number;
}

export interface BalanceSheet {
  asOf: string;
  sections: BalanceSheetSection[];
  imbalance: number;
}

export interface ProfitLoss {
  from: string;
  to: string;
  income: { rows: { accountCode: string; accountName: string; amount: number }[]; total: number };
  expense: { rows: { accountCode: string; accountName: string; amount: number }[]; total: number };
  netIncome: number;
}

export interface LedgerRow {
  entryId: string;
  date: string;
  kind: JournalEntryKind;
  memo?: string;
  debit: number;
  credit: number;
  runningBalance: number;
  /** Counterparty tax-registration ID per source line. The Ledger
   *  view shows it as its own column when the selected account is
   *  in the input-tax band (14xx — see `isTaxAccountCode`). */
  taxRegistrationId?: string;
}

export interface Ledger {
  accountCode: string;
  accountName: string;
  rows: LedgerRow[];
  closingBalance: number;
}

export type ReportPeriod = { kind: "month"; period: string } | { kind: "range"; from: string; to: string };

// The single dispatch route this plugin owns — shared with the server
// router via `ACCOUNTING_API` so the two can't drift.
const DISPATCH_URL = ACCOUNTING_API.dispatch.path;
const DISPATCH_METHOD = ACCOUNTING_API.dispatch.method;

function call<T>(action: string, args: Record<string, unknown> = {}): Promise<ApiResult<T>> {
  return apiCall<T>(DISPATCH_URL, { method: DISPATCH_METHOD, body: { action, ...args } });
}

// ── Books ────────────────────────────────────────────────────────────

export function getBooks(): Promise<ApiResult<{ books: BookSummary[] }>> {
  return call(ACCOUNTING_ACTIONS.getBooks);
}

export function createBook(input: {
  name: string;
  currency?: string;
  country?: SupportedCountryCode;
  /** Q1..Q4 — required at the form boundary, but the server silently
   *  defaults absent / empty to Q4 for back-compat. */
  fiscalYearEnd?: FiscalYearEnd;
}): Promise<ApiResult<{ book: BookSummary }>> {
  return call(ACCOUNTING_ACTIONS.createBook, input);
}

export function updateBook(input: {
  bookId: string;
  name?: string;
  /** Pass `""` to explicitly clear the country (server treats it as
   *  the "drop the field" sentinel). Any other value must be one of
   *  the curated `SupportedCountryCode`s. */
  country?: SupportedCountryCode | "";
  /** Q1..Q4 — pure metadata, only changes how the date-range
   *  shortcuts resolve. No "clear" path; absence leaves the existing
   *  value untouched. */
  fiscalYearEnd?: FiscalYearEnd;
}): Promise<ApiResult<{ book: BookSummary }>> {
  return call(ACCOUNTING_ACTIONS.updateBook, input);
}

export function deleteBook(bookId: string): Promise<ApiResult<{ deletedBookId: string; deletedBookName: string }>> {
  return call(ACCOUNTING_ACTIONS.deleteBook, { bookId, confirm: true });
}

// ── Accounts ─────────────────────────────────────────────────────────

export function getAccounts(bookId: string): Promise<ApiResult<{ bookId: string; accounts: Account[] }>> {
  return call(ACCOUNTING_ACTIONS.getAccounts, { bookId });
}

export function upsertAccount(account: Account, bookId: string): Promise<ApiResult<{ bookId: string; account: Account; accounts: Account[] }>> {
  return call(ACCOUNTING_ACTIONS.upsertAccount, { account, bookId });
}

// ── Entries ──────────────────────────────────────────────────────────

export interface AddEntriesItemInput {
  date: string;
  lines: JournalLine[];
  memo?: string;
  /** When set, marks this entry as the replacement posted via the
   *  "edit" flow. The caller is expected to have voided
   *  `replacesEntryId` separately just before this call — there is
   *  no atomic transaction. */
  replacesEntryId?: string;
}

export function addEntries(input: {
  bookId: string;
  /** One or more entries to post. The server validates every entry
   *  before any write, so a single bad entry rejects the whole
   *  batch. Pass a single-element array to post just one entry. */
  entries: AddEntriesItemInput[];
}): Promise<ApiResult<{ bookId: string; entries: JournalEntry[] }>> {
  return call(ACCOUNTING_ACTIONS.addEntries, input);
}

export function voidEntry(input: {
  entryId: string;
  reason?: string;
  bookId: string;
}): Promise<ApiResult<{ bookId: string; reverseEntry: JournalEntry; markerEntry: JournalEntry }>> {
  return call(ACCOUNTING_ACTIONS.voidEntry, input);
}

export function getJournalEntries(input: {
  from?: string;
  to?: string;
  accountCode?: string;
  bookId: string;
}): Promise<ApiResult<{ bookId: string; entries: JournalEntry[]; voidedEntryIds: string[] }>> {
  return call(ACCOUNTING_ACTIONS.getJournalEntries, input);
}

// ── Opening balances ─────────────────────────────────────────────────

export function getOpeningBalances(bookId: string): Promise<ApiResult<{ bookId: string; opening: JournalEntry | null }>> {
  return call(ACCOUNTING_ACTIONS.getOpeningBalances, { bookId });
}

export function setOpeningBalances(input: {
  asOfDate: string;
  lines: JournalLine[];
  memo?: string;
  bookId: string;
}): Promise<ApiResult<{ bookId: string; openingEntry: JournalEntry; replacedExisting: boolean }>> {
  return call(ACCOUNTING_ACTIONS.setOpeningBalances, input);
}

// ── Reports ──────────────────────────────────────────────────────────

export function getBalanceSheet(period: ReportPeriod, bookId: string): Promise<ApiResult<{ bookId: string; balanceSheet: BalanceSheet }>> {
  return call(ACCOUNTING_ACTIONS.getReport, { kind: "balance", period, bookId });
}

export function getProfitLoss(period: ReportPeriod, bookId: string): Promise<ApiResult<{ bookId: string; profitLoss: ProfitLoss }>> {
  return call(ACCOUNTING_ACTIONS.getReport, { kind: "pl", period, bookId });
}

export function getLedger(accountCode: string, period: ReportPeriod | undefined, bookId: string): Promise<ApiResult<{ bookId: string; ledger: Ledger }>> {
  return call(ACCOUNTING_ACTIONS.getReport, { kind: "ledger", accountCode, period, bookId });
}

export interface TimeSeriesPoint {
  label: string;
  from: string;
  to: string;
  value: number;
}

export interface TimeSeriesInput {
  bookId: string;
  metric: TimeSeriesMetric;
  granularity: TimeSeriesGranularity;
  /** Inclusive YYYY-MM-DD lower bound. The first bucket is the one
   *  CONTAINING this date — it can extend earlier. */
  from: string;
  /** Inclusive YYYY-MM-DD upper bound. The last bucket is the one
   *  CONTAINING this date — it can extend later. */
  to: string;
  /** Required when metric === "accountBalance"; forbidden otherwise.
   *  The server returns a 400 either way. */
  accountCode?: string;
}

export interface TimeSeriesResult {
  bookId: string;
  metric: TimeSeriesMetric;
  granularity: TimeSeriesGranularity;
  from: string;
  to: string;
  accountCode?: string;
  points: TimeSeriesPoint[];
}

export function getTimeSeries(input: TimeSeriesInput): Promise<ApiResult<TimeSeriesResult>> {
  // Spread so the named interface is widened into a fresh object
  // literal — `call()` takes `Record<string, unknown>` which a
  // declared interface doesn't satisfy structurally in TS.
  return call(ACCOUNTING_ACTIONS.getTimeSeries, { ...input });
}

// ── Admin ────────────────────────────────────────────────────────────

export function rebuildSnapshots(bookId: string): Promise<ApiResult<{ bookId: string; rebuilt: string[] }>> {
  return call(ACCOUNTING_ACTIONS.rebuildSnapshots, { bookId });
}
