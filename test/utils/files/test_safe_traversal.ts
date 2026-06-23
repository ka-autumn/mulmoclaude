// Unit test for `hasTraversalSegment` after consolidation into safe.ts.
// Sibling of `containsDotfileSegment` but with a stricter policy: only
// the literal `.` and `..` tokens are flagged, not arbitrary dotfiles
// like `.git`. The two coexist on purpose; do not collapse them.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasTraversalSegment, containsDotfileSegment } from "../../../server/utils/files/safe.ts";

describe("hasTraversalSegment", () => {
  it("returns false for a clean path", () => {
    assert.equal(hasTraversalSegment("data/attachments/2026/06/abc.pdf"), false);
    assert.equal(hasTraversalSegment("a/b/c/file.png"), false);
  });

  it("flags a `..` segment at any depth", () => {
    assert.equal(hasTraversalSegment("../escape.txt"), true);
    assert.equal(hasTraversalSegment("a/../b/file.txt"), true);
    assert.equal(hasTraversalSegment("a/b/.."), true);
  });

  it("flags a literal `.` segment", () => {
    assert.equal(hasTraversalSegment("./foo"), true);
    assert.equal(hasTraversalSegment("a/./b/file.txt"), true);
  });

  it("flags `..` after a backslash separator (Windows / encoded `%5C`)", () => {
    assert.equal(hasTraversalSegment("data\\..\\foo.pdf"), true);
    assert.equal(hasTraversalSegment("a/b\\..\\c"), true);
  });

  it("does NOT flag dotfile segments like `.git` or `.hidden`", () => {
    // This is the key behavioural difference vs containsDotfileSegment.
    assert.equal(hasTraversalSegment(".git/config"), false);
    assert.equal(hasTraversalSegment("dir/.hidden.html"), false);
  });

  it("does NOT flag a literal dot inside a filename", () => {
    assert.equal(hasTraversalSegment("foo.bar.txt"), false);
    assert.equal(hasTraversalSegment("a/b/file.tar.gz"), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(hasTraversalSegment(""), false);
  });
});

describe("hasTraversalSegment vs containsDotfileSegment", () => {
  // Quick contrast that both are reachable from safe.ts and the policy
  // distinction is real.
  it(".git is flagged by containsDotfileSegment but NOT hasTraversalSegment", () => {
    assert.equal(containsDotfileSegment(".git/config"), true);
    assert.equal(hasTraversalSegment(".git/config"), false);
  });

  it("`..` is flagged by BOTH", () => {
    assert.equal(containsDotfileSegment("../foo"), true);
    assert.equal(hasTraversalSegment("../foo"), true);
  });
});
