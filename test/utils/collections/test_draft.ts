// Unit tests for the inline-edit pure helpers in
// src/utils/collections/draft.ts (used by the collections table's
// checkbox/dropdown cells). No Vue, no I/O.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildUpdatedRecord, coerceInlineValue } from "../../../src/utils/collections/draft.js";
import type { FieldSpec } from "../../../src/components/collectionTypes.js";

const boolField: FieldSpec = { type: "boolean", label: "Done" };
const enumField: FieldSpec = { type: "enum", label: "Status", values: ["todo", "doing", "done"] };

describe("coerceInlineValue", () => {
  it("coerces a checkbox value to a strict boolean", () => {
    assert.equal(coerceInlineValue(boolField, true), true);
    assert.equal(coerceInlineValue(boolField, false), false);
    // Anything other than a literal `true` is `false`, matching draftToRecord.
    assert.equal(coerceInlineValue(boolField, "on"), false);
  });

  it("passes a non-empty enum selection through unchanged", () => {
    assert.equal(coerceInlineValue(enumField, "doing"), "doing");
  });

  it("treats the empty enum placeholder as a clear (undefined)", () => {
    assert.equal(coerceInlineValue(enumField, ""), undefined);
  });
});

describe("buildUpdatedRecord", () => {
  it("sets the key to the new value without mutating the input", () => {
    const item = { id: "mon", done: false };
    const next = buildUpdatedRecord(item, "done", true);
    assert.deepEqual(next, { id: "mon", done: true });
    assert.notStrictEqual(next, item);
    assert.equal(item.done, false); // original untouched
  });

  it("omits the key when the value is undefined (cleared field)", () => {
    const item = { id: "mon", status: "done" };
    const next = buildUpdatedRecord(item, "status", undefined);
    assert.deepEqual(next, { id: "mon" });
    assert.equal("status" in next, false);
  });

  it("preserves all other keys", () => {
    const item = { id: "mon", status: "todo", note: "yoga", count: 3 };
    const next = buildUpdatedRecord(item, "status", "done");
    assert.deepEqual(next, { id: "mon", status: "done", note: "yoga", count: 3 });
  });
});
