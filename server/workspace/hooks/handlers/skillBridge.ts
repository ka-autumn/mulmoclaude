// Skill-bridge handler — agent writes skill drafts under
// `data/skills/<slug>/` (a plain data dir, no permission special
// case) and this hook mirrors the allowlisted files into
// `.claude/skills/<slug>/` so Claude CLI's skill discovery picks
// them up.
//
// Why a bridge: Claude Code's permission system gives `.claude/`
// stricter scrutiny than ordinary cwd subdirs (the dir holds the
// agent's own skills / hooks / settings, so writes there are a
// self-modification risk). Even with explicit `Write(.claude/**)`
// allow rules in workspace settings.json, writes prompt — and the
// host GUI has no surface to answer the prompt. Routing writes
// through `data/skills/` avoids the gate; this hook (a regular
// subprocess, NOT a Claude tool call) does the mirror copy and is
// not subject to the gate.
//
// Why mirror as `<slug>/SKILL.md` (not flat `<slug>.md`): Claude
// CLI's canonical skill layout IS the nested form, and the agent
// naturally writes that shape. A flat staging path forced the agent
// to reason against its own training, missed the regex, and the
// mirror silently never fired. Mirroring 1:1 keeps the path math
// trivial for both sides.
//
// What crosses the gate — a FIXED ALLOWLIST, not the whole dir:
//
//   SKILL.md          the skill body Claude CLI reads
//   schema.json       the collection definition (a "collection skill"
//                     is a skill dir that ships a schema.json; without
//                     it the collection never registers)
//   templates/<path>  action templates a schema's `actions` reference
//                     by path. The accepted set is exactly what the
//                     schema validator allows (`isSafeActionTemplatePath`
//                     in collections/templatePath.ts) — a safe path
//                     under `templates/`, nesting allowed — so a valid
//                     schema can never reference a template the bridge
//                     drops.
//
// Everything else (README.md, assets/, arbitrary nesting) stays
// staging-side — same publish-boundary intent as the original
// SKILL.md-only design, but widened by exactly the two file kinds a
// collection skill needs. Keeping it an allowlist (vs. mirroring the
// whole dir) keeps the `.claude/` gate bypass narrow and auditable:
// the agent can't auto-publish a settings.json, an executable, or a
// deep subtree into its own config dir.
//
// Mirror operations:
//
//   Write/Edit data/skills/<slug>/{SKILL.md,schema.json,templates/*.md}
//     → copy content to the same relative path under
//       .claude/skills/<slug>/ (creates parent dirs on first install)
//
//   Bash "rm -rf data/skills/<slug>/" or "rm -rf data/skills/<slug>"
//     → rm -rf .claude/skills/<slug>/
//       (regex-matched so the agent's intent is unambiguous; a bulk
//        `rm -rf data/skills/` or wildcards are intentionally NOT
//        mirrored to avoid mass deletion surprises. Whole-dir delete
//        sweeps schema.json + templates too — no orphans)

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildAuthPost, safePost, serverLog } from "../shared/sidecar.js";
import type { HookPayload } from "../shared/stdin.js";
import { extractCommand, extractFilePath, extractToolName } from "../shared/stdin.js";
import { workspaceRoot } from "../shared/workspace.js";
import { errorMessage } from "../../../utils/errors.js";
import { isSafeActionTemplatePath } from "../../collections/templatePath.js";

const DATA_SKILLS_DIR = path.join("data", "skills");
const CLAUDE_SKILLS_DIR = path.join(".claude", "skills");
const SKILL_FILENAME = "SKILL.md";
const SCHEMA_FILENAME = "schema.json";

// Slugs follow Claude Code's skill-name convention: lowercase ASCII
// letters / digits with single-hyphen separators. Matching is
// strict so a typo or path traversal attempt (`../foo`) never
// reaches the destination path math.
//
// eslint-disable-next-line security/detect-unsafe-regex -- input is always a basename slice ≤ 64 chars, so the theoretical worst-case backtracking is bounded; this is the canonical kebab-case pattern used across the skill toolchain.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// `rm -rf data/skills/<slug>` regex. Captures the flag run as
// `match[1]` so the caller can post-validate that the user passed
// a recursive flag (`-r`, `-R`, `-rf`, `-fr`, …). Tolerates optional
// trailing slash and optional quoting around the path. A literal
// `rm -rf data/skills` (the parent dir itself) or paths with
// wildcards / shell expansion are intentionally NOT matched.
//
// Recursive-flag enforcement (Codex review on this PR): plain `rm`
// or `rm -f` cannot remove a directory, so the staging delete fails
// silently while the canonical delete still runs — desyncing the
// two trees. Requiring at least one `r` / `R` in the flags rejects
// those forms outright.
//
// eslint-disable-next-line security/detect-unsafe-regex -- the `(-[a-z0-9]+)*` slug clause is bounded by the path tail and the input is a single-line Bash command Claude CLI captured; no pathological backtracking surface.
const RM_RE = /^\s*rm\s+((?:-[a-zA-Z]+\s+)+)['"]?data\/skills\/([a-z0-9-]+)\/?['"]?\s*$/;
const RECURSIVE_FLAG_RE = /[rR]/;

// Pure helpers exported for unit testing. Source paths stay relative
// to the workspace root resolved at call time so the handler is
// safe to run from any cwd.

export function dataSkillDir(slug: string): string {
  return path.join(workspaceRoot(), DATA_SKILLS_DIR, slug);
}

export function dataSkillFilePath(slug: string): string {
  return path.join(dataSkillDir(slug), SKILL_FILENAME);
}

export function claudeSkillDir(slug: string): string {
  return path.join(workspaceRoot(), CLAUDE_SKILLS_DIR, slug);
}

export function claudeSkillFilePath(slug: string): string {
  return path.join(claudeSkillDir(slug), SKILL_FILENAME);
}

/** A staging file that's cleared to cross the `.claude/` gate. */
export interface BridgeTarget {
  /** The skill slug (the dir directly under data/skills/). */
  slug: string;
  /** Path segments BELOW the slug dir, e.g. `["SKILL.md"]`,
   *  `["schema.json"]`, `["templates", "invoice.md"]`. Used verbatim
   *  to build both the source and destination paths so the mirror is
   *  1:1. */
  relSegments: string[];
}

// Decide whether a path below the slug dir is on the allowlist.
//   <slug>/SKILL.md           → yes
//   <slug>/schema.json        → yes
//   <slug>/templates/<path>   → yes iff it's a safe action-template
//                               path (same predicate the schema
//                               validator uses, so what a schema can
//                               declare is exactly what crosses)
// everything else (README.md, assets/, any non-`templates/` sibling)
// → no.
function isAllowlisted(relSegments: string[]): boolean {
  if (relSegments.length === 1) {
    return relSegments[0] === SKILL_FILENAME || relSegments[0] === SCHEMA_FILENAME;
  }
  return isSafeActionTemplatePath(relSegments.join("/"));
}

// Resolve a Write/Edit path to the staging file it mirrors, or null
// when it's not a bridged file. Returns null when:
//   - the path doesn't sit under data/skills/<slug>/
//   - the slug isn't a valid kebab-case identifier
//   - the relative path isn't on the allowlist (see isAllowlisted)
//
// Non-allowlisted siblings (e.g. data/skills/<slug>/README.md or
// data/skills/<slug>/assets/foo.png) are intentionally NOT bridged —
// skill authors can keep extra material staging-side until they
// decide what belongs in the bundle. The allowlist keeps the
// `.claude/` gate bypass narrow.
export function bridgeTargetFromDataPath(filePath: string): BridgeTarget | null {
  const root = workspaceRoot();
  const staging = path.join(root, DATA_SKILLS_DIR);
  const rel = path.relative(staging, filePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const segments = rel.split(path.sep);
  // Need at least `<slug>/<file>`.
  if (segments.length < 2) return null;
  const [slug, ...relSegments] = segments;
  if (!SLUG_RE.test(slug)) return null;
  if (!isAllowlisted(relSegments)) return null;
  return { slug, relSegments };
}

// Extract the slug from a Bash `rm -rf data/skills/<slug>/` command.
// Returns null on any mismatch — wildcards, paths outside the
// staging dir, or non-recursive `rm` / `rm -f` (which can't delete
// the staging dir anyway, so mirroring would desync) are all
// intentionally rejected.
export function slugFromRmCommand(command: string): string | null {
  const match = RM_RE.exec(command);
  if (!match) return null;
  const [, flags, slug] = match;
  if (!RECURSIVE_FLAG_RE.test(flags)) return null;
  return SLUG_RE.test(slug) ? slug : null;
}

// Atomic mirror: write to a tmp file in the destination dir, then
// rename onto the canonical path. `fs.renameSync` is atomic on POSIX
// when source + destination share a filesystem (always true here —
// both are inside `.claude/skills/<slug>/`). If the hook is killed
// mid-write, the half-written tmp file is left behind (harmless,
// never read) and SKILL.md still has its previous contents — Claude
// CLI's skill discovery never sees a torn file. CodeRabbit review
// on PR #1298.
function mirrorWrite(target: BridgeTarget): void {
  const { slug, relSegments } = target;
  const src = path.join(dataSkillDir(slug), ...relSegments);
  const content = readFileSync(src, "utf-8");
  const dest = path.join(claudeSkillDir(slug), ...relSegments);
  // `mkdirSync(recursive)` covers the `templates/` subdir on first
  // install as well as the `<slug>/` dir itself.
  const destDir = path.dirname(dest);
  mkdirSync(destDir, { recursive: true });
  const tmp = path.join(destDir, `.${path.basename(dest)}.${process.pid}.tmp`);
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, dest);
}

function mirrorDelete(slug: string): void {
  rmSync(claudeSkillDir(slug), { recursive: true, force: true });
}

// `configRefresh` used to fan this out for us as a sibling handler,
// but running it in parallel with the mirror race'd: the
// `/api/config/refresh` POST could land before the canonical
// `.claude/skills/<slug>/SKILL.md` existed on disk, leaving a fresh
// skill unregistered until the next restart. `skillBridge` now
// fires the refresh itself, ALWAYS after a successful mirror (or
// delete), so ordering is deterministic (Codex review on this PR).
async function refreshConfig(): Promise<void> {
  await safePost(buildAuthPost("/api/config/refresh"));
}

async function handleWriteOrEdit(payload: HookPayload): Promise<void> {
  const filePath = extractFilePath(payload);
  if (!filePath) return;
  const target = bridgeTargetFromDataPath(filePath);
  if (target === null) return;
  const { slug, relSegments } = target;
  const relPath = relSegments.join("/");
  try {
    mirrorWrite(target);
    // Order matters: mirror must complete before refresh so the
    // server's skill / collection scan sees the new file. See
    // refreshConfig comment for the race history.
    await refreshConfig();
    // Server-side log line so the user can see from
    // `server-<date>.log` that the hook fired and what it did.
    // Without this the mirror is invisible — a successful copy
    // and "the hook never ran" look identical from the chat UI.
    const srcPath = path.join(dataSkillDir(slug), ...relSegments);
    const destPath = path.join(claudeSkillDir(slug), ...relSegments);
    await serverLog("skill-bridge", `mirrored ${srcPath} → ${destPath}`, { data: { slug, relPath, op: "write" } });
  } catch (err) {
    // The Write itself succeeded; a failed mirror would leave the
    // staging copy in place. Surface the failure to server logs
    // (so the user has a chance to react) but never throw — the
    // user's tool turn must stay clean.
    await serverLog("skill-bridge", `mirror write failed for slug=${slug} (${relPath})`, {
      level: "error",
      data: { slug, relPath, error: errorMessage(err) },
    });
  }
}

async function handleBash(payload: HookPayload): Promise<void> {
  const command = extractCommand(payload);
  if (!command) return;
  const slug = slugFromRmCommand(command);
  if (slug === null) return;
  try {
    mirrorDelete(slug);
    // Same ordering invariant as handleWriteOrEdit — refresh must
    // run after the canonical dir is gone so the server's rescan
    // deregisters the deleted skill.
    await refreshConfig();
    await serverLog("skill-bridge", `removed ${claudeSkillDir(slug)}`, { data: { slug, op: "delete" } });
  } catch (err) {
    // Same silent-fail discipline — a missed delete leaves an
    // orphan in `.claude/skills/` that the user can clean up
    // manually, which is better than aborting the tool turn.
    await serverLog("skill-bridge", `mirror delete failed for slug=${slug}`, {
      level: "error",
      data: { slug, error: errorMessage(err) },
    });
  }
}

export async function handleSkillBridge(payload: HookPayload): Promise<void> {
  const tool = extractToolName(payload);
  if (tool === "Write" || tool === "Edit") {
    await handleWriteOrEdit(payload);
    return;
  }
  if (tool === "Bash") {
    await handleBash(payload);
  }
}
