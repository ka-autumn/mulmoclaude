// Unit tests for the /skills sidebar helpers. categorizeSkill drives
// the per-row provenance badge + the edit/delete gate; the section
// helpers drive which collapsible section (active / catalog) starts
// open and how the persisted collapse state survives localStorage
// edge cases.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  COLLAPSED_SECTIONS_STORAGE_KEY,
  DEFAULT_CLOSED_SECTIONS,
  SECTION_LABEL_KEYS,
  SKILL_SECTION_KEYS,
  SYSTEM_SKILL_PREFIX,
  categorizeSkill,
  isSkillSectionKey,
  loadCollapsedSections,
  persistCollapsedSections,
  pickInitialSelection,
  REPO_COLLAPSED_STORAGE_KEY,
  loadRepoCollapsed,
  persistRepoCollapsed,
} from "../../../src/plugins/manageSkills/categories.js";

// Minimal localStorage shim. Mirrors only the methods the helpers call,
// plus an opt-in `setItemThrows` to exercise the swallow-error path.
function makeStorageShim(options: { setItemThrows?: boolean } = {}) {
  const map = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    setItem(key: string, value: string): void {
      if (options.setItemThrows) throw new Error("quota exceeded");
      map.set(key, value);
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    clear(): void {
      map.clear();
    },
  };
  return { map, storage: storage as unknown as Storage };
}

interface WindowGlobal {
  window?: { localStorage: Storage };
}
const globalRef = globalThis as unknown as WindowGlobal;

describe("manageSkills repo-collapse state (#1383 PR-C2)", () => {
  afterEach(() => {
    delete globalRef.window;
  });

  it("uses the documented localStorage key", () => {
    assert.equal(REPO_COLLAPSED_STORAGE_KEY, "skills:repoCollapsed");
  });

  it("defaults to empty (all repos expanded) with no window", () => {
    delete globalRef.window;
    assert.deepEqual([...loadRepoCollapsed()], []);
  });

  it("defaults to empty when nothing is persisted", () => {
    const { storage } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    assert.deepEqual([...loadRepoCollapsed()], []);
  });

  it("round-trips a persisted set", () => {
    const { storage } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    persistRepoCollapsed(new Set(["anthropics-skills", "foo-bar"]));
    assert.deepEqual([...loadRepoCollapsed()].sort(), ["anthropics-skills", "foo-bar"]);
  });

  it("ignores non-array / non-string garbage", () => {
    const { storage, map } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    map.set(REPO_COLLAPSED_STORAGE_KEY, JSON.stringify({ not: "an array" }));
    assert.deepEqual([...loadRepoCollapsed()], []);
    map.set(REPO_COLLAPSED_STORAGE_KEY, JSON.stringify(["ok", 42, null]));
    assert.deepEqual([...loadRepoCollapsed()], ["ok"]);
  });

  it("returns empty on malformed JSON", () => {
    const { storage, map } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    map.set(REPO_COLLAPSED_STORAGE_KEY, "{not json");
    assert.deepEqual([...loadRepoCollapsed()], []);
  });

  it("swallows persist errors (quota / private mode)", () => {
    const { storage } = makeStorageShim({ setItemThrows: true });
    globalRef.window = { localStorage: storage };
    assert.doesNotThrow(() => persistRepoCollapsed(new Set(["x"])));
  });
});

describe("manageSkills categorizeSkill", () => {
  it("returns 'user' for user-source skills regardless of name", () => {
    assert.equal(categorizeSkill({ name: "anything", source: "user" }), "user");
    assert.equal(categorizeSkill({ name: "mc-foo", source: "user" }), "user");
  });

  it("returns 'system' for project skills whose name begins with mc-", () => {
    assert.equal(categorizeSkill({ name: "mc-foo", source: "project" }), "system");
    assert.equal(categorizeSkill({ name: "mc-a-b-c", source: "project" }), "system");
  });

  it("returns 'project' for project skills without the mc- prefix", () => {
    assert.equal(categorizeSkill({ name: "foo", source: "project" }), "project");
    assert.equal(categorizeSkill({ name: "my-skill", source: "project" }), "project");
  });

  it("treats names like 'mcfoo' (no dash) as project, not system", () => {
    assert.equal(categorizeSkill({ name: "mcfoo", source: "project" }), "project");
  });

  it("is case-sensitive: 'Mc-foo' is project, not system", () => {
    assert.equal(categorizeSkill({ name: "Mc-foo", source: "project" }), "project");
  });

  it("treats the bare prefix 'mc-' as system", () => {
    assert.equal(categorizeSkill({ name: "mc-", source: "project" }), "system");
  });

  it("treats an empty name + project as project (no prefix match)", () => {
    assert.equal(categorizeSkill({ name: "", source: "project" }), "project");
  });
});

describe("manageSkills isSkillSectionKey", () => {
  it("accepts the two canonical section keys", () => {
    assert.equal(isSkillSectionKey("active"), true);
    assert.equal(isSkillSectionKey("catalog"), true);
  });

  it("rejects unknown strings and non-string values", () => {
    assert.equal(isSkillSectionKey("Active"), false);
    assert.equal(isSkillSectionKey(""), false);
    assert.equal(isSkillSectionKey("system"), false);
    assert.equal(isSkillSectionKey("group"), false);
    assert.equal(isSkillSectionKey(123), false);
    assert.equal(isSkillSectionKey(null), false);
    assert.equal(isSkillSectionKey(undefined), false);
    assert.equal(isSkillSectionKey({}), false);
  });
});

describe("manageSkills loadCollapsedSections", () => {
  afterEach(() => {
    delete globalRef.window;
  });

  it("returns the default closed set when window is not defined", () => {
    delete globalRef.window;
    const result = loadCollapsedSections();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_SECTIONS].sort());
  });

  it("returns the default set when nothing is persisted", () => {
    const { storage } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedSections();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_SECTIONS].sort());
  });

  it("restores the persisted set when JSON is valid and all keys are known", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(["active", "catalog"]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedSections();
    assert.deepEqual([...result].sort(), ["active", "catalog"]);
  });

  it("filters out unknown keys when the persisted JSON is mixed", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(["catalog", "wat", "system", 42]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedSections();
    assert.deepEqual([...result].sort(), ["catalog"]);
  });

  it("returns an empty set when the persisted array is empty", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify([]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedSections();
    assert.equal(result.size, 0);
  });

  it("falls back to defaults when the persisted JSON is corrupted", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_SECTIONS_STORAGE_KEY, "{not-json");
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedSections();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_SECTIONS].sort());
  });

  it("ignores the legacy group-collapse key (different storage key)", () => {
    const { map, storage } = makeStorageShim();
    map.set("skills:groupCollapsed", JSON.stringify(["system"]));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedSections();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_SECTIONS].sort());
  });

  it("falls back to defaults when the persisted JSON is not an array", () => {
    const { map, storage } = makeStorageShim();
    map.set(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify({ active: true }));
    globalRef.window = { localStorage: storage };
    const result = loadCollapsedSections();
    assert.deepEqual([...result].sort(), [...DEFAULT_CLOSED_SECTIONS].sort());
  });
});

describe("manageSkills persistCollapsedSections", () => {
  afterEach(() => {
    delete globalRef.window;
  });

  it("writes a JSON array of section keys to localStorage", () => {
    const { map, storage } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    persistCollapsedSections(new Set(["active", "catalog"]));
    const raw = map.get(COLLAPSED_SECTIONS_STORAGE_KEY);
    assert.ok(raw, "expected localStorage to have a value at the key");
    const parsed: unknown = JSON.parse(raw);
    assert.ok(Array.isArray(parsed));
    assert.deepEqual([...parsed].sort(), ["active", "catalog"]);
  });

  it("writes an empty array when the set is empty", () => {
    const { map, storage } = makeStorageShim();
    globalRef.window = { localStorage: storage };
    persistCollapsedSections(new Set());
    assert.equal(map.get(COLLAPSED_SECTIONS_STORAGE_KEY), "[]");
  });

  it("swallows errors when localStorage.setItem throws (quota / private mode)", () => {
    const { storage } = makeStorageShim({ setItemThrows: true });
    globalRef.window = { localStorage: storage };
    assert.doesNotThrow(() => persistCollapsedSections(new Set(["catalog"])));
  });

  it("is a no-op when window is undefined", () => {
    delete globalRef.window;
    assert.doesNotThrow(() => persistCollapsedSections(new Set(["catalog"])));
  });
});

describe("manageSkills pickInitialSelection", () => {
  const skills = [
    { name: "a-skill", source: "project" as const },
    { name: "b-skill", source: "user" as const },
  ];

  it("returns null when the skill list is empty", () => {
    assert.equal(pickInitialSelection([], new Set()), null);
  });

  it("picks the first skill when the active section is open", () => {
    assert.equal(pickInitialSelection(skills, new Set()), "a-skill");
  });

  it("returns null when the active section is collapsed (row hidden)", () => {
    assert.equal(pickInitialSelection(skills, new Set(["active"])), null);
  });

  it("still picks the first skill when only the catalog section is collapsed", () => {
    assert.equal(pickInitialSelection(skills, new Set(["catalog"])), "a-skill");
  });

  it("returns the only skill's name for a single-entry list", () => {
    assert.equal(pickInitialSelection([{ name: "only-one", source: "user" as const }], new Set()), "only-one");
  });
});

describe("manageSkills section constants", () => {
  it("declares the two section keys in the expected order", () => {
    assert.deepEqual([...SKILL_SECTION_KEYS], ["active", "catalog"]);
  });

  it("maps every section to an i18n label key", () => {
    for (const key of SKILL_SECTION_KEYS) {
      const label = SECTION_LABEL_KEYS[key];
      assert.ok(typeof label === "string" && label.startsWith("pluginManageSkills.section"));
    }
  });

  it("uses the documented localStorage key and mc- prefix", () => {
    assert.equal(COLLAPSED_SECTIONS_STORAGE_KEY, "skills:sectionCollapsed");
    assert.equal(SYSTEM_SKILL_PREFIX, "mc-");
  });

  it("opens both sections by default (nothing collapsed)", () => {
    assert.deepEqual([...DEFAULT_CLOSED_SECTIONS], []);
  });
});
