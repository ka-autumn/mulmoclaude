# Plan: stack-view empty state shows role sample queries (#1538)

## Problem

In `single` layout the empty-chat surface (`<PageChatComposer>`) renders the
role's sample queries as always-visible buttons. In `stack` layout the canvas
shows only `t("common.noResultsYet")` and the queries are hidden behind the
collapsed `<SuggestionsPanel>` toggle in ChatInput — users starting a new
chat in stack mode have no on-screen hint of what to ask.

## Approach (option A)

1. `<StackView>` gains an optional `queries?: readonly string[]` prop.
2. The empty-state branch (`v-if="toolResults.length === 0"`) renders, when
   `queries` is non-empty, a vertical button list (same visual language as
   `<SuggestionsPanel>`'s suggestion buttons) inside a centered column. Each
   button calls `props.sendTextMessage(query)` (the prop already exists).
3. Empty `queries` (or missing `sendTextMessage`) → keep the existing
   "No results yet" message untouched.
4. `App.vue` passes `:queries="sessionRoleQueries"` to `<StackView>`.
   `sessionRoleQueries` is already computed and threaded into `<ChatInput>`
   for the stack-mode bottom bar — same source of truth.
5. No new i18n keys: rely on existing `common.noResultsYet` for the fallback.

## Out of scope

- SuggestionsPanel auto-expand (option B).
- Persistent suggestions strip in ChatInput (option C).
- Skill suggestions in the empty state — queries are role-only.

## Test

- Stack mode + role with queries + zero results → buttons render, click sends.
- Stack mode + role with empty queries → "No results yet" fallback unchanged.
- Single mode → unaffected.
