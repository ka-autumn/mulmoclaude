// One-shot migration: rename the worklog plugin's on-disk directory
// after the package was renamed from `@mulmoclaude/worklog` to
// `@mulmoclaude/worklog-plugin` (post-PR-#1465 cleanup).
//
// The runtime keys each plugin's `files.data` / `files.config` root by
// `encodeURIComponent(pkgName)` (see `sanitisePackageNameForFs` in
// `server/plugins/runtime.ts`), so the directory name changed too:
//
//   data/plugins/%40mulmoclaude%2Fworklog/     → %40mulmoclaude%2Fworklog-plugin/
//   config/plugins/%40mulmoclaude%2Fworklog/   → %40mulmoclaude%2Fworklog-plugin/
//
// Without this migration any existing worklogs/candidates disappear
// from the UI on the boot following the rename (data still on disk,
// just under the old segment the runtime no longer looks at).
//
// Idempotent by construction: `fs.rename` is atomic on POSIX, so once
// the legacy directory is gone there's nothing for the next boot to
// do — no sentinel file needed. If both the legacy and the current
// path exist (user installed both versions side-by-side, or hand-
// created the new dir), we skip + warn rather than clobber.
//
// CLEANUP target: delete this file (and its import in
// `server/index.ts`) once every active worklog-using workspace has
// booted at least once on the renamed package.
//
// Pattern parallels `server/workspace/cooking-recipes/migrate.ts`.

import { rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { log } from "../system/logger/index.js";
import { errorMessage } from "../utils/errors.js";

const LEGACY_SEG = "%40mulmoclaude%2Fworklog";
const CURRENT_SEG = "%40mulmoclaude%2Fworklog-plugin";

export interface WorklogRenameMigrationOptions {
  /** Override for tests. Defaults to the production workspace paths. */
  pluginsDataRoot?: string;
  pluginsConfigRoot?: string;
}

export interface WorklogRenameMigrationResult {
  /** Per-root outcome — "renamed" (atomic move succeeded), "no-source"
   *  (nothing to migrate), "conflict" (both legacy and current present;
   *  skipped to avoid clobber), or "error" (rename threw; next boot
   *  retries). Callers MUST treat the "error" branch as a non-fatal
   *  warning rather than a success. */
  data: "renamed" | "no-source" | "conflict" | "error";
  config: "renamed" | "no-source" | "conflict" | "error";
}

/** Best-effort rename. Logs at info on success, warn on conflicts and
 *  I/O failures; never throws — boot continues regardless. */
export async function migrateWorklogPackageRename(opts: WorklogRenameMigrationOptions = {}): Promise<WorklogRenameMigrationResult> {
  const dataRoot = opts.pluginsDataRoot ?? WORKSPACE_PATHS.pluginsData;
  const configRoot = opts.pluginsConfigRoot ?? WORKSPACE_PATHS.pluginsConfig;
  return {
    data: await renameSegment(dataRoot, "data"),
    config: await renameSegment(configRoot, "config"),
  };
}

async function renameSegment(root: string, label: "data" | "config"): Promise<WorklogRenameMigrationResult["data"]> {
  const legacy = path.join(root, LEGACY_SEG);
  const current = path.join(root, CURRENT_SEG);
  if (!existsSync(legacy)) return "no-source";
  if (existsSync(current)) {
    // Both paths populated — refuse to merge or clobber. The user
    // reconciles manually (likely `mv` of individual files); log
    // loudly so the situation is visible rather than silent.
    log.warn("worklog-rename", `${label}: both legacy and current paths exist; manual reconciliation required`, { legacy, current });
    return "conflict";
  }
  return performRename(legacy, current, label);
}

async function performRename(legacy: string, current: string, label: "data" | "config"): Promise<"renamed" | "error"> {
  try {
    await rename(legacy, current);
    log.info("worklog-rename", `${label}: migrated plugin directory`, { legacy, current });
    return "renamed";
  } catch (err) {
    log.warn("worklog-rename", `${label}: rename failed (will retry next boot)`, { legacy, current, error: errorMessage(err) });
    return "error";
  }
}
