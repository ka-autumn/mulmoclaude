// Sparse-checkout refresh regression (#1386, CodeRabbit/CODEX
// blocker): re-installing the same URL with a different (or absent)
// subpath must re-apply `core.sparseCheckout` so the second checkout
// isn't constrained by the first install's stale pattern.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { cloneOrUpdate, type RunGit } from "../../../../server/workspace/skills/external/clone.js";
import { urlCacheKey } from "../../../../server/workspace/skills/external/id.js";

let cacheRoot: string;
const FAKE_SHA = "b".repeat(40);
const URL = "https://github.com/foo/bar";

beforeEach(() => {
  cacheRoot = mkdtempSync(path.join(tmpdir(), "ext-clone-test-"));
});

afterEach(() => {
  rmSync(cacheRoot, { recursive: true, force: true });
});

// Records every git invocation and materialises `.git/` on init so a
// second call reuses the existing clone (init becomes a no-op).
function recordingRunGit(cmds: string[][]): RunGit {
  return async (args) => {
    const list = [...args];
    cmds.push(list);
    if (list[0] === "init" && typeof list[1] === "string") {
      mkdirSync(path.join(list[1], ".git"), { recursive: true });
    }
    if (list.includes("rev-parse")) return { stdout: `${FAKE_SHA}\n`, stderr: "" };
    return { stdout: "", stderr: "" };
  };
}

function sparseFile(url: string): string {
  return path.join(cacheRoot, urlCacheKey(url), ".git", "info", "sparse-checkout");
}

describe("cloneOrUpdate — sparse-checkout refresh", () => {
  it("rewrites the sparse pattern when re-installed with a different subpath", async () => {
    const cmds: string[][] = [];
    const runGit = recordingRunGit(cmds);

    await cloneOrUpdate({ url: URL, subpath: "skills" }, { cacheRoot, runGit });
    assert.equal(readFileSync(sparseFile(URL), "utf-8").trim(), "skills/*");

    await cloneOrUpdate({ url: URL, subpath: "tools" }, { cacheRoot, runGit });
    assert.equal(readFileSync(sparseFile(URL), "utf-8").trim(), "tools/*");

    // `git init` only ran once (clone reused on the second call).
    assert.equal(cmds.filter((cmd) => cmd[0] === "init").length, 1);
  });

  it("disables sparse-checkout when re-installed without a subpath", async () => {
    const cmds: string[][] = [];
    const runGit = recordingRunGit(cmds);

    await cloneOrUpdate({ url: URL, subpath: "skills" }, { cacheRoot, runGit });
    await cloneOrUpdate({ url: URL }, { cacheRoot, runGit });

    const disabled = cmds.some((cmd) => cmd.includes("config") && cmd.includes("core.sparseCheckout") && cmd.includes("false"));
    assert.equal(disabled, true);
  });

  it("rejects an invalid URL before any git op", async () => {
    const cmds: string[][] = [];
    await assert.rejects(() => cloneOrUpdate({ url: "https://gitlab.com/foo/bar" }, { cacheRoot, runGit: recordingRunGit(cmds) }), /invalid GitHub HTTPS URL/);
    assert.equal(cmds.length, 0);
  });

  it("shares one cache dir across accepted URL variants", async () => {
    const cmds: string[][] = [];
    const runGit = recordingRunGit(cmds);
    await cloneOrUpdate({ url: "https://github.com/foo/bar" }, { cacheRoot, runGit });
    await cloneOrUpdate({ url: "https://github.com/foo/bar.git" }, { cacheRoot, runGit });
    // Same cache key → `git init` ran only once.
    assert.equal(cmds.filter((cmd) => cmd[0] === "init").length, 1);
    assert.equal(existsSync(path.join(cacheRoot, urlCacheKey("https://github.com/foo/bar"))), true);
  });
});
