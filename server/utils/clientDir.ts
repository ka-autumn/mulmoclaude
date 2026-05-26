/**
 * Resolve the directory the production static handler reads `index.html`
 * from. Picks between the env override and a caller-provided default —
 * caller composes the default path itself so this function does not
 * carry an unused `baseDir` when the env is set (review feedback on
 * PR #1506: a parameter that the override branch silently ignores is
 * a smell).
 *
 * Default (`envValue` unset or empty string): returns `defaultDir`
 * verbatim. The caller is expected to pass
 * `path.join(__dirname, "../client")` — the layout
 * `packages/mulmoclaude/bin/prepare-dist.js` produces when packaging
 * the tarball (`dist/client/` is copied to `<pkg>/client/` so
 * `../client` from `<pkg>/server/` resolves under `npx mulmoclaude`).
 *
 * Override (`envValue` non-empty): returns the env value verbatim.
 * Test spawners (fresh-user smoke specs spawn `tsx server/index.ts`
 * directly without the prepare-dist copy step) set
 * `MULMOCLAUDE_CLIENT_DIR=<repo-root>/dist/client/` so the source-run
 * server can find the SPA bundle. Empty string is treated as "unset"
 * so a shell that exports the var without a value doesn't
 * accidentally break the default.
 *
 * Pure function — both arguments are passed explicitly so the
 * resolver is unit-testable without mutating `process.env`.
 */
export function resolveClientDir(envValue: string | undefined, defaultDir: string): string {
  if (typeof envValue === "string" && envValue.length > 0) {
    return envValue;
  }
  return defaultDir;
}
