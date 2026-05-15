// Install / uninstall flow tests for the external-skill catalog
// (#1383 / #1335 PR-C C1).
//
// The git binary is stubbed via the injectable `RunGit` so tests can
// fake the filesystem layout without shelling out. The stub records
// every command + simulates the side-effects:
//
//   - `init <dir>`            → mkdir + write `.git/` sentinel
//   - `config core.sparseCheckout true` → no-op (sparse pattern is
//     written separately by the production code in `clone.ts`)
//   - `fetch --depth=1 ...`   → no-op (working tree is pre-seeded by
//     the test before calling install)
//   - `checkout FETCH_HEAD`   → no-op
//   - `rev-parse HEAD`        → returns a deterministic 40-hex SHA

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { installExternalRepo, uninstallExternalRepo, listInstalledRepos } from "../../../../server/workspace/skills/external/install.js";
import type { RunGit } from "../../../../server/workspace/skills/external/clone.js";
import { urlCacheKey } from "../../../../server/workspace/skills/external/id.js";

let workdir: string;
let cacheRoot: string;
const FAKE_SHA = "a".repeat(40);

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "ext-install-test-"));
  cacheRoot = mkdtempSync(path.join(tmpdir(), "ext-install-cache-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(cacheRoot, { recursive: true, force: true });
});

// Stub `git` that materialises the cache dir on `init` and answers
// `rev-parse HEAD` with FAKE_SHA. Other commands are recorded for
// assertion but don't touch the filesystem.
function makeRunGit(cmds: string[][]): RunGit {
  return async (args) => {
    const list = [...args];
    cmds.push(list);
    if (list[0] === "init" && typeof list[1] === "string") {
      mkdirSync(path.join(list[1], ".git"), { recursive: true });
    }
    if (list.includes("rev-parse")) {
      return { stdout: `${FAKE_SHA}\n`, stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };
}

function seedSkill(dir: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), body);
}

describe("installExternalRepo", () => {
  it("rejects a non-github URL", async () => {
    const result = await installExternalRepo({ url: "https://gitlab.com/foo/bar" }, { workspaceRoot: workdir, cacheRoot, runGit: makeRunGit([]) });
    assert.equal(result.kind, "invalid-url");
  });

  it("rejects a path-traversal subpath before any git op", async () => {
    let called = false;
    const runGit: RunGit = async () => {
      called = true;
      return { stdout: "", stderr: "" };
    };
    const result = await installExternalRepo({ url: "https://github.com/foo/bar", subpath: "../../../etc" }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(result.kind, "invalid-subpath");
    assert.equal(called, false);
  });

  it("clones, discovers a single root SKILL.md, writes catalog + metadata", async () => {
    const url = "https://github.com/foo/cool-skill";
    const cacheDir = path.join(cacheRoot, urlCacheKey(url));
    // The fetch step would normally populate cacheDir from the
    // remote; instead seed it via a wrapper around our stub.
    const runGit: RunGit = async (args) => {
      const list = [...args];
      if (list[0] === "init" && typeof list[1] === "string") {
        mkdirSync(path.join(list[1], ".git"), { recursive: true });
      }
      if (list.includes("checkout")) {
        seedSkill(cacheDir, "---\ndescription: a cool skill\n---\nbody contents");
      }
      if (list.includes("rev-parse")) {
        return { stdout: `${FAKE_SHA}\n`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    const result = await installExternalRepo({ url }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(result.kind, "installed");
    if (result.kind !== "installed") return;
    assert.equal(result.detail.repoId, "foo-cool-skill");
    assert.equal(result.detail.sha, FAKE_SHA);
    assert.equal(result.detail.skillCount, 1);

    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-cool-skill");
    assert.equal(existsSync(path.join(repoDir, "SKILL.md")), true);
    assert.equal(existsSync(path.join(repoDir, ".source.json")), true);
    const meta = JSON.parse(readFileSync(path.join(repoDir, ".source.json"), "utf-8"));
    assert.equal(meta.url, url);
    assert.equal(meta.sha, FAKE_SHA);
  });

  it("clones with subpath, discovers many skills, writes one folder per skill", async () => {
    const url = "https://github.com/anthropics/skills";
    const cacheDir = path.join(cacheRoot, urlCacheKey(url));
    const runGit: RunGit = async (args) => {
      const list = [...args];
      if (list[0] === "init" && typeof list[1] === "string") {
        mkdirSync(path.join(list[1], ".git"), { recursive: true });
      }
      if (list.includes("checkout")) {
        seedSkill(path.join(cacheDir, "skills", "pdf-form-filler"), "---\ndescription: fill PDFs\n---\nbody");
        seedSkill(path.join(cacheDir, "skills", "excel-builder"), "---\ndescription: build excel\n---\nbody");
        // A dir without SKILL.md should be ignored.
        mkdirSync(path.join(cacheDir, "skills", "no-skill-here"), { recursive: true });
      }
      if (list.includes("rev-parse")) {
        return { stdout: `${FAKE_SHA}\n`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    const result = await installExternalRepo({ url, subpath: "skills" }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(result.kind, "installed");
    if (result.kind !== "installed") return;
    assert.equal(result.detail.repoId, "anthropics-skills");
    assert.equal(result.detail.skillCount, 2);

    const repoDir = path.join(workdir, "data/skills/catalog/external/anthropics-skills");
    assert.equal(existsSync(path.join(repoDir, "pdf-form-filler", "SKILL.md")), true);
    assert.equal(existsSync(path.join(repoDir, "excel-builder", "SKILL.md")), true);
    assert.equal(existsSync(path.join(repoDir, "no-skill-here")), false);
    // Verify sparse-checkout pattern was written.
    const sparse = readFileSync(path.join(cacheDir, ".git", "info", "sparse-checkout"), "utf-8");
    assert.match(sparse, /skills\/\*/);
  });

  it("returns no-skills when nothing matches", async () => {
    const url = "https://github.com/foo/empty";
    const cacheDir = path.join(cacheRoot, urlCacheKey(url));
    const runGit: RunGit = async (args) => {
      const list = [...args];
      if (list[0] === "init" && typeof list[1] === "string") {
        mkdirSync(path.join(list[1], ".git"), { recursive: true });
      }
      if (list.includes("checkout")) {
        // Cache dir is empty (no SKILL.md anywhere).
        mkdirSync(cacheDir, { recursive: true });
      }
      if (list.includes("rev-parse")) {
        return { stdout: `${FAKE_SHA}\n`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    const result = await installExternalRepo({ url }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(result.kind, "no-skills");
  });

  it("surfaces clone errors as kind=error", async () => {
    const runGit: RunGit = async () => {
      throw new Error("network unreachable");
    };
    const result = await installExternalRepo({ url: "https://github.com/foo/bar" }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(result.kind, "error");
    if (result.kind === "error") assert.match(result.reason, /network unreachable/);
  });

  it("wipes the previous catalog tree on re-install (removed skills don't linger)", async () => {
    const url = "https://github.com/foo/multi";
    const cacheDir = path.join(cacheRoot, urlCacheKey(url));
    let pass = 0;
    const runGit: RunGit = async (args) => {
      const list = [...args];
      if (list[0] === "init" && typeof list[1] === "string") {
        mkdirSync(path.join(list[1], ".git"), { recursive: true });
      }
      if (list.includes("checkout")) {
        // First install: two skills. Second install: only one.
        rmSync(path.join(cacheDir, "a"), { recursive: true, force: true });
        rmSync(path.join(cacheDir, "b"), { recursive: true, force: true });
        seedSkill(path.join(cacheDir, "a"), "---\ndescription: a\n---\nbody");
        // eslint-disable-next-line security/detect-possible-timing-attacks -- comparing iteration counter, not a secret
        if (pass === 0) seedSkill(path.join(cacheDir, "b"), "---\ndescription: b\n---\nbody");
        pass += 1;
      }
      if (list.includes("rev-parse")) {
        return { stdout: `${FAKE_SHA}\n`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    const first = await installExternalRepo({ url }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(first.kind, "installed");
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-multi");
    assert.equal(existsSync(path.join(repoDir, "a", "SKILL.md")), true);
    assert.equal(existsSync(path.join(repoDir, "b", "SKILL.md")), true);

    const second = await installExternalRepo({ url }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(second.kind, "installed");
    assert.equal(existsSync(path.join(repoDir, "a", "SKILL.md")), true);
    assert.equal(existsSync(path.join(repoDir, "b")), false);
  });

  it("no-skills does NOT mutate the catalog (no .source.json, prior install survives)", async () => {
    const url = "https://github.com/foo/sometimes-empty";
    const cacheDir = path.join(cacheRoot, urlCacheKey(url));
    let pass = 0;
    const runGit: RunGit = async (args) => {
      const list = [...args];
      if (list[0] === "init" && typeof list[1] === "string") {
        mkdirSync(path.join(list[1], ".git"), { recursive: true });
      }
      if (list.includes("checkout")) {
        rmSync(cacheDir, { recursive: true, force: true });
        mkdirSync(cacheDir, { recursive: true });
        // eslint-disable-next-line security/detect-possible-timing-attacks -- iteration counter, not a secret
        if (pass === 0) seedSkill(path.join(cacheDir, "a"), "---\ndescription: a\n---\nbody");
        pass += 1;
      }
      if (list.includes("rev-parse")) return { stdout: `${FAKE_SHA}\n`, stderr: "" };
      return { stdout: "", stderr: "" };
    };

    const first = await installExternalRepo({ url }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(first.kind, "installed");
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-sometimes-empty");
    assert.equal(existsSync(path.join(repoDir, "a", "SKILL.md")), true);

    // Second fetch yields nothing — must NOT wipe the prior install.
    const second = await installExternalRepo({ url }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(second.kind, "no-skills");
    assert.equal(existsSync(path.join(repoDir, "a", "SKILL.md")), true);
    const repos = await listInstalledRepos({ workspaceRoot: workdir });
    assert.equal(repos.length, 1);
  });

  it("does not write .source.json on a first install that finds no skills", async () => {
    const url = "https://github.com/foo/empty2";
    const cacheDir = path.join(cacheRoot, urlCacheKey(url));
    const runGit: RunGit = async (args) => {
      const list = [...args];
      if (list[0] === "init" && typeof list[1] === "string") {
        mkdirSync(path.join(list[1], ".git"), { recursive: true });
      }
      if (list.includes("checkout")) mkdirSync(cacheDir, { recursive: true });
      if (list.includes("rev-parse")) return { stdout: `${FAKE_SHA}\n`, stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const result = await installExternalRepo({ url }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(result.kind, "no-skills");
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-empty2");
    assert.equal(existsSync(path.join(repoDir, ".source.json")), false);
    assert.deepEqual(await listInstalledRepos({ workspaceRoot: workdir }), []);
  });

  it("ignores a symlinked SKILL.md and a symlinked skill dir (untrusted repo)", async () => {
    const url = "https://github.com/foo/evil";
    const cacheDir = path.join(cacheRoot, urlCacheKey(url));
    const secretDir = mkdtempSync(path.join(tmpdir(), "ext-secret-"));
    writeFileSync(path.join(secretDir, "SKILL.md"), "---\ndescription: exfiltrated\n---\nsecret");
    const runGit: RunGit = async (args) => {
      const list = [...args];
      if (list[0] === "init" && typeof list[1] === "string") {
        mkdirSync(path.join(list[1], ".git"), { recursive: true });
      }
      if (list.includes("checkout")) {
        mkdirSync(path.join(cacheDir, "good"), { recursive: true });
        writeFileSync(path.join(cacheDir, "good", "SKILL.md"), "---\ndescription: ok\n---\nbody");
        // Attack 1: a skill dir that is actually a symlink to a host dir.
        symlinkSync(secretDir, path.join(cacheDir, "linkdir"), "dir");
        // Attack 2: a real dir whose SKILL.md is a symlink to a host file.
        mkdirSync(path.join(cacheDir, "linkfile"), { recursive: true });
        symlinkSync(path.join(secretDir, "SKILL.md"), path.join(cacheDir, "linkfile", "SKILL.md"));
      }
      if (list.includes("rev-parse")) return { stdout: `${FAKE_SHA}\n`, stderr: "" };
      return { stdout: "", stderr: "" };
    };

    const result = await installExternalRepo({ url }, { workspaceRoot: workdir, cacheRoot, runGit });
    assert.equal(result.kind, "installed");
    if (result.kind === "installed") assert.equal(result.detail.skillCount, 1);
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-evil");
    assert.equal(existsSync(path.join(repoDir, "good", "SKILL.md")), true);
    assert.equal(existsSync(path.join(repoDir, "linkdir")), false);
    assert.equal(existsSync(path.join(repoDir, "linkfile")), false);
    rmSync(secretDir, { recursive: true, force: true });
  });

  it("refuses to overwrite a punctuation-colliding DIFFERENT repo (no data loss)", async () => {
    // `foo/a.b` and `foo/a-b` both derive repoId `foo-a-b`.
    const urlA = "https://github.com/foo/a.b";
    const urlB = "https://github.com/foo/a-b";
    const seedingRunGit = (url: string): RunGit => {
      const cacheDir = path.join(cacheRoot, urlCacheKey(url));
      return async (args) => {
        const list = [...args];
        if (list[0] === "init" && typeof list[1] === "string") {
          mkdirSync(path.join(list[1], ".git"), { recursive: true });
        }
        if (list.includes("checkout")) {
          seedSkill(path.join(cacheDir, "x"), "---\ndescription: x\n---\nbody");
        }
        if (list.includes("rev-parse")) return { stdout: `${FAKE_SHA}\n`, stderr: "" };
        return { stdout: "", stderr: "" };
      };
    };

    const instA = await installExternalRepo({ url: urlA }, { workspaceRoot: workdir, cacheRoot, runGit: seedingRunGit(urlA) });
    assert.equal(instA.kind, "installed");
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-a-b");
    assert.equal(JSON.parse(readFileSync(path.join(repoDir, ".source.json"), "utf-8")).url, urlA);

    const instB = await installExternalRepo({ url: urlB }, { workspaceRoot: workdir, cacheRoot, runGit: seedingRunGit(urlB) });
    assert.equal(instB.kind, "id-collision");
    if (instB.kind === "id-collision") assert.match(instB.existingUrl, /github\.com\/foo\/a\.b/);
    // Repo A's catalog + metadata must be untouched.
    assert.equal(existsSync(path.join(repoDir, "x", "SKILL.md")), true);
    assert.equal(JSON.parse(readFileSync(path.join(repoDir, ".source.json"), "utf-8")).url, urlA);
  });

  it("re-install of the SAME repo via a different accepted URL form still succeeds", async () => {
    const url1 = "https://github.com/foo/repo";
    const url2 = "https://github.com/foo/repo.git";
    const seedingRunGit = (url: string): RunGit => {
      const cacheDir = path.join(cacheRoot, urlCacheKey(url));
      return async (args) => {
        const list = [...args];
        if (list[0] === "init" && typeof list[1] === "string") {
          mkdirSync(path.join(list[1], ".git"), { recursive: true });
        }
        if (list.includes("checkout")) seedSkill(path.join(cacheDir, "x"), "---\ndescription: x\n---\nbody");
        if (list.includes("rev-parse")) return { stdout: `${FAKE_SHA}\n`, stderr: "" };
        return { stdout: "", stderr: "" };
      };
    };
    assert.equal((await installExternalRepo({ url: url1 }, { workspaceRoot: workdir, cacheRoot, runGit: seedingRunGit(url1) })).kind, "installed");
    // Same canonical repo → no collision, install succeeds again.
    assert.equal((await installExternalRepo({ url: url2 }, { workspaceRoot: workdir, cacheRoot, runGit: seedingRunGit(url2) })).kind, "installed");
  });
});

describe("listInstalledRepos", () => {
  it("returns [] when no external repos are installed", async () => {
    const repos = await listInstalledRepos({ workspaceRoot: workdir });
    assert.deepEqual(repos, []);
  });

  it("returns one entry per repo with valid metadata", async () => {
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-bar");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(
      path.join(repoDir, ".source.json"),
      JSON.stringify({ url: "https://github.com/foo/bar", sha: FAKE_SHA, installedAt: "2026-01-01T00:00:00Z" }),
    );
    const repos = await listInstalledRepos({ workspaceRoot: workdir });
    assert.equal(repos.length, 1);
    assert.equal(repos[0].repoId, "foo-bar");
    assert.equal(repos[0].url, "https://github.com/foo/bar");
  });

  it("skips repos with missing or malformed metadata", async () => {
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-bad");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, ".source.json"), "{not json");
    const repos = await listInstalledRepos({ workspaceRoot: workdir });
    assert.deepEqual(repos, []);
  });

  it("rejects unsafe repo-id directory names", async () => {
    const root = path.join(workdir, "data/skills/catalog/external");
    mkdirSync(root, { recursive: true });
    // Cannot actually create `..` as a dir name; use a name that
    // fails the safe-id regex instead.
    mkdirSync(path.join(root, "Foo_Bar"), { recursive: true });
    writeFileSync(
      path.join(root, "Foo_Bar", ".source.json"),
      JSON.stringify({ url: "https://github.com/foo/bar", sha: FAKE_SHA, installedAt: "2026-01-01T00:00:00Z" }),
    );
    const repos = await listInstalledRepos({ workspaceRoot: workdir });
    assert.deepEqual(repos, []);
  });
});

describe("uninstallExternalRepo", () => {
  it("removes the catalog dir and reports uninstalled", async () => {
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-bar");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(path.join(repoDir, "SKILL.md"), "---\ndescription: x\n---\n");
    writeFileSync(
      path.join(repoDir, ".source.json"),
      JSON.stringify({ url: "https://github.com/foo/bar", sha: FAKE_SHA, installedAt: "2026-01-01T00:00:00Z" }),
    );
    const result = await uninstallExternalRepo("foo-bar", { workspaceRoot: workdir, cacheRoot });
    assert.equal(result.kind, "uninstalled");
    assert.equal(existsSync(repoDir), false);
  });

  it("returns not-found when the repo dir is missing", async () => {
    const result = await uninstallExternalRepo("foo-missing", { workspaceRoot: workdir, cacheRoot });
    assert.equal(result.kind, "not-found");
  });

  it("rejects unsafe repoId strings", async () => {
    const result = await uninstallExternalRepo("../etc", { workspaceRoot: workdir, cacheRoot });
    assert.equal(result.kind, "invalid-repo-id");
  });

  it("leaves active copies under .claude/skills/ untouched", async () => {
    const repoDir = path.join(workdir, "data/skills/catalog/external/foo-bar");
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(
      path.join(repoDir, ".source.json"),
      JSON.stringify({ url: "https://github.com/foo/bar", sha: FAKE_SHA, installedAt: "2026-01-01T00:00:00Z" }),
    );
    const activeDir = path.join(workdir, ".claude/skills/foo-bar");
    mkdirSync(activeDir, { recursive: true });
    writeFileSync(path.join(activeDir, "SKILL.md"), "---\ndescription: starred\n---\n");
    const result = await uninstallExternalRepo("foo-bar", { workspaceRoot: workdir, cacheRoot });
    assert.equal(result.kind, "uninstalled");
    assert.equal(existsSync(path.join(activeDir, "SKILL.md")), true);
  });
});
