# Plan: Worklog Plugin

Part of the [Solopreneur OS umbrella](feat-solopreneur-os.md). Reviewable and shippable independently — no dependency on Client or Invoice.

## Standalone value

An AI-native time tracker. Useful in two modes; both ship as part of v1.

**Manual mode:**

- "Log 2 hours on the auth refactor for Acme just now."
- "I worked from 9 to noon today on Globex onboarding."
- "What did I log this week?"
- "Total my hours per client for May."

This alone replaces Toggl Track for a chat-native user. No inference, no AI risk; a structured, queryable time log.

**Inference mode:**

- "What did I do for Acme yesterday?" → scans git commits, Claude sessions, and recent artifacts, proposes a worklog draft for approval.
- "Propose worklog for last week." → same, across configured repos and the full workspace.

Inference is an **enhancement layered on top** of the manual surface. If proposals are low quality, the user falls back to manual entry and the plugin is still useful. Partial fills are still less work than full entry. This is why there is no kill-gate on inference quality — a worse-than-hoped inference engine still augments the manual baseline.

Compares to: Toggl Track, Harvest, Clockify. Differentiator: chat input, artifact-aware inference, no timer to forget to start.

## Data model

Two trees:

```text
~/mulmoclaude/data/worklogs/
  committed/
    2026-05.jsonl                 ← one file per month, append-only
    2026-04.jsonl
  candidates/
    2026-05-20T10-00-00Z.json     ← one file per `propose` or `create` call
```

**Committed entry** (one JSONL record per line):

```yaml
id: wl-2026-05-20-001
clientId: acme                    # foreign key into data/clients/<id>.md if Client plugin present; otherwise a free string
projectId: acme/site-redesign     # optional, slash-separated
startTime: 2026-05-20T09:15:00-07:00
endTime: 2026-05-20T11:45:00-07:00
duration: 9000                    # seconds, denormalized for grep
billable: true
source: manual                    # manual | claude-session | git | document | calendar
evidence:                         # populated for inferred entries; empty for manual
  - kind: git-commits
    repo: ~/git/acme/site
    shas: [a1b2c3d, e4f5g6h]
notes: |
  Free-form. Survives edits via supersedes.
supersedes: null                  # id of previous version if this is an edit
```

Edits append a new line with `supersedes: <oldId>` rather than mutating. Listing resolves to the latest version per id. Trade-off: file grows monotonically; rotate annually if needed.

**Candidates** are arrays of proposed entries with an extra `confidence: 0.0–1.0` field per entry, dropped on approval.

Each monthly file starts with a `{"schema": "v1"}` header line so a future v2 reader has a hook.

## Tool surface

```ts
manageWorklog({
  action:
    | "create"          // manual entry; writes a candidate, user approves
    | "propose"         // inference; scans evidence, writes candidate
    | "approve"         // promote candidate(s) to committed
    | "edit"            // append supersedes-line
    | "delete"          // append tombstone
    | "list"            // query committed entries
    | "summarize",      // weekly/monthly rollup with totals per client/project
  range?: { from: string; to: string },
  clientId?: string,
  projectId?: string,
  worklogId?: string,
  entry?: Partial<Worklog>,
})
```

`create` and `propose` both produce candidates — the difference is who fills the fields (user via chat for `create`, Claude via evidence scan for `propose`). Approval funnels through the same UI, keeping the AI-on-a-leash boundary uniform.

## Inference engine (v1.1 of the plugin)

Lives entirely in the plugin, not the host. The `propose` handler:

1. Reads the configured repo list from `~/mulmoclaude/config/worklog.json`.
2. Walks git logs in those repos for the date range (commits authored by `user.email`).
3. Reads Claude Code session indices from `~/.claude/projects/*/` for sessions overlapping the range.
4. Stats `~/mulmoclaude/artifacts/` and `data/` for files written in the range.
5. Optionally reads `data/calendar/` for events in the range (if the calendar plugin is installed).
6. Bundles the evidence into a structured prompt and calls Claude with a JSON-schema response.
7. Writes the response as a candidate file; opens the approval view.

The user can edit any field inline before approving. Approval moves the entries into the committed JSONL.

Manual-mode `create` takes the same path with an empty evidence bundle; Claude is just structuring the user's chat description into the schema.

## GUI surfaces

1. **Approval view**: table of candidate rows with inline edit. Per row: time range, duration, client, project, billable toggle, confidence (if inferred), evidence chips (clickable to expand). Approve-selected button writes them to committed JSONL and deletes the candidate file.
2. **Weekly summary view** (default for `list` and `summarize`): spreadsheet of committed entries for a date range, grouped by client / project / day. Reuse `src/plugins/spreadsheet/`. Totals row at the bottom.
3. **Preview** (sidebar): for a `list` result, show a compact "this week vs. last week" bar.

No standalone `/worklog` route in MVP.

## Phases

| Phase | Scope | Effort |
|---|---|---|
| 1 | Schema + JSONL I/O + `create` / `approve` / `list` / `edit` / `delete` handlers | 4 days |
| 2 | Approval view + weekly summary view + i18n | 3 days |
| 3 | `propose` handler — evidence collection from git, sessions, artifacts | 5 days |
| 4 | Inference prompt + dogfooding on user's real week + tuning | 3 days |
| 5 | Polish: confidence display, evidence drill-down, supersedes resolver | 2 days |

Total: ~17 working days.

**Ship phases 1–2 as v1 (manual-only).** v1 is independently useful and demoable. Phases 3–5 ship as v1.1 once manual is stable.

## Cross-plugin reads (informational)

- Reads `data/clients/*.md` if present, to validate `clientId` and offer autocomplete. Falls back to free-string entry if Client plugin absent.
- Reads `data/calendar/` if present, as inference evidence.

Does not write outside its own subtree.

## Success criteria

**v1 (manual):**

1. "Log 2 hours on the Acme migration starting at 9am." → candidate, approve, committed JSONL line written.
2. "What did I log this week?" → spreadsheet view with totals per client.
3. "Edit yesterday's Acme entry to end at 4pm instead of 3pm." → new supersedes-line appended; list reflects the updated time.

**v1.1 (inference):**

4. "Propose worklog for last week." → table of candidates with evidence chips; user accepts >50% without edit.
5. The user prefers `propose` + edit over manual entry for a typical week. (Qualitative measure; if not true, ship v1, stop iterating on inference.)

Not in scope:

- Live timer UI ("start tracking now") — manual entry of completed blocks is enough; live timers are what this plugin is replacing.
- Invoicing-aware billable rate (lives in the Client plugin; Invoice reads it).
- Multi-user attribution.
- Non-developer evidence sources (figma, vscode liveshare, etc.) — see open question 4.

## Open questions

1. **Claude session enumeration.** Confirm `~/.claude/projects/-*/` naming convention and session index layout before phase 3 starts.
2. **Confidence in the approval UI.** Show numerically (`0.82`), as bands (`high/med/low`), or hide entirely? Anchoring bias risk if shown. Decide after first dogfooding.
3. **Schema versioning.** v1 header line is the migration hook. The actual v2 migration is deferred until a schema change is actually proposed.
4. **Inference for non-developer users.** All v1.1 evidence sources are developer-centric. A designer's "work" is figma history; a writer's is document mtimes. Out of scope for MVP; the evidence-collection layer is plug-replaceable per-source so adding figma later is additive, not a rewrite.
