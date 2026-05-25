// Unit tests for isPresetActivation — the helper that decides whether
// the detail pane swaps the destructive "Delete" affordance for the
// non-destructive "Unstar" copy. See src/plugins/manageSkills/View.vue
// and the helper's own file header for the why.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPresetActivation, type PresetCatalogLookup } from "../../../src/plugins/manageSkills/presetDetection.js";

const PRESETS: PresetCatalogLookup[] = [
  { slug: "mc-library", source: "preset" },
  { slug: "mc-worklog", source: "preset" },
];

describe("isPresetActivation", () => {
  it("returns true for a slug present in the preset catalog", () => {
    assert.equal(isPresetActivation("mc-library", PRESETS), true);
  });

  it("returns false for a slug absent from the preset catalog (no false positives by prefix)", () => {
    // A user could hand-author `mc-foo` as a project skill — the writer
    // does not block the namespace. Without a catalog entry, this is
    // NOT a recoverable preset activation, so the helper must return
    // false and the UI must keep the destructive Delete copy.
    assert.equal(isPresetActivation("mc-foo", PRESETS), false);
  });

  it("returns false for a slug whose entry is external (not preset)", () => {
    const mixed: PresetCatalogLookup[] = [
      { slug: "mc-library", source: "preset" },
      { slug: "third-party-thing", source: "external" },
    ];
    assert.equal(isPresetActivation("third-party-thing", mixed), false);
  });

  it("returns false when the catalog is empty (load in flight or failed)", () => {
    assert.equal(isPresetActivation("mc-library", []), false);
  });

  it("returns false for undefined / empty name", () => {
    assert.equal(isPresetActivation(undefined, PRESETS), false);
    assert.equal(isPresetActivation("", PRESETS), false);
  });
});
