// Boundary tests for the local-calendar shortcut helpers added to
// src/plugins/accounting/dates.ts. These drive the Balance Sheet's
// Period dropdown (This month / Last month / Last quarter / Last
// year), so a regression here would silently hand the user the
// wrong as-of period.
//
// Pure functions — no Vue / DOM. Each helper accepts an injected
// `now` so we don't depend on the test runner's clock.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { decemberOfPreviousYearString, lastMonthOfPreviousQuarterString, previousMonthString } from "../src/shared/dates.ts";

describe("previousMonthString", () => {
  it("returns the previous calendar month as YYYY-MM", () => {
    assert.equal(previousMonthString(new Date(2026, 4, 15)), "2026-04");
    assert.equal(previousMonthString(new Date(2026, 6, 1)), "2026-06");
    assert.equal(previousMonthString(new Date(2026, 11, 31)), "2026-11");
  });

  it("rolls back to December of last year when current month is January", () => {
    assert.equal(previousMonthString(new Date(2026, 0, 1)), "2025-12");
    assert.equal(previousMonthString(new Date(2026, 0, 31)), "2025-12");
  });
});

describe("lastMonthOfPreviousQuarterString", () => {
  it("Q2 → March of the same year", () => {
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 3, 1)), "2026-03");
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 4, 15)), "2026-03");
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 5, 30)), "2026-03");
  });

  it("Q3 → June of the same year", () => {
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 6, 1)), "2026-06");
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 8, 30)), "2026-06");
  });

  it("Q4 → September of the same year", () => {
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 9, 1)), "2026-09");
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 11, 31)), "2026-09");
  });

  it("Q1 → December of last year", () => {
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 0, 1)), "2025-12");
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 1, 28)), "2025-12");
    assert.equal(lastMonthOfPreviousQuarterString(new Date(2026, 2, 31)), "2025-12");
  });
});

describe("decemberOfPreviousYearString", () => {
  it("returns YYYY-12 for the year before `now`", () => {
    assert.equal(decemberOfPreviousYearString(new Date(2026, 4, 15)), "2025-12");
    assert.equal(decemberOfPreviousYearString(new Date(2026, 0, 1)), "2025-12");
    assert.equal(decemberOfPreviousYearString(new Date(2026, 11, 31)), "2025-12");
  });

  it("crosses the millennium boundary correctly", () => {
    assert.equal(decemberOfPreviousYearString(new Date(2000, 0, 1)), "1999-12");
  });
});
