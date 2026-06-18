// Pure edit-draft logic for the collection record form, extracted from
// CollectionView.vue so the parent (build draft / save / validate) and
// the extracted CollectionRecordPanel (per-row table mutators) share one
// implementation. No Vue, no I/O — every function maps a draft + schema
// to a value, so the omission/validation semantics are unit-testable.

import { fieldVisible } from "./actionVisible";
import type { CollectionFieldSpec as FieldSpec, CollectionFieldType as FieldType, CollectionItem, CollectionSchema } from "./schema";
import type { EditState, TableRowDraft } from "./uiTypes";

/** A fresh, empty row draft for a `table` field's sub-schema. */
export function emptyRow(subFields: Record<string, FieldSpec>): TableRowDraft {
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  for (const [subKey, subField] of Object.entries(subFields)) {
    if (subField.type === "boolean") {
      bool[subKey] = false;
      boolOriginallyPresent[subKey] = false; // brand-new row
      boolTouched[subKey] = false;
    } else {
      text[subKey] = "";
    }
  }
  return { text, bool, boolOriginallyPresent, boolTouched };
}

/** Build a row draft from an existing persisted row. */
export function rowFromItem(item: Record<string, unknown>, subFields: Record<string, FieldSpec>): TableRowDraft {
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const boolOriginallyPresent: Record<string, boolean> = {};
  const boolTouched: Record<string, boolean> = {};
  for (const [subKey, subField] of Object.entries(subFields)) {
    const raw = item[subKey];
    if (subField.type === "boolean") {
      bool[subKey] = raw === true;
      // `typeof raw === "boolean"` so an existing explicit `false` is
      // recorded as present and round-trips on a no-op save.
      boolOriginallyPresent[subKey] = typeof raw === "boolean";
      boolTouched[subKey] = false;
    } else {
      text[subKey] = raw === undefined || raw === null ? "" : String(raw);
    }
  }
  return { text, bool, boolOriginallyPresent, boolTouched };
}

/** Decide whether a boolean field's draft value should be emitted (vs.
 *  omitted so a downstream default applies). */
function shouldEmitBoolean(state: EditState, key: string, field: FieldSpec): boolean {
  return Boolean(state.boolOriginallyPresent[key] || state.boolTouched[key] || field.required);
}

/** Convert a scalar draft slot to its persisted form. `undefined` = omit. */
function scalarDraftToValue(raw: string | undefined, fieldType: FieldType): unknown {
  if (raw === undefined || raw === "") return undefined;
  if (fieldType === "number" || fieldType === "money") {
    const num = Number(raw);
    return Number.isFinite(num) ? num : raw;
  }
  return raw;
}

/** Convert one table row draft to its persisted record. */
function rowDraftToRecord(rowDraft: TableRowDraft, subFields: Record<string, FieldSpec>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [subKey, subField] of Object.entries(subFields)) {
    if (subField.type === "boolean") {
      const value = rowDraft.bool[subKey] === true;
      if (rowDraft.boolOriginallyPresent[subKey] || rowDraft.boolTouched[subKey] || value || subField.required) row[subKey] = value;
      continue;
    }
    const value = scalarDraftToValue(rowDraft.text[subKey], subField.type);
    if (value !== undefined) row[subKey] = value;
  }
  return row;
}

/** Convert a full edit draft to the record to persist. */
export function draftToRecord(state: EditState, schema: CollectionSchema): CollectionItem {
  const record: CollectionItem = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type === "derived" || field.type === "embed" || field.type === "toggle") continue; // never persisted (toggle projects an enum field)
    if (field.type === "boolean") {
      if (shouldEmitBoolean(state, key, field)) record[key] = state.bool[key] === true;
      continue;
    }
    if (field.type === "table" && field.of) {
      const subFields = field.of;
      record[key] = (state.table[key] ?? []).map((rowDraft) => rowDraftToRecord(rowDraft, subFields));
      continue;
    }
    const value = scalarDraftToValue(state.text[key], field.type);
    if (value !== undefined) record[key] = value;
  }
  return record;
}

/** Normalise a raw inline-edit input (table-cell checkbox/select) to its
 *  persisted form. Mirrors `draftToRecord`'s boolean strictness; an empty
 *  enum selection (the placeholder option) clears the field via `undefined`. */
export function coerceInlineValue(field: FieldSpec, raw: boolean | string): unknown {
  if (field.type === "boolean") return raw === true;
  return raw === "" ? undefined : raw;
}

/** Build the full record to PUT for a single-cell inline edit, without
 *  mutating `item`. A `undefined` value omits the key (enum cleared),
 *  matching `draftToRecord`'s omission semantics. */
export function buildUpdatedRecord(item: CollectionItem, key: string, value: unknown): CollectionItem {
  if (value === undefined) {
    const { [key]: __omit, ...rest } = item;
    return rest;
  }
  return { ...item, [key]: value };
}

/** Empty for required-field validation — NOT a truthiness check (a
 *  numeric `0` is a filled value). */
function isMissingDraftValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** Label of the first required table sub-field empty in any row, else null. */
function firstMissingTableSubField(field: FieldSpec, rows: TableRowDraft[] | undefined): string | null {
  if (!field.of || !rows) return null;
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    for (const [subKey, subField] of Object.entries(field.of)) {
      if (!subField.required || subField.type === "boolean") continue;
      if (isMissingDraftValue(row.text[subKey])) return `${field.label} #${rowIdx + 1}: ${subField.label}`;
    }
  }
  return null;
}

function validateOneField(key: string, field: FieldSpec, draft: EditState, record: CollectionItem): string | null {
  // A `when`-hidden field has no input the user can fill — never missing.
  if (!fieldVisible(field, record)) return null;
  if (field.type === "table" && field.of) {
    const rows = draft.table[key];
    if (field.required && (!rows || rows.length === 0)) return field.label;
    return firstMissingTableSubField(field, rows);
  }
  if (!field.required) return null;
  if (draft.mode === "create" && field.primary === true) return null; // server auto-generates id
  if (field.type === "boolean" || field.type === "derived" || field.type === "embed" || field.type === "toggle") return null;
  return isMissingDraftValue(draft.text[key]) ? field.label : null;
}

/** Human-readable label of the first missing required field, or null. */
export function firstMissingRequiredField(draft: EditState, schema: CollectionSchema): string | null {
  const record = draftToRecord(draft, schema);
  for (const [key, field] of Object.entries(schema.fields)) {
    const missing = validateOneField(key, field, draft, record);
    if (missing) return missing;
  }
  return null;
}
