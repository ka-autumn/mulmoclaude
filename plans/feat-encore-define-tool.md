# `defineEncore` — split structural from operational

## Problem

`manageEncore` is one MCP tool with 9 kinds (`setup`, `amendDefinition`, `markStepDone`, `markTargetSkipped`, `recordValues`, `query`, `appendNote`, `snooze`, `unsnooze`). Per-kind argument shapes diverge wildly, so the tool's JSON Schema is minimal (`{ kind: enum }` + `additionalProperties: true`) and the LLM gets zero per-field type hints.

The single most-error-prone argument is `definition` (the full DSL document) on `setup` and `amendDefinition`:

- LLMs commonly `JSON.stringify` nested object args (PR #1433 added server-side string-coercion to tolerate it).
- The same nested-object shape would benefit from a typed JSON Schema, but encoding the full DSL inline in `manageEncore`'s parameters would force the same shape on every other kind that doesn't need it.

The other 7 kinds take ~5 short string properties (`obligationId`, `cycleId`, `targetId`, `stepId`, optional `values` / `body` / `pendingId`). They have a totally different ergonomic profile from setup/amend.

## Approach

Two MCP tools under one plugin package (the [scheduler pattern](../src/plugins/scheduler/index.ts) — `manageCalendar` and `manageAutomations` share `/api/scheduler`):

| Tool | Purpose | Kinds | Discriminator |
|---|---|---|---|
| `defineEncore` (new) | Structural — write or modify a DSL document | setup, amendDefinition | `obligationId` presence (absent → setup, present → amend) |
| `manageEncore` (existing, slimmed) | Operational — react to bell entries, query, record | markStepDone, markTargetSkipped, recordValues, query, appendNote, snooze, unsnooze | `kind` enum (as today) |

Both tools share `/api/encore` (the existing dispatch endpoint). The server-side dispatcher gains one new kind, `defineEncore`, that routes internally to the existing `handleSetup` / `handleAmend` by `obligationId` presence.

### `defineEncore` JSON Schema

```ts
parameters: {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["defineEncore"] }, // fixed-value, MCP single-enum
    dsl: z.toJSONSchema(EncoreDslInput),              // typed DSL document, auto-derived
    obligationId: { type: "string", description: "Present → amend. Absent → setup." }
  },
  required: ["kind", "dsl"]
}
```

The `dsl` schema is **derived from Zod** (`z.toJSONSchema(EncoreDslInput)`) so the JSON Schema can't drift from the runtime validator. The full (non-partial) shape is exposed; for amend the parameter description tells the LLM to only fill the fields it wants to change. The server merges the patch onto the existing DSL and runs the full validator on the merge — so partial inputs are semantically OK even though the schema marks fields as required.

### DSL schema location

The Zod source of truth moves from `server/encore/dsl/` to `src/types/encore-dsl/`. Both server (validation) and plugin tool definition (JSON Schema generation) import it as a value. Justification:

- The schema is pure Zod (no Node-only imports — verified). Browser-bundle-safe.
- The existing eslint rule `no-restricted-imports` blocks plugin code from importing `**/server/**` at value level. Moving the schema out of `server/` removes that boundary.
- `src/types/` already houses cross-cutting shapes both sides consume (e.g., `session.ts`, `events.ts`). The DSL schema fits the same role — a contract both sides reference.
- No new workspace package needed (lighter than `packages/encore-dsl/` would have been).

### Discriminator: `obligationId` presence

- Absent → setup (server generates `id` from `displayName`).
- Present → amend the named obligation.

This mirrors the LLM's mental model: "I'm creating something new" (no id yet) vs "I'm changing this specific one" (id known). The presence/absence of the parameter IS the intent — no redundant `kind` flag inside the tool.

### 409 collision guard (footgun mitigation)

If the LLM intends to amend but forgets `obligationId`, it would silently fall through to setup → create a duplicate obligation with a similar name. The current `generateUniqueObligationId` auto-numbers (`-2`, `-3`) on slug collision, masking the mistake.

Replace with a strict reject: if `slugify(dsl.displayName)` collides with an existing obligation, throw `409 Conflict` with a directive message:

> Obligation `"daily-payment-hisayo"` already exists (displayName: "Daily payment — Hisayo"). To modify it, call `defineEncore` with `obligationId: "daily-payment-hisayo"` (this becomes an amend). To create a parallel one, change the `displayName`.

The LLM reads the message → either fills in `obligationId` (recovers as amend) or picks a different name (creates a sibling).

### `manageEncore` after the slim-down

- Drop `setup` and `amendDefinition` from `LLM_ENCORE_KINDS`.
- Keep them in the server-side dispatcher switch (backward compat for in-app and out-of-tree callers; the new `handleDefineEncore` translates to them internally).
- The MCP `description` and `prompt` can drop the DSL-composition language entirely — that's `defineEncore`'s job now.

## File changes

### Server (1 file)

- `server/encore/dispatch.ts` — new `DefineArgs` Zod schema; new `handleDefineEncore`; new switch entry; replace `generateUniqueObligationId` with `requireUniqueObligationId` that throws 409.

### Plugin (frontend — scheduler-style split)

- `src/plugins/encore/meta.ts` → **rename** to `manageEncoreMeta.ts` (carries the full META: toolName, apiNamespace, apiRoutes, mcpDispatch, workspaceDirs).
- `src/plugins/encore/definition.ts` → **rename** to `manageEncoreDefinition.ts` (drop setup/amend from `LLM_ENCORE_KINDS`; slim `description` and `prompt`).
- **New** `src/plugins/encore/defineEncoreMeta.ts` — toolName-only META.
- **New** `src/plugins/encore/defineEncoreDefinition.ts` — the new tool with `kind: "defineEncore"` + typed `dsl` (auto-derived via `z.toJSONSchema(EncoreDslInput)`) + optional `obligationId`.
- `src/plugins/encore/index.ts` — switch from `REGISTRATION` (singular) to `REGISTRATIONS` (plural array): two `{ toolName, entry }` rows, two `execute` functions (both POST to the shared dispatch endpoint, no transformation needed since the body already carries `kind`).
- Run `yarn plugins:codegen` to regenerate `_generated/{metas,registrations,server-bindings}.ts`.

### DSL schema relocation

- **Move** `server/encore/dsl/{at-expression,at-resolver,cadence,schema}.ts` → `src/types/encore-dsl/`. Pure Zod files with no Node-only deps; both server and plugin can import.
- Update import paths in `server/encore/{closure,cycle,dispatch,notifier,obligation,reconcile,tick}.ts`.

### Help file

- `server/workspace/helps/encore-dsl.md` — add `defineEncore` section at the top of the call-shapes; mark `setup` / `amendDefinition` as legacy (still works via `manageEncore` for backward compat, but new code should use `defineEncore`).

### Tests

New tests in `test/plugins/test_encore_dispatch.ts`:

- `defineEncore` with no `obligationId` → creates obligation (same end state as `setup`).
- `defineEncore` with `obligationId` → amends obligation (same end state as `amendDefinition`).
- `defineEncore` for a `displayName` that collides with an existing slug → 409 with the recovery hint message.
- Existing `setup` / `amendDefinition` tests keep passing (backward compat).

## Out of scope

- **Per-field type hints for `manageEncore`'s remaining kinds** (`cycleId: { type: "string" }`, `targetId: { type: "string" }`, etc.). Smaller ROI; separate PR if needed.
- **Removing `setup` and `amendDefinition` from the dispatch switch.** They stay as the backward-compat path the new `handleDefineEncore` translates to. Removing them is a separate cleanup.
- **Renaming the `definition` field to `dsl` in the underlying `SetupArgs` / `AmendArgs`.** Internal-only naming; not worth the diff churn.

## Dependencies

- PR #1433 (`feat/encore-reconciler-plan`) — adds string-coercion for `definition` (still used by the legacy path) and the reconciler refactor. Merge order: PR #1433 → this PR.

## Acceptance

- `defineEncore` appears in the MCP tool list with typed `dsl` and `obligationId` properties.
- LLM-visible `manageEncore` kinds no longer include `setup` or `amendDefinition`.
- 409 collision on duplicate `displayName` carries a message that names the existing `obligationId` and tells the LLM how to recover.
- Every existing test passes; new tests cover the three scenarios above plus the 409.
- `yarn format` / `lint` / `typecheck` / `test` / `build` all green.
- `yarn plugins:codegen` produces a stable output (no spurious diff on a re-run).
