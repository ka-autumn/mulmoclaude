# Todo list — the canonical collection recipe

Read this whenever you build (or migrate) a **todo / task list** as a collection.
It is the authoritative template; copy it rather than reinventing one from the
generic DSL fragments in `config/helps/collection-skills.md`. Read that file
first for the general schema rules — this one is the todo-specific specialization.

The design in one line: **the `status` enum is the single source of truth, and
the "done" checkbox is a `toggle` field that projects it.** There is NO separate
stored `done` boolean to keep in sync.

> **The #1 mistake:** omitting the `done` toggle. Without it the list still works
> — but there is **no checkbox**, only a status dropdown and a kanban column.
> A todo list almost always wants the checkbox. Always include the toggle.

## schema.json

Author it at `data/skills/todos/schema.json` (the bridge mirrors it to
`.claude/skills/todos/`; the user opens it at `/collections/todos`):

```json
{
  "title": "Todos",
  "icon": "checklist",
  "dataPath": "data/todos/items",
  "primaryKey": "id",
  "fields": {
    "id":       { "type": "string", "label": "ID", "primary": true, "required": true },
    "done":     { "type": "toggle", "label": "Done", "field": "status", "onValue": "done", "offValue": "todo" },
    "text":     { "type": "string", "label": "Task", "required": true },
    "status":   { "type": "enum",   "label": "Status", "values": ["todo", "doing", "done"], "required": true },
    "priority": { "type": "enum",   "label": "Priority", "values": ["urgent", "high", "medium", "low"] },
    "dueDate":  { "type": "date",   "label": "Due" },
    "note":     { "type": "markdown", "label": "Note" }
  },
  "displayField": "text",
  "kanbanField": "status",
  "calendarField": "dueDate",
  "completionField": "status",
  "completionDoneValues": ["done"],
  "notifyWhen": { "field": "priority", "in": ["urgent", "high"] }
}
```

Every key earns its place:

| Key | What it gives the user |
|---|---|
| `done` (`toggle`) | The **checkbox** — in every table row and on every kanban card. Checking it sets `status` to `onValue`; the card jumps to the Done column. `offValue` is the status to return to on uncheck (your default open column). Both must be members of the `status` enum's `values`. |
| `status` (`enum`) | The kanban columns and the single source of truth for "done". |
| `kanbanField` | Pins the board to `status` (drag a card → writes `status`). |
| `displayField` | Card / bell label (the task text, not the opaque id). |
| `calendarField` | A due-date calendar view (only if you keep `dueDate`). |
| `completionField` + `completionDoneValues` | The bell: fires while a todo is open, clears when `status` → `done`. |
| `notifyWhen` | Fire the bell **only** for `urgent`/`high` priority (not every todo). Omit it to bell every open todo. |

## SKILL.md

`data/skills/todos/SKILL.md`:

```markdown
---
name: todos
description: The user's personal todo list. Use whenever they add, list, edit,
  mark done, or remove a todo ("todo 追加", "やることリスト", "add a todo",
  "what's on my list?", "mark X as done"). Records live at
  `data/todos/items/<id>.json`; the user views them at `/collections/todos`.
---

# Todos (schema-driven collection)

## Record shape
- `id` — string, primary key (the filename). New items: `todo-<slug>` or
  `todo-<YYYYMMDDHHmm>`.
- `text` — the task line (required).
- `status` — `todo` | `doing` | `done` (required). This IS the done state.
- `priority` — `urgent` | `high` | `medium` | `low` (optional).
- `dueDate` — `YYYY-MM-DD` (optional).
- `note` — markdown (optional; URLs, context).
- Do NOT write a `done` field — it's a projection of `status`.

## What to do
- **Add**: derive an id, default `status: "todo"`, Write the JSON.
- **List**: read `data/todos/items/`, answer from the files; point the user at
  `/collections/todos` rather than reciting the table.
- **Mark done**: Read → set `status: "done"` → Write.
- **Edit / Delete**: Read → mutate / remove the file (preserve untouched fields).
- After a change, call `presentCollection` with slug `todos` (and the id) to show
  it inline.
```

## A record on disk

One JSON per item — note there is **no `done` key**:

```json
{ "id": "todo-buy-milk", "text": "Buy milk", "status": "todo", "priority": "high", "dueDate": "2026-06-10" }
```

## What the user gets, with zero host code

- **Table** — a `done` checkbox per row (ticking it sets `status: "done"`), plus
  inline `status` / `priority` dropdowns.
- **Kanban** — columns from `status`; drag a card to move it, or tick its
  per-card `done` checkbox (same write).
- **Calendar** — todos on their `dueDate`.
- **Bell** — fires for open `urgent`/`high` todos, clears on done / delete.

## Options

- **Reminder timing.** Add `"triggerField": "dueDate"` to hold the bell until the
  due date instead of firing on create; add `"triggerLeadDays": 2` to fire it N
  days early. `triggerField` must name a real `date` field.
- **Notify on everything.** Drop `notifyWhen` to bell every open todo (not just
  high priority).
- **Severity color.** `notifyWhen` controls *whether* the bell fires, not its
  color — the bell uses the standard severity; per-value red-vs-amber isn't
  modelled.

## Migrating the legacy `todo-plugin`

Old records live at `data/plugins/%40mulmoclaude%2Ftodo-plugin/todos.json` (a
single array) with the columns in the sibling `columns.json`. Convert them:

1. **Columns → `status` values.** Use the `columns.json` ids as the `status`
   enum `values` (keep the user's own columns — e.g.
   `["todo", "mulmoclaude", "mag2", "done"]`). Set `completionDoneValues` to the
   column whose `isDone` is `true`, and `kanbanField: "status"`.
2. **Add the `done` toggle.** `onValue` = the done column, `offValue` = the
   default open column (e.g. `"todo"`). **Do not skip this** — it's the checkbox
   the legacy list had.
3. **Fold `completed` into `status`.** A legacy `completed: true` item belongs in
   the done column; don't carry a separate boolean.
4. **One file per item.** Split the array into `data/todos/items/<id>.json`,
   preserving each legacy `id` verbatim.
5. **Convert `createdAt`.** The legacy value is Unix milliseconds — convert it to
   a `YYYY-MM-DD` `date` field. Carry `priority`, `dueDate`, `note` straight
   across.
6. Leave the legacy plugin files in place (don't delete) unless the user asks.
```
