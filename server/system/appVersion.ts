// The running app's version, read once from the nearest package.json.
//
// Layout is the same shape in both modes, so `../../package.json`
// relative to this file resolves correctly without a workspace walk:
//   - dev (`yarn dev`):  <repo>/server/system/appVersion.ts        → <repo>/package.json
//   - tarball (`npx`):   <pkgDir>/server/system/appVersion.ts      → <pkgDir>/package.json
// The launcher keeps `packages/mulmoclaude/package.json` in lockstep
// with the root version at publish time, so either resolution yields
// the same user-facing app version.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { errorMessage } from "../utils/errors.js";
import { log } from "./logger/index.js";

function readAppVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const { version } = parsed as { version: unknown };
      if (typeof version === "string" && version.length > 0) return version;
    }
    log.warn("appVersion", "package.json has no usable version field", { pkgPath });
  } catch (err) {
    log.warn("appVersion", "failed to read package.json", { pkgPath, error: errorMessage(err) });
  }
  return "unknown";
}

/** Frozen at module load — package.json never changes mid-process. */
export const APP_VERSION: string = readAppVersion();
