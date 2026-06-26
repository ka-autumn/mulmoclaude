import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { AccountingError, addEntries, createBook, getTimeSeriesReport, setOpeningBalances } from "../../src/server/service.js";
// Note: addEntries doesn't require an opening at the service layer
// (the gate is in the UI). setOpeningBalances is only used in the
// `accountBalance` test that needs a non-zero starting balance.
import { _resetRebuildQueueForTesting } from "../../src/server/snapshotCache.js";

const created: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mulmo-acct-ts-"));
  created.push(dir);
  return dir;
}

beforeEach(async () => {
  await _resetRebuildQueueForTesting();
});

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

describe("getTimeSeriesReport — input validation", () => {
  it("rejects unknown metric", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    await assert.rejects(
      () => getTimeSeriesReport({ bookId: book.book.id, metric: "burnRate", granularity: "month", from: "2025-01-01", to: "2025-03-31" }, root),
      AccountingError,
    );
  });

  it("rejects unknown granularity", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    await assert.rejects(
      () => getTimeSeriesReport({ bookId: book.book.id, metric: "revenue", granularity: "weekly", from: "2025-01-01", to: "2025-03-31" }, root),
      AccountingError,
    );
  });

  it("rejects malformed dates", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    await assert.rejects(
      () => getTimeSeriesReport({ bookId: book.book.id, metric: "revenue", granularity: "month", from: "2025-01", to: "2025-03-31" }, root),
      AccountingError,
    );
  });

  it("rejects impossible calendar dates (Feb 30, month 13, day 0)", async () => {
    // Regex-shaped but not real days — without round-trip validation
    // they'd silently normalise into the wrong month and produce
    // malformed bucket boundaries instead of a clean 400.
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    // 0099-01-01 catches the year-drift regression: parseInt-then-
    // build with `Date.UTC(99, 0, 1)` silently yields year 1999, so
    // a regex-only check would accept the input but downstream
    // formatting would emit a non-YYYY year. The journal-side
    // `isValidCalendarDate` round-trips and catches it.
    for (const bad of ["2025-02-30", "2025-13-01", "2025-04-31", "2025-00-15", "2025-01-00", "0099-01-01"]) {
      await assert.rejects(
        () => getTimeSeriesReport({ bookId: book.book.id, metric: "revenue", granularity: "month", from: bad, to: "2025-12-31" }, root),
        AccountingError,
        `should reject from=${bad}`,
      );
    }
  });

  it("rejects from > to", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    await assert.rejects(
      () => getTimeSeriesReport({ bookId: book.book.id, metric: "revenue", granularity: "month", from: "2025-04-01", to: "2025-03-01" }, root),
      AccountingError,
    );
  });

  it("requires accountCode when metric is accountBalance", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    await assert.rejects(
      () => getTimeSeriesReport({ bookId: book.book.id, metric: "accountBalance", granularity: "month", from: "2025-01-01", to: "2025-03-31" }, root),
      AccountingError,
    );
  });

  it("rejects accountCode for non-balance metrics", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    await assert.rejects(
      () =>
        getTimeSeriesReport({ bookId: book.book.id, metric: "revenue", granularity: "month", from: "2025-01-01", to: "2025-03-31", accountCode: "1000" }, root),
      AccountingError,
    );
  });

  it("rejects an unknown accountCode (404)", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "X" }, root);
    await assert.rejects(
      () =>
        getTimeSeriesReport(
          { bookId: book.book.id, metric: "accountBalance", granularity: "month", from: "2025-01-01", to: "2025-01-31", accountCode: "9999" },
          root,
        ),
      AccountingError,
    );
  });
});

describe("getTimeSeriesReport — happy paths", () => {
  it("returns a chart-ready monthly revenue series with continuous buckets", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2025-01-15",
            lines: [
              { accountCode: "1000", debit: 1000 },
              { accountCode: "4000", credit: 1000 },
            ],
          },
          {
            date: "2025-03-10",
            lines: [
              { accountCode: "1000", debit: 500 },
              { accountCode: "4000", credit: 500 },
            ],
          },
        ],
      },
      root,
    );
    const result = await getTimeSeriesReport({ bookId, metric: "revenue", granularity: "month", from: "2025-01-01", to: "2025-03-31" }, root);
    assert.equal(result.metric, "revenue");
    assert.equal(result.granularity, "month");
    assert.equal(result.from, "2025-01-01");
    assert.equal(result.to, "2025-03-31");
    assert.equal(result.accountCode, undefined);
    assert.deepEqual(
      result.points.map((point) => ({ label: point.label, value: point.value })),
      [
        { label: "2025-01", value: 1000 },
        { label: "2025-02", value: 0 },
        { label: "2025-03", value: 500 },
      ],
    );
  });

  it("buckets quarters under a Q1 (March-close) book and labels by FY end year", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "JP", fiscalYearEnd: "Q1" }, root);
    const bookId = book.book.id;
    await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2025-05-15", // FY2026-Q1 (Apr–Jun 2025)
            lines: [
              { accountCode: "1000", debit: 800 },
              { accountCode: "4000", credit: 800 },
            ],
          },
          {
            date: "2025-12-20", // FY2026-Q3 (Oct–Dec 2025)
            lines: [
              { accountCode: "1000", debit: 200 },
              { accountCode: "4000", credit: 200 },
            ],
          },
        ],
      },
      root,
    );
    const result = await getTimeSeriesReport({ bookId, metric: "revenue", granularity: "quarter", from: "2025-04-01", to: "2026-03-31" }, root);
    assert.deepEqual(
      result.points.map((point) => ({ label: point.label, value: point.value })),
      [
        { label: "FY2026-Q1", value: 800 },
        { label: "FY2026-Q2", value: 0 },
        { label: "FY2026-Q3", value: 200 },
        { label: "FY2026-Q4", value: 0 },
      ],
    );
  });

  it("returns a cumulative account balance series including opening balances", async () => {
    const root = makeTmp();
    const book = await createBook({ name: "Test" }, root);
    const bookId = book.book.id;
    await setOpeningBalances(
      {
        bookId,
        asOfDate: "2024-12-31",
        lines: [
          { accountCode: "1000", debit: 5000 },
          { accountCode: "3000", credit: 5000 },
        ],
      },
      root,
    );
    await addEntries(
      {
        bookId,
        entries: [
          {
            date: "2025-02-10",
            lines: [
              { accountCode: "1000", debit: 1500 },
              { accountCode: "4000", credit: 1500 },
            ],
          },
        ],
      },
      root,
    );
    const result = await getTimeSeriesReport(
      {
        bookId,
        metric: "accountBalance",
        granularity: "month",
        from: "2025-01-01",
        to: "2025-03-31",
        accountCode: "1000",
      },
      root,
    );
    assert.equal(result.accountCode, "1000");
    assert.deepEqual(
      result.points.map((point) => point.value),
      [5000, 6500, 6500],
    );
  });
});
