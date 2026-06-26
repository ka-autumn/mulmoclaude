import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAmountNumeric, formatAmount, fractionDigitsFor } from "../src/shared/currencies.ts";

// Pin locale on every assertion so host-default locale variations
// (CI vs. dev machine, de-DE vs. en-US) cannot turn into flakes.
// `.toLocaleString` honours the locale arg even when the host default
// is something else — that's exactly the contract this suite verifies.

describe("formatAmountNumeric", () => {
  it("renders 2 decimals by default", () => {
    assert.equal(formatAmountNumeric(1234.5, 2, "en-US"), "1,234.50");
  });

  it("accepts 0 decimals for integer-only currencies", () => {
    // de-DE uses `.` as thousands separator — a regex like `/\.\d/`
    // would false-match here even though there is no fractional part.
    // Pin both locales and compare exact output instead. (Codex review
    // on #1318.)
    assert.equal(formatAmountNumeric(1234, 0, "en-US"), "1,234");
    assert.equal(formatAmountNumeric(1234, 0, "de-DE"), "1.234");
  });

  it("preserves the minus sign on negative amounts", () => {
    // Asserting `/99/` alone would silently pass if the sign were
    // dropped (Codex review on #1318) — pin a locale + check the
    // full string so a sign regression fails the test.
    assert.equal(formatAmountNumeric(-99.99, 2, "en-US"), "-99.99");
  });

  it("handles zero", () => {
    assert.equal(formatAmountNumeric(0, 2, "en-US"), "0.00");
  });

  it("respects an explicit locale when provided", () => {
    // en-US uses comma as the thousands separator + period as the
    // decimal mark; de-DE swaps them. The host's default locale must
    // NOT bleed into a caller-pinned locale.
    assert.equal(formatAmountNumeric(1234.5, 2, "en-US"), "1,234.50");
    assert.equal(formatAmountNumeric(1234.5, 2, "de-DE"), "1.234,50");
  });
});

describe("formatAmount currency awareness", () => {
  it("returns a non-empty string for valid currency", () => {
    const out = formatAmount(1130, "USD", "en-US");
    assert.equal(typeof out, "string");
    assert.ok(out.length > 0);
  });

  it("renders JPY with 0 decimals on the happy path", () => {
    // The previous version of this test claimed it exercised the
    // `catch` fallback inside formatAmount, but JPY is a valid Intl
    // currency code so the try path always succeeds (Codex review
    // on #1318). Renamed + pinned to en-US so the assertion is
    // robust regardless of host locale. Fallback-path coverage is
    // intentionally out of scope: the catch arm is defensive code
    // for partial-Intl runtimes that this codebase never targets.
    assert.equal(formatAmount(1130, "JPY", "en-US"), "¥1,130");
  });

  it("fractionDigitsFor returns 0 for JPY, 2 for USD", () => {
    assert.equal(fractionDigitsFor("JPY"), 0);
    assert.equal(fractionDigitsFor("USD"), 2);
  });
});
