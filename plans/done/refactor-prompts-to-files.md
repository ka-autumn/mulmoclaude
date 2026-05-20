# refactor: extract static system-prompt literals into `server/prompts/`

## User prompt

> server/agent/prompt.ts に直接 prompt が書いてあるけど、これはファイルにして読み込んだほうがメンテしやすくない？ server/prompts がわかりやすいね。

Follow-up discussion narrowed the scope: the user initially also wanted
`server/workspace/helps/` and `server/workspace/skills-preset/` moved
into `server/prompts/`, but investigation showed those are **workspace
seed templates** (copied into the user's runtime workspace by
`server/workspace/workspace.ts` via `__dirname`-relative paths, then
user-editable). They have a different owner / mutability / consumer
than app-internal prompt constants, so they are **explicitly out of
scope** — moving them would break the seeding paths and mix two
lifecycles.

## Goal

Move the large, fully-static system-prompt string literals out of
`server/agent/prompt.ts` into plain `.md` files under
`server/prompts/system/`, loaded once at module init. Editing prompt
prose becomes a plain-text edit with clean diffs; `prompt.ts` keeps
its exported symbols and logic.

## Scope

### In scope — 5 fully-static blocks (0 `${}` interpolation, verified)

| Current const (`server/agent/prompt.ts`) | Lines | New file |
|---|---|---|
| `SYSTEM_PROMPT` | ~15–106 | `server/prompts/system/system.md` |
| `TOPIC_MEMORY_MANAGEMENT` | ~195–255 | `server/prompts/system/memory-management-topic.md` |
| `ATOMIC_MEMORY_MANAGEMENT` | ~257–290 | `server/prompts/system/memory-management-atomic.md` |
| `NEWS_CONCIERGE_PROMPT` | ~419–442 | `server/prompts/system/news-concierge.md` |
| `SANDBOX_TOOLS_HINT` | ~593–602 | `server/prompts/system/sandbox-tools.md` |

### Added in the same PR (guard-then-static-block functions)

Follow-up to the user's request to continue in this PR. Two more
**fully-static** blocks that were emitted behind a runtime guard —
the guard / message-wrap stays in the function, only the prose moves:

| Source (`server/agent/prompt.ts`) | New file |
|---|---|
| `prependJournalPointer` `<journal-context>` block | `server/prompts/system/journal-pointer.md` |
| `buildSourcesContext` return body | `server/prompts/system/sources-context.md` |

Both have **no trailing newline** (they reproduce `[…].join("\n")`
output verbatim). `prependJournalPointer` becomes
`[JOURNAL_POINTER, "", message].join("\n")`; `buildSourcesContext`
returns `SOURCES_CONTEXT` after its `existsSync` guards. Byte-identity
vs the pre-refactor output verified directly.

### Out of scope

- Interpolated hints (`MCP_PREFIX_HINT`, timezone hint, date line):
  1–3 lines each, `${}` interpolation belongs next to the logic —
  **stay in code**.
- Single-sentence static fragments inside `buildMemoryContext`
  (the `config/helps/index.md` pointer line) and `buildWikiContext`
  (3 mutually-exclusive guard-branch sentences, one branch is
  `${summary}`-dynamic). Extracting a one-sentence fragment to its
  own `.md` makes the code *harder* to follow (open a file to read a
  sentence) and would fragment `buildWikiContext` into tiny files
  plus a leftover dynamic branch — net-negative for the
  maintainability goal. **Deliberately left inline.**
- `server/workspace/helps/*.md` — workspace seed template, leave as-is.
- `server/workspace/skills-preset/**` — workspace seed template,
  leave as-is.
- Any change to `prompt.ts`'s exported symbol names or call sites.

## Key facts established during investigation

- **Bundling is already safe.** `packages/mulmoclaude/bin/prepare-dist.js:71`
  copies the *entire* `server/` tree (`cpSync`, only `server/logs`
  excluded) and `packages/mulmoclaude/package.json` `files` includes
  `"server/"`. So `server/prompts/**/*.md` is automatically copied +
  published — **no prepare-dist change required**. (This was the
  single biggest risk; it's already mitigated by the whole-tree copy.)
- All 5 blocks verified `${}`-interpolation-free via grep.
- These prompts are app-owned constants, never user-visible, never
  edited at runtime → synchronous read at module load is correct
  (no async plumbing, no per-request I/O).

## Implementation steps

1. Create `server/prompts/system/` and write the 5 `.md` files with
   the exact current literal content (byte-for-byte; no prose edits in
   this PR — keep the refactor reviewable).
2. Add `server/prompts/index.ts`:
   - Resolve the prompt dir via `fileURLToPath(import.meta.url)` —
     **never** `process.cwd()` (must resolve under both dev and the
     npx-installed launcher).
   - `readFileSync(..., "utf-8")` each file once at module load.
   - Export each as the same `const` name the codebase already uses
     (`SYSTEM_PROMPT`, `TOPIC_MEMORY_MANAGEMENT`, …).
3. In `server/agent/prompt.ts`: replace the 5 inline `const … = \`…\``
   blocks with `export { SYSTEM_PROMPT, … } from "../prompts/index.js"`
   (or import + re-export to keep the existing public surface). No
   call-site changes elsewhere.
4. `trimEnd()` discipline: keep the loader output equivalent to the
   old literal (the literals had no trailing newline; `.md` files
   conventionally end with one — `.trimEnd()` in the loader or assert
   the files have no trailing blank to keep output identical).
5. Test: `test/agent/test_prompt_files.ts` —
   - each of the 5 files exists at the resolved path and is non-empty;
   - the loaded `SYSTEM_PROMPT` etc. start/end with the same
     sentinel substrings the old literals had (guards against a
     missing-file or stray-whitespace regression failing in
     production instead of CI).
6. Validate: `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`.
7. Local launcher smoke (the bundling guarantee, exercised):
   `node scripts/mulmoclaude/tarball.mjs` — confirms the packed
   tarball boots with the prompt files present (HTTP 200).

## Acceptance criteria

- `prompt.ts` no longer contains the 5 large literal blocks; exported
  symbols unchanged; all call sites compile untouched.
- System prompt produced by `buildSystemPrompt` is byte-identical to
  pre-refactor for a fixed role/workspace (diff the rendered output
  before/after).
- `yarn test` green incl. the new prompt-file test.
- `node scripts/mulmoclaude/tarball.mjs` green (launcher boots with
  prompts bundled).

## Risks / notes

- **Byte-identity**: the only correctness risk is whitespace drift
  between the old literal and the file. Mitigation: the before/after
  rendered-prompt diff in acceptance criteria + the sentinel test.
- Low cross-branch conflict risk: touches one module's literals, not
  boot order or shared infra.
- No i18n: these are model-read English, same as the existing
  literals (consistent with issue #875's scoping note).
