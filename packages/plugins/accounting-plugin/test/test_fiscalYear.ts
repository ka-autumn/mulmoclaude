// Boundary tests for the fiscal-year arithmetic in
// src/plugins/accounting/fiscalYear.ts. Pure functions — no Vue / DOM.
// Drives every "current quarter / current year" date-range shortcut
// in the UI; a regression here would silently misroute the Ledger
// and Accounts views.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  currentFiscalYearRange,
  currentQuarterRange,
  fiscalYearEndMonth,
  isFiscalYearEnd,
  previousFiscalYearRange,
  previousQuarterRange,
  resolveFiscalYearEnd,
} from "../src/shared/fiscalYear.ts";

describe("fiscalYearEndMonth", () => {
  it("maps each Q to the correct calendar month", () => {
    assert.equal(fiscalYearEndMonth("Q1"), 3);
    assert.equal(fiscalYearEndMonth("Q2"), 6);
    assert.equal(fiscalYearEndMonth("Q3"), 9);
    assert.equal(fiscalYearEndMonth("Q4"), 12);
  });
});

describe("isFiscalYearEnd", () => {
  it("accepts only Q1..Q4", () => {
    for (const value of ["Q1", "Q2", "Q3", "Q4"]) assert.equal(isFiscalYearEnd(value), true);
    for (const value of ["", "q1", "Q5", null, undefined, 1]) assert.equal(isFiscalYearEnd(value), false);
  });
});

describe("resolveFiscalYearEnd", () => {
  it("defaults absent to Q4 (calendar year)", () => {
    assert.equal(resolveFiscalYearEnd(undefined), "Q4");
    assert.equal(resolveFiscalYearEnd("Q1"), "Q1");
    assert.equal(resolveFiscalYearEnd("Q3"), "Q3");
  });
});

describe("currentQuarterRange — Q4 (calendar year) book", () => {
  it("May resolves to Apr–Jun", () => {
    const rng = currentQuarterRange("Q4", new Date(2026, 4, 3)); // May 3 2026
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
  it("January resolves to Jan–Mar", () => {
    const rng = currentQuarterRange("Q4", new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Mar 31 still resolves to Q1 (boundary)", () => {
    const rng = currentQuarterRange("Q4", new Date(2026, 2, 31));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Apr 1 flips to Q2 (boundary)", () => {
    const rng = currentQuarterRange("Q4", new Date(2026, 3, 1));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
  it("Dec 31 resolves to Q4", () => {
    const rng = currentQuarterRange("Q4", new Date(2026, 11, 31));
    assert.deepEqual(rng, { from: "2026-10-01", to: "2026-12-31" });
  });
});

describe("currentQuarterRange — Q1 (FY ends Mar 31) book", () => {
  it("May (FQ1, Apr–Jun)", () => {
    const rng = currentQuarterRange("Q1", new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
  it("Jan (FQ4, closing Jan–Mar)", () => {
    const rng = currentQuarterRange("Q1", new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Mar 31 still in FQ4 (boundary)", () => {
    const rng = currentQuarterRange("Q1", new Date(2026, 2, 31));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Apr 1 starts the new fiscal year (boundary)", () => {
    const rng = currentQuarterRange("Q1", new Date(2026, 3, 1));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
});

describe("currentQuarterRange — Q2 (FY ends Jun 30) book", () => {
  it("July starts FQ1 of the next FY (Jul–Sep)", () => {
    const rng = currentQuarterRange("Q2", new Date(2026, 6, 1));
    assert.deepEqual(rng, { from: "2026-07-01", to: "2026-09-30" });
  });
  it("January falls in FQ3 (Jan–Mar)", () => {
    const rng = currentQuarterRange("Q2", new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("June 30 closes the fiscal year (boundary)", () => {
    const rng = currentQuarterRange("Q2", new Date(2026, 5, 30));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2026-06-30" });
  });
});

describe("previousQuarterRange", () => {
  it("Q4 in May returns Jan–Mar", () => {
    const rng = previousQuarterRange("Q4", new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
  it("Q4 in January wraps to prior-year Oct–Dec", () => {
    const rng = previousQuarterRange("Q4", new Date(2026, 0, 15));
    assert.deepEqual(rng, { from: "2025-10-01", to: "2025-12-31" });
  });
  it("Q1 in April wraps to prior FY's closing Jan–Mar", () => {
    const rng = previousQuarterRange("Q1", new Date(2026, 3, 5));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-03-31" });
  });
});

describe("currentFiscalYearRange", () => {
  it("Q4 covers Jan 1 → Dec 31 of today's calendar year", () => {
    const rng = currentFiscalYearRange("Q4", new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2026-01-01", to: "2026-12-31" });
  });
  it("Q1 covers Apr 1 → Mar 31 of the FY that contains today", () => {
    const rng = currentFiscalYearRange("Q1", new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2026-04-01", to: "2027-03-31" });
  });
  it("Q1 in February covers the FY ending in March of today's year", () => {
    const rng = currentFiscalYearRange("Q1", new Date(2026, 1, 15));
    assert.deepEqual(rng, { from: "2025-04-01", to: "2026-03-31" });
  });
  it("Q2 covers Jul 1 → Jun 30 spanning two calendar years", () => {
    const rng = currentFiscalYearRange("Q2", new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2025-07-01", to: "2026-06-30" });
  });
});

describe("previousFiscalYearRange", () => {
  it("Q4 returns the prior calendar year", () => {
    const rng = previousFiscalYearRange("Q4", new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2025-01-01", to: "2025-12-31" });
  });
  it("Q1 in May 2026 returns Apr 2025 → Mar 2026", () => {
    const rng = previousFiscalYearRange("Q1", new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2025-04-01", to: "2026-03-31" });
  });
  it("Q2 in May 2026 returns Jul 2024 → Jun 2025", () => {
    const rng = previousFiscalYearRange("Q2", new Date(2026, 4, 3));
    assert.deepEqual(rng, { from: "2024-07-01", to: "2025-06-30" });
  });
});
