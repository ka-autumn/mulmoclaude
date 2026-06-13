// Server-side custom-view management: removing a collection's custom view.
//
// A custom view spans two on-disk facts that must be removed together:
//   1. an entry in the collection's schema.json `views[]` array
//   2. its HTML file at `<base>/views/<file>` (the entry's `file` field)
//
// The base dir is source-aware, mirroring `readCustomViewHtml`: a PROJECT
// collection authors into the staging tree (`data/skills/<slug>/`) and
// discovery scans an active mirror (`.claude/skills/<slug>/`, i.e.
// `collection.skillDir`) — so the schema edit must touch BOTH copies. The
// skill-bridge hook that normally keeps them in sync only fires on the agent's
// own tool calls, never from an API route, exactly as `deleteCollection`
// reasons. A FEED / USER collection is a single tree at `collection.skillDir`.
//
// Custom-view HTML is staging-only for project collections (never mirrored —
// rendering is host-side), so only the canonical base's copy is unlinked.

import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { workspacePath } from "../workspace.js";
import { WORKSPACE_DIRS } from "../paths.js";
import { isPresetSlug } from "../skills-preset.js";
import { resolveTemplatePath, safeSlugName, SCHEMA_FILE } from "./paths.js";
import type { LoadedCollection } from "./discovery.js";
import type { IoOptions } from "./io.js";

export type DeleteViewResult =
  | { kind: "ok"; viewId: string }
  | { kind: "not-found"; viewId: string }
  | { kind: "user-scope" }
  | { kind: "preset" }
  | { kind: "unsafe-path"; viewId: string };

/** The authoritative base dir for a collection's schema.json + view HTML —
 *  the staging tree for a project collection, else its own skill dir. Matches
 *  `readCustomViewHtml`'s resolution so reads and deletes agree. */
function canonicalBase(collection: Pick<LoadedCollection, "source" | "skillDir">, workspaceRoot: string, safeSlug: string): string {
  return collection.source === "project" ? path.join(workspaceRoot, WORKSPACE_DIRS.skillsStaging, safeSlug) : collection.skillDir;
}

/** Every on-disk schema.json that must reflect the removal. For a project
 *  collection that's the staging copy AND the active mirror; otherwise just
 *  the single skill-dir copy. */
function schemaWriteTargets(collection: Pick<LoadedCollection, "source" | "skillDir">, workspaceRoot: string, safeSlug: string): string[] {
  const active = path.join(collection.skillDir, SCHEMA_FILE);
  if (collection.source === "project") return [path.join(workspaceRoot, WORKSPACE_DIRS.skillsStaging, safeSlug, SCHEMA_FILE), active];
  return [active];
}

/** Idempotent unlink — a missing file is fine (the schema entry still gets
 *  cleaned), but a real error (permissions, etc.) propagates. */
async function unlinkIfPresent(target: string): Promise<void> {
  try {
    await unlink(target);
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  }
}

/** Re-read the canonical schema.json, drop the `views[]` entry, and write the
 *  result back to every on-disk copy so staging + active stay identical. Reads
 *  raw (not `collection.schema`) so fields the typed schema doesn't model are
 *  preserved verbatim. */
async function removeViewFromSchemas(collection: LoadedCollection, viewId: string, workspaceRoot: string, safeSlug: string): Promise<void> {
  const canonical = path.join(canonicalBase(collection, workspaceRoot, safeSlug), SCHEMA_FILE);
  const parsed = JSON.parse(await readFile(canonical, "utf-8")) as { views?: { id?: unknown }[] };
  if (Array.isArray(parsed.views)) parsed.views = parsed.views.filter((entry) => entry?.id !== viewId);
  const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
  for (const target of schemaWriteTargets(collection, workspaceRoot, safeSlug)) {
    await writeFileAtomic(target, serialized);
  }
}

/** Delete one custom view from `collection`: unlink its HTML file and drop it
 *  from every schema.json copy. User-scope and preset (mc-*) collections are
 *  refused (read-only / re-seeded on boot), consistent with `deleteCollection`. */
export async function deleteCustomView(collection: LoadedCollection, viewId: string, opts: IoOptions = {}): Promise<DeleteViewResult> {
  if (collection.source === "user") return { kind: "user-scope" };
  if (isPresetSlug(collection.slug)) return { kind: "preset" };
  const safeSlug = safeSlugName(collection.slug);
  if (safeSlug === null) return { kind: "unsafe-path", viewId };
  const views = collection.schema.views ?? [];
  const view = views.find((entry) => entry.id === viewId);
  if (!view) return { kind: "not-found", viewId };
  const workspaceRoot = opts.workspaceRoot ?? workspacePath;
  const htmlPath = resolveTemplatePath(canonicalBase(collection, workspaceRoot, safeSlug), view.file);
  if (htmlPath === null) return { kind: "unsafe-path", viewId };
  // Rewrite the schema BEFORE unlinking: if the write fails the request errors
  // out, but the HTML stays put and the still-registered view keeps working —
  // an orphaned `views[]` entry pointing at a deleted file would 404 forever.
  await removeViewFromSchemas(collection, viewId, workspaceRoot, safeSlug);
  // Distinct ids may point at the same `file` (unique ids are enforced, unique
  // files are not), so only unlink when no remaining view still references it.
  const stillReferenced = views.some((entry) => entry.id !== viewId && entry.file === view.file);
  if (!stillReferenced) await unlinkIfPresent(htmlPath);
  return { kind: "ok", viewId };
}
