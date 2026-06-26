// Account-code numbering convention. The chart of accounts uses
// 4-digit codes whose leading digit identifies the type:
//
//   1xxx → asset
//   2xxx → liability
//   3xxx → equity
//   4xxx → income
//   5xxx → expense
//
// Within those bands, the second digit `4` is reserved for tax-
// related accounts on both sides of the balance sheet:
//
//   14xx → tax-related current assets
//          (1400 Input Tax Receivable / 仮払消費税, plus future
//           withholding-tax-receivable / etc. siblings)
//   24xx → tax-related current liabilities
//          (2400 Sales Tax Payable / 仮受消費税, plus future
//           withholding-tax-payable / etc. siblings)
//
// Special-case UI (Ledger T-number column, JournalEntryForm
// per-line tax-registration ID input) is **input-tax-only** — it
// keys off `isTaxAccountCode`, which matches 14xx (purchase side)
// only. Output-tax / sales-side lines (24xx) intentionally don't
// surface a counterparty registration field: the seller's
// obligation is to put their *own* registration number on the
// invoice they issue, not to capture the customer's. So a custom
// suspense account added in the 14xx band participates without
// any opt-in step; 24xx accounts book the liability without the
// extra column.
//
// Lives in its own module so AccountsModal, AccountEditor, and the
// validation helper can share the same constants without circular
// imports between Vue components.

import type { Account, AccountType } from "../api";

export const ACCOUNT_TYPE_PREFIX: Record<AccountType, number> = {
  asset: 1,
  liability: 2,
  equity: 3,
  income: 4,
  expense: 5,
};

const TAX_ACCOUNT_PREFIXES: readonly string[] = ["14"];

/** Returns `true` for codes whose first two digits identify a
 *  tax-related current asset (`14xx`) — i.e. the input-tax /
 *  purchase side of consumption / sales / VAT bookkeeping. Drives
 *  Ledger column visibility and the JournalEntryForm per-line
 *  tax-registration ID input. Output-tax (24xx) is intentionally
 *  excluded: the counterparty's registration ID is only
 *  load-bearing for input-tax-credit eligibility on purchases. */
export function isTaxAccountCode(code: string): boolean {
  return TAX_ACCOUNT_PREFIXES.some((prefix) => code.startsWith(prefix));
}

const ACCOUNT_CODE_RE = /^\d{4}$/;
const SUGGESTED_GAP = 10;

export function isValidAccountCode(code: string): boolean {
  return ACCOUNT_CODE_RE.test(code);
}

export function typeForCode(code: string): AccountType | null {
  if (!isValidAccountCode(code)) return null;
  const leading = Number.parseInt(code[0], 10);
  for (const [type, prefix] of Object.entries(ACCOUNT_TYPE_PREFIX) as [AccountType, number][]) {
    if (prefix === leading) return type;
  }
  return null;
}

export function codeMatchesType(code: string, type: AccountType): boolean {
  return typeForCode(code) === type;
}

/** Suggest the next free 4-digit code for `type`. Picks max-in-range
 *  + SUGGESTED_GAP so users keep room to insert sibling accounts
 *  later (the standard accounting convention). Falls back to the
 *  prefix base when the range is empty, and to max+1 when +gap would
 *  spill out of the 4-digit prefix window. */
export function suggestNextCode(type: AccountType, accounts: readonly Account[]): string {
  const prefix = ACCOUNT_TYPE_PREFIX[type];
  const inRange: number[] = [];
  for (const account of accounts) {
    if (!isValidAccountCode(account.code)) continue;
    const value = Number.parseInt(account.code, 10);
    if (Math.floor(value / 1000) !== prefix) continue;
    inRange.push(value);
  }
  if (inRange.length === 0) return `${prefix}000`;
  const max = Math.max(...inRange);
  const candidate = max + SUGGESTED_GAP;
  if (Math.floor(candidate / 1000) === prefix && candidate <= 9999) return String(candidate);
  // Range is dense at the top — fall back to a unit step. If even
  // that overflows the prefix window the chart is essentially full
  // for that type; surface the overflow rather than silently
  // suggesting a code in the next type's range.
  const fallback = max + 1;
  if (Math.floor(fallback / 1000) === prefix && fallback <= 9999) return String(fallback);
  return `${prefix}999`;
}
