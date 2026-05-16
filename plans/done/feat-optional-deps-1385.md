# feat: optional-dependency graceful degradation (#1385)

## Goal

A missing optional host binary must never crash the app. The
feature disables itself, the user is warned once (bell + log),
everything else keeps working.

## Scope (v1) — refined after reading the code

The issue assumed `presentMulmoScript` was a runtime plugin gated
in a registration loop. It is actually a **built-in** plugin and
the MCP tool list is assembled in a **separate stdio child
process** (`server/agent/mcp-server.ts`), so cross-process tool
gating is delicate. ffmpeg is invoked deep inside the `mulmocast`
lib from the `generateMovie` / `renderBeat` HTTP routes, not via a
direct `spawn` in our code.

So v1 delivers the reusable framework plus the user's two concrete
asks, guarding ffmpeg at the **route** layer (where it actually
crashes) rather than the MCP tool-list layer:

1. `which@^6` direct dep — root `package.json` + `packages/mulmoclaude/package.json`
   (launcher does not inherit transitive deps — publish-mulmoclaude trap #1).
2. `server/system/optionalDeps.ts`:
   - `OptionalDep` / `DepStatus` types
   - `probeOptionalDeps()` — parallel, process-lifetime cached
   - `depStatus(id)` — sync read after probe
   - default probe = `which(cmd, {nothrow:true}) !== null`
   - per-entry `probe?` override (docker daemon liveness)
   - registry: `docker` (override = existing liveness), `ffmpeg` (default)
3. `docker.ts` — register existing `isDockerAvailable` liveness body
   as the docker entry's `probe`. Keep `isDockerAvailable` exported
   and behaviour-identical so callers are untouched.
4. Boot wiring `server/index.ts` after L885 `announcePluginMetaDiagnostics()`:
   `await probeOptionalDeps()`, then per missing dep →
   `publishNotification()` + one `log.warn("deps", …)`.
5. ffmpeg route guard — `generateMovie` (L688) and `renderBeat`
   (L587) in `server/api/routes/mulmo-script.ts`: when
   `depStatus("ffmpeg")` is unavailable, respond with a clean
   JSON error (`ffmpegMissing` message) instead of letting
   `mulmocast` throw an opaque spawn error.
6. `PluginMeta.requires?: readonly string[]` (`src/plugins/meta-types.ts`).
   `presentMulmoScript/meta.ts` → `requires: ["ffmpeg"]`. Boot uses
   it to name the affected plugin in the warn/notification.
7. i18n `optionalDeps.*` (8 locales) + `lockStatusPopup` docker
   disabled-reason copy.
8. Tests:
   - `probeOptionalDeps` parallel + cache (which called once) + `probe` override + `reason` mapping (stub `which`)
   - ffmpeg route guard returns clean error when stubbed unavailable

## Out of scope (→ follow-up)

- MCP tool-list cross-process gating (hide the `presentMulmoScript`
  tool entirely from the LLM when ffmpeg missing). Route guard is
  enough to satisfy "doesn't crash" for v1.
- `git` / `libreoffice` / `pandoc` / `poppler` (issue v2).
- Per-platform install hints in the warn copy (issue v2).
- Runtime re-probe (process-lifetime cache acceptable).

## Acceptance

- No ffmpeg installed → server boots, bell shows
  "ffmpeg not found — presentMulmoScript (movie/render) disabled",
  calling generateMovie returns a clean error, no crash/stacktrace.
- No docker + sandbox-on → existing disable-sandbox fallback,
  plus a bell warn + lock popup explains the reason.
- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test` green.
