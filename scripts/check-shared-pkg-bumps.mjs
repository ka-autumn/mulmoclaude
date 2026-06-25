// Shared-package version-bump guard.
//
// The `@mulmoclaude/*` packages under `packages/plugins/` and
// `packages/services/` are consumed by BOTH MulmoClaude and MulmoTerminal,
// and the two apps share one `~/mulmoclaude/` workspace. So a change to one
// of these packages that ships WITHOUT a version bump means the two apps can
// run different published versions against the same data — a cross-app
// data-correctness skew, not just a missing feature (e.g. the `safeRecordId`
// dotted-id rule in collection-plugin: app A writes a record id app B can't
// address). The `@mulmobridge/*` drift check (scripts/mulmoclaude/drift.mjs)
// does NOT cover this scope, so this guard fills the gap.
//
// Two rules, both relative to the PR base ref:
//   1. If any file under a published `@mulmoclaude/*` package changed, its
//      `version` must be STRICTLY GREATER than the base version (a mere
//      change — or a downgrade — isn't a publishable bump).
//   2. A change under a shared, non-package subtree (e.g.
//      `packages/plugins/shared/**`, which published plugins bundle) can alter
//      a package artifact without touching that package's own files — flag it
//      so the author bumps every package that bundles it.
// Pure git + fs; no install/build needed.
//
// Usage:
//   node scripts/check-shared-pkg-bumps.mjs            # base = origin/main
//   node scripts/check-shared-pkg-bumps.mjs <base-ref> # explicit base
//   BASE_SHA=<sha> node scripts/check-shared-pkg-bumps.mjs   # CI

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHARED_DIRS = ["packages/plugins", "packages/services"];
const SCOPE = "@mulmoclaude/";

const base = process.env.BASE_SHA || process.argv[2] || "origin/main";

function git(args) {
  return execFileSync("git", args, { encoding: "utf-8" });
}

/** git always speaks forward slashes, even on Windows where `path.join`
 *  yields backslashes — normalise before any `diff -- <path>` / `show ref:path`. */
const toGitPath = (p) => p.split(path.sep).join("/");

/** Files under `dir` that this branch changed since it diverged from `base`
 *  (three-dot = merge-base..HEAD, so a base that moved ahead doesn't count). */
function changedUnder(dir) {
  const out = git(["diff", "--name-only", `${base}...HEAD`, "--", toGitPath(dir)]).trim();
  return out ? out.split("\n") : [];
}

/** `version` of a package.json as it exists at `base`, or null when the file
 *  didn't exist there (a brand-new package — nothing published to skew). */
function versionAtBase(pkgJsonRel) {
  try {
    return JSON.parse(git(["show", `${base}:${toGitPath(pkgJsonRel)}`])).version ?? null;
  } catch {
    return null;
  }
}

/** True iff semver `a` is strictly greater than `b` (numeric major.minor.patch;
 *  the shared packages don't use prerelease tags, so a plain triple compare is
 *  enough). A downgrade or an equal version returns false. */
function isHigher(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Top-level package.json fields that, when changed in isolation, do NOT alter
 *  what consumers install and therefore do NOT warrant a publish-bump:
 *
 *    - `devDependencies` — never installed by consumers (npm/yarn/pnpm skip
 *      them on `--production` and at transitive install)
 *    - `scripts`         — only run locally / in CI, not at consumer install
 *    - `version`         — guard's own state; allowed here so the same exempt
 *      pattern keeps working when the author bumps version alongside a
 *      devDeps-only sweep (the `isHigher` check would catch that case
 *      anyway, but listing it here lets the exempt logic stay obvious)
 *
 *  Everything else (`dependencies`, `peerDependencies`, `optionalDependencies`,
 *  `exports`, `files`, `main`, `module`, `types`, `bin`, `engines`, …) MUST
 *  trigger a bump because it changes the install-time contract consumers
 *  observe. */
export const NON_SHIPPING_PKG_JSON_KEYS = new Set(["devDependencies", "scripts", "version"]);

/** Pure helper: compare two parsed package.json objects and return true when
 *  every key whose value differs is in `NON_SHIPPING_PKG_JSON_KEYS`. Exported
 *  for unit testing — the I/O-bound wrapper `isNonShippingChange` below uses
 *  git + fs to fetch the two JSONs, then delegates the decision here. */
export function packageJsonDiffShipsNothing(baseJson, headJson) {
  const allKeys = new Set([...Object.keys(baseJson), ...Object.keys(headJson)]);
  for (const key of allKeys) {
    if (JSON.stringify(baseJson[key]) === JSON.stringify(headJson[key])) continue;
    if (!NON_SHIPPING_PKG_JSON_KEYS.has(key)) return false;
  }
  return true;
}

/** True when the ONLY file this branch changed under <pkgDir> is its
 *  package.json, AND the only top-level keys that differ between base and
 *  HEAD are in `NON_SHIPPING_PKG_JSON_KEYS`. Lets cross-workspace devDep
 *  sweeps (e.g. `@types/node` 26.0.0 → 26.0.1 in every package.json) land
 *  without forcing 15+ identical publish bumps that consumers can't even
 *  observe. */
function isNonShippingChange(pkgDir, pkgJsonRel) {
  const changed = changedUnder(pkgDir);
  if (changed.length !== 1) return false;
  if (changed[0] !== toGitPath(pkgJsonRel)) return false;
  let baseJson;
  try {
    baseJson = JSON.parse(git(["show", `${base}:${toGitPath(pkgJsonRel)}`]));
  } catch {
    return false; // can't classify a brand-new package this way — let caller decide
  }
  const headJson = JSON.parse(readFileSync(pkgJsonRel, "utf-8"));
  return packageJsonDiffShipsNothing(baseJson, headJson);
}

// Only run the CLI when this file is invoked directly. When imported by a
// unit test (`test/scripts/test_check_shared_pkg_bumps.ts`) we want the pure
// helpers without the side-effecting git / fs walk that follows.
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (!isCli) {
  // imported as a module — pure exports above are enough.
} else {
  runCli();
}

function runCli() {
const failures = [];
const packageDirs = []; // every subdir holding a package.json, for orphan exclusion

for (const root of SHARED_DIRS) {
  if (!existsSync(root)) continue;
  for (const name of readdirSync(root)) {
    const pkgDir = path.join(root, name);
    const pkgJsonRel = path.join(pkgDir, "package.json");
    if (!existsSync(pkgJsonRel)) continue;
    packageDirs.push(pkgDir);
    const pkg = JSON.parse(readFileSync(pkgJsonRel, "utf-8"));
    if (!pkg.name?.startsWith(SCOPE) || pkg.private === true) continue;
    if (changedUnder(pkgDir).length === 0) continue;
    const baseVersion = versionAtBase(pkgJsonRel);
    if (baseVersion === null) continue; // new package — nothing published to skew
    // Cross-workspace devDep / script sweeps (e.g. `@types/node` patch bump
    // touching every package.json) don't change what consumers install — skip
    // the bump requirement so the author doesn't have to publish-bump every
    // package for a change that ships nothing.
    if (isNonShippingChange(pkgDir, pkgJsonRel)) continue;
    if (!isHigher(pkg.version, baseVersion)) {
      failures.push(`${pkg.name} — changed, but version ${pkg.version} is not greater than base ${baseVersion}`);
    }
  }
}

// Rule 2: changes in a non-package subtree (its first path segment under a
// shared root has no package.json) — bundled into published packages but
// invisible to the per-package check above. Loose files directly under the
// root (config, README) are not shipped, so they're excluded.
const orphans = [];
for (const root of SHARED_DIRS) {
  if (!existsSync(root)) continue;
  for (const file of changedUnder(root)) {
    if (packageDirs.some((dir) => file.startsWith(`${toGitPath(dir)}/`))) continue;
    const segments = path.relative(root, file.split("/").join(path.sep)).split(path.sep);
    if (segments.length < 2) continue; // loose file at the root, not a shipped subtree
    // A whole-package deletion (its package.json existed at base but is gone in
    // HEAD — e.g. a package consolidated into @mulmoclaude/core) ships nothing to
    // skew: the package is removed, not version-skewed. Its now-deleted files
    // would otherwise read as orphan shared source since the dir dropped out of
    // `packageDirs`. Symmetric to the "new package — nothing to skew" skip above.
    const removedPkgJsonRel = path.join(root, segments[0], "package.json");
    if (!existsSync(removedPkgJsonRel) && versionAtBase(removedPkgJsonRel) !== null) continue;
    orphans.push(file);
  }
}
if (orphans.length > 0) {
  failures.push(`shared source changed outside any package — bump every package that bundles it:\n      ${orphans.join("\n      ")}`);
}

if (failures.length > 0) {
  console.error(`Shared @mulmoclaude/* version-bump guard failed (base: ${base}):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\nBump the affected package's "version" in its package.json (publish on the next cascade).`);
  console.error("These packages are consumed by BOTH MulmoClaude and MulmoTerminal and share workspace data,");
  console.error("so an unbumped change ships a version skew between the two apps.");
  process.exit(1);
}
console.log(`✓ all changed @mulmoclaude/* shared packages are version-bumped vs ${base}`);
}
