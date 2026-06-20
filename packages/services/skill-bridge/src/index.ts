// @mulmoclaude/skill-bridge — the skill staging→active mirror RULE, shared by
// MulmoClaude and MulmoTerminal so the two hosts can't drift on what crosses the
// `.claude/` permission gate.
//
// The agent writes skill drafts under `data/skills/<slug>/` (a plain data dir, no
// `.claude/` permission special-case). This package decides which writes are
// allowlisted and mirrors them 1:1 into `.claude/skills/<slug>/` so Claude CLI's
// skill discovery + the collection engine pick them up. It also mirrors a
// `rm -rf data/skills/<slug>` delete.
//
// What crosses — a FIXED ALLOWLIST, not the whole dir:
//   SKILL.md          the skill body Claude CLI reads
//   schema.json       the collection definition (a "collection skill" ships one)
//   templates/<path>  action templates a schema's `actions` reference — exactly the
//                     set the schema validator accepts (`isSafeActionTemplatePath`)
// Everything else (README.md, assets/, arbitrary nesting) stays staging-side.
//
// Pure rule + fs ops, parameterized by `workspaceRoot` (passed in, not read from a
// host module) so either host can call it. Each host wires this into its own hook /
// PostToolUse path and triggers its own config refresh afterward.
import path from "node:path";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isSafeActionTemplatePath } from "@mulmoclaude/collection-plugin/server";

const DATA_SKILLS_DIR = path.join("data", "skills");
const CLAUDE_SKILLS_DIR = path.join(".claude", "skills");
const SKILL_FILENAME = "SKILL.md";
const SCHEMA_FILENAME = "schema.json";

// Slugs follow Claude Code's skill-name convention: lowercase ASCII letters/digits
// with single-hyphen separators. Strict so a typo / traversal never reaches the dest.
// eslint-disable-next-line security/detect-unsafe-regex -- input is a basename slice ≤64 chars; bounded backtracking.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// `rm -rf data/skills/<slug>` matcher. `match[1]` is the flag run (must contain a
// recursive flag); `match[2]` is the slug. Wildcards / the parent dir / non-recursive
// `rm` are intentionally NOT matched (a non-recursive rm can't delete the dir anyway,
// so mirroring would desync the trees).
// eslint-disable-next-line security/detect-unsafe-regex -- single-line captured Bash command; bounded.
const RM_RE = /^\s*rm\s+((?:-[a-zA-Z]+\s+)+)['"]?data\/skills\/([a-z0-9-]+)\/?['"]?\s*$/;
const RECURSIVE_FLAG_RE = /[rR]/;

/** A staging file cleared to cross the `.claude/` gate. */
export interface BridgeTarget {
  /** The skill slug (the dir directly under data/skills/). */
  slug: string;
  /** Path segments BELOW the slug dir, e.g. `["SKILL.md"]`, `["templates","x.md"]`.
   *  Used verbatim for both source and destination so the mirror is 1:1. */
  relSegments: string[];
}

/** `<workspaceRoot>/data/skills/<slug>` — the staging dir for a skill. */
export function dataSkillDir(workspaceRoot: string, slug: string): string {
  return path.join(workspaceRoot, DATA_SKILLS_DIR, slug);
}

/** `<workspaceRoot>/.claude/skills/<slug>` — the active dir Claude CLI discovers. */
export function claudeSkillDir(workspaceRoot: string, slug: string): string {
  return path.join(workspaceRoot, CLAUDE_SKILLS_DIR, slug);
}

// Allowlist a path below the slug dir: SKILL.md / schema.json at the top, or a safe
// `templates/<path>` (the same predicate the schema validator uses, so what a schema
// can declare is exactly what crosses). Everything else → false.
function isAllowlisted(relSegments: string[]): boolean {
  if (relSegments.length === 1) {
    return relSegments[0] === SKILL_FILENAME || relSegments[0] === SCHEMA_FILENAME;
  }
  return isSafeActionTemplatePath(relSegments.join("/"));
}

/** Resolve a Write/Edit path to the staging file it mirrors, or null when it isn't a
 *  bridged file (not under `data/skills/<slug>/`, bad slug, or off the allowlist). */
export function bridgeTargetFromDataPath(workspaceRoot: string, filePath: string): BridgeTarget | null {
  const staging = path.join(workspaceRoot, DATA_SKILLS_DIR);
  const rel = path.relative(staging, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const segments = rel.split(path.sep);
  if (segments.length < 2) return null; // need at least `<slug>/<file>`
  const [slug, ...relSegments] = segments;
  if (!SLUG_RE.test(slug)) return null;
  if (!isAllowlisted(relSegments)) return null;
  return { slug, relSegments };
}

/** Extract the slug from a Bash `rm -rf data/skills/<slug>` command, or null on any
 *  mismatch (wildcards, paths outside staging, non-recursive `rm`). */
export function slugFromRmCommand(command: string): string | null {
  const match = RM_RE.exec(command);
  if (!match) return null;
  const [, flags, slug] = match;
  if (!RECURSIVE_FLAG_RE.test(flags)) return null;
  return SLUG_RE.test(slug) ? slug : null;
}

/** Atomic mirror of one allowlisted staging file → its active path: write a tmp file
 *  in the dest dir, then rename onto the canonical path (atomic on POSIX; both paths
 *  share a filesystem). A killed mid-write leaves a harmless tmp and the previous
 *  SKILL.md intact. Returns the resolved src/dest for logging. */
export function mirrorSkillWrite(workspaceRoot: string, target: BridgeTarget): { src: string; dest: string } {
  const { slug, relSegments } = target;
  const src = path.join(dataSkillDir(workspaceRoot, slug), ...relSegments);
  const content = readFileSync(src, "utf-8");
  const dest = path.join(claudeSkillDir(workspaceRoot, slug), ...relSegments);
  const destDir = path.dirname(dest);
  mkdirSync(destDir, { recursive: true }); // covers templates/ + the slug dir on first install
  const tmp = path.join(destDir, `.${path.basename(dest)}.${process.pid}.tmp`);
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, dest);
  return { src, dest };
}

/** Remove the active skill dir (mirrors a staging `rm -rf`). Returns the dest. */
export function mirrorSkillDelete(workspaceRoot: string, slug: string): { dest: string } {
  const dest = claudeSkillDir(workspaceRoot, slug);
  rmSync(dest, { recursive: true, force: true });
  return { dest };
}
