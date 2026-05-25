// Tests for the boot-time preset-skill sync.
//
// #1210 PR-A: introduced. Source: `server/workspace/skills-preset/`.
// Destination: originally `<workspaceRoot>/.claude/skills/`.
// #1335 PR-A: destination flipped to
// `<workspaceRoot>/data/skills/catalog/preset/` (catalog half of the
// catalog-vs-active split). The sync helper itself doesn't care
// about the literal path — it works against whatever `destDir` the
// caller passes — so these tests stay tmpdir-based.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { syncActivePresetSkills, syncPresetSkills, isPresetSlug } from "../../server/workspace/skills-preset.js";

let workdir: string;
let sourceDir: string;
let destDir: string;

function writePresetSource(slug: string, body = `placeholder for ${slug}`): void {
  const slugDir = path.join(sourceDir, slug);
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(path.join(slugDir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\n${body}\n`);
}

function writeDestSkill(slug: string, body: string): void {
  const slugDir = path.join(destDir, slug);
  mkdirSync(slugDir, { recursive: true });
  writeFileSync(path.join(slugDir, "SKILL.md"), body);
}

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "skills-preset-"));
  sourceDir = path.join(workdir, "source");
  destDir = path.join(workdir, "dest");
  mkdirSync(sourceDir);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("isPresetSlug", () => {
  it("accepts mc-* slugs", () => {
    assert.equal(isPresetSlug("mc-library"), true);
    assert.equal(isPresetSlug("mc-x"), true);
  });

  it("rejects non-prefixed slugs", () => {
    assert.equal(isPresetSlug("library"), false);
    assert.equal(isPresetSlug("manage-library"), false);
  });

  it("rejects bare prefix without a name", () => {
    assert.equal(isPresetSlug("mc-"), false);
  });

  it("rejects empty / unrelated", () => {
    assert.equal(isPresetSlug(""), false);
    assert.equal(isPresetSlug("MC-LIBRARY"), false);
  });
});

describe("syncPresetSkills — happy path", () => {
  it("copies a single mc-* preset into the destination", () => {
    writePresetSource("mc-foo");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied, ["mc-foo"]);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.removed, []);
    const destFile = path.join(destDir, "mc-foo", "SKILL.md");
    assert.ok(existsSync(destFile));
    assert.match(readFileSync(destFile, "utf-8"), /placeholder for mc-foo/);
  });

  it("copies multiple presets in one pass", () => {
    writePresetSource("mc-a");
    writePresetSource("mc-b");
    writePresetSource("mc-c");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied.sort(), ["mc-a", "mc-b", "mc-c"]);
    for (const slug of ["mc-a", "mc-b", "mc-c"]) {
      assert.ok(existsSync(path.join(destDir, slug, "SKILL.md")));
    }
  });

  it("creates the destination dir when it does not exist yet", () => {
    writePresetSource("mc-foo");
    assert.equal(existsSync(destDir), false);
    syncPresetSkills({ sourceDir, destDir });
    assert.ok(existsSync(destDir));
  });

  it("returns an empty result when the source dir does not exist (no presets shipped yet)", () => {
    rmSync(sourceDir, { recursive: true });
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result, { copied: [], removed: [], skipped: [] });
  });
});

describe("syncPresetSkills — overwrite policy", () => {
  it("refreshes a preset whose dest content was modified", () => {
    writePresetSource("mc-foo", "fresh content");
    writeDestSkill("mc-foo", "stale content from a previous boot");
    syncPresetSkills({ sourceDir, destDir });
    const after = readFileSync(path.join(destDir, "mc-foo", "SKILL.md"), "utf-8");
    assert.match(after, /fresh content/);
    assert.doesNotMatch(after, /stale content/);
  });

  it("is idempotent — running twice yields the same on-disk state", () => {
    writePresetSource("mc-foo");
    syncPresetSkills({ sourceDir, destDir });
    const first = readFileSync(path.join(destDir, "mc-foo", "SKILL.md"), "utf-8");
    syncPresetSkills({ sourceDir, destDir });
    const second = readFileSync(path.join(destDir, "mc-foo", "SKILL.md"), "utf-8");
    assert.equal(first, second);
  });
});

describe("syncPresetSkills — user-skill safety", () => {
  it("does NOT touch a non-mc- slug in the destination", () => {
    writePresetSource("mc-foo");
    writeDestSkill("library", "user-authored content");
    syncPresetSkills({ sourceDir, destDir });
    const after = readFileSync(path.join(destDir, "library", "SKILL.md"), "utf-8");
    assert.equal(after, "user-authored content");
  });

  it("does NOT remove a non-mc- slug during cleanup", () => {
    // Even when there are NO source presets, a user's library/ in
    // dest must survive the cleanup pass.
    writeDestSkill("library", "user-authored content");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.removed, []);
    assert.ok(existsSync(path.join(destDir, "library", "SKILL.md")));
  });
});

describe("syncPresetSkills — slug guard", () => {
  it("skips a source entry without the mc- prefix", () => {
    writePresetSource("library");
    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.deepEqual(result.copied, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /library/);
    assert.match(result.skipped[0], /mc-/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /library/);
    assert.equal(existsSync(path.join(destDir, "library")), false);
  });

  it("skips a source entry without SKILL.md", () => {
    mkdirSync(path.join(sourceDir, "mc-empty"));
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /mc-empty/);
    assert.match(result.skipped[0], /SKILL\.md/);
  });

  it("skips a non-directory source entry", () => {
    writeFileSync(path.join(sourceDir, "stray-file.md"), "not a slug dir");
    writePresetSource("mc-foo");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied, ["mc-foo"]);
    assert.deepEqual(result.skipped, []);
  });

  it("ignores hidden source entries (.gitkeep, .DS_Store)", () => {
    writeFileSync(path.join(sourceDir, ".gitkeep"), "");
    writeFileSync(path.join(sourceDir, ".DS_Store"), "");
    writePresetSource("mc-foo");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.copied, ["mc-foo"]);
    assert.deepEqual(result.skipped, []);
  });

  it("skips when SKILL.md is a directory (regression: not a regular file)", () => {
    // Codex review iter-1: existsSync alone passes a directory
    // standing in for SKILL.md; copyFileSync would then crash boot.
    // The classifier must check `isFile()`.
    const slugDir = path.join(sourceDir, "mc-bad-shape");
    mkdirSync(path.join(slugDir, "SKILL.md"), { recursive: true });
    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.deepEqual(result.copied, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /mc-bad-shape/);
    assert.match(result.skipped[0], /regular file/);
    assert.equal(warnings.length, 1);
  });
});

describe("syncPresetSkills — source resilience", () => {
  it("aborts cleanly when sourceDir exists as a regular file (packaging mistake)", () => {
    // Codex review iter-3: existsSync(sourceDir) accepts a regular
    // file standing in for the preset directory; readdirSync would
    // then ENOTDIR-crash boot. The function must tolerate that
    // packaging bug as a recoverable "skip the sync" state.
    rmSync(sourceDir, { recursive: true, force: true });
    writeFileSync(sourceDir, "stray file at the source path");

    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.deepEqual(result.copied, []);
    assert.deepEqual(result.removed, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /non-directory/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /preset sync aborted/);
  });
});

describe("syncPresetSkills — destination resilience", () => {
  it("aborts the sync cleanly when the root dest itself is a regular file (regression: corruption-tolerant boot)", () => {
    // Codex review iter-2 (on the original `.claude/skills/` dest;
    // same defence applies to the catalog destination after #1335
    // PR-A): prior fix only protected per-slug mkdirSync; the root
    // mkdirSync would still EEXIST-crash if the destination root
    // itself was somehow a regular file. Now it logs warn + skips
    // the whole sync.
    writePresetSource("mc-foo");
    writeFileSync(destDir, "stray file blocking the root skills dir");

    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.deepEqual(result.copied, []);
    assert.deepEqual(result.removed, []);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /non-directory/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /preset sync aborted/);
  });

  it("skips a slug whose dest slot is occupied by a regular file (regression: corruption-tolerant boot)", () => {
    // Codex review iter-1: mkdirSync recursive: true throws EEXIST
    // when the path is a regular file. One bad slot must not crash
    // boot — log warn and skip just that slug, keep others moving.
    writePresetSource("mc-foo");
    writePresetSource("mc-bar");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(path.join(destDir, "mc-foo"), "stray file blocking the slug dir");

    const warnings: string[] = [];
    const result = syncPresetSkills({
      sourceDir,
      destDir,
      onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
    });
    // mc-foo is skipped (slot occupied), mc-bar still copies.
    assert.deepEqual(result.copied, ["mc-bar"]);
    assert.equal(result.skipped.length, 1);
    assert.match(result.skipped[0], /mc-foo/);
    assert.match(result.skipped[0], /non-directory/);
    assert.equal(warnings.length, 1);
    // mc-bar landed normally despite mc-foo's failure.
    assert.ok(existsSync(path.join(destDir, "mc-bar", "SKILL.md")));
  });
});

describe("syncPresetSkills — cleanup of retired presets", () => {
  it("removes an mc-* slug in dest that no longer exists in source", () => {
    writeDestSkill("mc-stale", "old preset from a previous release");
    writePresetSource("mc-foo");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.removed, ["mc-stale"]);
    assert.equal(existsSync(path.join(destDir, "mc-stale")), false);
    assert.ok(existsSync(path.join(destDir, "mc-foo", "SKILL.md")));
  });

  it("does NOT remove the slug we just copied", () => {
    writeDestSkill("mc-foo", "old content");
    writePresetSource("mc-foo", "new content");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.copied, ["mc-foo"]);
  });

  it("removes multiple stale mc-* entries in one pass", () => {
    writeDestSkill("mc-old-a", "");
    writeDestSkill("mc-old-b", "");
    writePresetSource("mc-fresh");
    const result = syncPresetSkills({ sourceDir, destDir });
    assert.deepEqual(result.removed.sort(), ["mc-old-a", "mc-old-b"]);
  });

  it("emits an info log for each removed entry", () => {
    writeDestSkill("mc-stale", "");
    const infos: string[] = [];
    syncPresetSkills({
      sourceDir,
      destDir,
      onInfo: (message, data) => infos.push(`${message} ${JSON.stringify(data)}`),
    });
    assert.ok(infos.some((entry) => entry.includes("removed retired preset") && entry.includes("mc-stale")));
  });
});

describe("syncPresetSkills — combined scenarios", () => {
  it("handles an upgrade: one preset added, one removed, one user-skill untouched", () => {
    // Snapshot of a typical mulmoclaude upgrade: previous boot
    // installed mc-old + mc-keep, user added their own `library`,
    // current source ships mc-keep + mc-new.
    writeDestSkill("mc-old", "retired in this release");
    writeDestSkill("mc-keep", "stale content");
    writeDestSkill("library", "user content");
    writePresetSource("mc-keep", "refreshed content");
    writePresetSource("mc-new", "new in this release");

    const result = syncPresetSkills({ sourceDir, destDir });

    assert.deepEqual(result.copied.sort(), ["mc-keep", "mc-new"]);
    assert.deepEqual(result.removed, ["mc-old"]);
    assert.equal(existsSync(path.join(destDir, "mc-old")), false);
    assert.match(readFileSync(path.join(destDir, "mc-keep", "SKILL.md"), "utf-8"), /refreshed/);
    assert.ok(existsSync(path.join(destDir, "mc-new", "SKILL.md")));
    assert.equal(readFileSync(path.join(destDir, "library", "SKILL.md"), "utf-8"), "user content");
  });
});

// ---------------------------------------------------------------
// syncActivePresetSkills — refreshes the already-starred copy in
// `.claude/skills/<slug>/` to match the source. New in the
// apps→collections rename PR; the rename itself was the trigger.
// ---------------------------------------------------------------

describe("syncActivePresetSkills", () => {
  let activeDir: string;

  beforeEach(() => {
    activeDir = path.join(workdir, "active");
    mkdirSync(activeDir, { recursive: true });
  });

  function writeActiveSkill(slug: string, body: string): void {
    const slugDir = path.join(activeDir, slug);
    mkdirSync(slugDir, { recursive: true });
    writeFileSync(path.join(slugDir, "SKILL.md"), body);
  }

  it("overwrites the active SKILL.md when the source has changed, backing up the prior contents", () => {
    writePresetSource("mc-clients", "NEW BODY");
    writeActiveSkill("mc-clients", "OLD BODY");
    const result = syncActivePresetSkills({ sourceDir, activeDir });
    assert.deepEqual(result.updated, ["mc-clients"]);
    assert.equal(result.unchanged.length, 0);
    const activeSkillPath = path.join(activeDir, "mc-clients", "SKILL.md");
    assert.ok(readFileSync(activeSkillPath, "utf-8").includes("NEW BODY"));
    const backups = readdirSync(path.join(activeDir, "mc-clients")).filter((entry) => entry.startsWith("SKILL.md.bak."));
    assert.equal(backups.length, 1, "expected exactly one .bak file alongside SKILL.md");
    assert.equal(readFileSync(path.join(activeDir, "mc-clients", backups[0]), "utf-8"), "OLD BODY");
  });

  it("is a no-op when the active copy already matches source (no .bak created)", () => {
    writePresetSource("mc-clients", "SAME BODY");
    const activeSlugDir = path.join(activeDir, "mc-clients");
    mkdirSync(activeSlugDir, { recursive: true });
    writeFileSync(path.join(activeSlugDir, "SKILL.md"), `---\nname: mc-clients\ndescription: test fixture\n---\nSAME BODY\n`);
    const result = syncActivePresetSkills({ sourceDir, activeDir });
    assert.deepEqual(result.unchanged, ["mc-clients"]);
    assert.equal(result.updated.length, 0);
    const entries = readdirSync(activeSlugDir);
    assert.deepEqual(
      entries.filter((entry) => entry.includes(".bak.")),
      [],
      "no .bak file should be created when contents already match",
    );
  });

  it("skips slugs that haven't been starred yet (never auto-stars)", () => {
    writePresetSource("mc-worklog", "NEVER STARRED");
    const result = syncActivePresetSkills({ sourceDir, activeDir });
    assert.deepEqual(result.notActive, ["mc-worklog"]);
    assert.equal(result.updated.length, 0);
    assert.equal(existsSync(path.join(activeDir, "mc-worklog")), false, "must not auto-create the active dir");
  });

  it("leaves user-added files in the active slug dir untouched", () => {
    // Same body in both so the SKILL.md compare is a no-op — the
    // assertion of interest is that `my-notes.md` (which only
    // exists in active) survives the sync.
    writePresetSource("mc-clients", "SOURCE BODY");
    const activeSlugDir = path.join(activeDir, "mc-clients");
    mkdirSync(activeSlugDir, { recursive: true });
    writeFileSync(path.join(activeSlugDir, "SKILL.md"), `---\nname: mc-clients\ndescription: test fixture\n---\nSOURCE BODY\n`);
    const userFile = path.join(activeSlugDir, "my-notes.md");
    writeFileSync(userFile, "user's private notes");
    const result = syncActivePresetSkills({ sourceDir, activeDir });
    assert.deepEqual(result.unchanged, ["mc-clients"]);
    assert.equal(readFileSync(userFile, "utf-8"), "user's private notes");
  });

  it("ignores non-mc-* slugs even if they exist under sourceDir", () => {
    // Defense in depth — `syncPresetSkills` already rejects non-mc
    // slugs at the source side, but `syncActivePresetSkills` should
    // double-check so a stray non-prefixed source dir can never
    // touch a user-authored skill of the same name.
    mkdirSync(path.join(sourceDir, "user-private"), { recursive: true });
    writeFileSync(path.join(sourceDir, "user-private", "SKILL.md"), "INJECTED");
    writeActiveSkill("user-private", "USER VERSION");
    const result = syncActivePresetSkills({ sourceDir, activeDir });
    assert.equal(result.updated.length, 0);
    assert.equal(result.notActive.length, 0);
    assert.equal(readFileSync(path.join(activeDir, "user-private", "SKILL.md"), "utf-8"), "USER VERSION");
  });

  it("returns empty result when sourceDir is missing", () => {
    const result = syncActivePresetSkills({ sourceDir: path.join(workdir, "nonexistent"), activeDir });
    assert.deepEqual(result, { updated: [], unchanged: [], notActive: [], skipped: [], backupSuffix: null });
  });

  // Codex P1 review on PR #1490: the original `syncActivePresetSkills`
  // used `statSync` (follows symlinks) on the dest slug dir, so a
  // starred `mc-*` slug that was actually a symlink to outside the
  // workspace would let the recursive copy write to the link's
  // target. Pin the realpath-containment rejection here so a
  // regression resurfaces the file-disclosure / arbitrary-write
  // primitive immediately.

  it("refuses to sync when the active slug dir is a symlink pointing outside activeDir", () => {
    writePresetSource("mc-clients", "NEW BODY");
    // Outside-the-workspace target the symlink points at.
    const outsideDir = mkdtempSync(path.join(tmpdir(), "outside-active-"));
    writeFileSync(path.join(outsideDir, "SKILL.md"), "ATTACKER WOULD LOVE TO READ/WRITE THIS");
    try {
      // Active slot is a symlink, not a real dir.
      symlinkSync(outsideDir, path.join(activeDir, "mc-clients"));
      const warnings: string[] = [];
      const result = syncActivePresetSkills({
        sourceDir,
        activeDir,
        onWarn: (message, data) => warnings.push(`${message} ${JSON.stringify(data)}`),
      });
      assert.equal(result.updated.length, 0, "must not report success");
      assert.equal(result.skipped.length, 1);
      assert.match(result.skipped[0], /mc-clients/);
      assert.match(result.skipped[0], /symlink|escapes/);
      // The outside file must remain untouched (no overwrite, no .bak rename).
      assert.equal(readFileSync(path.join(outsideDir, "SKILL.md"), "utf-8"), "ATTACKER WOULD LOVE TO READ/WRITE THIS");
      assert.deepEqual(
        readdirSync(outsideDir).filter((entry) => entry.includes(".bak.")),
        [],
      );
      assert.ok(
        warnings.some((line) => /symlink|escapes/.test(line)),
        "must log a warning",
      );
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("accepts a symlink whose target stays inside activeDir (intra-workspace symlink)", () => {
    // Symlinks within the workspace are legitimate (e.g. a user
    // who likes git-managing their skills via a checkout under
    // .claude/_repo/ and symlinks the active dir to it). Make
    // sure we don't false-positive on those.
    writePresetSource("mc-clients", "FRESH FROM SOURCE");
    const realSlugDir = path.join(activeDir, "mc-clients-real");
    mkdirSync(realSlugDir, { recursive: true });
    writeFileSync(path.join(realSlugDir, "SKILL.md"), "STALE");
    symlinkSync(realSlugDir, path.join(activeDir, "mc-clients"));
    const result = syncActivePresetSkills({ sourceDir, activeDir });
    assert.deepEqual(result.updated, ["mc-clients"]);
    assert.match(readFileSync(path.join(realSlugDir, "SKILL.md"), "utf-8"), /FRESH FROM SOURCE/);
  });

  it("syncs newly-added files from source to an existing active dir", () => {
    // e.g. `schema.json` was added to a preset that the user had
    // already starred when only SKILL.md existed.
    writePresetSource("mc-clients", "SKILL BODY");
    const srcSchema = path.join(sourceDir, "mc-clients", "schema.json");
    writeFileSync(srcSchema, '{"title":"X"}');
    writeActiveSkill("mc-clients", `---\nname: mc-clients\ndescription: test fixture\n---\nSKILL BODY\n`);
    const result = syncActivePresetSkills({ sourceDir, activeDir });
    assert.deepEqual(result.updated, ["mc-clients"]);
    const activeSchema = path.join(activeDir, "mc-clients", "schema.json");
    assert.equal(readFileSync(activeSchema, "utf-8"), '{"title":"X"}');
    // No .bak — schema.json didn't exist before.
    assert.equal(readdirSync(path.join(activeDir, "mc-clients")).filter((entry) => entry.includes(".bak.")).length, 0);
  });
});

describe("syncPresetSkills — repository fixture", () => {
  it("the in-repo skills-preset/ directory has at least one preset and ALL slugs are mc-* prefixed", () => {
    // Anchored to a real path so this test catches regressions where
    // someone adds a preset slug missing the mc- prefix at the
    // repository level (boot would warn-and-skip, but a CI fail is
    // louder).
    const REPO_PRESET_DIR = path.resolve(import.meta.dirname, "..", "..", "server", "workspace", "skills-preset");
    if (!existsSync(REPO_PRESET_DIR)) return; // dir not created yet — covered by other tests
    const slugs = readdirSync(REPO_PRESET_DIR).filter((entry) => !entry.startsWith("."));
    assert.ok(slugs.length >= 1, "expected at least one preset under skills-preset/");
    for (const slug of slugs) {
      assert.equal(isPresetSlug(slug), true, `slug "${slug}" must start with "mc-"`);
      assert.ok(existsSync(path.join(REPO_PRESET_DIR, slug, "SKILL.md")), `slug "${slug}" must contain a SKILL.md`);
    }
  });
});
