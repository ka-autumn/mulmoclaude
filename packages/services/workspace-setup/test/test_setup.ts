import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPresetSlug, helpsAssetDir, presetSkillsAssetDir, seedHelps, syncPresetSkills } from "../src/index.ts";
import { _replaceSlugTree, type SlugTreeFsOps } from "../src/sync.ts";

test("isPresetSlug", () => {
  assert.equal(isPresetSlug("mc-library"), true);
  assert.equal(isPresetSlug("mc-"), false); // prefix only
  assert.equal(isPresetSlug("my-skill"), false);
});

test("bundled asset dirs exist and carry the preset skills", () => {
  assert.ok(existsSync(helpsAssetDir()), "helps asset dir exists");
  assert.ok(
    readdirSync(helpsAssetDir()).some((file) => file.endsWith(".md")),
    "helps has .md docs",
  );
  assert.ok(existsSync(presetSkillsAssetDir()), "preset asset dir exists");
  const presets = readdirSync(presetSkillsAssetDir());
  assert.ok(
    presets.some((dir) => dir.startsWith("mc-")),
    "preset dir has mc-* skills",
  );
});

test("seedHelps copies the bundled help docs into a fresh workspace", () => {
  const wsDir = mkdtempSync(path.join(tmpdir(), "wsDir-setup-"));
  try {
    seedHelps({ destDir: path.join(wsDir, "helps") });
    const seeded = readdirSync(path.join(wsDir, "helps"));
    const source = readdirSync(helpsAssetDir());
    assert.deepEqual(seeded.sort(), source.sort());
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("syncPresetSkills re-sync replaces a slug cleanly (wipe stale siblings) and leaves no staging dirs", () => {
  const wsDir = mkdtempSync(path.join(tmpdir(), "wsDir-setup-"));
  try {
    const src = path.join(wsDir, "src");
    const dest = path.join(wsDir, "dest");
    mkdirSync(path.join(src, "mc-demo"), { recursive: true });
    writeFileSync(path.join(src, "mc-demo", "SKILL.md"), "v1");
    writeFileSync(path.join(src, "mc-demo", "old.txt"), "stale");

    const first = syncPresetSkills({ sourceDir: src, destDir: dest });
    assert.deepEqual(first.copied, ["mc-demo"]);
    assert.equal(readFileSync(path.join(dest, "mc-demo", "SKILL.md"), "utf8"), "v1");
    assert.ok(existsSync(path.join(dest, "mc-demo", "old.txt")));

    // Next release: drop the stale sibling, bump SKILL.md.
    rmSync(path.join(src, "mc-demo", "old.txt"));
    writeFileSync(path.join(src, "mc-demo", "SKILL.md"), "v2");
    syncPresetSkills({ sourceDir: src, destDir: dest });
    assert.equal(readFileSync(path.join(dest, "mc-demo", "SKILL.md"), "utf8"), "v2", "contents refreshed");
    assert.ok(!existsSync(path.join(dest, "mc-demo", "old.txt")), "stale sibling removed (wipe-and-replace)");

    // Stage-and-swap must not leak temp staging dirs into the catalog.
    const leftovers = readdirSync(dest).filter((name) => name.includes(".tmp-"));
    assert.deepEqual(leftovers, [], "no staging dirs leaked");
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("_replaceSlugTree rolls back to the old preset when the swap rename fails (no data loss)", () => {
  const wsDir = mkdtempSync(path.join(tmpdir(), "wsDir-setup-"));
  try {
    const src = path.join(wsDir, "src-slug");
    const dest = path.join(wsDir, "dest-slug");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "SKILL.md"), "NEW");
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, "SKILL.md"), "OLD");

    const ops: SlugTreeFsOps = {
      copyTree: (from, target) => {
        mkdirSync(target, { recursive: true });
        for (const name of readdirSync(from)) copyFileSync(path.join(from, name), path.join(target, name));
      },
      // Fail only the staging→dest swap (its `from` is the `.tmp-` staging dir);
      // the backup move and the rollback restore use real rename.
      rename: (from, target) => {
        if (from.includes(".tmp-")) throw new Error("simulated rename failure");
        renameSync(from, target);
      },
      remove: (target) => rmSync(target, { recursive: true, force: true }),
      exists: existsSync,
    };

    assert.throws(() => _replaceSlugTree(src, dest, ops), /simulated rename failure/);
    // The previous preset must still be intact (restored from the backup), not lost.
    assert.ok(existsSync(path.join(dest, "SKILL.md")), "old preset survives a failed swap");
    assert.equal(readFileSync(path.join(dest, "SKILL.md"), "utf8"), "OLD");
    // No staging/backup dirs leaked after a successful rollback.
    const leftovers = readdirSync(wsDir).filter((name) => name.includes(".tmp-") || name.includes(".bak-"));
    assert.deepEqual(leftovers, [], "no staging/backup dirs leaked");
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});

test("syncPresetSkills copies the bundled presets into a catalog dir", () => {
  const wsDir = mkdtempSync(path.join(tmpdir(), "wsDir-setup-"));
  try {
    const dest = path.join(wsDir, "data", "skills", "catalog", "preset");
    const result = syncPresetSkills({ sourceDir: presetSkillsAssetDir(), destDir: dest });
    assert.ok(result.copied.length > 0, "copied at least one preset");
    assert.ok(result.copied.every(isPresetSlug), "every copied slug is mc-*");
    // Each copied preset has its SKILL.md at the destination.
    for (const slug of result.copied) {
      assert.ok(existsSync(path.join(dest, slug, "SKILL.md")), `${slug}/SKILL.md present`);
      assert.ok(readFileSync(path.join(dest, slug, "SKILL.md"), "utf8").length > 0);
    }
  } finally {
    rmSync(wsDir, { recursive: true, force: true });
  }
});
