#!/usr/bin/env node
// Skip-if-fresh gate for `yarn dev`'s pre-flight workspace build (#1202).
//
// `yarn build:packages:dev` rebuilt all 6 workspace packages on every
// `yarn dev` invocation, costing ~8.5 s of warm-cache no-op work
// because tsc / vite-build don't keep a per-package incremental cache.
// This script compares the latest mtime under each package's `src/`
// (and `package.json`) against the latest mtime under `dist/`, and
// only rebuilds packages whose source is newer.
//
// Cold start (no `dist/`) is handled by the `distMtime === 0` branch
// in `isStale` — no special case needed.
//
// Flags:
//   --force   Rebuild every package regardless of mtime. Useful when
//             a `src/` file was deleted (deletions don't bump dir
//             mtime on macOS/Linux, so the gate would falsely skip).

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(__dirname);

// Mirrors the build order in `package.json#build:packages:dev`.
// Order matters: tsc packages export types that the vite ones consume,
// so deeper deps come first inside each tier and the script preserves
// that by walking the array in sequence (with no parallelism — keeps
// log output legible and avoids racing concurrent yarn invocations).
// Foundational packages that the dev tier depends on. Hard-coded
// because their dir names don't always match the npm name (e.g.
// `packages/scheduler/` publishes as `@receptron/task-scheduler`)
// and because `build:packages:dev` enumerates exactly these — drift
// from that script is a bug, not a feature.
export const DEV_FOUNDATIONAL_DIRS = ["packages/protocol", "packages/scheduler", "packages/client", "packages/chat-service"];

// Plugin tier — discovered to keep parity with
// `node scripts/build-workspaces.mjs packages/plugins @mulmoclaude --name-suffix=-plugin`,
// which is what `build:packages:dev` invokes. New `@mulmoclaude/<x>-plugin`
// directories under `packages/plugins/` get picked up automatically.
function discoverPluginDirs(repoRoot) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(join(repoRoot, "packages/plugins"), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJson = join(repoRoot, "packages/plugins", entry.name, "package.json");
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(pkgJson, "utf-8"));
    } catch {
      continue;
    }
    const { name, scripts } = parsed ?? {};
    if (typeof name !== "string") continue;
    if (!name.startsWith("@mulmoclaude/")) continue;
    if (!name.endsWith("-plugin")) continue;
    if (!scripts || typeof scripts.build !== "string") continue;
    found.push(join("packages", "plugins", entry.name));
  }
  found.sort();
  return found;
}

export function devPackageDirs(repoRoot) {
  return [...DEV_FOUNDATIONAL_DIRS, ...discoverPluginDirs(repoRoot)];
}

/** Latest mtime (ms) of any file under `dir`, recursively. 0 if missing. */
export function maxMtime(dir) {
  let max = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = maxMtime(full);
      if (child > max) max = child;
    } else if (entry.isFile()) {
      const stat = statSync(full);
      if (stat.mtimeMs > max) max = stat.mtimeMs;
    }
  }
  return max;
}

/** True when `<pkg>/dist/` is missing or older than the newest input. */
export function isStale(pkgDir) {
  const srcMtime = Math.max(maxMtime(join(pkgDir, "src")), fileMtime(join(pkgDir, "package.json")));
  const distMtime = maxMtime(join(pkgDir, "dist"));
  if (distMtime === 0) return true; // cold start
  return srcMtime > distMtime;
}

function fileMtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function main() {
  const force = process.argv.includes("--force");
  const dirs = devPackageDirs(REPO_ROOT);
  const stale = [];
  for (const rel of dirs) {
    const abs = join(REPO_ROOT, rel);
    if (force || isStale(abs)) stale.push(rel);
  }

  if (stale.length === 0) {
    console.log(`[dev-build] all ${dirs.length} workspace packages fresh — skipping build`);
    return;
  }

  // Delegate to the existing parallelised chain rather than rebuild
  // a per-package serial loop here. `build:packages:dev` already has
  // the right tier ordering (protocol/scheduler → client/chat-service
  // → plugins) and runs each tier through `concurrently`, so the
  // happy path (cold start, all stale) stays as fast as before. The
  // gate's only contribution is the all-fresh skip. Selective
  // single-package rebuild was tried — ~4 s for one stale plugin —
  // but the implementation cost (re-doing tier ordering, parallelism,
  // signal forwarding) outweighed the savings vs the existing 8 s
  // parallel full build.
  const names = stale.map((rel) => rel.replace("packages/", ""));
  console.log(`[dev-build] ${stale.length}/${dirs.length} stale (${names.join(", ")})${force ? " --force" : ""} — running yarn build:packages:dev`);
  execSync("yarn build:packages:dev", { cwd: REPO_ROOT, stdio: "inherit" });
}

// Only run when invoked directly. Importing for tests is a no-op.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
