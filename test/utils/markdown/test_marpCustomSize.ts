import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCustomMarpSize } from "../../../src/utils/markdown/marpCustomSize.js";

interface FakeThemeSet {
  add: (css: string) => void;
  calls: string[];
}

function makeFakeMarp(): { themeSet: FakeThemeSet } {
  const calls: string[] = [];
  return {
    themeSet: {
      add: (css: string) => calls.push(css),
      calls,
    },
  };
}

describe("applyCustomMarpSize — pass-through cases", () => {
  it("returns the input unchanged when there is no frontmatter", () => {
    const marp = makeFakeMarp();
    const source = "# heading\n\nbody";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("passes through size: 16:9 (Marp handles natively)", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 16:9\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("passes through size: 4:3", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 4:3\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("passes through when no size directive present", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\ntheme: gaia\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("passes through unrecognised non-numeric values", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: jumbotron\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });
});

describe("applyCustomMarpSize — numeric WxH", () => {
  it("registers a composite theme and rewrites frontmatter for `1080x1920`", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 1080x1920\n---\n# slide";
    const out = applyCustomMarpSize(marp, source);
    assert.equal(marp.themeSet.calls.length, 1);
    assert.match(marp.themeSet.calls[0], /@theme mc_size_default_1080x1920/);
    assert.match(marp.themeSet.calls[0], /section \{ width: 1080px; height: 1920px;/);
    assert.match(out, /theme: mc_size_default_1080x1920/);
    assert.doesNotMatch(out, /^size:/m);
  });

  it("accepts uppercase 'X' separator", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 1920X1080\n---\n# x";
    const out = applyCustomMarpSize(marp, source);
    assert.equal(marp.themeSet.calls.length, 1);
    assert.match(out, /mc_size_default_1920x1080/);
  });

  it("composes on top of the user's chosen theme", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\ntheme: gaia\nsize: 1080x1920\n---\n# x";
    const out = applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /@import "gaia"/);
    assert.match(out, /theme: mc_size_gaia_1080x1920/);
  });

  it("rejects implausibly small or non-numeric shapes", () => {
    const marp = makeFakeMarp();
    for (const bad of ["5x10", "10x10", "axb", "1080x", "x1920", "0x0"]) {
      const source = `---\nmarp: true\nsize: ${bad}\n---\n# x`;
      assert.equal(applyCustomMarpSize(marp, source), source, `should pass through size: ${bad}`);
    }
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("is idempotent — re-applying with an already-generated theme name is a no-op", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\ntheme: mc_size_default_1080x1920\nsize: 1080x1920\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });
});

describe("applyCustomMarpSize — aspect-ratio presets", () => {
  it("maps `9:16` to 1080x1920 portrait", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 9:16\n---\n# x";
    const out = applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /width: 1080px; height: 1920px/);
    assert.match(out, /theme: mc_size_default_1080x1920/);
  });

  it("maps `16:10` to 1280x800", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 16:10\n---\n# x";
    const out = applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /width: 1280px; height: 800px/);
    assert.match(out, /theme: mc_size_default_1280x800/);
  });

  it("maps `1:1` to 1080x1080 square", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 1:1\n---\n# x";
    applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /width: 1080px; height: 1080px/);
  });
});

describe("applyCustomMarpSize — body preservation", () => {
  it("preserves the body verbatim, including embedded slide separators", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 9:16\n---\n# Slide 1\n\nbody1\n\n---\n\n# Slide 2\n\nbody2\n";
    const out = applyCustomMarpSize(marp, source);
    assert.ok(out.includes("# Slide 1\n\nbody1\n\n---\n\n# Slide 2\n\nbody2\n"), "body should be preserved after the rewritten frontmatter");
  });
});
