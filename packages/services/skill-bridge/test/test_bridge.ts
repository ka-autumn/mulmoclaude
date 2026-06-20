import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bridgeTargetFromDataPath, slugFromRmCommand, mirrorSkillWrite, mirrorSkillDelete } from "../src/index.ts";

const wsRoot = "/wsRoot"; // a notional workspace root for the pure path tests
const atPath = (rel: string) => path.join(wsRoot, rel);

test("bridgeTargetFromDataPath: allowlisted files", () => {
  assert.deepEqual(bridgeTargetFromDataPath(wsRoot, atPath("data/skills/my-skill/SKILL.md")), { slug: "my-skill", relSegments: ["SKILL.md"] });
  assert.deepEqual(bridgeTargetFromDataPath(wsRoot, atPath("data/skills/my-skill/schema.json")), { slug: "my-skill", relSegments: ["schema.json"] });
  assert.deepEqual(bridgeTargetFromDataPath(wsRoot, atPath("data/skills/my-skill/templates/invoice.md")), {
    slug: "my-skill",
    relSegments: ["templates", "invoice.md"],
  });
});

test("bridgeTargetFromDataPath: rejects non-allowlisted + bad inputs", () => {
  assert.equal(bridgeTargetFromDataPath(wsRoot, atPath("data/skills/my-skill/README.md")), null);
  assert.equal(bridgeTargetFromDataPath(wsRoot, atPath("data/skills/my-skill/assets/logo.png")), null);
  assert.equal(bridgeTargetFromDataPath(wsRoot, atPath("data/skills/Bad_Slug/SKILL.md")), null);
  assert.equal(bridgeTargetFromDataPath(wsRoot, atPath("data/skills/my-skill")), null); // no file segment
  assert.equal(bridgeTargetFromDataPath(wsRoot, atPath("data/other/file.md")), null);
});

test("slugFromRmCommand", () => {
  assert.equal(slugFromRmCommand("rm -rf data/skills/my-skill"), "my-skill");
  assert.equal(slugFromRmCommand("rm -rf data/skills/my-skill/"), "my-skill");
  assert.equal(slugFromRmCommand('rm -rf "data/skills/my-skill"'), "my-skill");
  assert.equal(slugFromRmCommand("rm -f data/skills/my-skill"), null); // not recursive
  assert.equal(slugFromRmCommand("rm -rf data/skills/*"), null); // wildcard
  assert.equal(slugFromRmCommand("rm -rf data/skills"), null); // parent dir
  assert.equal(slugFromRmCommand("echo hi"), null);
});

test("mirrorSkillWrite + mirrorSkillDelete (atomic copy / rm against a temp workspace)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "skill-bridge-"));
  try {
    mkdirSync(path.join(root, "data", "skills", "my-skill", "templates"), { recursive: true });
    writeFileSync(path.join(root, "data", "skills", "my-skill", "SKILL.md"), "BODY");
    writeFileSync(path.join(root, "data", "skills", "my-skill", "templates", "t.md"), "TPL");

    const writeMd = mirrorSkillWrite(root, { slug: "my-skill", relSegments: ["SKILL.md"] });
    assert.equal(writeMd.dest, path.join(root, ".claude", "skills", "my-skill", "SKILL.md"));
    assert.equal(readFileSync(writeMd.dest, "utf8"), "BODY");

    const writeTpl = mirrorSkillWrite(root, { slug: "my-skill", relSegments: ["templates", "t.md"] });
    assert.equal(readFileSync(writeTpl.dest, "utf8"), "TPL");

    mirrorSkillDelete(root, "my-skill");
    assert.equal(existsSync(path.join(root, ".claude", "skills", "my-skill")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
