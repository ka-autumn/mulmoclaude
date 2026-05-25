// Unit tests for the tiny derived-formula evaluator
// (src/utils/collections/derivedFormula.ts). The evaluator is a
// pure module specifically so the parser/eval quirks are pinned
// here, independently from any Vue rendering layer.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateDerived } from "../../../src/utils/collections/derivedFormula.js";

describe("evaluateDerived — literals + arithmetic", () => {
  it("returns a bare number literal", () => {
    assert.equal(evaluateDerived("42", { record: {} }), 42);
    assert.equal(evaluateDerived("0", { record: {} }), 0);
    assert.equal(evaluateDerived("1.5", { record: {} }), 1.5);
    assert.equal(evaluateDerived(".25", { record: {} }), 0.25);
  });

  it("respects standard arithmetic precedence", () => {
    assert.equal(evaluateDerived("1 + 2 * 3", { record: {} }), 7);
    assert.equal(evaluateDerived("(1 + 2) * 3", { record: {} }), 9);
    assert.equal(evaluateDerived("10 - 4 - 2", { record: {} }), 4); // left-associative
    assert.equal(evaluateDerived("100 / 4 / 5", { record: {} }), 5);
    assert.equal(evaluateDerived("2 + 3 * 4 - 1", { record: {} }), 13);
  });

  it("handles parens nested deeply", () => {
    assert.equal(evaluateDerived("((1 + 2) * (3 + 4))", { record: {} }), 21);
  });
});

describe("evaluateDerived — identifiers", () => {
  it("resolves a top-level field by name", () => {
    assert.equal(evaluateDerived("subtotal", { record: { subtotal: 100 } }), 100);
    assert.equal(evaluateDerived("subtotal + tax", { record: { subtotal: 100, tax: 10 } }), 110);
  });

  it("coerces numeric strings to numbers", () => {
    assert.equal(evaluateDerived("rate", { record: { rate: "12.5" } }), 12.5);
  });

  it("returns null when a referenced field is missing", () => {
    assert.equal(evaluateDerived("subtotal", { record: {} }), null);
  });

  it("returns null when a referenced field is non-numeric", () => {
    assert.equal(evaluateDerived("subtotal", { record: { subtotal: "abc" } }), null);
    assert.equal(evaluateDerived("subtotal", { record: { subtotal: true } }), null);
  });
});

describe("evaluateDerived — sum()", () => {
  const lineItems = [
    { quantity: 10, rate: 100 },
    { quantity: 2, rate: 250 },
    { quantity: 5, rate: 50 },
  ];

  it("sums a single column", () => {
    const record = { lineItems: [{ amount: 100 }, { amount: 250 }, { amount: 50 }] };
    assert.equal(evaluateDerived("sum(lineItems[].amount)", { record }), 400);
  });

  it("sums the product of two columns", () => {
    // 10*100 + 2*250 + 5*50 = 1000 + 500 + 250 = 1750
    assert.equal(evaluateDerived("sum(lineItems[].quantity * lineItems[].rate)", { record: { lineItems } }), 1750);
  });

  it("returns 0 when the table is missing or empty", () => {
    assert.equal(evaluateDerived("sum(lineItems[].amount)", { record: {} }), 0);
    assert.equal(evaluateDerived("sum(lineItems[].amount)", { record: { lineItems: [] } }), 0);
  });

  it("integrates with surrounding arithmetic (subtotal-tax-total pattern)", () => {
    const record = { lineItems, taxRate: 0.1 };
    // subtotal = 1750
    assert.equal(evaluateDerived("sum(lineItems[].quantity * lineItems[].rate)", { record }), 1750);
    // tax = subtotal * taxRate, computed against the post-subtotal context
    assert.equal(evaluateDerived("subtotal * taxRate", { record: { subtotal: 1750, taxRate: 0.1 } }), 175);
    // total = subtotal + tax
    assert.equal(evaluateDerived("subtotal + tax", { record: { subtotal: 1750, tax: 175 } }), 1925);
  });

  it("returns null when a column value is non-numeric inside sum", () => {
    const record = { lineItems: [{ quantity: 10, rate: "bad" }] };
    assert.equal(evaluateDerived("sum(lineItems[].quantity * lineItems[].rate)", { record }), null);
  });

  it("rejects mismatched tables inside one sum (would be ambiguous)", () => {
    const record = { foo: [{ x: 1 }], bar: [{ y: 1 }] };
    assert.equal(evaluateDerived("sum(foo[].x * bar[].y)", { record }), null);
  });
});

describe("evaluateDerived — error handling", () => {
  it("returns null on parse error (unexpected char)", () => {
    assert.equal(evaluateDerived("1 + @ + 2", { record: {} }), null);
  });

  it("returns null on parse error (trailing junk)", () => {
    assert.equal(evaluateDerived("1 + 2 garbage", { record: {} }), null);
  });

  it("returns null on parse error (mismatched parens)", () => {
    assert.equal(evaluateDerived("(1 + 2", { record: {} }), null);
    assert.equal(evaluateDerived("1 + 2)", { record: {} }), null);
  });

  it("returns null on divide by zero", () => {
    assert.equal(evaluateDerived("10 / 0", { record: {} }), null);
  });

  it("returns null on division by missing field", () => {
    assert.equal(evaluateDerived("10 / divisor", { record: { divisor: 0 } }), null);
  });

  it("returns null when sum() argument shape is wrong", () => {
    assert.equal(evaluateDerived("sum(lineItems)", { record: { lineItems: [] } }), null);
    assert.equal(evaluateDerived("sum()", { record: {} }), null);
  });

  it("rejects unsupported function calls", () => {
    assert.equal(evaluateDerived("avg(lineItems[].amount)", { record: {} }), null);
  });

  it("rejects string concatenation / boolean operators / comparisons", () => {
    assert.equal(evaluateDerived("1 == 1", { record: {} }), null);
    assert.equal(evaluateDerived("a && b", { record: { a: 1, b: 2 } }), null);
  });
});
