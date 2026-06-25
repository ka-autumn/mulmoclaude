// Type declarations for check-shared-pkg-bumps.mjs. Kept as a sidecar
// so the script itself stays plain JS (easy to run with `node` on a
// fresh clone without a build step) while still giving the unit test
// a typed import surface. Mirrors the pattern used by the other CLI
// scripts under scripts/mulmoclaude/ (deps.d.mts, drift.d.mts, ...).

/** Top-level package.json fields whose isolated diffs do NOT alter what
 *  consumers install — `devDependencies`, `scripts`, `version`. See
 *  the comment block above the runtime `NON_SHIPPING_PKG_JSON_KEYS`
 *  for the rationale. */
export const NON_SHIPPING_PKG_JSON_KEYS: ReadonlySet<string>;

/** Pure helper: true when every key whose value differs between
 *  `baseJson` and `headJson` is in `NON_SHIPPING_PKG_JSON_KEYS`.
 *  False otherwise — including when a shipping field appears in
 *  only one of the two objects. */
export function packageJsonDiffShipsNothing(baseJson: Record<string, unknown>, headJson: Record<string, unknown>): boolean;
