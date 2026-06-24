# fix-windows-claude-spawn-1757

Issue: [#1757](https://github.com/receptron/mulmoclaude/issues/1757).
Acknowledgement: original problem report + 3-failure-mode analysis by
@lapispapyrus on the now-closed PR #1571.

## Problem (restated)

On Windows, every `child_process.spawn("claude", args, …)` call site
fails one of three ways, and the three escape hatches are mutually
exclusive — a double-bind that takes chat / journal / summarizer /
translation offline as soon as MulmoClaude is installed on a Windows
host.

| Attempt | Why it fails |
|---|---|
| `spawn("claude", args)` | `ENOENT` — Node looks for an extensionless executable; npm-installed `claude.cmd` is not found. |
| `spawn("claude.cmd", args)` | `EINVAL` — since CVE-2024-27980, Node refuses `.cmd` directly unless `shell: true`. |
| `spawn("claude", args, { shell: true })` | "コマンドラインが長すぎます" — cmd.exe wraps the call and trips the 8191-char limit once MCP-config + system-prompt args land. |

The only escape that respects all three constraints is to spawn the
native `claude.exe` directly (no wrapper, no shell, full Win32 long-
command-line headroom).

## Target spawn surface

PR #1571 listed 6 files. Two of those (`sources/classifier.ts`,
`sources/pipeline/summarize.ts`) have been removed from main since
then. `server/system/credentials.ts` uses `node-pty`'s `pty.spawn`
which has its own conpty/winpty wrapping and is NOT subject to the
CVE-2024-27980 / 8191-char issues. The remaining surface is 4 sites:

| File | Line | Current call |
|---|---|---|
| `server/agent/backend/claude-code.ts` | 32 | `spawn("claude", cliArgs, {…})` |
| `server/workspace/journal/archivist-cli.ts` | 32 | `spawn("claude", ["-p", "--output-format", "text"], {…})` |
| `server/workspace/chat-index/summarizer.ts` | 198 | `spawn("claude", args, {…})` |
| `server/services/translation/llm.ts` | 122 | `spawn("claude", buildArgs(promptInput), {…})` |

Each site changes to `spawn(claudeBinPath(), args, {…})` — one-line
swap, no shape changes to args / stdio / env.

## Design: `server/utils/claudeBin.ts`

Single exported function with the following contract:

```ts
export function claudeBinPath(): string;
```

### Non-Windows

Returns the literal string `"claude"`. PATH lookup just works, no
.cmd / cmd.exe involvement. Zero behaviour change for the macOS /
Linux paths every existing CI run already covers.

### Windows

Returns the absolute path to a `claude.exe` we found, resolved in this
order (first hit wins, all subsequent steps skipped):

1. **`where claude.cmd` probe (canonical path)**. Run
   `spawnSync("where", ["claude.cmd"])`; for each line of output, walk
   parent directories looking for
   `node_modules/@anthropic-ai/claude-code/bin/claude.exe` up to 4
   levels. Covers npm-global (`%APPDATA%\npm`), yarn-global
   (`%LOCALAPPDATA%\Yarn\bin`), pnpm-global (`%LOCALAPPDATA%\pnpm`),
   nvm-windows (any prefix), Volta, and any custom `npm prefix -g`.
2. **`npm config get prefix`**. Run `spawnSync("npm", ["config",
   "get", "prefix"])` to discover the user's npm prefix even if PATH
   doesn't carry it, then probe
   `<prefix>\node_modules\@anthropic-ai\claude-code\bin\claude.exe`.
3. **`%APPDATA%\npm`** (npm's documented Windows default).
4. **`%LOCALAPPDATA%\Yarn\config\global`** + classic Yarn global node
   modules layout.
5. **`%LOCALAPPDATA%\pnpm`** + pnpm global glob (`global/*/node_modules`).

If none of those hit, throw an `Error` whose message lists every path
probed plus install instructions:

```text
claude CLI binary not found. Tried:
  - %APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe
  - %LOCALAPPDATA%\Yarn\config\global\node_modules\…
  - …
Install with: npm install -g @anthropic-ai/claude-code
```

### Caching

Resolution is a one-shot probe and the install path doesn't change
during a process's lifetime. Cache the result of the first successful
resolution in a module-level `cachedBin: string | null | undefined`
(`undefined` = not probed; `null` = probed-and-missing — still throw
each call so the error surfaces consistently, just skip re-probing).

### Testability

Resolution depends on the platform, `spawnSync`, `existsSync`, and env
vars. To keep this unit-testable without actually installing the
claude CLI, accept an `options` parameter (default `{}`) with
injectable `platform`, `spawnSync`, `existsSync`, and `env`. Internal
code uses real Node defaults; tests pass mocks.

```ts
export interface ResolveOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawnSync?: typeof import("node:child_process").spawnSync;
  readonly existsSync?: typeof import("node:fs").existsSync;
  readonly env?: NodeJS.ProcessEnv;
  readonly resetCache?: boolean;  // tests reset between cases
}
```

## Tests (`test/utils/test_claudeBin.ts`)

- Non-Windows (`platform: "darwin" | "linux"`) returns `"claude"` —
  zero probing.
- Windows + `where claude.cmd` → npm-style layout → returns the
  resolved `.exe` path.
- Windows + `where claude.cmd` → yarn-style layout (bin/ sibling of
  node_modules) → returns the resolved `.exe`.
- Windows + `where` empty + `npm config get prefix` returns a valid
  path → returns the resolved `.exe`.
- Windows + all probes miss → throws with a list of probed paths AND
  includes the install hint string.
- Caching: first call probes, second call doesn't (verify with a
  spawnSync mock call counter).

## Touch list

| Path | Change | Lines |
|---|---|---|
| `server/utils/claudeBin.ts` | **new** — helper | ~120 |
| `test/utils/test_claudeBin.ts` | **new** — 6+ cases | ~150 |
| `server/agent/backend/claude-code.ts` | swap call | +1/-1 |
| `server/workspace/journal/archivist-cli.ts` | swap call | +1/-1 |
| `server/workspace/chat-index/summarizer.ts` | swap call | +1/-1 |
| `server/services/translation/llm.ts` | swap call | +1/-1 |

## Out of scope / known limits

- `server/system/credentials.ts` (`node-pty`'s `pty.spawn`) is **not**
  touched — node-pty handles its own conpty/winpty wrapping and is
  not subject to CVE-2024-27980 / cmd.exe 8191 limits.
- We do not bundle a fallback `claude` install — if the user hasn't
  installed `@anthropic-ai/claude-code` globally, the new error
  message points them at the install command.
- We do not migrate `spawn` to any newer execa-style wrapper — the
  patch stays within `node:child_process` to keep the diff narrow.

## Acceptance

- All 4 call sites compile and pass typecheck.
- New helper has 100% branch coverage in `test_claudeBin.ts` (6+
  scenarios) and tests pass on macOS / Linux / Windows runners.
- The existing CI matrix continues to pass on macOS + Linux.
- On a fresh Windows 11 install with `npm install -g
  @anthropic-ai/claude-code`, MulmoClaude chat starts cleanly
  without ENOENT / EINVAL / "command line too long".
