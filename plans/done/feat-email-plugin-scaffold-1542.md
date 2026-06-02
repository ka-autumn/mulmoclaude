# Plan: `@mulmoclaude/email-plugin` PR 1 scaffold (#1542)

## Scope (this PR only)

Stand the runtime plugin up with everything except real IMAP/SMTP I/O:

- Package skeleton (`package.json`, `tsconfig`, `vite.config`, `eslint.config`)
- `TOOL_DEFINITION` for `manageEmail` (`kind: list | read | search | send`)
- Zod-discriminated `Args` with strict validation (email regex, ISO-date regex, range checks)
- Self-healing config flow (`config.json` at `~/mulmoclaude/config/plugins/%40mulmoclaude%2Femail-plugin/`)
  - `missing` → asks LLM to collect email + App Password from user
  - `server_unknown` (domain not in preset table, no explicit imap/smtp block) → asks for host/port
- Provider preset table (gmail / googlemail / fastmail / icloud / me / outlook / hotmail)
- Stub handlers for `list` / `read` / `search` returning the dispatched args (proves the call path)
- Send-gate envelope: first `kind:'send'` returns `needs_confirmation: true` + a `retry_with` block carrying the args + `confirmed: true`; only the second call (with `confirmed:true`) reaches the (stub) send
- `preset-list.ts` entry with `devOnly: true` (matches the publish-boundary contract from #1513)
- Unit tests: args, providers, config (20 tests total)

## Out of scope (later PRs)

- PR 2: real IMAP `list` / `read` / `search` via `imapflow` + `mailparser`
- PR 3: real SMTP `send` via `nodemailer`, plus a host-side hook so the send-gate envelope renders as `presentForm`
- PR 4: optional Vue View / Preview
- PR 5: 8-locale i18n, Personal role wiring, e2e
- PR 6: npm publish + `mulmoclaude` deps

## Notes

- No `node:fs` / `node:path` in plugin source (banned by the plugin eslint preset). `homedir()` is allowed (used by edgar-plugin too) and only needed for the absolute-path string returned in the self-healing payload.
- `peerDependencies: { gui-chat-protocol, zod }` mirrors edgar-plugin so the runtime loader resolves the same singletons.
- Tarball will publish at `0.1.0` later via the same `publish` skill flow used for todo/spotify.
