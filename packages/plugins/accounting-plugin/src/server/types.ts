// Domain types for the accounting plugin (opt-in, custom-Role only).
//
// Source-of-truth files on disk:
//   data/accounting/config.json                 ← AccountingConfig
//   data/accounting/books/<id>/accounts.json    ← Account[]
//   data/accounting/books/<id>/journal/YYYY-MM.jsonl  ← JournalEntry per line
//   data/accounting/books/<id>/snapshots/YYYY-MM.json ← MonthSnapshot (cache)
//
// Snapshots are cache only — journal is the single source of truth.

import type { SupportedCountryCode, FiscalYearEnd } from "../shared";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** B/S accounts (assets / liabilities / equity). Used by opening
 *  balance validation: opening entries reference balance-sheet
 *  accounts only. */
export const BALANCE_SHEET_ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity"];

export interface Account {
  /** Stable identifier the journal lines reference. Typically a
   *  numeric string ("1000" / "2000" …) but free-form is allowed
   *  so the user can adopt their existing numbering. */
  code: string;
  name: string;
  type: AccountType;
  /** Optional free-form note (tax bucket, parent group, …). Not
   *  interpreted by the engine — passes through verbatim. */
  note?: string;
  /** Soft-delete flag. When `false`, the account is hidden from
   *  entry/ledger dropdowns but stays visible in Manage Accounts
   *  and historical entries — accounting integrity requires that
   *  a code referenced by a journal line never disappears. Omitted
   *  (treated as active) by default to keep the JSON files clean
   *  for books created before this field existed. */
  active?: boolean;
}

export interface BookSummary {
  id: string;
  name: string;
  /** ISO 4217 (e.g. "USD" / "JPY"). Single-currency per book — no
   *  cross-book aggregation. */
  currency: string;
  /** ISO 3166-1 alpha-2 country code (e.g. "US" / "JP" / "GB").
   *  Identifies the tax jurisdiction the book is kept under so the
   *  Accounting role can give country-aware advice (Japanese T-number
   *  under インボイス制度, EU VAT ID, GSTIN, ABN, etc.). Constrained
   *  to `SupportedCountryCode` (the curated list shared with the UI
   *  dropdown and the LLM tool's JSON-schema enum) so a typo from any
   *  ingress path is rejected at the service layer rather than silently
   *  persisted. Optional for backward compatibility with books created
   *  before the field was introduced; the UI prompts existing books
   *  to set it. */
  country?: SupportedCountryCode;
  /** Which calendar-quarter end is the book's fiscal year end:
   *    Q1 → March 31, Q2 → June 30, Q3 → September 30, Q4 → December 31.
   *  Drives the UI's "current quarter / current year" date-range
   *  shortcuts. Optional in the persisted shape for backward
   *  compatibility with books written before this field existed —
   *  read-side code treats the absent value as Q4 via
   *  `resolveFiscalYearEnd`. New books require it at the create
   *  boundary; the default is Q4. */
  fiscalYearEnd?: FiscalYearEnd;
  createdAt: string;
}

export interface AccountingConfig {
  books: BookSummary[];
}

export type JournalEntryKind = "normal" | "opening" | "void" | "void-marker";

export interface JournalLine {
  accountCode: string;
  /** Use exactly one of debit / credit per line, both as positive
   *  numbers. The engine treats them as separate fields rather than
   *  a single signed amount so the input matches a standard
   *  bookkeeping form. */
  debit?: number;
  credit?: number;
  /** Per-line memo (the entry-level memo lives on JournalEntry). */
  memo?: string;
  /** Counterparty's tax-authority-issued registration ID for this
   *  line — Japanese 適格請求書発行事業者登録番号 (T-number), EU
   *  VAT identification number, UK VAT registration number, India
   *  GSTIN, Australia ABN, etc. Required for input-tax-credit
   *  eligibility under the Japanese インボイス制度 (effective
   *  2023-10-01) and equivalent regimes elsewhere. Free-form string;
   *  format validation belongs upstream (per-jurisdiction). */
  taxRegistrationId?: string;
}

export interface JournalEntry {
  /** Globally unique within a book — ULID-style; ordering by id
   *  reproduces creation order. */
  id: string;
  /** Calendar date the entry is booked for (YYYY-MM-DD). The month
   *  part decides which `journal/YYYY-MM.jsonl` file the entry lives
   *  in; entries can be for any past / future date. */
  date: string;
  kind: JournalEntryKind;
  lines: JournalLine[];
  /** Entry-level memo. */
  memo?: string;
  /** When `kind === "void-marker"`: id of the entry being voided.
   *  When `kind === "void"`: the system-generated reverse entry
   *  references the original via this field. */
  voidedEntryId?: string;
  /** Reason supplied by the user when voiding. */
  voidReason?: string;
  /** When this entry was posted via the "edit" flow (void-then-add),
   *  this is the id of the entry it replaces. The void + new-entry
   *  pair is *not* atomic on the server — the client issues two
   *  sequential calls — but recording the link here makes the
   *  edit chain queryable later (e.g. "what corrected entry X?"). */
  replacesEntryId?: string;
  /** ISO timestamp the entry was appended to the journal — the
   *  authoritative "when did this hit the books" clock. Distinct
   *  from `date`, which is the user-visible booking date. */
  createdAt: string;
}

/** Aggregated balance per account at a point in time. The signed
 *  number is debit − credit; downstream display logic converts to
 *  natural sign per account type (assets debit-positive, liabilities
 *  credit-positive). */
export interface AccountBalance {
  accountCode: string;
  /** Σ debit − Σ credit across all entries up to and including the
   *  snapshot's period end. */
  netDebit: number;
}

export interface MonthSnapshot {
  /** "YYYY-MM" — the closing month covered. */
  period: string;
  /** Closing balances at end of `period`. */
  balances: AccountBalance[];
  /** ISO timestamp the snapshot file was written. */
  builtAt: string;
}

/** Period selector for reports. Either a single closing month or a
 *  date range. Always inclusive on both ends. */
export type ReportPeriod = { kind: "month"; period: string } | { kind: "range"; from: string; to: string };
