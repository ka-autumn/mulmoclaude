// Validation pass surfaced through presentCollection: a malformed record
// is silently skipped at read time, so the validator must report it back
// to the authoring LLM. Pins the unparseable-JSON detection (the
// silent-data-loss bug), the cheap schema checks, and the realpath
// containment guard (the dataDir must stay under the workspace root).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { validateCollectionRecords } from "../../../server/workspace/collections/validate.js";
import type { LoadedCollection } from "../../../server/workspace/collections/index.js";
import type { CollectionSchema } from "../../../server/workspace/collections/types.js";

const schema = {
  title: "Lessons",
  icon: "school",
  dataPath: "data/lessons/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    title: { type: "string", label: "Title", required: true },
    status: { type: "enum", label: "Status", values: ["planned", "done"], required: true },
  },
} as unknown as CollectionSchema;

// `root` is the test "workspace"; records live in `root/items` (the dataDir),
// so the realpath containment guard is satisfied — mirrors test_io.ts.
let root: string;
let dir: string;
const collection = (dataDir = dir): LoadedCollection =>
  ({ slug: "lessons", source: "project", schema, dataDir, skillDir: dataDir }) as unknown as LoadedCollection;
const validate = (dataDir = dir) => validateCollectionRecords(collection(dataDir), { workspaceRoot: root });
const write = (name: string, body: string) => writeFileSync(path.join(dir, name), body);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "validate-"));
  dir = path.join(root, "items");
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("validateCollectionRecords", () => {
  it("returns no issues when every record is valid", async () => {
    write("a.json", JSON.stringify({ id: "a", title: "A", status: "planned" }));
    write("b.json", JSON.stringify({ id: "b", title: "B", status: "done" }));
    assert.deepEqual(await validate(), []);
  });

  it("returns [] when the data dir doesn't exist yet", async () => {
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(await validate(), []);
  });

  it("flags an unparseable record (the unescaped-quote bug)", async () => {
    write("bad.json", '{ "id": "bad", "title": "がんは"細胞のバグ"", "status": "planned" }');
    const issues = await validate();
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.file, "bad.json");
    assert.match(issues[0]?.problem ?? "", /invalid JSON/);
  });

  it("flags a record whose JSON is not an object", async () => {
    write("arr.json", JSON.stringify([1, 2]));
    write("num.json", "42");
    const byFile = Object.fromEntries((await validate()).map((i) => [i.file, i.problem]));
    assert.match(byFile["arr.json"] ?? "", /not a JSON object/);
    assert.match(byFile["num.json"] ?? "", /not a JSON object/);
  });

  it("flags a non-regular .json entry (a directory)", async () => {
    mkdirSync(path.join(dir, "weird.json"));
    const [issue] = await validate();
    assert.equal(issue?.file, "weird.json");
    assert.match(issue?.problem ?? "", /not a regular file/);
  });

  it("flags id not matching the filename", async () => {
    write("x.json", JSON.stringify({ id: "wrong", title: "T", status: "planned" }));
    const [issue] = await validate();
    assert.match(issue?.problem ?? "", /must equal the filename/);
  });

  it("flags a missing required field and an invalid enum value", async () => {
    write("m.json", JSON.stringify({ id: "m", status: "planned" })); // missing title
    write("e.json", JSON.stringify({ id: "e", title: "T", status: "nope" })); // bad enum
    const byFile = Object.fromEntries((await validate()).map((i) => [i.file, i.problem]));
    assert.match(byFile["m.json"] ?? "", /missing required field 'title'/);
    assert.match(byFile["e.json"] ?? "", /not one of/);
  });

  it("ignores dotfiles and non-json entries", async () => {
    write(".DS_Store", "junk");
    write("notes.txt", "not a record");
    write("ok.json", JSON.stringify({ id: "ok", title: "T", status: "done" }));
    assert.deepEqual(await validate(), []);
  });

  it("refuses a dataDir that escapes the workspace root", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "outside-"));
    // Malformed on purpose: if the guard ever READ this dir it would report a
    // "not a JSON object" issue, so [] proves it short-circuited before reading.
    writeFileSync(path.join(outside, "secret.json"), "42");
    assert.deepEqual(await validate(outside), []);
    rmSync(outside, { recursive: true, force: true });
  });
});
