// Unit tests for the pure helpers exported by
// `scripts/check-shared-pkg-bumps.mjs`. The git + fs walk that drives the
// CLI itself is end-to-end-tested by running it on every PR, but the
// classification logic (which `package.json` diffs are "ships nothing")
// has historically over-fired — a workspace-wide `@types/node` patch bump
// tripped the guard for 15 packages despite shipping nothing. These tests
// pin the non-shipping exemption so a future regression that re-tightens
// the rule (e.g. someone adds `files` to the exempt set, or drops
// `devDependencies` from it) gets caught here instead of in CI noise on
// every routine devDeps sweep.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as guard from "../../scripts/check-shared-pkg-bumps.mjs";

// Loose handle on the imported shape — the script is plain .mjs without
// types. Declare just what we use here so the rest of the file stays typed.
const { NON_SHIPPING_PKG_JSON_KEYS, packageJsonDiffShipsNothing } = guard as unknown as {
  NON_SHIPPING_PKG_JSON_KEYS: Set<string>;
  packageJsonDiffShipsNothing: (baseJson: Record<string, unknown>, headJson: Record<string, unknown>) => boolean;
};

describe("NON_SHIPPING_PKG_JSON_KEYS", () => {
  it("contains exactly devDependencies, scripts, and version — anything else here is a regression", () => {
    assert.deepEqual([...NON_SHIPPING_PKG_JSON_KEYS].sort(), ["devDependencies", "scripts", "version"]);
  });

  it("does NOT include dependencies (would silently skip a real consumer-facing dep bump)", () => {
    assert.ok(!NON_SHIPPING_PKG_JSON_KEYS.has("dependencies"));
  });

  it("does NOT include peerDependencies / optionalDependencies (same reason)", () => {
    assert.ok(!NON_SHIPPING_PKG_JSON_KEYS.has("peerDependencies"));
    assert.ok(!NON_SHIPPING_PKG_JSON_KEYS.has("optionalDependencies"));
  });

  it("does NOT include exports / main / module / types / files / bin (install-time contract)", () => {
    for (const key of ["exports", "main", "module", "types", "files", "bin"]) {
      assert.ok(!NON_SHIPPING_PKG_JSON_KEYS.has(key), `${key} must NOT be in the exempt set`);
    }
  });
});

describe("packageJsonDiffShipsNothing — exempts non-shipping diffs", () => {
  it("returns true when only a devDependency version differs (the canonical @types/node sweep)", () => {
    const base = {
      name: "@mulmoclaude/scheduler",
      version: "0.1.0",
      devDependencies: { "@types/node": "^26.0.0", tsx: "^4.22.4" },
    };
    const head = {
      name: "@mulmoclaude/scheduler",
      version: "0.1.0",
      devDependencies: { "@types/node": "^26.0.1", tsx: "^4.22.4" },
    };
    assert.equal(packageJsonDiffShipsNothing(base, head), true);
  });

  it("returns true when only `scripts` changed (lint / test wiring)", () => {
    const base = { name: "x", scripts: { test: "echo old" } };
    const head = { name: "x", scripts: { test: "echo new" } };
    assert.equal(packageJsonDiffShipsNothing(base, head), true);
  });

  it("returns true when version + devDependencies both changed (combined sweep + manual bump)", () => {
    const base = { name: "x", version: "0.1.0", devDependencies: { "@types/node": "^26.0.0" } };
    const head = { name: "x", version: "0.1.1", devDependencies: { "@types/node": "^26.0.1" } };
    assert.equal(packageJsonDiffShipsNothing(base, head), true);
  });

  it("returns true for an empty diff (defensive — caller should have filtered, but be safe)", () => {
    const base = { name: "x", version: "0.1.0" };
    const head = { name: "x", version: "0.1.0" };
    assert.equal(packageJsonDiffShipsNothing(base, head), true);
  });
});

describe("packageJsonDiffShipsNothing — requires bump for shipping diffs", () => {
  it("returns false when `dependencies` changed (real consumer-facing dep bump)", () => {
    const base = { name: "x", dependencies: { lodash: "^4.17.0" } };
    const head = { name: "x", dependencies: { lodash: "^4.17.1" } };
    assert.equal(packageJsonDiffShipsNothing(base, head), false);
  });

  it("returns false when `peerDependencies` changed (peer range is part of the contract)", () => {
    const base = { name: "x", peerDependencies: { "gui-chat-protocol": "^0.3.3" } };
    const head = { name: "x", peerDependencies: { "gui-chat-protocol": "^0.4.0" } };
    assert.equal(packageJsonDiffShipsNothing(base, head), false);
  });

  it("returns false when `exports` changed (subpath shape)", () => {
    const base = { name: "x", exports: { ".": "./dist/index.js" } };
    const head = { name: "x", exports: { ".": "./dist/index.js", "./vue": "./dist/vue.js" } };
    assert.equal(packageJsonDiffShipsNothing(base, head), false);
  });

  it("returns false when `files` changed (npm-publish whitelist alters the tarball)", () => {
    const base = { name: "x", files: ["dist/"] };
    const head = { name: "x", files: ["dist/", "client/"] };
    assert.equal(packageJsonDiffShipsNothing(base, head), false);
  });

  it("returns false when `main` / `module` / `types` / `bin` changed (entry-point contract)", () => {
    for (const key of ["main", "module", "types", "bin"]) {
      const base = { name: "x", [key]: "./old" };
      const head = { name: "x", [key]: "./new" };
      assert.equal(packageJsonDiffShipsNothing(base, head), false, `${key} change must require a bump`);
    }
  });

  it("returns false when devDeps changed AND a shipping field also changed (don't let exempt fields mask a real change)", () => {
    const base = {
      name: "x",
      version: "0.1.0",
      devDependencies: { "@types/node": "^26.0.0" },
      dependencies: { lodash: "^4.17.0" },
    };
    const head = {
      name: "x",
      version: "0.1.0",
      devDependencies: { "@types/node": "^26.0.1" },
      dependencies: { lodash: "^4.18.0" }, // dependencies also changed
    };
    assert.equal(packageJsonDiffShipsNothing(base, head), false);
  });

  it("returns false when a brand-new shipping field appears in head (e.g. first-time exports)", () => {
    const base = { name: "x", main: "./dist/index.js" };
    const head = { name: "x", main: "./dist/index.js", exports: { ".": "./dist/index.js" } };
    assert.equal(packageJsonDiffShipsNothing(base, head), false);
  });

  it("returns false when a shipping field disappears in head", () => {
    const base = { name: "x", main: "./dist/index.js", types: "./dist/index.d.ts" };
    const head = { name: "x", main: "./dist/index.js" }; // dropped types
    assert.equal(packageJsonDiffShipsNothing(base, head), false);
  });
});
