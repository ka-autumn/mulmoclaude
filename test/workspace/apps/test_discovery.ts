// Schema validation + field-type tests for the apps discovery
// module. Locks in: (1) the v0 supported field-type set, (2) the
// rejection of unknown types and structurally malformed schemas,
// (3) the primaryKey-must-be-flagged-primary check from PR-1483
// review round 1.
//
// Drives the live `discoverApps` against a `mkdtempSync` tree by
// supplying `workspaceRoot` + `userSkillsDir` overrides — same
// pattern as `server/workspace/skills/catalog.ts` tests.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverApps, loadApp } from "../../../server/workspace/apps/discovery.js";

let workdir: string;
let emptyUserDir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "apps-discovery-"));
  // Empty stand-in for ~/.claude/skills/ so the user-scope scan
  // doesn't read real skills into our assertions. The directory
  // exists but contains nothing.
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "apps-discovery-user-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

function writeSkill(slug: string, schema: object | string | null): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  if (schema !== null) {
    const body = typeof schema === "string" ? schema : JSON.stringify(schema);
    writeFileSync(path.join(dir, "schema.json"), body);
  }
}

async function listApps() {
  return discoverApps({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });
}

describe("discoverApps — field-type support", () => {
  it("accepts a schema using every v0 field type, including boolean", async () => {
    writeSkill("test-allfields", {
      title: "All Fields",
      icon: "category",
      dataPath: "data/all/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
        bio: { type: "text", label: "Bio" },
        email: { type: "email", label: "Email" },
        age: { type: "number", label: "Age" },
        joined: { type: "date", label: "Joined" },
        active: { type: "boolean", label: "Active" },
        notes: { type: "markdown", label: "Notes" },
      },
    });
    const apps = await listApps();
    assert.equal(apps.length, 1);
    assert.equal(apps[0]?.slug, "test-allfields");
    assert.equal(apps[0]?.schema.fields.active?.type, "boolean");
  });

  it("rejects a schema with an unknown field type (still v0)", async () => {
    writeSkill("test-ref-not-yet", {
      title: "Ref",
      icon: "link",
      dataPath: "data/ref/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", label: "Client" }, // ref is deferred
      },
    });
    const apps = await listApps();
    assert.equal(apps.length, 0, "schema with unsupported field type must be skipped");
  });
});

describe("discoverApps — structural validation", () => {
  it("rejects a schema whose primaryKey field is not flagged primary: true", async () => {
    writeSkill("test-missing-primary-flag", {
      title: "Missing Flag",
      icon: "warning",
      dataPath: "data/missing/items",
      primaryKey: "id",
      fields: {
        // Note: no `primary: true` — discovery must reject this
        // since the CollectionView disable-on-edit check is
        // `field.primary === true`.
        id: { type: "string", label: "ID", required: true },
        name: { type: "string", label: "Name" },
      },
    });
    const apps = await listApps();
    assert.equal(apps.length, 0);
  });

  it("rejects a schema whose primaryKey doesn't name a declared field", async () => {
    writeSkill("test-orphan-primary", {
      title: "Orphan",
      icon: "warning",
      dataPath: "data/orphan/items",
      primaryKey: "nonexistent",
      fields: {
        id: { type: "string", label: "ID", primary: true },
      },
    });
    const apps = await listApps();
    assert.equal(apps.length, 0);
  });

  it("rejects a schema whose dataPath escapes the workspace", async () => {
    writeSkill("test-escape", {
      title: "Escape",
      icon: "warning",
      dataPath: "../../etc",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const apps = await listApps();
    assert.equal(apps.length, 0);
  });

  it("rejects malformed JSON in schema.json", async () => {
    writeSkill("test-bad-json", "{ not valid json");
    const apps = await listApps();
    assert.equal(apps.length, 0);
  });

  it("ignores skills that ship no schema.json (they're regular skills)", async () => {
    writeSkill("test-no-schema", null);
    const apps = await listApps();
    assert.equal(apps.length, 0);
  });
});

describe("discoverApps — workspaceRoot propagation", () => {
  it("roots each app's dataDir at the supplied workspaceRoot, not the live workspace", async () => {
    // Regression for PR #1489 Codex P1: discovery used to pass
    // `workspaceRoot` through to `.claude/skills/` scanning but
    // call `resolveDataDir` with no arg, so dataDir resolved
    // against the real `~/mulmoclaude/` and broke test isolation.
    writeSkill("test-rooting", {
      title: "Rooting",
      icon: "anchor",
      dataPath: "data/rooting/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const apps = await listApps();
    assert.equal(apps.length, 1);
    const dataDir = apps[0]?.dataDir;
    assert.ok(dataDir, "dataDir should be set");
    assert.ok(dataDir.startsWith(`${workdir}${path.sep}`), `dataDir ${dataDir} should live under workdir ${workdir}`);
  });
});

describe("loadApp", () => {
  it("returns the named project-scope app", async () => {
    writeSkill("test-load", {
      title: "Loadable",
      icon: "download",
      dataPath: "data/load/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const app = await loadApp("test-load", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.notEqual(app, null);
    assert.equal(app?.slug, "test-load");
    assert.equal(app?.source, "project");
  });

  it("returns null for an invalid slug", async () => {
    const app = await loadApp("../escape", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.equal(app, null);
  });

  it("returns null when the named app does not exist", async () => {
    const app = await loadApp("nope", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.equal(app, null);
  });
});
