# MulmoClaude

Experience GUI-chat with Claude Code — and long-term memory!

## Quick Start

```bash
# Prerequisites: Node.js 20+, Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude auth login

# Launch MulmoClaude
npx mulmoclaude
```

Your browser opens to `http://localhost:3001`. That's it.

## Options

```
npx mulmoclaude                              # Default (port 3001, opens browser)
npx mulmoclaude --port 8080                  # Custom port
npx mulmoclaude --no-open                    # Don't open browser
npx mulmoclaude --dev-plugin ./my-plugin     # Load a plugin from a local
                                             # project dir (repeatable;
                                             # path can be relative or absolute)
npx mulmoclaude --version                    # Show version
```

`--dev-plugin <path>` is the plugin author's dev loop. Pair with
`yarn dev` (vite watch) in the plugin directory: edits → vite
rebuilds `dist/` → **the browser auto-reloads** via a debounced
watcher on the plugin's `dist/`. The plugin's `package.json` name +
`dist/index.js` must already be in place; the launcher refuses to
start on missing files or on a name collision with an already-
installed plugin. Server-side `definePlugin` factory edits still
require a launcher restart (Node ESM has no cache invalidation API);
the launcher log explicitly says so when `dist/index.js` changes.

## How it works

The npm package ships with the pre-built client (Vite) and the server
source — TypeScript, executed directly via `tsx`. No cloning, no
build step for end users: `npx` downloads the package and starts the
Express server.

Your data lives in `~/mulmoclaude/` (created on first run).

## Auth token for long-running bridges

By default the server generates a fresh bearer token on every startup
and writes it to `~/mulmoclaude/.session-token`. Bridges
(`@mulmobridge/telegram`, `@mulmobridge/discord`, …) read that file
once at launch — so if you restart the server while a bridge is
running, the bridge keeps the old token and every API call then
returns **401**, silently.

**Fix**: set `MULMOCLAUDE_AUTH_TOKEN` to the same long random value
on both the server and the bridge. The server uses it verbatim
instead of regenerating, so the token survives restarts.

```bash
# Launch the server with a pinned token
MULMOCLAUDE_AUTH_TOKEN=long-random-string npx mulmoclaude

# Bridge (separate process / machine — same value)
MULMOCLAUDE_AUTH_TOKEN=long-random-string \
  TELEGRAM_BOT_TOKEN=... \
  npx @mulmobridge/telegram@latest
```

Recommended: ≥ 32 characters of random data (shorter values trigger a
startup warning).

## For developers

Publish flow and the full local-test recipe (prepare-dist,
direct launch, curl checks, tarball simulation) live in the
header comment of `bin/prepare-dist.js`.

## License

MIT
