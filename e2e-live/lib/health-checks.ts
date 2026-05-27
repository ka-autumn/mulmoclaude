// Pure happy-tour assertion helpers — `e2e-live/lib/health-checks.ts`.
//
// L-HAPPY-TOUR exists to catch the "individual specs all pass but the
// whole app is broken" class of regression (2026-05-25 preset plugin
// bundle drop that left `/todos` failing to load is the canonical
// example). The spec walks each major View / endpoint; this module
// is the *pure* layer of those checks so the same assertions can be
// reused by:
//   - the Playwright spec (`e2e-live/tests/happy-tour.spec.ts`)
//   - a future doctor CLI / pre-release smoke harness
// without dragging Playwright's `Page` into either reuse target.
//
// Each helper takes raw JSON / value input and returns a discriminated
// `{ ok: true } | { ok: false; reason }` so the spec can render a
// readable failure string AND a doctor CLI can short-circuit on the
// first miss without `try` boilerplate.

import { isRecord } from "../../server/utils/types.ts";

/**
 * Standard discriminated result. `reason` on the failure branch is
 * the only field — the spec / CLI both render it verbatim, so it must
 * be self-describing (include the input that failed, not just the
 * rule that fired).
 */
export type HealthCheckResult = { ok: true } | { ok: false; reason: string };

const HEALTH_OK_RE = /^(?:ok|healthy|ready)$/i;

/**
 * `/api/health` returns `{ status: "ok" }`-ish in the steady state.
 * The spec already asserted HTTP 200 before calling this; the body
 * check exists to catch a regression where `/api/health` 200s with
 * an unexpected payload (e.g. fell back to the SPA index.html when
 * the route registration broke).
 */
export function assertHealthBody(body: unknown): HealthCheckResult {
  if (!isRecord(body)) {
    return { ok: false, reason: `/api/health body is not an object: ${JSON.stringify(body)}` };
  }
  const { status } = body;
  if (typeof status !== "string" || !HEALTH_OK_RE.test(status)) {
    return { ok: false, reason: `/api/health body.status missing or not ok-ish: ${JSON.stringify(body)}` };
  }
  return { ok: true };
}

/**
 * Preset plugins we expect a dev checkout (`yarn dev`) to register
 * via the workspace symlinks. `devOnly` mirrors `PRESET_PLUGINS` in
 * `server/plugins/preset-list.ts` — those packages are stripped from
 * the published `mulmoclaude` tarball, so a doctor CLI running there
 * should not require them. The spec lives in a dev checkout so all
 * four show up; we keep the metadata here so the same module can be
 * reused from a packaged-tarball harness without forking.
 */
export interface ExpectedPresetPlugin {
  name: string;
  devOnly: boolean;
}

export const EXPECTED_PRESET_PLUGINS: readonly ExpectedPresetPlugin[] = [
  { name: "@mulmoclaude/todo-plugin", devOnly: false },
  { name: "@mulmoclaude/spotify-plugin", devOnly: false },
  { name: "@mulmoclaude/debug-plugin", devOnly: true },
  { name: "@mulmoclaude/edgar-plugin", devOnly: true },
];

interface RuntimePluginRow {
  name: string;
}

function parsePluginRow(raw: unknown): RuntimePluginRow | null {
  if (!isRecord(raw)) return null;
  const { name } = raw;
  if (typeof name !== "string" || name.length === 0) return null;
  return { name };
}

/**
 * `/api/plugins/runtime/list` returns `{ plugins: [{ name, ... }] }`.
 * Two regressions this catches:
 *   1. The 2026-05-25 incident — preset package missing from the
 *      shipped tarball; `name` absent from the list.
 *   2. The runtime registry failing to load anything at all (returns
 *      `plugins: []`); usually means `loadPresetPlugins` crashed.
 *
 * `requireDevOnly = false` lets a packaged-tarball doctor harness
 * skip the dev-only entries without forking this helper.
 */
function collectRegisteredPluginNames(rows: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    const parsed = parsePluginRow(row);
    if (parsed !== null) names.add(parsed.name);
  }
  return names;
}

function findMissingPresets(registered: Set<string>, requireDevOnly: boolean): string[] {
  const required = EXPECTED_PRESET_PLUGINS.filter((preset) => requireDevOnly || !preset.devOnly);
  return required.filter((preset) => !registered.has(preset.name)).map((preset) => preset.name);
}

export function assertRuntimePluginsRegistered(body: unknown, requireDevOnly: boolean): HealthCheckResult {
  if (!isRecord(body) || !Array.isArray(body.plugins)) {
    return { ok: false, reason: `/api/plugins/runtime/list body is not { plugins: [...] }: ${JSON.stringify(body)}` };
  }
  const registered = collectRegisteredPluginNames(body.plugins);
  if (registered.size === 0) {
    return { ok: false, reason: "/api/plugins/runtime/list returned zero registered plugins (preset loader dead?)" };
  }
  const missing = findMissingPresets(registered, requireDevOnly);
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `preset plugins missing from /api/plugins/runtime/list: ${missing.join(", ")} (got: ${Array.from(registered).sort().join(", ")})`,
  };
}

/**
 * `/api/plugins/diagnostics` returns `{ diagnostics: [...] }` — an
 * array of boot-time collisions between host aggregators and plugin
 * META contributions. A clean boot returns an empty array. Any
 * entry here means the bell will surface a warning toast at startup,
 * which the L-HAPPY-TOUR step 3 check is specifically scoped to catch.
 *
 * Collision shapes vary by aggregator, so we keep the entries as
 * `unknown[]` and only assert envelope-shape + emptiness — the spec
 * doesn't care about the collision payload, only that there are none.
 */
export function assertNoPluginDiagnostics(body: unknown): HealthCheckResult {
  if (!isRecord(body) || !Array.isArray(body.diagnostics)) {
    return { ok: false, reason: `/api/plugins/diagnostics body is not { diagnostics: [...] }: ${JSON.stringify(body)}` };
  }
  if (body.diagnostics.length > 0) {
    return { ok: false, reason: `/api/plugins/diagnostics returned ${body.diagnostics.length} collision(s): ${JSON.stringify(body.diagnostics)}` };
  }
  return { ok: true };
}
