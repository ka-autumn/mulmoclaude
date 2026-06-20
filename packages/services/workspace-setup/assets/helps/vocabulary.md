# Vocabulary — a language-learning collection recipe

Read this whenever the user wants to **learn a new language** (or grow their
vocabulary in any language) and wants their words tracked, reviewed, and graded
over time. It is the authoritative template for a vocabulary collection — copy
it rather than reinventing one from the generic DSL fragments in
`config/helps/collection-skills.md`. Read that file first for the general schema
rules; this one is the vocabulary-specific specialization.

The design in one line: **the `proficiency` enum is the single source of truth
for how well a word is known, and a kanban board lets the user drag a word
between mastery levels.** It works for any target language — English, Spanish,
French, Japanese, anything. The word goes in the target language; the example
sentence shows it in use.

> **The point of the toggle:** the `mastered` checkbox is a `toggle` that
> projects `proficiency` — checking it sets `proficiency` to `"mastered"`,
> unchecking returns it to `"new"`. There is NO separate stored `mastered`
> boolean to keep in sync.

## schema.json

Author it at `data/skills/vocabulary/schema.json` (the bridge mirrors it to
`.claude/skills/vocabulary/`; the user opens it at `/collections/vocabulary`):

```json
{
  "title": "Vocabulary",
  "icon": "menu_book",
  "dataPath": "data/vocabulary/items",
  "primaryKey": "id",
  "fields": {
    "id":          { "type": "string", "label": "ID", "primary": true, "required": true },
    "mastered":    { "type": "toggle", "label": "Mastered", "field": "proficiency", "onValue": "mastered", "offValue": "new" },
    "word":        { "type": "string", "label": "Word", "required": true },
    "proficiency": { "type": "enum",   "label": "Proficiency", "values": ["new", "learning", "familiar", "mastered"], "required": true },
    "meaning":     { "type": "string", "label": "Meaning" },
    "example":     { "type": "text",   "label": "Example" }
  },
  "displayField": "word",
  "kanbanField": "proficiency"
}
```

Every key earns its place:

| Key | What it gives the user |
|---|---|
| `word` (`string`) | The word to learn, in the **target language**. It is the `displayField`, so it labels every table row and kanban card. |
| `proficiency` (`enum`) | The four mastery levels and the single source of truth for "how well known". Drives the kanban columns. |
| `mastered` (`toggle`) | The **checkbox** in every row and card. Checking it sets `proficiency` to `onValue` (`"mastered"`); the card jumps to the Mastered column. `offValue` (`"new"`) is the level to return to on uncheck. Both must be members of the `proficiency` enum's `values`. |
| `meaning` (`string`) | The translation / definition in the user's native language. Optional, but recommended for real study — a word list without meanings is hard to revise from. |
| `example` (`text`) | A sentence using the word in context — the fastest way to remember usage, not just the dictionary gloss. |
| `kanbanField` | Pins the board to `proficiency` (drag a card → writes `proficiency`). |
| `displayField` | Card / table label (the word itself, not the opaque id). |

**Labels are localizable.** `title`, `label`, and the enum `values` are free
text — a Japanese learner's deck might use `"未分類" | "要勉強" | "だいたい" |
"マスター"`. Keep `onValue` / `offValue` in lockstep with whatever `values` you
choose; they must match exactly.

## SKILL.md

`data/skills/vocabulary/SKILL.md` tells the agent when and how to operate the
collection. Keep it short — the schema does the heavy lifting. It should cover:

- **Trigger phrases** — "add a word", "vocabulary", "I learned this word",
  "raise my proficiency", plus the equivalents in the user's language.
- **Record shape** — point at the schema; note `id` is the filename
  (`word-<slug>` or `word-<unix-ms>`), `proficiency` starts at `"new"`, and
  `mastered` is host-computed (never write it directly).
- **Operations** — record I/O via `manageCollection` (raw Read / Write / Edit
  on `data/vocabulary/items/<id>.json` is the escape hatch):
  - **Add** — generate an id, set `proficiency` to `"new"`, putItems with
    `mode: "create"`.
  - **List** — getItems (it includes the host-computed `mastered` value);
    rather than dumping every word into chat, point the user at
    `/collections/vocabulary`.
  - **Update proficiency** — putItems with `mode: "merge"` and
    `{ id, proficiency }` (merge keeps the fields the row omits).
  - **Edit** — same: putItems `mode: "merge"` with just the changed fields.
  - **Delete** — remove the JSON file.
- After any change, call `presentCollection` with slug `vocabulary` (and the
  record id) to render the result inline.

## How it works for the learner

- The **kanban view** groups by `proficiency` — four columns from `new` →
  `mastered`. Dragging a card across promotes or demotes the word; the user can
  run a spaced-review session entirely by dragging.
- The agent can **bulk-add** words from a passage, a lesson, or a topic the user
  is studying: extract the unfamiliar words, write one record each at
  `proficiency: "new"`, fill in `meaning` and a natural `example` sentence.
- For a **quiz**, the agent reads the items, picks words at the lower proficiency
  levels, and uses `presentForm` (or just asks in chat) to test the user — then
  bumps `proficiency` up for the ones they got right.
- Because each word is its own file, the deck is fully diffable and portable;
  the user owns it as plain JSON.

## Extending it

- Add a `partOfSpeech` enum (`noun` / `verb` / `adjective` / …) or a `tags`
  field to group words by lesson or theme.
- Add a `pronunciation` string (IPA or kana) for spoken practice.
- Add a `dueDate` date plus `"calendarField": "dueDate"` to schedule spaced
  repetition on the calendar.

Keep additions minimal — the four core fields (`word`, `proficiency`,
`meaning`, `example`) are enough to start learning today.
