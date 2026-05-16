// Verifies APP_VERSION resolves to the repo's package.json version.
// The helper reads `../../package.json` relative to its own file
// (server/system/appVersion.ts → repo root in dev), which this test
// re-derives independently so a version bump never needs a test edit.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_VERSION } from "../../server/system/appVersion.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg: unknown = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const expectedVersion = typeof pkg === "object" && pkg !== null && "version" in pkg ? (pkg as { version: string }).version : "";

describe("appVersion APP_VERSION", () => {
  it("equals the repo package.json version", () => {
    assert.equal(APP_VERSION, expectedVersion);
  });

  it("is a non-empty, non-'unknown' string in this layout", () => {
    assert.equal(typeof APP_VERSION, "string");
    assert.ok(APP_VERSION.length > 0);
    assert.notEqual(APP_VERSION, "unknown", "package.json should resolve from the repo root in tests");
  });

  it("looks like a semver", () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+/);
  });
});
