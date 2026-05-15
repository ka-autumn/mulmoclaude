// Catalog reader + star helper tests (#1335 PR-B).
//
// `catalog.ts` reads `<workspace>/data/skills/catalog/<source>/<slug>/`
// and copies entries into `<workspace>/.claude/skills/<slug>/` on
// star. Both functions accept an explicit `workspaceRoot` override so
// tests can point at a `mkdtempSync` tree without touching
// `~/mulmoclaude/`.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { isCatalogSource, listCatalogEntries, readCatalogEntryDetail, starCatalogEntry } from "../../../server/workspace/skills/catalog.js";

let workdir: string;
let catalogPresetDir: string;
let activeDir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "catalog-test-"));
  catalogPresetDir = path.join(workdir, "data/skills/catalog/preset");
  activeDir = path.join(workdir, ".claude/skills");
  mkdirSync(catalogPresetDir, { recursive: true });
  mkdirSync(activeDir, { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeCatalogEntry(slug: string, body: string): void {
  const slugDir = path.join(catalogPresetDir, slug);
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(path.join(slugDir, "SKILL.md"), body);
}

describe("isCatalogSource", () => {
  it("accepts the supported source strings", () => {
    assert.equal(isCatalogSource("preset"), true);
    assert.equal(isCatalogSource("external"), true);
  });

  it("rejects unknown sources", () => {
    assert.equal(isCatalogSource("anthropic"), false);
    assert.equal(isCatalogSource("community"), false);
    assert.equal(isCatalogSource(""), false);
    assert.equal(isCatalogSource(123), false);
    assert.equal(isCatalogSource(null), false);
  });
});

describe("listCatalogEntries", () => {
  it("returns [] on an empty catalog", async () => {
    const entries = await listCatalogEntries({ workspaceRoot: workdir });
    assert.deepEqual(entries, []);
  });

  it("returns one entry per valid catalog slug", async () => {
    writeCatalogEntry("mc-foo", "---\ndescription: foo desc\n---\nbody");
    writeCatalogEntry("mc-bar", "---\ndescription: bar desc\n---\nbody");
    const entries = await listCatalogEntries({ workspaceRoot: workdir });
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((entry) => entry.slug),
      ["mc-bar", "mc-foo"], // sorted
    );
    assert.equal(entries[0].source, "preset");
    assert.equal(entries[0].description, "bar desc");
  });

  it("skips entries with missing or malformed SKILL.md", async () => {
    writeCatalogEntry("mc-good", "---\ndescription: ok\n---\nbody");
    // No SKILL.md at all
    mkdirSync(path.join(catalogPresetDir, "mc-empty"));
    // SKILL.md exists but has no frontmatter
    const noFmDir = path.join(catalogPresetDir, "mc-no-fm");
    mkdirSync(noFmDir);
    writeFileSync(path.join(noFmDir, "SKILL.md"), "just text, no frontmatter");
    const entries = await listCatalogEntries({ workspaceRoot: workdir });
    assert.deepEqual(
      entries.map((entry) => entry.slug),
      ["mc-good"],
    );
  });

  it("skips hidden entries", async () => {
    writeCatalogEntry("mc-foo", "---\ndescription: ok\n---\n");
    // .DS_Store, .gitkeep, etc.
    writeFileSync(path.join(catalogPresetDir, ".DS_Store"), "");
    mkdirSync(path.join(catalogPresetDir, ".hidden-dir"));
    const entries = await listCatalogEntries({ workspaceRoot: workdir });
    assert.deepEqual(
      entries.map((entry) => entry.slug),
      ["mc-foo"],
    );
  });

  it("flags alreadyActive when the slug exists under .claude/skills/", async () => {
    writeCatalogEntry("mc-foo", "---\ndescription: ok\n---\n");
    mkdirSync(path.join(activeDir, "mc-foo"));
    const entries = await listCatalogEntries({ workspaceRoot: workdir });
    assert.equal(entries[0].alreadyActive, true);
  });

  it("alreadyActive is false when only the catalog has the entry", async () => {
    writeCatalogEntry("mc-foo", "---\ndescription: ok\n---\n");
    const entries = await listCatalogEntries({ workspaceRoot: workdir });
    assert.equal(entries[0].alreadyActive, false);
  });
});

describe("starCatalogEntry", () => {
  it("copies the catalog slug dir into .claude/skills/", async () => {
    writeCatalogEntry("mc-foo", "---\ndescription: ok\n---\nthe body");
    const result = await starCatalogEntry("preset", "mc-foo", { workspaceRoot: workdir });
    assert.deepEqual(result, { kind: "starred", slug: "mc-foo" });
    const activeSkill = path.join(activeDir, "mc-foo/SKILL.md");
    assert.equal(existsSync(activeSkill), true);
    assert.match(readFileSync(activeSkill, "utf-8"), /the body/);
  });

  it("copies subdirectories too (scripts/ etc.)", async () => {
    const slugDir = path.join(catalogPresetDir, "mc-with-scripts");
    mkdirSync(path.join(slugDir, "scripts"), { recursive: true });
    writeFileSync(path.join(slugDir, "SKILL.md"), "---\ndescription: ok\n---\n");
    writeFileSync(path.join(slugDir, "scripts", "helper.py"), "print('hi')");
    await starCatalogEntry("preset", "mc-with-scripts", { workspaceRoot: workdir });
    assert.equal(existsSync(path.join(activeDir, "mc-with-scripts/scripts/helper.py")), true);
  });

  it("returns already-active when the slug is in .claude/skills/", async () => {
    writeCatalogEntry("mc-foo", "---\ndescription: ok\n---\n");
    mkdirSync(path.join(activeDir, "mc-foo"));
    const result = await starCatalogEntry("preset", "mc-foo", { workspaceRoot: workdir });
    assert.deepEqual(result, { kind: "already-active", slug: "mc-foo" });
  });

  it("returns not-found when the catalog slug doesn't exist", async () => {
    const result = await starCatalogEntry("preset", "mc-missing", { workspaceRoot: workdir });
    assert.deepEqual(result, { kind: "not-found", source: "preset", slug: "mc-missing" });
  });

  it("rejects path-traversal slugs", async () => {
    const result = await starCatalogEntry("preset", "../etc/passwd", { workspaceRoot: workdir });
    assert.equal(result.kind, "invalid-slug");
  });

  it("rejects slugs with path separators", async () => {
    assert.equal((await starCatalogEntry("preset", "foo/bar", { workspaceRoot: workdir })).kind, "invalid-slug");
    assert.equal((await starCatalogEntry("preset", "foo\\bar", { workspaceRoot: workdir })).kind, "invalid-slug");
  });

  it("rejects empty + dot-prefixed slugs", async () => {
    assert.equal((await starCatalogEntry("preset", "", { workspaceRoot: workdir })).kind, "invalid-slug");
    assert.equal((await starCatalogEntry("preset", ".hidden", { workspaceRoot: workdir })).kind, "invalid-slug");
  });
});

describe("readCatalogEntryDetail", () => {
  it("returns description + body for a valid entry", async () => {
    writeCatalogEntry("mc-foo", "---\ndescription: foo desc\n---\nthe markdown body");
    const result = await readCatalogEntryDetail("preset", "mc-foo", { workspaceRoot: workdir });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.detail.slug, "mc-foo");
    assert.equal(result.detail.source, "preset");
    assert.equal(result.detail.description, "foo desc");
    assert.match(result.detail.body, /the markdown body/);
  });

  it("returns not-found when the slug doesn't exist in the catalog", async () => {
    const result = await readCatalogEntryDetail("preset", "mc-missing", { workspaceRoot: workdir });
    assert.deepEqual(result, { kind: "not-found", source: "preset", slug: "mc-missing" });
  });

  it("returns not-found when SKILL.md has no frontmatter", async () => {
    const slugDir = path.join(catalogPresetDir, "mc-bad");
    mkdirSync(slugDir);
    writeFileSync(path.join(slugDir, "SKILL.md"), "no frontmatter, just text");
    const result = await readCatalogEntryDetail("preset", "mc-bad", { workspaceRoot: workdir });
    assert.equal(result.kind, "not-found");
  });

  it("rejects path-traversal slugs", async () => {
    const result = await readCatalogEntryDetail("preset", "../etc/passwd", { workspaceRoot: workdir });
    assert.equal(result.kind, "invalid-slug");
  });

  it("does not require alreadyActive computation (detail is catalog-only)", async () => {
    // Different from `listCatalogEntries` — detail doesn't peek at
    // `.claude/skills/` so it's faster and one fewer fs.stat.
    writeCatalogEntry("mc-foo", "---\ndescription: x\n---\nbody");
    mkdirSync(path.join(activeDir, "mc-foo"));
    const result = await readCatalogEntryDetail("preset", "mc-foo", { workspaceRoot: workdir });
    assert.equal(result.kind, "ok");
    // No `alreadyActive` field on the detail shape (compared to
    // CatalogEntry).
    if (result.kind === "ok") {
      assert.equal("alreadyActive" in result.detail, false);
    }
  });
});
