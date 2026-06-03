// Pure path logic for the L-31 "skill 化して" bridge-dispatch canary,
// extracted from `live-chat.ts` so it can be unit-tested without
// pulling in `@playwright/test`. See `test/e2e-live/test_staging_skill_path.ts`.

import path from "node:path";

import { isValidSlug } from "../../server/utils/slug.ts";

// Absolute path the host workspace is bind-mounted at inside the Docker
// sandbox. Mirrors `CONTAINER_WORKSPACE_PATH` in `server/agent/config.ts`;
// kept as a local literal (not imported) so this test fixture stays free
// of config.ts's heavy module graph (@mulmobridge/*, mcp shim, …) — which
// would otherwise break the unit test in a freshly-installed worktree.
export const CONTAINER_WORKSPACE_PATH = "/home/node/mulmoclaude";

/**
 * Tail-anchored matcher for a staging-skill `SKILL.md` write. The
 * leading `(?:^|[/\\])` plus the trailing `$` pin the path to end
 * exactly with `data/skills/<slug>/SKILL.md`, so any absolute root
 * (host or Docker sandbox mount) is accepted while `…/data/skillsX/…`
 * or a deeper `…/SKILL.md.bak` is not.
 */
// eslint-disable-next-line security/detect-unsafe-regex -- the slug clause is bounded by the path tail (slug ≤ DEFAULT_MAX_LENGTH per server/utils/slug.ts) and the input is the agent-supplied file_path the Claude SDK already validated; no pathological backtracking surface.
export const STAGING_SKILL_WRITE_PATH_RE = /(?:^|[/\\])data[/\\]skills[/\\]([a-z0-9]+(?:-[a-z0-9]+)*)[/\\]SKILL\.md$/;

/**
 * Resolve the staging-skill slug from a `Write` tool call's `file_path`,
 * or `null` when the path is not a write to
 * `<workspace>/data/skills/<slug>/SKILL.md`.
 *
 * Why TWO workspace roots are accepted:
 *   - **Docker off**: the agent runs on the host, so its absolute (or
 *     cwd-relative) `file_path` resolves under `hostWorkspaceRoot`.
 *   - **Docker on**: the agent runs INSIDE the sandbox, where the same
 *     workspace is bind-mounted at `CONTAINER_WORKSPACE_PATH`
 *     (`/home/node/mulmoclaude`). Its `file_path` is therefore
 *     `/home/node/mulmoclaude/data/skills/<slug>/SKILL.md` — the SAME
 *     staging write under a DIFFERENT absolute root.
 *
 * The previous host-only `candidate === expectedPath` check silently
 * dropped the sandbox path (`/home/node/…` ≠ `/Users/…`), so L-31
 * failed under Docker even though the agent wrote SKILL.md to the
 * correct staging dir. Accepting either root fixes that while still
 * rejecting a write that lands outside both known workspace roots
 * (the false-positive guard the host-only check was originally for).
 *
 * Separators: only NATIVE forward-slash paths are matched as hits.
 * The Claude SDK serialises `file_path` with the agent host's
 * separator and this suite only ever runs the agent on Linux (Docker
 * sandbox) or macOS, so `/` is the sole form seen in practice. The
 * regex's `[/\\]` tolerance lets a backslash-form path match the
 * shape, but `path.resolve` on a POSIX host keeps the backslashes
 * literal so it won't equal either expected root — i.e. backslash
 * paths deliberately fall through to `null` (pinned by a unit test)
 * rather than being silently normalised for a Windows agent we never
 * run.
 */
export function stagingSkillSlugFromWritePath(filePath: string, hostWorkspaceRoot: string): string | null {
  const match = STAGING_SKILL_WRITE_PATH_RE.exec(filePath);
  if (!match) return null;
  const [, slug] = match;
  // Re-validate against the canonical server rule (the kebab regex
  // does not enforce the 1-120 char bound `isValidSlug` adds).
  if (!isValidSlug(slug)) return null;
  const relStaging = `data/skills/${slug}/SKILL.md`;
  // Docker off: relative or host-absolute → resolves under the host root.
  const hostExpected = path.resolve(hostWorkspaceRoot, relStaging);
  const candidate = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(hostWorkspaceRoot, filePath);
  if (candidate === hostExpected) return slug;
  // Docker on: absolute path rooted at the sandbox mount, not the host.
  const sandboxExpected = path.posix.join(CONTAINER_WORKSPACE_PATH, relStaging);
  if (path.posix.normalize(filePath) === sandboxExpected) return slug;
  return null;
}
