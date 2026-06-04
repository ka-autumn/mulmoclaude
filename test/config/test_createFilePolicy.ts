// Regression tests for #1598's file-creation policy registry.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CREATE_FILE_POLICIES, normaliseNewFileSlug, policyForFolder } from "../../src/config/createFilePolicy";

describe("policyForFolder", () => {
  it("returns the wiki-pages entry for `data/wiki/pages`", () => {
    const policy = policyForFolder("data/wiki/pages");
    assert.ok(policy);
    assert.equal(policy?.extension, ".md");
  });

  it("returns null for an unlisted folder", () => {
    assert.equal(policyForFolder("data/wiki/pages/nested"), null);
    assert.equal(policyForFolder("artifacts/images"), null);
    assert.equal(policyForFolder(""), null);
    assert.equal(policyForFolder("/"), null);
  });

  it("requires exact path match (no prefix / suffix slash)", () => {
    assert.equal(policyForFolder("data/wiki/pages/"), null);
    assert.equal(policyForFolder("/data/wiki/pages"), null);
  });
});

describe("CREATE_FILE_POLICIES registry shape", () => {
  it("uses lowercase POSIX paths for every folder", () => {
    for (const entry of CREATE_FILE_POLICIES) {
      assert.equal(entry.folder, entry.folder.toLowerCase(), `${entry.folder} should be lowercase`);
      assert.ok(!entry.folder.includes("\\"), `${entry.folder} must use POSIX separators`);
      assert.ok(!entry.folder.startsWith("/"), `${entry.folder} must be workspace-relative (no leading slash)`);
      assert.ok(!entry.folder.endsWith("/"), `${entry.folder} must not end with a separator`);
    }
  });

  it("ships an extension that starts with a dot", () => {
    for (const entry of CREATE_FILE_POLICIES) {
      assert.match(entry.extension, /^\.[a-z0-9]+$/, `${entry.folder}'s extension "${entry.extension}" should be like ".md"`);
    }
  });

  it("declares a placeholder i18n key under fileTree.newFilePlaceholder.*", () => {
    for (const entry of CREATE_FILE_POLICIES) {
      assert.match(entry.placeholderKey, /^fileTree\.newFilePlaceholder\.[a-zA-Z]+$/);
    }
  });

  it("has no duplicate folder entries", () => {
    const folders = CREATE_FILE_POLICIES.map((entry) => entry.folder);
    assert.equal(new Set(folders).size, folders.length);
  });
});

describe("normaliseNewFileSlug", () => {
  const wikiPolicy = { folder: "data/wiki/pages", extension: ".md", placeholderKey: "x" };
  const jsonPolicy = { folder: "artifacts/stories", extension: ".json", placeholderKey: "x" };

  it("appends the policy extension to a clean slug", () => {
    assert.deepEqual(normaliseNewFileSlug("my-new-page", wikiPolicy), {
      ok: true,
      filename: "my-new-page.md",
    });
  });

  it("strips a user-supplied extension and uses the policy's", () => {
    assert.deepEqual(normaliseNewFileSlug("my-page.txt", wikiPolicy), {
      ok: true,
      filename: "my-page.md",
    });
    assert.deepEqual(normaliseNewFileSlug("my-page.md", wikiPolicy), {
      ok: true,
      filename: "my-page.md",
    });
    // Even an unrelated extension on a json folder gets coerced
    assert.deepEqual(normaliseNewFileSlug("script.txt", jsonPolicy), {
      ok: true,
      filename: "script.json",
    });
  });

  it("trims surrounding whitespace", () => {
    assert.deepEqual(normaliseNewFileSlug("  my-page  ", wikiPolicy), {
      ok: true,
      filename: "my-page.md",
    });
  });

  it("accepts non-ASCII slugs verbatim (the wiki tree already does)", () => {
    assert.deepEqual(normaliseNewFileSlug("旅行記-2026", wikiPolicy), {
      ok: true,
      filename: "旅行記-2026.md",
    });
  });

  it("rejects empty / whitespace-only / extension-only input", () => {
    assert.deepEqual(normaliseNewFileSlug("", wikiPolicy), { ok: false, reason: "empty" });
    assert.deepEqual(normaliseNewFileSlug("   ", wikiPolicy), { ok: false, reason: "empty" });
    // A user typing just an extension also normalises to empty
    assert.deepEqual(normaliseNewFileSlug(".md", wikiPolicy), { ok: false, reason: "empty" });
    assert.deepEqual(normaliseNewFileSlug(".env", wikiPolicy), { ok: false, reason: "empty" });
  });

  it("rejects unsafe slugs (separators, `..`, NUL)", () => {
    assert.deepEqual(normaliseNewFileSlug("../escape", wikiPolicy), { ok: false, reason: "unsafe" });
    assert.deepEqual(normaliseNewFileSlug("..", wikiPolicy), { ok: false, reason: "unsafe" });
    assert.deepEqual(normaliseNewFileSlug("sub/dir", wikiPolicy), { ok: false, reason: "unsafe" });
    assert.deepEqual(normaliseNewFileSlug("back\\slash", wikiPolicy), { ok: false, reason: "unsafe" });
    assert.deepEqual(normaliseNewFileSlug("with\0nul", wikiPolicy), { ok: false, reason: "unsafe" });
    assert.deepEqual(normaliseNewFileSlug(".", wikiPolicy), { ok: false, reason: "unsafe" });
  });
});
