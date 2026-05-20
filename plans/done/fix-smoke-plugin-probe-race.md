# Fix: `mulmoclaude_smoke` runtime-plugin probe race

## Symptom

`mulmoclaude_smoke` workflow intermittently fails at the tarball stage:

```
✗ tarball  runtime plugin probe failed: dev plugin "@smoke/dev-fixture@dev" not in list — saw:
```

The list comes back empty (`saw:` trailing nothing). Triggers on PRs that
touch unrelated paths in the workflow's `paths:` filter (`package.json`,
`server/**`, `src/**`, …) — including PR #1411 (Playwright dep tweak).

## Root cause

Plugin loading runs inside a fire-and-forget IIFE at
`server/index.ts:940`:

```js
void (async () => {
  const [presets, userInstalled, devLoad] = await Promise.all([
    loadPresetPlugins(...),
    loadRuntimePlugins(...),
    loadDevPlugins(...),
  ]);
  ...
  registerRuntimePlugins(staticToolNames, [...presets, ...userInstalled, ...devLoad.plugins]);
})();
```

The IIFE fires AFTER `app.listen()` returns, so the `/` route can answer
200 before `registerRuntimePlugins` runs. `runTarballSmoke` polls `/`
until 200, then immediately probes `/api/plugins/runtime/list` — on a
fast boot (warm cache, light load) the probe wins the race against the
IIFE and the list is `[]`.

Downloaded launcher.log from run 25985390538 confirms it:

```
2026-05-17T08:07:35.476Z INFO  [server] listening port=34447
2026-05-17T08:07:35.742Z INFO  [server] shutting down signal=SIGTERM
```

266 ms between listening and the smoke killing the server. No log lines
about plugin loading in between — the IIFE hadn't logged anything yet.

Last successful main run (#1424 merge, 25981541291) booted slowly:
"HTTP 200 on port 35103 after 10 attempt(s) (4515ms)" — 4.5 s of poll
attempts gave the IIFE time to finish. The race has been latent forever;
fast boots just make it visible.

## Fix

Make `probeRuntimePlugins` poll when `expectedDevPlugin` is set —
single-shot is wrong when the thing we're asserting on is loaded
asynchronously. Same poll-until-condition pattern as `pollHttp`.

- Add `pollTimeoutMs` (default 10 s) and `pollIntervalMs` (default
  250 ms) options.
- Extract the single-attempt logic into a private helper
  (`runRuntimePluginsProbeOnce`) so the poll loop doesn't duplicate
  response-shape checks.
- When `expectedDevPlugin` is null, keep one-shot behaviour: an empty
  list is a legitimate state (fresh install) and polling would just
  burn the budget.
- Inject `now` / `sleep` so unit tests stay deterministic.

Why not "wait for plugins to load before listening" in the launcher?
That would slow real users' boot and is a bigger surface change. The
smoke is the one consumer that needs the strong ordering; bake the wait
into the smoke.

## Test plan

- Unit tests added to `test/scripts/mulmoclaude/test_tarball.ts`:
  - polls until `expectedDevPlugin` appears (3 attempts, 2 sleeps)
  - gives up after `pollTimeoutMs` and preserves the last error
  - does NOT poll when `expectedDevPlugin` is absent (one-shot)
  - existing "expected plugin absent" tests pin `pollTimeoutMs: 0` so
    they assert on the single-attempt error shape, not the
    poll-and-give-up path.
- `yarn lint` / `yarn typecheck` clean.
- Whole tarball suite runs in 260 ms (no real-time sleeps).
