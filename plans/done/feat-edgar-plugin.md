# Plan: Edgar plugin

> **Status: implemented as a runtime plugin under `packages/plugins/edgar-plugin/`.** Wraps the public SEC EDGAR API as one tool with kind-discriminated dispatch, server-only (no Vue View / Preview), with a self-healing config flow when the SEC-required contact info is missing.

## Why a runtime plugin (the move from built-in)

Edgar shipped originally as a built-in plugin under `src/plugins/edgar/` (PR #1270). The reason at the time was that runtime plugins were auto-included in every role's tool set regardless of `role.availablePlugins`, which would have leaked edgar's verbose tool description into every system prompt. PR #1267 fixed that — runtime plugins are now gated by `role.availablePlugins` exactly like built-ins. With the structural reason gone, edgar moves to `packages/plugins/edgar-plugin/` to match the convention used by every other domain-specific plugin (spotify, recipe-book, todo, debug, bookmarks).

Trade-off accepted explicitly: the config path becomes URL-encoded (`~/mulmoclaude/config/plugins/%40mulmoclaude%2Fedgar-plugin/config.json`) because `runtime.files.config` keeps each scoped npm name as a single safe directory segment. The clean `~/mulmoclaude/config/plugins/edgar/` path the built-in version had is no longer available. Existing users re-enter their name + email at the new path; no migration shipped.

## File layout

```text
packages/plugins/edgar-plugin/
├── package.json          # @mulmoclaude/edgar-plugin, server-only export
├── tsconfig.json
├── eslint.config.mjs     # gui-chat-protocol/eslint-preset
├── vite.config.ts        # single server entry, no Vue, externals: node:os, node:url
├── src/
│   ├── index.ts          # definePlugin factory; per-kind handlers; dispatch under 20 lines
│   ├── definition.ts     # TOOL_DEFINITION (single tool, six kinds, prompt names config path)
│   ├── args.ts           # Zod schema in its own file so tests import without runtime overhead
│   ├── edgar.ts          # createEdgarClient factory; serialised throttle + ticker cache;
│   │                     #   AbortController fetch with sec.gov host allowlist
│   └── config.ts         # readConfig + missingConfigResponse + configAbsolutePath
└── test/
    ├── test_args_validation.ts   # 30+ cases — pins regex guards + date-pair refinement
    ├── test_throttle.ts          # 2 cases — concurrency invariant + chain-not-poisoned
    └── test_config.ts            # 4 cases — payload shape + absolute path
```

Host wiring is one line in `server/plugins/preset-list.ts` plus one entry in `src/config/toolNames.ts:HOST_TOOL_NAMES` so role files get `TOOL_NAMES.edgar` type safety.

## Tool surface

One tool, name `edgar`, with a `kind` discriminator covering all six EDGAR endpoints:

- `lookup_cik` — ticker → 10-digit CIK + company name.
- `get_recent_filings` — list a company's most recent filings (filterable by `form_types`).
- `get_filing_document` — fetch the primary document of a specific filing as raw HTML/text. `max_chars` defaults to 20 000 (vs 50 000 in the standalone MCP) — without a View the LLM has to read this verbatim.
- `get_company_facts` — every XBRL-tagged fact (large; prefer `get_concept`).
- `get_concept` — time series for one XBRL concept across all filings.
- `search_filings` — full-text search across the entire EDGAR corpus.

## Security guards (all input regexes pinned by tests)

- `accession_number` — `^\d{10}-\d{2}-\d{6}$` (canonical SEC form).
- `primary_document` — `^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9_.-]*$` (bare filename, no path separators or `..`).
- `concept` — `^[A-Za-z]\w*$` (XBRL identifier shape).
- `from_date`/`to_date` — both-or-neither (`refine`); partial bounds 400.
- `runtime.fetch` configured with `allowedHosts: ["www.sec.gov", "data.sec.gov", "efts.sec.gov"]` — fetches outside that allowlist throw before hitting the network.

## Throttle (concurrency-safe, pinned by test)

The SEC's 10 req/s cap requires serialisation across concurrent callers. The throttle (`src/edgar.ts:throttledSlot`) chains all calls through a single promise; each caller observes the prior caller's release timestamp before computing its own wait. Pattern mirrors bookmarks-plugin's per-plugin write lock. A thrown handler doesn't poison the chain.

## Config — self-healing missing-config flow

Config lives at the runtime-plugin scope root:

```text
~/mulmoclaude/config/plugins/%40mulmoclaude%2Fedgar-plugin/config.json
```

Schema:

```json
{ "name": "Full Name", "email": "user@example.com" }
```

The plugin reads the config first on every dispatch. If absent or malformed, returns a `{instructions: ...}` payload (NOT thrown) with the absolute path + JSON schema folded into the instructions prose. The MCP bridge (`server/agent/mcp-server.ts`) surfaces only `message` / `instructions` to the LLM, so we deliberately use `instructions` (and avoid `data`, which would trigger an unwanted frontend canvas push).

The literal path is also surfaced in `TOOL_DEFINITION.prompt` so the LLM knows where to write before it ever needs to trigger the missing-config response.

## Role wiring

No default role lists `TOOL_NAMES.edgar` — opt-in per role. Users add it to a custom role via the role-editor UI or by hand:

```ts
{
  // ...
  availablePlugins: [TOOL_NAMES.presentForm, TOOL_NAMES.edgar, ...],
}
```

`TOOL_NAMES.edgar` is type-safe because `edgar` lives in `HOST_TOOL_NAMES`.

## Implementation steps (done)

1. ✅ Recreate `packages/plugins/edgar-plugin/` (package.json, tsconfig, eslint, vite config).
2. ✅ Port the source from the built-in shape into runtime-plugin form: `definition.ts`, `args.ts` (extracted for testability), `edgar.ts` (with `createEdgarClient` factory + `throttledSlot`), `config.ts`, `index.ts` (definePlugin factory + dispatch).
3. ✅ Move tests into `packages/plugins/edgar-plugin/test/` (45 tests) — pins regex guards, throttle invariant, config payload shape.
4. ✅ Add `edgar` to `HOST_TOOL_NAMES` in `src/config/toolNames.ts` for `TOOL_NAMES.edgar` type safety.
5. ✅ Add `{ packageName: "@mulmoclaude/edgar-plugin" }` to `PRESET_PLUGINS` in `server/plugins/preset-list.ts`.
6. ✅ Delete `src/plugins/edgar/`, `server/edgar/`, `server/api/routes/edgar.ts`, the route mount in `server/index.ts`, and the host-side tests under `test/edgar/` (replaced by in-package tests).
7. ✅ `yarn plugins:codegen` — drops edgar from the built-in barrels.
8. ✅ `yarn install`, `yarn workspace @mulmoclaude/edgar-plugin run build`, `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`, `yarn format`. All clean.

## Out of scope (explicitly)

- **Backward compatibility for the config path.** Users who set up edgar against the built-in path (`~/mulmoclaude/config/plugins/edgar/config.json`) need to re-enter name + email at the new path. Trivial flow — the missing-config payload tells the LLM exactly where to write.
- **No View / Preview.** Pure server-side tool. Adding a canvas surface later is a separate PR.
- **No streaming.** Each dispatch is a single round-trip; large responses come back whole.
- **No XBRL post-processing.** `get_company_facts` and `get_concept` return SEC's JSON shape unchanged.
- **No HTML→text conversion** in `get_filing_document`. Raw HTML is returned (with truncation).
- **No retry logic** beyond what `runtime.fetch` provides. EDGAR rate-limits at 10 req/sec and we throttle to 9; a 429 still bubbles up as an error.
