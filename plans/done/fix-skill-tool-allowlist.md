# fix: permit the `Skill` tool so `.claude/skills/` skills are invokable

## User prompt

> skill の呼び出しが失敗して、`Skill {skill: "nazonazo"}` → `Execute skill: nazonazo` エラー → `Glob **/nazonazo/**` で探している。なんで？ … ではまず `--allowedTools` だけやろう。

## Root cause (confirmed via claude-code-guide)

`server/agent/config.ts` builds the `claude` CLI invocation with an
**explicit `--allowedTools` allowlist**:

```ts
const BASE_ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"];
// …
const allowedTools = [...BASE_ALLOWED_TOOLS, ...extraAllowedTools, "mcp__mulmoclaude", ...mcpToolNames];
args = [ …, "--allowedTools", allowedTools.join(","), … ];
```

`Skill` is **not** in the list. Claude Code gates the `Skill` tool
(the mechanism the model uses to execute a discovered
`.claude/skills/<name>/SKILL.md`) through `--allowedTools` like any
other tool. With a strict allowlist that omits `Skill`, every
autonomous `Skill({skill:"…"})` call is permission-denied → the
harness emits `Execute skill: <name>` → the model falls back to
`Glob`+`Read` to run the SKILL.md as a plain doc.

This is independent of frontmatter (`name:` is optional; the dir slug
is used when omitted) and of skill placement (cwd = workspace, the
bridge mirrors into `.claude/skills/` correctly). It affects **all**
skills uniformly — which matches the observed symptom (`nazonazo`
with valid `name:` AND `daily-plan` without it both fail identically).

## Scope (this PR — step A only)

Add `"Skill"` to `BASE_ALLOWED_TOOLS`. This permits the model to
invoke any discovered skill.

### Explicitly out of scope (separate follow-up)

- **(B)** `--system-prompt` full-replace drops Claude Code's default
  skill listing + skill-use guidance. Even with `Skill` permitted, the
  model may not know *which* skills exist or *when* to invoke them
  unless we inject a skill listing into the custom system prompt.
  That's a design change (the repo deliberately replaces, not appends,
  the system prompt) and needs its own plan + empirical verification.
  Tracked as the next step; this PR only unblocks the tool itself.
- Fixing individual malformed SKILL.md files (`daily-plan` /
  `shiritori` / `library` missing `name:` / `description:`) — separate
  workspace-content concern, not a repo code bug.

## Change

`server/agent/config.ts`:

```diff
-const BASE_ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"];
+const BASE_ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Skill"];
```

`"Skill"` (bare, no parens) is the exact token Claude Code matches to
permit skill execution for all skills (confirmed: the in-repo
state-machine test already models `toolName: "Skill"`,
`args: { skill: "<name>" }`).

## Test

Add an assertion in `test/agent/test_agent_config.ts` that the
`--allowedTools` value contains `Skill`, so a future allowlist edit
that drops it fails CI rather than silently re-breaking skill
invocation.

## Validation

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
- Empirical (manual, after merge): invoke `/nazonazo` and an
  autonomous `Skill` call in a real chat; confirm no `Execute skill`
  error / Glob fallback. If invocation still fails even with `Skill`
  permitted, that confirms (B) is also required — proceed to the
  follow-up plan.

## Risk

Minimal. Widens the tool allowlist by one entry (`Skill`), which is
the intended capability. No behaviour change for any non-skill path.
Existing `--allowedTools` tests use `.includes()` membership checks,
so adding an entry doesn't break them.
