// Realpath-based containment + slug-safety tests for the collections module.
//
// Locks in the symlink-traversal fix from the PR-1483 second review:
// `resolveDataDir` used to do only lexical normalization, so a
// schema could declare `dataPath: "data/clients/items"` while the
// `clients` directory was actually a symlink to `/etc` or anywhere
// outside the workspace. The fix (`isContainedInRoot` realpaths the
// closest existing ancestor) is exercised here against three
// scenarios CodeQL flagged: a symlinked dataPath, a symlinked
// ancestor of dataPath, and a symlinked sibling that does NOT shadow
// the dataPath but lives in the same tree.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isContainedInRoot, safeRecordId, safeSlugName } from "@mulmoclaude/collection-plugin/server";

let rootDir: string;
let outsideDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(path.join(tmpdir(), "apps-paths-root-"));
  outsideDir = mkdtempSync(path.join(tmpdir(), "apps-paths-outside-"));
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

describe("isContainedInRoot", () => {
  it("accepts a real subdirectory of the root", () => {
    const sub = path.join(rootDir, "data", "clients", "items");
    mkdirSync(sub, { recursive: true });
    assert.equal(isContainedInRoot(sub, rootDir), true);
  });

  it("accepts a not-yet-existing subdirectory whose parent is inside the root", () => {
    // Common first-write case: the data dir hasn't been created
    // yet, but its parent (workspace root) is real and contained.
    const sub = path.join(rootDir, "data", "clients", "items");
    assert.equal(isContainedInRoot(sub, rootDir), true);
  });

  it("rejects a directory that IS a symlink pointing outside the root", () => {
    // `<root>/escape` → `<outside>/`. Lexical check would pass
    // because `path.resolve(root, "escape")` stays under root.
    const linkPath = path.join(rootDir, "escape");
    symlinkSync(outsideDir, linkPath);
    assert.equal(isContainedInRoot(linkPath, rootDir), false);
  });

  it("rejects a path whose ancestor is a symlink pointing outside the root", () => {
    // `<root>/data` → `<outside>/data`; then `<root>/data/clients`
    // resolves to `<outside>/data/clients`. The escape happens at
    // the ancestor, not the leaf — the lexical check missed this
    // because it only normalised the textual path.
    const outsideData = path.join(outsideDir, "data");
    mkdirSync(outsideData);
    symlinkSync(outsideData, path.join(rootDir, "data"));
    const escapedLeaf = path.join(rootDir, "data", "clients", "items");
    assert.equal(isContainedInRoot(escapedLeaf, rootDir), false);
  });

  it("rejects an absolute path that lives outside the root entirely", () => {
    assert.equal(isContainedInRoot(outsideDir, rootDir), false);
    assert.equal(isContainedInRoot(path.join(outsideDir, "items"), rootDir), false);
  });

  it("accepts a symlink whose target is itself inside the root", () => {
    // Sibling symlinks within a workspace are common (the catalog
    // sync writes them in some setups). Make sure we don't reject
    // them — only the escape case should fail.
    const insideTarget = path.join(rootDir, "real-data");
    mkdirSync(insideTarget);
    const link = path.join(rootDir, "link-data");
    symlinkSync(insideTarget, link);
    assert.equal(isContainedInRoot(link, rootDir), true);
  });
});

describe("safeSlugName", () => {
  it("accepts normal slugs", () => {
    assert.equal(safeSlugName("acme-corp"), "acme-corp");
    assert.equal(safeSlugName("client42"), "client42");
    assert.equal(safeSlugName("a"), "a");
  });

  it("rejects path separators and traversal", () => {
    assert.equal(safeSlugName("../etc"), null);
    assert.equal(safeSlugName("a/b"), null);
    assert.equal(safeSlugName("a\\b"), null);
    assert.equal(safeSlugName(".."), null);
  });

  it("rejects leading/trailing hyphens and empty input", () => {
    assert.equal(safeSlugName("-leading"), null);
    assert.equal(safeSlugName("trailing-"), null);
    assert.equal(safeSlugName(""), null);
  });

  it("rejects non-string input", () => {
    assert.equal(safeSlugName(null as unknown as string), null);
    assert.equal(safeSlugName(undefined as unknown as string), null);
    assert.equal(safeSlugName(42 as unknown as string), null);
  });
});

describe("safeRecordId", () => {
  it("accepts everything a slug accepts, including repeated -/_", () => {
    assert.equal(safeRecordId("acme-corp"), "acme-corp");
    assert.equal(safeRecordId("client42"), "client42");
    assert.equal(safeRecordId("a--b"), "a--b");
    assert.equal(safeRecordId("a__b"), "a__b");
  });

  it("accepts natural keys with interior dots", () => {
    assert.equal(safeRecordId("1718900000.123456"), "1718900000.123456"); // Slack ts
    assert.equal(safeRecordId("1.2.3"), "1.2.3"); // SemVer
  });

  it("rejects `..`, path separators, and leading/trailing dots", () => {
    assert.equal(safeRecordId("a..b"), null);
    assert.equal(safeRecordId(".."), null);
    assert.equal(safeRecordId(".hidden"), null);
    assert.equal(safeRecordId("trailing."), null);
    assert.equal(safeRecordId("../etc"), null);
    assert.equal(safeRecordId("a/b"), null);
    assert.equal(safeRecordId("a\\b"), null);
  });

  it("rejects non-string and empty input", () => {
    assert.equal(safeRecordId(""), null);
    assert.equal(safeRecordId(null as unknown as string), null);
    assert.equal(safeRecordId(42 as unknown as string), null);
  });
});
