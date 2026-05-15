// Read + star tests for the external-skill catalog (#1383 / #1335
// PR-C C1). Filesystem layout is set up by hand (no git stub
// involved) since these functions only ever read the catalog dir +
// `.source.json` — install.ts is what writes it.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { listExternalCatalogEntries, readExternalCatalogDetail, starExternalCatalogEntry } from "../../../../server/workspace/skills/external/catalog.js";

let workdir: string;
const FAKE_SHA = "a".repeat(40);

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "ext-catalog-test-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function seedRepo(repoId: string, url: string, layout: Record<string, string>): void {
  const repoDir = path.join(workdir, "data/skills/catalog/external", repoId);
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(path.join(repoDir, ".source.json"), JSON.stringify({ url, sha: FAKE_SHA, installedAt: "2026-01-01T00:00:00Z" }));
  for (const [relPath, body] of Object.entries(layout)) {
    const full = path.join(repoDir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
}

describe("listExternalCatalogEntries", () => {
  it("returns [] on an empty catalog", async () => {
    const entries = await listExternalCatalogEntries({ workspaceRoot: workdir });
    assert.deepEqual(entries, []);
  });

  it("returns one entry per skill folder for a multi-skill repo", async () => {
    seedRepo("anthropics-skills", "https://github.com/anthropics/skills", {
      "pdf-form-filler/SKILL.md": "---\ndescription: fill PDFs\n---\nbody",
      "excel-builder/SKILL.md": "---\ndescription: build excel\n---\nbody",
    });
    const entries = await listExternalCatalogEntries({ workspaceRoot: workdir });
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.activeId).sort(), ["anthropics-excel-builder", "anthropics-pdf-form-filler"]);
    assert.equal(entries[0].repoId, "anthropics-skills");
    assert.equal(entries[0].repoUrl, "https://github.com/anthropics/skills");
  });

  it("returns one entry with skillFolder='.' for a single-skill-at-root repo", async () => {
    seedRepo("foo-cool", "https://github.com/foo/cool", {
      "SKILL.md": "---\ndescription: cool\n---\nbody",
    });
    const entries = await listExternalCatalogEntries({ workspaceRoot: workdir });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].skillFolder, ".");
    assert.equal(entries[0].activeId, "foo-cool");
  });

  it("flags alreadyActive when .claude/skills/<activeId>/ exists", async () => {
    seedRepo("foo-cool", "https://github.com/foo/cool", {
      "SKILL.md": "---\ndescription: cool\n---\nbody",
    });
    mkdirSync(path.join(workdir, ".claude/skills/foo-cool"), { recursive: true });
    const entries = await listExternalCatalogEntries({ workspaceRoot: workdir });
    assert.equal(entries[0].alreadyActive, true);
  });

  it("skips repos whose metadata is missing the url", async () => {
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-bar");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, ".source.json"), JSON.stringify({ sha: FAKE_SHA, installedAt: "x" }));
    writeFileSync(path.join(repoDir, "SKILL.md"), "---\ndescription: orphan\n---\n");
    const entries = await listExternalCatalogEntries({ workspaceRoot: workdir });
    assert.deepEqual(entries, []);
  });

  it("skips skill folders with unsafe names", async () => {
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-bar");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, ".source.json"), JSON.stringify({ url: "https://github.com/foo/bar", sha: FAKE_SHA, installedAt: "x" }));
    // ".bad" starts with a dot — should be skipped via the hidden-entry filter.
    mkdirSync(path.join(repoDir, ".bad"));
    writeFileSync(path.join(repoDir, ".bad", "SKILL.md"), "---\ndescription: bad\n---\n");
    // "ok-skill" should be picked up.
    mkdirSync(path.join(repoDir, "ok-skill"));
    writeFileSync(path.join(repoDir, "ok-skill", "SKILL.md"), "---\ndescription: ok\n---\n");
    const entries = await listExternalCatalogEntries({ workspaceRoot: workdir });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].skillFolder, "ok-skill");
  });
});

describe("readExternalCatalogDetail", () => {
  beforeEach(() => {
    seedRepo("anthropics-skills", "https://github.com/anthropics/skills", {
      "pdf-form-filler/SKILL.md": "---\ndescription: fill PDFs\n---\nstep one\nstep two",
    });
  });

  it("returns description + body for a known entry", async () => {
    const result = await readExternalCatalogDetail("anthropics-skills", "pdf-form-filler", { workspaceRoot: workdir });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.detail.activeId, "anthropics-pdf-form-filler");
    assert.equal(result.detail.description, "fill PDFs");
    assert.match(result.detail.body, /step one/);
  });

  it("returns not-found for an unknown skillFolder", async () => {
    const result = await readExternalCatalogDetail("anthropics-skills", "missing-skill", { workspaceRoot: workdir });
    assert.equal(result.kind, "not-found");
  });

  it("returns invalid-id for an unsafe repoId", async () => {
    const result = await readExternalCatalogDetail("../etc", "any", { workspaceRoot: workdir });
    assert.equal(result.kind, "invalid-id");
  });

  it("returns invalid-id for an unsafe skillFolder", async () => {
    const result = await readExternalCatalogDetail("anthropics-skills", "../etc", { workspaceRoot: workdir });
    assert.equal(result.kind, "invalid-id");
  });

  it("handles single-skill-at-root via skillFolder='.'", async () => {
    seedRepo("foo-cool", "https://github.com/foo/cool", {
      "SKILL.md": "---\ndescription: root skill\n---\nbody here",
    });
    const result = await readExternalCatalogDetail("foo-cool", ".", { workspaceRoot: workdir });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.detail.activeId, "foo-cool");
    assert.equal(result.detail.description, "root skill");
  });
});

describe("starExternalCatalogEntry", () => {
  beforeEach(() => {
    seedRepo("anthropics-skills", "https://github.com/anthropics/skills", {
      "pdf-form-filler/SKILL.md": "---\ndescription: fill PDFs\n---\nbody",
      "pdf-form-filler/helper.py": "print('helper')",
    });
  });

  it("copies the skill folder into .claude/skills/<activeId>/", async () => {
    const result = await starExternalCatalogEntry("anthropics-skills", "pdf-form-filler", { workspaceRoot: workdir });
    assert.equal(result.kind, "starred");
    if (result.kind !== "starred") return;
    assert.equal(result.activeId, "anthropics-pdf-form-filler");
    const activeDir = path.join(workdir, ".claude/skills/anthropics-pdf-form-filler");
    assert.equal(existsSync(path.join(activeDir, "SKILL.md")), true);
    assert.equal(existsSync(path.join(activeDir, "helper.py")), true);
  });

  it("returns already-active when the target dir exists", async () => {
    mkdirSync(path.join(workdir, ".claude/skills/anthropics-pdf-form-filler"), { recursive: true });
    const result = await starExternalCatalogEntry("anthropics-skills", "pdf-form-filler", { workspaceRoot: workdir });
    assert.equal(result.kind, "already-active");
  });

  it("returns not-found when the skillFolder is missing on disk", async () => {
    const result = await starExternalCatalogEntry("anthropics-skills", "missing-skill", { workspaceRoot: workdir });
    assert.equal(result.kind, "not-found");
  });

  it("returns invalid-id on path-traversal repoId", async () => {
    const result = await starExternalCatalogEntry("../etc", "any", { workspaceRoot: workdir });
    assert.equal(result.kind, "invalid-id");
  });

  it("returns invalid-id on path-traversal skillFolder", async () => {
    const result = await starExternalCatalogEntry("anthropics-skills", "../escape", { workspaceRoot: workdir });
    assert.equal(result.kind, "invalid-id");
  });

  it("stars a single-skill-at-root repo using its repo-derived activeId", async () => {
    seedRepo("foo-cool", "https://github.com/foo/cool", {
      "SKILL.md": "---\ndescription: cool\n---\nbody",
    });
    const result = await starExternalCatalogEntry("foo-cool", ".", { workspaceRoot: workdir });
    assert.equal(result.kind, "starred");
    if (result.kind !== "starred") return;
    assert.equal(result.activeId, "foo-cool");
    assert.equal(existsSync(path.join(workdir, ".claude/skills/foo-cool/SKILL.md")), true);
  });

  it("does NOT copy the .source.json sentinel into the active dir", async () => {
    await starExternalCatalogEntry("anthropics-skills", "pdf-form-filler", { workspaceRoot: workdir });
    const activeDir = path.join(workdir, ".claude/skills/anthropics-pdf-form-filler");
    assert.equal(existsSync(path.join(activeDir, ".source.json")), false);
  });

  it("a dotted skill folder (e.g. v1.2) is listable, previewable, and star-able", async () => {
    // Regression for the install/read divergence: install discovery
    // accepts dotted folder names, so the read+star side must too.
    seedRepo("foo-versioned", "https://github.com/foo/versioned", {
      "v1.2/SKILL.md": "---\ndescription: versioned skill\n---\nbody",
    });
    const entries = await listExternalCatalogEntries({ workspaceRoot: workdir });
    const dotted = entries.find((entry) => entry.repoId === "foo-versioned");
    assert.ok(dotted, "dotted folder must appear in the catalog listing");
    assert.equal(dotted.skillFolder, "v1.2");

    const detail = await readExternalCatalogDetail("foo-versioned", "v1.2", { workspaceRoot: workdir });
    assert.equal(detail.kind, "ok");

    const starred = await starExternalCatalogEntry("foo-versioned", "v1.2", { workspaceRoot: workdir });
    assert.equal(starred.kind, "starred");
    if (starred.kind === "starred") {
      assert.equal(existsSync(path.join(workdir, ".claude/skills", starred.activeId, "SKILL.md")), true);
    }
  });
});
