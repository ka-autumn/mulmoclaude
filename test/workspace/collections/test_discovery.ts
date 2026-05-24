// Schema validation + field-type tests for the collections discovery
// module. Locks in: (1) the v0 supported field-type set, (2) the
// rejection of unknown types and structurally malformed schemas,
// (3) the primaryKey-must-be-flagged-primary check from PR-1483
// review round 1.
//
// Drives the live `discoverCollections` against a `mkdtempSync` tree
// by supplying `workspaceRoot` + `userSkillsDir` overrides — same
// pattern as `server/workspace/skills/catalog.ts` tests.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverCollections, loadCollection } from "../../../server/workspace/collections/discovery.js";

let workdir: string;
let emptyUserDir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collections-discovery-"));
  // Empty stand-in for ~/.claude/skills/ so the user-scope scan
  // doesn't read real skills into our assertions. The directory
  // exists but contains nothing.
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "collections-discovery-user-"));
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

async function listCollections() {
  return discoverCollections({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });
}

describe("discoverCollections — field-type support", () => {
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
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.slug, "test-allfields");
    assert.equal(collections[0]?.schema.fields.active?.type, "boolean");
  });

  it("accepts a schema using `ref` with a non-empty `to` (added in feat-collections-ref-field)", async () => {
    writeSkill("test-ref-ok", {
      title: "Worklog-like",
      icon: "link",
      dataPath: "data/refok/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", to: "mc-clients", label: "Client", required: true },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    assert.equal(collections[0]?.schema.fields.clientId?.type, "ref");
    assert.equal(collections[0]?.schema.fields.clientId?.to, "mc-clients");
  });

  it("rejects a schema with `ref` but no `to`", async () => {
    writeSkill("test-ref-bad", {
      title: "Broken Ref",
      icon: "link",
      dataPath: "data/refbad/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", label: "Client" }, // missing `to`
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0, "schema with type:ref but no `to` must be skipped");
  });

  // Codex P2 review on PR #1495: `to` must be a real slug, not
  // any non-empty string. Without this guard, values like
  // `"../escape"` or `"mc-clients/extra"` produced malformed
  // `/collections/${field.to}` router targets and behavior
  // mismatches versus the URI-encoded API fetch path.

  it("rejects a schema whose `ref.to` contains path traversal", async () => {
    writeSkill("test-ref-traversal", {
      title: "Traversal Ref",
      icon: "warning",
      dataPath: "data/reftrav/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", to: "../escape", label: "Client" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema whose `ref.to` contains a path separator", async () => {
    writeSkill("test-ref-slash", {
      title: "Slash Ref",
      icon: "warning",
      dataPath: "data/refslash/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", to: "mc-clients/extra", label: "Client" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema whose `ref.to` is whitespace", async () => {
    writeSkill("test-ref-ws", {
      title: "Whitespace Ref",
      icon: "warning",
      dataPath: "data/refws/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        clientId: { type: "ref", to: "  ", label: "Client" },
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema with an unknown field type", async () => {
    writeSkill("test-unknown-type", {
      title: "Unknown",
      icon: "warning",
      dataPath: "data/unknown/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        weird: { type: "geocoord", label: "Geo" }, // not in v0 enum
      },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });
});

describe("discoverCollections — structural validation", () => {
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
    const collections = await listCollections();
    assert.equal(collections.length, 0);
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
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects a schema whose dataPath escapes the workspace", async () => {
    writeSkill("test-escape", {
      title: "Escape",
      icon: "warning",
      dataPath: "../../etc",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("rejects malformed JSON in schema.json", async () => {
    writeSkill("test-bad-json", "{ not valid json");
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });

  it("ignores skills that ship no schema.json (they're regular skills)", async () => {
    writeSkill("test-no-schema", null);
    const collections = await listCollections();
    assert.equal(collections.length, 0);
  });
});

describe("discoverCollections — workspaceRoot propagation", () => {
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
    const collections = await listCollections();
    assert.equal(collections.length, 1);
    const dataDir = collections[0]?.dataDir;
    assert.ok(dataDir, "dataDir should be set");
    assert.ok(dataDir.startsWith(`${workdir}${path.sep}`), `dataDir ${dataDir} should live under workdir ${workdir}`);
  });
});

describe("loadCollection", () => {
  it("returns the named project-scope collection", async () => {
    writeSkill("test-load", {
      title: "Loadable",
      icon: "download",
      dataPath: "data/load/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const collection = await loadCollection("test-load", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.notEqual(collection, null);
    assert.equal(collection?.slug, "test-load");
    assert.equal(collection?.source, "project");
  });

  it("returns null for an invalid slug", async () => {
    const collection = await loadCollection("../escape", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.equal(collection, null);
  });

  it("returns null when the named collection does not exist", async () => {
    const collection = await loadCollection("nope", { workspaceRoot: workdir, userSkillsDir: emptyUserDir });
    assert.equal(collection, null);
  });
});
