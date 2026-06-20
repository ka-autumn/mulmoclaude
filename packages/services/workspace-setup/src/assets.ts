// Resolve the package's BUNDLED assets (shipped via package.json `files`) and seed
// them into a workspace. ESM-only: `import.meta.url` points at this module under
// `dist/`, so `../assets` is the package's assets dir at the package root. (The
// package builds ESM only — `import.meta.url` isn't available under CJS; both hosts
// run the server as ESM via tsx.)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

const ASSETS_DIR = fileURLToPath(new URL("../assets", import.meta.url));

/** The bundled help-docs source dir (`assets/helps/`). */
export function helpsAssetDir(): string {
  return path.join(ASSETS_DIR, "helps");
}

/** The bundled preset-skills source dir (`assets/skills-preset/`) — pass as the
 *  `sourceDir` of `syncPresetSkills` / `syncActivePresetSkills`. */
export function presetSkillsAssetDir(): string {
  return path.join(ASSETS_DIR, "skills-preset");
}

/** Copy every bundled help doc into `destDir` (created if missing). Idempotent —
 *  overwrites on each call so the help docs always track the package's version. */
export function seedHelps(opts: { destDir: string }): void {
  mkdirSync(opts.destDir, { recursive: true });
  const src = helpsAssetDir();
  for (const file of readdirSync(src)) {
    copyFileSync(path.join(src, file), path.join(opts.destDir, file));
  }
}
