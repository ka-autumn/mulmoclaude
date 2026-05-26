// Unit tests for the skill-bridge handler. The handler mirrors
// edits + deletes from `data/skills/<slug>/` into
// `.claude/skills/<slug>/` — but only for an allowlist of files
// (SKILL.md, schema.json, templates/*.md). We verify the path math
// and the regex gating directly, plus a smoke test of the mirror
// copy / delete against a real tmp workspace.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bridgeTargetFromDataPath,
  claudeSkillDir,
  claudeSkillFilePath,
  dataSkillDir,
  dataSkillFilePath,
  handleSkillBridge,
  slugFromRmCommand,
} from "../../../../server/workspace/hooks/handlers/skillBridge.js";

function setWorkspace(root: string): void {
  // The handler reads CLAUDE_PROJECT_DIR at call time. Mutating
  // env before each test gives us a clean per-test workspace.
  process.env.CLAUDE_PROJECT_DIR = root;
}

describe("bridgeTargetFromDataPath", () => {
  it("matches data/skills/<slug>/SKILL.md", () => {
    setWorkspace("/ws");
    assert.deepEqual(bridgeTargetFromDataPath("/ws/data/skills/nazonazo/SKILL.md"), { slug: "nazonazo", relSegments: ["SKILL.md"] });
    assert.deepEqual(bridgeTargetFromDataPath("/ws/data/skills/my-skill/SKILL.md"), { slug: "my-skill", relSegments: ["SKILL.md"] });
  });

  it("matches data/skills/<slug>/schema.json (collection definition)", () => {
    // A collection skill ships a schema.json next to SKILL.md;
    // without it crossing the gate the collection never registers.
    setWorkspace("/ws");
    assert.deepEqual(bridgeTargetFromDataPath("/ws/data/skills/swimming/schema.json"), { slug: "swimming", relSegments: ["schema.json"] });
  });

  it("matches any safe action-template path under templates/ (matches the schema validator)", () => {
    // Action templates referenced by a schema's `actions` must cross.
    // The accepted set is exactly what `isSafeActionTemplatePath`
    // allows (the same predicate discovery validates against): a safe
    // path under `templates/`, nesting + any extension permitted — so
    // a valid schema can never reference a template the bridge drops.
    setWorkspace("/ws");
    assert.deepEqual(bridgeTargetFromDataPath("/ws/data/skills/invoice/templates/journal-sale.md"), {
      slug: "invoice",
      relSegments: ["templates", "journal-sale.md"],
    });
    assert.deepEqual(
      bridgeTargetFromDataPath("/ws/data/skills/invoice/templates/mail/welcome.md"),
      {
        slug: "invoice",
        relSegments: ["templates", "mail", "welcome.md"],
      },
      "nested template path",
    );
    assert.deepEqual(
      bridgeTargetFromDataPath("/ws/data/skills/foo/templates/report.txt"),
      {
        slug: "foo",
        relSegments: ["templates", "report.txt"],
      },
      "non-.md extension allowed",
    );
  });

  it("rejects non-staging paths", () => {
    setWorkspace("/ws");
    assert.equal(bridgeTargetFromDataPath("/ws/data/wiki/foo.md"), null);
    assert.equal(bridgeTargetFromDataPath("/ws/.claude/skills/foo/SKILL.md"), null);
    assert.equal(bridgeTargetFromDataPath("/elsewhere/data/skills/foo/SKILL.md"), null);
  });

  it("rejects non-allowlisted sibling files in the staging skill dir", () => {
    // Only SKILL.md / schema.json / templates/*.md cross over —
    // READMEs, assets, and arbitrary files stay staging-side. The
    // agent writing `data/skills/foo/README.md` by mistake should
    // be a no-op, not a mis-mirror.
    setWorkspace("/ws");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo/README.md"), null);
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo/notes.json"), null);
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo/assets/img.png"), null);
  });

  it("rejects template-like paths that aren't under templates/ or that traverse", () => {
    setWorkspace("/ws");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo/assets/x.md"), null, "non-templates subdir rejected");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo/prompts/x.md"), null, "must be under templates/, not a sibling dir");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo/templates/../escape.md"), null, "traversal rejected");
  });

  it("rejects flat <slug>.md (the old layout)", () => {
    // Earlier draft used `data/skills/<slug>.md`. The agent's
    // natural skill shape is nested-with-SKILL.md, so the flat
    // form is no longer recognised. Document the change here so
    // a partial revert can't silently re-introduce it.
    setWorkspace("/ws");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo.md"), null);
  });

  it("rejects invalid slugs", () => {
    setWorkspace("/ws");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/Foo/SKILL.md"), null, "uppercase rejected");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo_bar/SKILL.md"), null, "underscore rejected");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/-foo/SKILL.md"), null, "leading hyphen rejected");
    assert.equal(bridgeTargetFromDataPath("/ws/data/skills/foo--bar/SKILL.md"), null, "double hyphen rejected");
  });
});

describe("slugFromRmCommand", () => {
  it("matches `rm -rf data/skills/<slug>/` and variants with recursive flags", () => {
    assert.equal(slugFromRmCommand("rm -rf data/skills/nazonazo/"), "nazonazo");
    assert.equal(slugFromRmCommand("rm -rf data/skills/nazonazo"), "nazonazo");
    assert.equal(slugFromRmCommand("rm -r data/skills/foo/"), "foo");
    assert.equal(slugFromRmCommand("rm -R data/skills/foo"), "foo", "capital -R also recursive");
    assert.equal(slugFromRmCommand("rm -fr data/skills/foo"), "foo", "flag order doesn't matter");
    assert.equal(slugFromRmCommand("rm -rf 'data/skills/my-skill/'"), "my-skill");
  });

  it("rejects non-recursive forms (rm / rm -f) — they can't delete a directory, so mirroring would desync", () => {
    // Codex regression: `rm` / `rm -f` against `data/skills/<slug>/`
    // (a dir) fails with "is a directory" — the staging copy stays,
    // but the previous regex would still let us delete the canonical
    // tree. Strictly require a recursive flag now.
    assert.equal(slugFromRmCommand("rm data/skills/nazonazo"), null);
    assert.equal(slugFromRmCommand("rm -f data/skills/nazonazo"), null);
    assert.equal(slugFromRmCommand("rm -fv data/skills/nazonazo"), null, "verbose-only still rejected");
    assert.equal(slugFromRmCommand("rm -i data/skills/nazonazo"), null, "interactive-only rejected");
  });

  it("rejects wildcards and parent-dir deletes", () => {
    // Mass deletes via wildcards or wiping the whole staging dir
    // must NOT be mirrored — one typo could otherwise wipe every
    // skill in .claude/skills/.
    assert.equal(slugFromRmCommand("rm -rf data/skills/*"), null);
    assert.equal(slugFromRmCommand("rm -rf data/skills/"), null);
    assert.equal(slugFromRmCommand("rm -rf data/skills"), null);
    assert.equal(slugFromRmCommand("rm -rf data/skills/foo data/skills/bar"), null);
  });

  it("rejects non-rm commands", () => {
    assert.equal(slugFromRmCommand("ls data/skills/"), null);
    assert.equal(slugFromRmCommand("mv data/skills/foo data/skills/bar"), null);
  });
});

describe("handleSkillBridge — mirror copy", () => {
  it("copies data/skills/<slug>/SKILL.md to .claude/skills/<slug>/SKILL.md on Write", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-write-"));
    setWorkspace(root);
    await mkdir(dataSkillDir("nazonazo"), { recursive: true });
    const content = "---\nname: nazonazo\n---\n\n# Test skill\n";
    await writeFile(dataSkillFilePath("nazonazo"), content, "utf-8");

    await handleSkillBridge({
      tool_name: "Write",
      tool_input: { file_path: dataSkillFilePath("nazonazo") },
    });

    const mirrored = await readFile(claudeSkillFilePath("nazonazo"), "utf-8");
    assert.equal(mirrored, content);

    await rm(root, { recursive: true, force: true });
  });

  it("copies schema.json to .claude/skills/<slug>/schema.json on Write", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-schema-"));
    setWorkspace(root);
    await mkdir(dataSkillDir("swimming"), { recursive: true });
    const schemaPath = path.join(dataSkillDir("swimming"), "schema.json");
    const content = '{\n  "title": "Swimming Log",\n  "primaryKey": "id",\n  "fields": {}\n}\n';
    await writeFile(schemaPath, content, "utf-8");

    await handleSkillBridge({
      tool_name: "Write",
      tool_input: { file_path: schemaPath },
    });

    const mirrored = await readFile(path.join(claudeSkillDir("swimming"), "schema.json"), "utf-8");
    assert.equal(mirrored, content);

    await rm(root, { recursive: true, force: true });
  });

  it("copies templates/<name>.md into .claude/skills/<slug>/templates/ (creates the subdir)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-template-"));
    setWorkspace(root);
    await mkdir(path.join(dataSkillDir("invoice"), "templates"), { recursive: true });
    const tplPath = path.join(dataSkillDir("invoice"), "templates", "journal-sale.md");
    const content = "# Record sale\n\nPost the receivable journal.\n";
    await writeFile(tplPath, content, "utf-8");

    await handleSkillBridge({
      tool_name: "Write",
      tool_input: { file_path: tplPath },
    });

    const mirrored = await readFile(path.join(claudeSkillDir("invoice"), "templates", "journal-sale.md"), "utf-8");
    assert.equal(mirrored, content);

    await rm(root, { recursive: true, force: true });
  });

  it("does NOT mirror a non-allowlisted sibling (README.md)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-sibling-"));
    setWorkspace(root);
    await mkdir(dataSkillDir("foo"), { recursive: true });
    const readmePath = path.join(dataSkillDir("foo"), "README.md");
    await writeFile(readmePath, "scratch notes", "utf-8");

    await handleSkillBridge({
      tool_name: "Write",
      tool_input: { file_path: readmePath },
    });

    // Nothing crossed — the canonical skill dir was never created.
    assert.equal(existsSync(claudeSkillDir("foo")), false);

    await rm(root, { recursive: true, force: true });
  });

  it("removes .claude/skills/<slug>/ on a matching Bash rm -rf", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-delete-"));
    setWorkspace(root);
    await mkdir(path.join(claudeSkillDir("doomed"), "templates"), { recursive: true });
    await writeFile(claudeSkillFilePath("doomed"), "---\nname: doomed\n---", "utf-8");
    // A collection skill: prove the whole-dir delete sweeps the
    // schema + templates too, leaving no orphans behind.
    await writeFile(path.join(claudeSkillDir("doomed"), "schema.json"), "{}", "utf-8");
    await writeFile(path.join(claudeSkillDir("doomed"), "templates", "x.md"), "# x", "utf-8");

    await handleSkillBridge({
      tool_name: "Bash",
      tool_input: { command: "rm -rf data/skills/doomed/" },
    });

    // Whole `.claude/skills/doomed/` is gone — not just the SKILL.md
    // file. Collections carry schema.json + templates/ and we don't
    // want orphans dangling.
    assert.equal(existsSync(claudeSkillDir("doomed")), false);

    await rm(root, { recursive: true, force: true });
  });

  it("mirror copy completes BEFORE the refresh POST fires (no race)", async () => {
    // Regression for Codex review on this PR: previously
    // `handleConfigRefresh` ran in parallel with this handler, so
    // `/api/config/refresh` could land before the canonical
    // `.claude/skills/<slug>/SKILL.md` existed and the server's
    // skill scan would miss the new file. Now `skillBridge` owns
    // the refresh POST and fires it AFTER mirrorWrite. This test
    // captures the request order by intercepting `fetch`.
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-race-"));
    setWorkspace(root);
    await mkdir(dataSkillDir("racey"), { recursive: true });
    await writeFile(dataSkillFilePath("racey"), "---\nname: racey\n---\n", "utf-8");
    // Provide token + port sidecars so buildAuthPost returns a
    // real request (otherwise safePost short-circuits to no-op).
    await writeFile(path.join(root, ".session-token"), "test-token", "utf-8");
    await writeFile(path.join(root, ".server-port"), "65535", "utf-8");

    const callOrder: { url: string; canonicalExists: boolean }[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      callOrder.push({ url, canonicalExists: existsSync(claudeSkillFilePath("racey")) });
      return new Response(null, { status: 204 });
    };
    try {
      await handleSkillBridge({
        tool_name: "Write",
        tool_input: { file_path: dataSkillFilePath("racey") },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Two fetches: /api/config/refresh, then /api/hooks/log.
    // Both must observe the canonical file already on disk —
    // i.e. mirrorWrite ran before either POST.
    assert.ok(callOrder.length >= 1, "at least one fetch (refresh) should fire");
    const refreshCall = callOrder.find((entry) => entry.url.endsWith("/api/config/refresh"));
    assert.ok(refreshCall, "/api/config/refresh must be called");
    assert.equal(refreshCall.canonicalExists, true, "canonical SKILL.md must exist before /api/config/refresh fires");

    await rm(root, { recursive: true, force: true });
  });

  it("ignores writes outside data/skills/", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skill-bridge-noop-"));
    setWorkspace(root);
    await mkdir(path.join(root, "data", "wiki"), { recursive: true });
    await writeFile(path.join(root, "data", "wiki", "page.md"), "wiki content", "utf-8");

    await handleSkillBridge({
      tool_name: "Write",
      tool_input: { file_path: path.join(root, "data", "wiki", "page.md") },
    });

    // Nothing was mirrored into .claude/skills/.
    assert.equal(existsSync(path.join(root, ".claude", "skills")), false);

    await rm(root, { recursive: true, force: true });
  });
});
