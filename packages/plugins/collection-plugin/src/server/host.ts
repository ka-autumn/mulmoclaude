// Host binding for the server-side collection engine.
//
// The engine is parameterized over the host's workspace + services, but
// threading those through every call would be invasive. Instead each host
// (MulmoClaude, MulmoTerminal) configures the binding ONCE at startup via
// `configureCollectionHost`, and the engine reads it through the getters
// below. This keeps the existing call sites (which default to the live
// workspace root) unchanged while removing the package's dependency on
// host-only modules (`server/workspace/workspace.ts`, the host logger).

/** Logger shape the engine logs through — matches the host `Logger`
 *  (prefix, message, optional structured data). */
export interface CollectionLogger {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  info: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => void;
}

export interface CollectionHost {
  /** Absolute path to the host workspace root (e.g. `~/mulmoclaude`). The
   *  default root for every path/containment check that isn't given an
   *  explicit override. */
  workspaceRoot: string;
  /** Host logger; the engine logs under the `"collections"` prefix. */
  log: CollectionLogger;
  /** Host workspace layout — supplied as the host's own path helpers so the
   *  package owns no layout literals and works against a test/alt root. */
  paths: {
    /** Absolute user-scope skills dir (host-specific, e.g. `~/.claude/skills`). */
    userSkillsDir: string;
    /** Absolute project-scope skills dir for a workspace (`<root>/.claude/skills`). */
    projectSkillsDir: (workspaceRoot: string) => string;
    /** Absolute feeds-registry root for a workspace (`<root>/data/feeds`). */
    feedsRoot: (workspaceRoot: string) => string;
    /** Absolute project-skills *staging* dir for a workspace (`<root>/data/skills`). */
    skillsStagingDir: (workspaceRoot: string) => string;
    /** Workspace-relative archive dir (a removed collection's files move here). */
    archiveDir: string;
  };
  /** True for a preset-skill slug (host-owned naming convention). */
  isPresetSlug: (slug: string) => boolean;
}

let current: CollectionHost | null = null;

/** Wire the engine to a host. Call once at server startup, before any
 *  collection storage operation. Re-binding to a *different* host throws —
 *  silently redirecting later filesystem operations to another workspace
 *  would be a bug, not a feature. Re-calling with the same host is a no-op. */
export function configureCollectionHost(host: CollectionHost): void {
  if (current !== null && current !== host) {
    throw new Error("@mulmoclaude/collection-plugin/server: configureCollectionHost() was already called with a different host");
  }
  current = host;
}

function requireHost(): CollectionHost {
  if (current === null) {
    throw new Error("@mulmoclaude/collection-plugin/server: configureCollectionHost() was not called by the host");
  }
  return current;
}

/** The configured workspace root. Throws if the host never configured one. */
export function getWorkspaceRoot(): string {
  return requireHost().workspaceRoot;
}

// Workspace-layout accessors — thin wrappers over the host binding, named to
// match the host helpers they replace so the moved engine modules keep their
// call sites. Each throws (via requireHost) if the host never configured.
export function userSkillsDir(): string {
  return requireHost().paths.userSkillsDir;
}
export function projectSkillsDir(workspaceRoot: string): string {
  return requireHost().paths.projectSkillsDir(workspaceRoot);
}
export function feedsRoot(workspaceRoot: string): string {
  return requireHost().paths.feedsRoot(workspaceRoot);
}
export function skillsStagingDir(workspaceRoot: string): string {
  return requireHost().paths.skillsStagingDir(workspaceRoot);
}
export function archiveDir(): string {
  return requireHost().paths.archiveDir;
}
export function isPresetSlug(slug: string): boolean {
  return requireHost().isPresetSlug(slug);
}

/** Logger proxy so engine modules can `import { log }` and use it exactly like
 *  the host logger — each call forwards to the live host binding. Logging is
 *  non-critical, so calls before the host configures a binding (e.g. unit tests
 *  that exercise pure logic) are dropped rather than throwing — unlike
 *  `getWorkspaceRoot()`, which fails loudly because the engine cannot operate
 *  without a workspace root. */
export const log: CollectionLogger = {
  error: (prefix, message, data) => current?.log.error(prefix, message, data),
  warn: (prefix, message, data) => current?.log.warn(prefix, message, data),
  info: (prefix, message, data) => current?.log.info(prefix, message, data),
  debug: (prefix, message, data) => current?.log.debug(prefix, message, data),
};
