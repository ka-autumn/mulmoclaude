// Pure validation for the AccountsModal editor draft. Lives in its
// own module so unit tests can exercise the boundary cases (reserved
// `_` prefix, duplicate code, empty fields) without spinning up Vue
// or i18n. The component maps the returned error code to a
// localized message.
//
// The `_`-prefix rule mirrors the server's check in
// server/accounting/service.ts:upsertAccount — codes starting with
// `_` are reserved for synthetic report rows. Catching it client-
// side avoids a round-trip and surfaces the localized message
// instead of the raw server error.

import type { Account } from "../api";
import type { AccountDraft } from "./accountDraft";
import { codeMatchesType, isValidAccountCode } from "./accountNumbering";

export const RESERVED_PREFIX = "_";

export type CodeValidationError = "emptyCode" | "reservedCode" | "invalidCodeFormat" | "codeTypeMismatch" | "duplicateCode";
export type NameValidationError = "emptyName" | "duplicateName";
export type AccountValidationError = CodeValidationError | NameValidationError;

/**
 * Validate just the code field. Split out from the full draft
 * validator so AccountEditor can paint a per-field red border in
 * realtime without re-running the name check on every keystroke.
 */
export function validateCodeField(draft: AccountDraft, existing: readonly Account[], isNew: boolean): CodeValidationError | null {
  const trimmedCode = draft.code.trim();
  if (trimmedCode.length === 0) return "emptyCode";
  if (trimmedCode.startsWith(RESERVED_PREFIX)) return "reservedCode";
  // 4-digit numbering is enforced for new accounts only: pre-existing
  // books may already hold legacy codes the user added before the
  // rule landed, and changing the code would orphan their journal
  // lines (codes are immutable once created — see codeReadOnlyHint).
  if (isNew && !isValidAccountCode(trimmedCode)) return "invalidCodeFormat";
  if (isNew && !codeMatchesType(trimmedCode, draft.type)) return "codeTypeMismatch";
  if (isNew && existing.some((account) => account.code === trimmedCode)) return "duplicateCode";
  return null;
}

/**
 * Validate just the name field. Empty + duplicate (case-insensitive,
 * trimmed) against other accounts. On edit, the account being edited
 * is excluded from the duplicate check via `draft.code` — otherwise
 * every save would flag the user's own row as a collision.
 */
export function validateNameField(draft: AccountDraft, existing: readonly Account[], isNew: boolean): NameValidationError | null {
  const trimmedName = draft.name.trim();
  if (trimmedName.length === 0) return "emptyName";
  const folded = trimmedName.toLowerCase();
  const collides = existing.some((account) => {
    if (!isNew && account.code === draft.code.trim()) return false;
    return account.name.trim().toLowerCase() === folded;
  });
  if (collides) return "duplicateName";
  return null;
}

/**
 * Validate a draft about to be sent to `upsertAccount`. Returns
 * `null` on success or an error code on failure. Caller maps the
 * code to a localized message.
 *
 * `existing` is the current chart of accounts — used to detect a
 * duplicate code on a brand-new entry (otherwise the server would
 * silently overwrite the existing account, which is rarely what
 * the user typing into the "Add account" form intended).
 *
 * Code errors take precedence over name errors so the user fixes
 * one stable issue at a time as they type.
 */
export function validateAccountDraft(draft: AccountDraft, existing: readonly Account[], isNew: boolean): AccountValidationError | null {
  return validateCodeField(draft, existing, isNew) ?? validateNameField(draft, existing, isNew);
}
