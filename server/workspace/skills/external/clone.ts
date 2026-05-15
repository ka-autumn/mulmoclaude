// Git sparse-checkout helper for the external-skill catalog
// (#1383 / #1335 PR-C).
//
// Responsibilities:
//   - Clone or fetch into a workspace-EXTERNAL scratch dir keyed by
//     hash(url) so multiple installs of the same URL (with different
//     subpaths) share one `.git/`.
//   - Apply a sparse-checkout pattern when `subpath` is provided so
//     huge multi-skill repos don't materialise files we won't use.
//   - Return the resolved commit SHA + cache dir so the install
//     layer can scan for SKILL.md and write its own `.source.json`.
//
// The git binary is invoked through `execFile` (no shell) and the
// runner is injectable via `deps.runGit` so unit tests can fake the
// filesystem layout without ever shelling out.

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ONE_MINUTE_MS } from "../../../utils/time.js";
import { parseGitHubHttpsUrl, urlCacheKey } from "./id.js";

const execFileP = promisify(execFile);

const GIT_OP_TIMEOUT_MS = ONE_MINUTE_MS;

export interface CloneOptions {
  url: string;
  subpath?: string;
  /** Branch / tag / SHA to fetch. Default: "HEAD". */
  ref?: string;
}

export interface CloneResult {
  /** Absolute path to the populated cache dir (contains `.git/` plus
   *  the checked-out tree). */
  cacheDir: string;
  /** Commit SHA pointed to by `HEAD` after fetch. */
  sha: string;
}

export type RunGit = (args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

/** Default git runner: shells out to `git` on PATH with no shell
 *  involvement (execFile, not exec). The workspace init already
 *  assumes `git` is available (see `server/workspace/workspace.ts`),
 *  so this isn't a new dependency. */
export const defaultRunGit: RunGit = async (args) => execFileP("git", args.slice(), { timeout: GIT_OP_TIMEOUT_MS });

/** Default scratch root: `~/.cache/mulmoclaude/sources/`. Kept
 *  outside the workspace so `.git/` clutter doesn't end up in the
 *  user's workspace git history or Obsidian sync. */
export function defaultCacheRoot(): string {
  return path.join(homedir(), ".cache", "mulmoclaude", "sources");
}

export interface CloneDeps {
  cacheRoot?: string;
  runGit?: RunGit;
}

/** One-time repo creation: `git init` + `remote add`. No-op once
 *  `.git/` exists (re-installs reuse the existing clone). */
async function initRepoOnce(cacheDir: string, url: string, runGit: RunGit): Promise<void> {
  if (existsSync(path.join(cacheDir, ".git"))) return;
  await runGit(["init", cacheDir]);
  await runGit(["-C", cacheDir, "remote", "add", "origin", url]);
}

/** Apply sparse-checkout config to match the CURRENT request — runs
 *  on every call, not just first init. Without this, re-installing
 *  the same URL with a different (or absent) `subpath` would keep the
 *  stale pattern from the first install, so `git checkout` stays
 *  constrained and discovery wrongly reports `no-skills`. Caller
 *  guarantees `subpath` is already sanitised. */
async function applySparseCheckout(cacheDir: string, subpath: string | undefined, runGit: RunGit): Promise<void> {
  if (!subpath) {
    // Lift any constraint left by a previous subpath install.
    await runGit(["-C", cacheDir, "config", "core.sparseCheckout", "false"]);
    return;
  }
  await runGit(["-C", cacheDir, "config", "core.sparseCheckout", "true"]);
  // sparse-checkout pattern is one entry per line; we want the
  // entire subpath subtree.
  const sparseFile = path.join(cacheDir, ".git", "info", "sparse-checkout");
  await mkdir(path.dirname(sparseFile), { recursive: true });
  await writeFile(sparseFile, `${subpath}/*\n`);
}

/** Fetch `ref` at depth 1, check it out, and return the resolved
 *  40-hex SHA. Throws if `rev-parse` yields anything unexpected. */
async function fetchAndResolveSha(cacheDir: string, ref: string, runGit: RunGit): Promise<string> {
  // `--depth=1` keeps the scratch dir small; we only need the current
  // tree, never history. `--no-tags` avoids pulling release-tag noise.
  await runGit(["-C", cacheDir, "fetch", "--depth=1", "--no-tags", "origin", ref]);
  await runGit(["-C", cacheDir, "checkout", "FETCH_HEAD"]);
  const { stdout: shaRaw } = await runGit(["-C", cacheDir, "rev-parse", "HEAD"]);
  const sha = shaRaw.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`git rev-parse returned unexpected output: ${JSON.stringify(shaRaw)}`);
  }
  return sha;
}

/** Initialise (or refresh) a scratch clone for the given URL and
 *  return the cache dir + resolved SHA. Idempotent: a second call
 *  with the same URL only fetches new commits and re-checks-out. */
export async function cloneOrUpdate(opts: CloneOptions, deps: CloneDeps = {}): Promise<CloneResult> {
  // Defense-in-depth: the install layer already validates via
  // `deriveRepoId`, but re-checking here keeps the function safe
  // against direct callers (tests / future refactors) so an
  // unvalidated URL can never reach `git`.
  if (!parseGitHubHttpsUrl(opts.url)) {
    throw new Error(`invalid GitHub HTTPS URL: ${opts.url}`);
  }
  const runGit = deps.runGit ?? defaultRunGit;
  const cacheRoot = deps.cacheRoot ?? defaultCacheRoot();
  const cacheDir = path.join(cacheRoot, urlCacheKey(opts.url));

  await mkdir(cacheDir, { recursive: true });
  await initRepoOnce(cacheDir, opts.url, runGit);
  await applySparseCheckout(cacheDir, opts.subpath, runGit);
  const sha = await fetchAndResolveSha(cacheDir, opts.ref ?? "HEAD", runGit);
  return { cacheDir, sha };
}
