// Invariant guard for the hand-curated external-skill preset list.
// Adding an entry is an editorial act (see presets.ts header) — these
// assertions keep every entry well-formed so a typo can't ship a
// dead "+ Add skill repository" suggestion.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTERNAL_PRESETS } from "../../../../server/workspace/skills/external/presets.js";

describe("EXTERNAL_PRESETS", () => {
  it("has at least the Anthropic + Superpowers entries", () => {
    const urls = EXTERNAL_PRESETS.map((preset) => preset.url);
    assert.ok(urls.includes("https://github.com/anthropics/skills"));
    assert.ok(urls.includes("https://github.com/obra/superpowers"));
  });

  it("every entry is a well-formed public GitHub https repo URL", () => {
    for (const preset of EXTERNAL_PRESETS) {
      assert.match(preset.url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/, `bad url: ${preset.url}`);
    }
  });

  it("every entry has a non-empty displayName and description", () => {
    for (const preset of EXTERNAL_PRESETS) {
      assert.ok(preset.displayName.trim().length > 0, `empty displayName for ${preset.url}`);
      assert.ok(preset.description.trim().length > 0, `empty description for ${preset.url}`);
    }
  });

  it("subpath, when present, is a clean relative path (no leading/trailing slash, no traversal)", () => {
    for (const preset of EXTERNAL_PRESETS) {
      if (preset.subpath === undefined) continue;
      assert.doesNotMatch(preset.subpath, /^\/|\/$|\.\.|\\|\0/, `unsafe subpath: ${preset.subpath}`);
      assert.ok(preset.subpath.length > 0, "subpath, if set, must be non-empty");
    }
  });

  it("URLs are unique (no duplicate suggestions)", () => {
    const urls = EXTERNAL_PRESETS.map((preset) => preset.url);
    assert.equal(new Set(urls).size, urls.length, "duplicate preset URL");
  });
});
