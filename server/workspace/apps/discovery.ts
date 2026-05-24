// Discover schema-driven apps. An "app" is a skill directory that
// ships a `schema.json` alongside its `SKILL.md`. Scans both user
// (`~/.claude/skills/`) and project (`<workspace>/.claude/skills/`)
// scopes; project wins on slug collision (mirrors the rule in
// `server/workspace/skills/discovery.ts`).

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { log } from "../../system/logger/index.js";
import { workspacePath } from "../workspace.js";
import { USER_SKILLS_DIR, projectSkillsDir } from "../skills/paths.js";
import { SCHEMA_FILE, resolveDataDir, safeSlugName } from "./paths.js";
import type { AppDetail, AppSchema, AppSource, AppSummary } from "./types.js";

const FieldSpecSchema = z.object({
  type: z.enum(["string", "text", "email", "number", "date", "boolean", "markdown"]),
  label: z.string().min(1),
  primary: z.boolean().optional(),
  required: z.boolean().optional(),
});

const AppSchemaZ = z.object({
  title: z.string().min(1),
  icon: z.string().min(1),
  dataPath: z.string().min(1),
  primaryKey: z.string().min(1),
  fields: z.record(z.string(), FieldSpecSchema),
});

interface LoadedApp {
  slug: string;
  source: AppSource;
  schema: AppSchema;
  /** Absolute path to the resolved dataPath directory (inside the
   *  workspace). May not exist yet — the data folder is created on
   *  first write. */
  dataDir: string;
}

async function loadOneApp(skillsRoot: string, slug: string, source: AppSource, workspaceRoot: string): Promise<LoadedApp | null> {
  const safeName = safeSlugName(slug);
  if (safeName === null) return null;
  const schemaPath = path.join(skillsRoot, safeName, SCHEMA_FILE);
  let raw: string;
  try {
    const fileStat = await stat(schemaPath);
    if (!fileStat.isFile()) return null;
    raw = await readFile(schemaPath, "utf-8");
  } catch (err) {
    const error = err as { code?: string };
    if (error.code !== "ENOENT") {
      log.warn("apps", "failed to read schema.json, skipping", { slug: safeName, path: schemaPath, error: String(err) });
    }
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    log.warn("apps", "schema.json is not valid JSON, skipping", { slug: safeName, error: String(err) });
    return null;
  }

  const parsed = AppSchemaZ.safeParse(parsedJson);
  if (!parsed.success) {
    log.warn("apps", "schema.json failed validation, skipping", { slug: safeName, issues: parsed.error.issues });
    return null;
  }

  // Verify the primary key is one of the declared fields AND is
  // flagged `primary: true`. Without the flag the CollectionView
  // would render the field as editable (its disabled-on-edit check
  // is `field.primary === true`), the user's rename would silently
  // be pinned back to the URL itemId on save, and they'd never know
  // the edit was dropped. Reject the schema up front rather than
  // ship that UX.
  const schema = parsed.data;
  const primaryField = schema.fields[schema.primaryKey];
  if (!primaryField) {
    log.warn("apps", "schema.json primaryKey not found in fields, skipping", { slug: safeName, primaryKey: schema.primaryKey });
    return null;
  }
  if (primaryField.primary !== true) {
    log.warn("apps", "schema.json primaryKey field is not flagged primary: true, skipping", { slug: safeName, primaryKey: schema.primaryKey });
    return null;
  }

  const dataDir = resolveDataDir(schema.dataPath, workspaceRoot);
  if (dataDir === null) {
    log.warn("apps", "schema.json dataPath escapes workspace, skipping", { slug: safeName, dataPath: schema.dataPath, workspaceRoot });
    return null;
  }

  return { slug: safeName, source, schema, dataDir };
}

async function collectAppsFromDir(skillsRoot: string, source: AppSource, workspaceRoot: string): Promise<LoadedApp[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsRoot);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    log.warn("apps", "failed to list skills dir, returning empty", { root: skillsRoot, error: String(err) });
    return [];
  }

  const results: LoadedApp[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const safeName = safeSlugName(name);
    if (safeName === null) continue;
    const dirPath = path.join(skillsRoot, safeName);
    let dirStat;
    try {
      dirStat = await stat(dirPath);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;
    const app = await loadOneApp(skillsRoot, safeName, source, workspaceRoot);
    if (app) results.push(app);
  }
  return results;
}

export interface DiscoveryOptions {
  /** Override the workspace root for project-scope skill discovery.
   *  Default: the live `workspacePath`. Tests point this at a
   *  `mkdtempSync` tree so they don't touch the user's real
   *  `~/mulmoclaude/`. Mirrors the pattern in
   *  `server/workspace/skills/catalog.ts#CatalogOptions`. */
  workspaceRoot?: string;
  /** Override `~/.claude/skills/` for tests. Production callers
   *  leave this unset. Without an override, even a test-scoped
   *  workspaceRoot still scans the real user home — which can leak
   *  unrelated skills into the result. */
  userSkillsDir?: string;
}

/** Discover every schema-driven app available to this workspace.
 *  Project-scope apps override user-scope on slug collision. The
 *  `workspaceRoot` override also flows into each app's dataDir
 *  resolution so a tmpdir-scoped test gets dataDirs under the same
 *  tmpdir (Codex P1 review on PR #1489 — previously dataDir was
 *  always rooted at the live workspacePath regardless of override). */
export async function discoverApps(opts: DiscoveryOptions = {}): Promise<LoadedApp[]> {
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const userDir = opts.userSkillsDir ?? USER_SKILLS_DIR;
  const projectDir = projectSkillsDir(workspaceRoot);
  const userApps = await collectAppsFromDir(userDir, "user", workspaceRoot);
  const projectApps = await collectAppsFromDir(projectDir, "project", workspaceRoot);
  const merged = new Map<string, LoadedApp>();
  for (const app of userApps) merged.set(app.slug, app);
  for (const app of projectApps) merged.set(app.slug, app);
  return [...merged.values()].sort((left, right) => left.slug.localeCompare(right.slug));
}

/** Load one app by slug. Returns null if the slug is invalid, no
 *  matching skill exists, or the schema is malformed. */
export async function loadApp(slug: string, opts: DiscoveryOptions = {}): Promise<LoadedApp | null> {
  const safeName = safeSlugName(slug);
  if (safeName === null) return null;
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const userDir = opts.userSkillsDir ?? USER_SKILLS_DIR;
  const projectDir = projectSkillsDir(workspaceRoot);
  // Project first (overrides user).
  const projectApp = await loadOneApp(projectDir, safeName, "project", workspaceRoot);
  if (projectApp) return projectApp;
  return loadOneApp(userDir, safeName, "user", workspaceRoot);
}

export function toSummary(app: LoadedApp): AppSummary {
  return { slug: app.slug, title: app.schema.title, icon: app.schema.icon, source: app.source };
}

export function toDetail(app: LoadedApp): AppDetail {
  return { ...toSummary(app), schema: app.schema };
}

export type { LoadedApp };
