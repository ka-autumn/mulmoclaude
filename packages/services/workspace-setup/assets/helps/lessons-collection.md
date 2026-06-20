# Lessons — a stateful-curriculum collection recipe

Read this whenever the user wants to **learn a topic over multiple sessions** and
have their **course tracked** — a sequence of lessons, where each lesson is taught
once, practiced, and revisited, with progress that survives across conversations.
It is the authoritative template for a lessons collection — copy it rather than
reinventing one from the generic DSL fragments in
`config/helps/collection-skills.md`. Read that file first for the general schema
rules; this one is the lessons-specific specialization. For a **flashcard / word
deck** (single-item drilling rather than a structured curriculum) use
`config/helps/vocabulary.md` instead.

The design in one line: **each lesson is one record, the `status` enum is the
single source of truth for where the learner is in the curriculum, and a kanban
board turns the whole course into a visible progress pipeline.** The lesson's
actual content lives as a self-contained HTML artifact that a `file` field links
to — so the collection is the *table of contents + progress board* over the
self-contained HTML lessons you author.

> **The `lesson` field points at a real HTML file on disk.** Each lesson's body
> is a self-contained HTML page saved under `artifacts/html/…`; the `file` field
> stores its **workspace-relative path**, and the row becomes a clickable link
> that re-opens the rendered page. The collection never stores the lesson body —
> it points at it. One concept per lesson, one HTML file per lesson, one record
> per lesson. **How and *when* that file gets written matters — see "Authoring the
> lesson HTML" and "Pre-generating lessons in the background" below: author ahead of
> time in a hidden background session so the learner never waits; `presentHtml`
> renders a single lesson to the learner but don't loop it to batch-create files.**

## Ground it in the learner's goal first

A curriculum is only good if it serves a real goal. **Before** authoring lessons,
establish *why* the learner wants this and *where they already are* — the Tutor
role does this with `putQuestions`. Capture the answer (their goal + current
level) so later sessions can resume without re-asking: either in the SKILL.md, or
as a `singleton` companion collection (see "Extending it"). Then pitch each
lesson at the learner's **zone of proximal development** — challenging but
reachable — and prefer cited, external sources over unverified recall.

## schema.json

Author it at `data/skills/lessons-<topic>/schema.json` — one collection per
course, so the slug carries the topic (`lessons-french-cooking`,
`lessons-linear-algebra`). The bridge mirrors it to `.claude/skills/<slug>/`; the
user opens it at `/collections/lessons-<topic>`:

```json
{
  "title": "Linear Algebra",
  "icon": "school",
  "dataPath": "data/lessons-linear-algebra/items",
  "primaryKey": "id",
  "fields": {
    "id":        { "type": "string",   "label": "ID", "primary": true, "required": true },
    "order":     { "type": "number",   "label": "#", "required": true },
    "title":     { "type": "string",   "label": "Lesson", "required": true },
    "status":    { "type": "enum",     "label": "Status", "values": ["planned", "learning", "practiced", "mastered"], "required": true },
    "objective": { "type": "text",     "label": "What this lesson teaches" },
    "lesson":    { "type": "file",     "label": "Lesson" },
    "resources": { "type": "markdown", "label": "Cited sources" },
    "notes":     { "type": "text",     "label": "Where the learner is" }
  },
  "displayField": "title",
  "kanbanField": "status",
  "actions": [
    { "id": "learn", "label": "Learn", "icon": "school", "kind": "chat", "role": "tutor", "template": "templates/learn.md" }
  ],
  "collectionActions": [
    { "id": "continue", "label": "Learn", "icon": "play_arrow", "kind": "chat", "role": "tutor", "template": "templates/continue.md" }
  ]
}
```

Every key earns its place:

| Key | What it gives the user |
|---|---|
| `order` (`number`) | The curriculum sequence. Sort the table by it to read the course top-to-bottom. Cheap to renumber, unlike renaming files. |
| `title` (`string`) | The lesson name. It is the `displayField`, so it labels every table row and kanban card. |
| `status` (`enum`) | The four stages of mastery and the single source of truth for "where the learner is". Drives the kanban columns: `planned` → `learning` → `practiced` → `mastered`. |
| `objective` (`text`) | The **prompt the lesson's HTML page is generated from** (see the callout below). A paragraph covering the one concept this lesson teaches, the key points, and the takeaway — keep it to **one concept** (the cardinal rule of good lessons), but describe it *fully*. Not a one-line title. |
| `lesson` (`file`) | The clickable link to the lesson's HTML page on disk. Stores the bare workspace-relative path (`artifacts/html/lessons-<topic>/<id>.html`) — never an `/api/files/raw?...` URL. Written directly to disk when pre-authored, or set from the path `presentHtml` returns when taught live. Empty until the page exists. |
| `resources` (`markdown`) | Cited external sources for the lesson — links the learner can return to. Grounds teaching in verifiable material, not unverified recall. |
| `notes` (`text`) | Learner-specific observations: what they struggled with, what to revisit next time. The continuity that makes multi-session teaching work. |
| `kanbanField` | Pins the board to `status` (drag a card → writes `status`). |
| `displayField` | Card / table label (the lesson title, not the opaque id). |

> **`objective` is the lesson's generation prompt — write it like one.** Because
> lessons are authored just-in-time, when the page is finally written the LLM sees
> only this record: `title` + `objective` are the entire spec it generates the
> HTML from. So don't write a label — write a brief. Spell out the angle to take,
> the points that must be covered, a worked example or analogy to use, what to
> defer to other lessons, and the takeaway the learner should leave with. The
> richer the `objective`, the better the page and the less it drifts from the
> course you planned. Think of it as the prompt you're handing your future self.
>
> **Because it's a long prose field, mind the JSON:** an unescaped ASCII quote
> inside `objective` (e.g. `…もう"中心"ではなく…`) breaks the file, and a broken
> record is **silently skipped** — you'll quietly end up with fewer lessons than
> you wrote. In prose, use `「」`/`『』` (or escape as `\"`), never a raw `"`.

**Labels are localizable.** `title`, every `label`, and the enum `values` are free
text — translate them into the learner's language. Product/role names stay in
English. Keep the `status` `values` in lockstep with anything that references them
(`kanbanField`, action `when` predicates).

## Action templates

There are just **two actions, both labeled "Learn"** — each picks the right mode
automatically, so the learner never has to choose "teach vs. review vs. extend".
Each needs a plain-English template inside the skill dir; the host starts a new
chat in the `tutor` role seeded with it.

- **Per-record action** (`actions`) — the **Learn** button on a lesson's detail
  panel. The host prepends **that lesson's record JSON** as passive data; the
  `learn` template teaches or reviews it depending on its `status` (the gating
  that used to need a `when` predicate now lives inside the template).
- **Collection-level action** (`collectionActions`) — the **Learn** button in the
  collection header. There's no single record, so the host prepends a **compact
  progress summary of every lesson** (each one's `id`, `title`, and `status`); the
  `continue` template reads how far the learner has got and picks the next lesson
  to run. `when` predicates are not evaluated on collection-level actions.

Keep templates short — the role prompt already knows how to teach.

`data/skills/lessons-<topic>/templates/learn.md` (per-record):

```markdown
Learn this lesson. The record above gives the lesson's `title`, its `objective`
(a paragraph describing what to teach — your authoring brief), `status`, and — if
already authored — its `lesson` HTML path. Pick the mode from `status`, and never
jump straight to a quiz — the HTML page IS the lesson, so deliver it first.

Deliver the page with `presentHtml`:
- `lesson` already set (often pre-authored in the background — see below) → present
  it by passing its **path** to `presentHtml` (no duplicate save). Instant.
- `lesson` empty (the prefetch worker hasn't finished, or never ran) → author the
  page **from the `objective` brief** and present it with `presentHtml` (passing the
  `html`), then write the returned `data.filePath` into the record's `lesson` field.
  This is the graceful fallback.

**The moment the page is on screen — _before_ you teach or quiz — prefetch the next
lesson** so its generation overlaps the whole time the learner spends here: call
`spawnBackgroundChat` (`hidden: true`, `role: "tutor"`) to author the next-by-`order`
lesson's HTML in the background (a self-contained message that reads that record and
`Write`s the page to `artifacts/html/lessons-<topic>/<id>.html`, sets its `lesson`
field, and presents nothing). Skip if it's already authored or this is the last
lesson. **Do this now, not at the end** — the learner often advances the instant they
finish, and a prefetch fired during the wrap-up is too late to hide the wait.

Then branch on `status`:
- `planned` / `learning` → teach the page, check understanding with a question or a
  `presentForm` quiz, and set `status` to `learning` (or `practiced` if they nailed
  it).
- `practiced` / `mastered` → run a short review quiz on the `objective` (include an
  "explain it in your own words" item); set `status` to `mastered`, or back to
  `learning` if they're shaky.

Cite real sources in the page and in `resources`, and record anything to revisit in
`notes`. Don't re-show the collection card after a single lesson — just keep the
conversation going; the board reflects the new `status` next time it's opened. (The
next lesson was already prefetched right after you showed this page — see above.)
```

`data/skills/lessons-<topic>/templates/continue.md` (collection-level):

```markdown
Continue the course. The summary above lists every lesson's `id`, `title`, and
`status`. Pick the next move, in order:

1. a lesson with `status: learning` → resume it
2. else the lowest-`order` `status: planned` lesson → start it
3. else a `practiced` (not yet `mastered`) lesson → review it

In cases 1–3, run that one lesson exactly like the per-lesson Learn button: present
by `path` if `lesson` is set (else author from `objective`), and **immediately
prefetch the next lesson** with a hidden `spawnBackgroundChat` worker — _before_ you
teach or quiz, so it generates while the learner works. Then deliver the lesson, check
understanding, and update `status` + `notes`. Don't re-show the collection card
afterwards — just continue the conversation.

4. only if **every** lesson is `mastered` → append the next batch as `planned`
   records (a **paragraph `objective`** each — the authoring brief — continuing the
   `order`), pitched at the learner's now-higher level; do NOT author the HTML yet.
   When you write these records, use the language's quotation marks (`「」`/`『』`,
   or `'…'`/`“…”`) — or escape as `\"` — in string values, never a raw `"`, or the
   file breaks and the record is silently skipped. Then call
   `presentCollection` once to show the expanded roadmap.
```

## Authoring the lesson HTML — two ways

`presentHtml` does two things: it saves the HTML *and* **renders it in the
learner's canvas**. The `Write` tool only saves. Choose by whether the learner
should see the page right now.

**Batch / scaffolding (no user involvement) — Write the file directly.** If you
pre-author several lessons at once, do NOT loop `presentHtml` over them — that
would flash every page into the canvas one after another, hijacking the
conversation. Instead:

1. Author the self-contained HTML (see `config/helps/presenthtml.md` for the
   document rules — full `<!DOCTYPE html>`, inline CSS/JS or an allowed CDN).
2. **Write it straight to disk** at a stable, course-scoped path:
   `artifacts/html/lessons-<topic>/<id>.html` (filename = the record id, so the
   link is meaningful and stable). Use the `Write` tool — not `presentHtml`.
3. Set that path as the lesson record's `lesson` field.

**Teaching one lesson live — use `presentHtml`.** This is the common case: most
lessons are authored **just-in-time**, the moment the learner reaches them (you
don't pre-generate the whole course up front). When you teach one and want it in
the canvas:

- **New lesson** (empty `lesson`): call `presentHtml` with the `html` — it saves
  and renders in one step and returns the saved path in `data.filePath`. Write
  *that* returned path into the record's `lesson` field (don't also `Write` it
  yourself, or you'll create two copies).
- **Pre-authored lesson** (`lesson` already set): call `presentHtml` with the
  **`path`** (the existing `lesson` value) instead of `html` — it presents the
  file in place without saving a duplicate.

Either way, **`presentHtml` must actually run** — delivering the page is the heart
of teaching, not an optional step before the quiz.

Keep lesson pages **self-contained** (inline everything or an allowed CDN) so
they render correctly regardless of the directory they were saved in.

## Pre-generating lessons in the background — no wait

Authoring a full HTML page takes the model tens of seconds, and `presentHtml` only
renders **after** the page is fully generated. So a lesson authored at the moment
the learner asks for it makes them **stare at a blank canvas** — worst of all on the
very first lesson of a brand-new course. The fix: author **ahead of time, in a
parallel background session**, so the page is already on disk (and the record's
`lesson` field set) by the time the learner opens it. Then you just present it by
`path`, instantly.

The tool is **`spawnBackgroundChat({ message, role, hidden })`** — it launches a
second, independent agent session that runs **concurrently** with this conversation
and returns immediately. To pre-author one lesson:

```
spawnBackgroundChat({
  role: "tutor",
  hidden: true,
  message: "<a fully self-contained instruction — see the rules below>"
})
```

Rules for the worker:

- **`hidden: true`, always.** These are plumbing, not conversations — a visible
  worker would clutter the learner's chat history. (`hidden: false` exists for other
  uses where the user *should* see the spawned chat; a lesson worker is never that.)
- **The `message` must be fully self-contained** — the worker shares NONE of this
  chat's context. Spell out: read the record at
  `data/lessons-<topic>/items/<id>.json`; author a self-contained HTML page **from
  its `objective`** (full `<!DOCTYPE html>`, inline CSS/JS or an allowed CDN — see
  `config/helps/presenthtml.md`); **`Write`** it to
  `artifacts/html/lessons-<topic>/<id>.html`; set that path as the record's `lesson`
  field with `manageCollection` putItems `mode: "merge"` (`{ id, lesson }` — merge
  keeps every other field); do **NOT** call `presentHtml` and do **NOT** present
  anything — just write the files and stop. (No one is viewing the worker's canvas,
  so presenting there is wasted.)
- **One lesson per call**, and don't spawn a fleet — the host caps concurrent hidden
  workers and a worker can't spawn further workers.

**When to pre-author:**

1. **At course creation — pre-author lesson 1 (optionally 2).** Right after
   `presentCollection` shows the roadmap, fire a worker for lesson 1 and tell the
   learner it's being prepared (e.g. "コースができました!最初のレッスンを準備中です。
   準備ができたら『始めて』と言ってください"). The learner reads the roadmap while the
   page generates — the wait now **overlaps** with something useful instead of being
   dead air. Do **not** also author lesson 1 inline in the same turn.
2. **Prefetch the next lesson the moment you present the current one — not at the
   end.** As soon as lesson N's page is on screen (*before* you teach or quiz it),
   fire a worker for the next-by-`order` lesson, so its generation overlaps the
   *whole* time the learner spends on N. Waiting until you update `status`/`notes` is
   too late — the learner often advances the instant they finish, and the wait
   reappears. By the time they reach N+1, it's already authored → instant.

**Presenting, and the fallback.** When the learner opens a lesson, check its `lesson`
field: **set** → `presentHtml` by `path` (instant); **still empty** (the worker
hasn't finished, or never ran) → author it inline from `objective` as usual. The
inline path is the graceful fallback — background pre-generation is a pure
optimization, never a dependency. Because workers write to the **stable**
`artifacts/html/lessons-<topic>/<id>.html` path, a rare double-author (learner races
ahead of the worker) just overwrites in place — never a duplicate.

## SKILL.md

`data/skills/lessons-<topic>/SKILL.md` tells the agent when and how to operate the
collection. Keep it short — the schema and templates do the heavy lifting. Cover:

- **Trigger phrases** — "teach me <topic>", "what's my next lesson", "continue my
  course", "I'm ready for the next one", plus the equivalents in the learner's
  language.
- **Record shape** — point at the schema; note `id` is the filename
  (`lesson-<order3>-<slug>`, e.g. `lesson-001-eigenvalues`), new lessons start at
  `status: "planned"` with an empty `lesson`, `order` is the reading sequence, and
  `objective` is a **full paragraph** (the authoring brief), not a one-liner.
- **The teaching loop** —
  - **Plan the course**: once the goal/level is known, draft the full sequence of
    lessons as `planned` records, in `order`, so the learner can see the road
    ahead. Give each one a **paragraph `objective`** — what that lesson must teach,
    its key points, the intended takeaway — not just a title. That paragraph is
    what makes deferred authoring work: when you write the page later, the record's
    `objective` is the prompt you generate it from, so write it that way. Once the
    records are written, call `presentCollection` **once** to show the roadmap (this
    also surfaces any malformed records right away). **Then immediately fire a hidden
    `spawnBackgroundChat` worker to pre-author lesson 1** and tell the learner it's
    being prepared — do NOT author lesson 1 inline in the same turn (see
    "Pre-generating lessons in the background"). The learner reads the roadmap while
    it generates.
  - **Pre-author lesson 1 in the background** (then the rest just-in-time): the
    worker above writes lesson 1's HTML to disk and sets its `lesson` path, so the
    first open never waits. You *may* fire a second worker for lesson 2 as well.
    Leaving the rest `planned` with an empty `lesson` and prefetching each next
    lesson as you open the current one is the default — never pre-generate the
    whole course up front.
  - **Learn a lesson** (the per-lesson **Learn** button): always **deliver the page
    with `presentHtml` first** — never jump straight to a quiz. Present by `path` if
    `lesson` is set (usually it was pre-authored in the background), else author from
    `objective` inline (store the returned `data.filePath`) as the fallback. **The
    moment the page is shown — before teaching or quizzing — prefetch the next lesson**
    with a hidden `spawnBackgroundChat` worker, so its generation overlaps this whole
    lesson rather than starting at the end. Then branch on `status`:
    `planned`/`learning` → teach + quiz (→ `learning`/`practiced`);
    `practiced`/`mastered` → review quiz (→ `mastered`, or back to `learning` if
    shaky). Record gaps in `notes`.
  - **Continue the course** (the header **Learn** button, `continue` action): from
    the progress summary, resume a `learning` lesson, else start the lowest-`order`
    `planned` one, else review a `practiced` lesson; **prefetch the next lesson the
    moment you present the current one** (not after running it) — and only once
    everything is `mastered`, append the next batch of `planned` lessons (paragraph
    `objective` each, HTML authored lazily later).
- **Operations** — record I/O via `manageCollection` (`getItems` to read;
  `putItems` for schema-validated writes — `mode: "create"` for new lessons,
  `mode: "merge"` with a partial row for status/notes/lesson updates so the
  fields you omit survive; Delete removes the file at
  `data/lessons-<topic>/items/<id>.json`; raw Read / Write / Edit is the
  escape hatch). Rather than dumping the whole course into chat,
  point the user at `/collections/lessons-<topic>`.
- **When to call `presentCollection`** — when the **course itself** changes: after
  creating the collection or adding/extending lessons (it also surfaces malformed
  records). Do **not** call it after each individual lesson's teach/review — a
  single `status` update doesn't need the whole board re-rendered; that's just
  noise mid-lesson.

## A record on disk

One JSON per lesson — `lesson` is empty until the lesson is taught. Note the
`objective` is a full paragraph (the brief the page will be authored from), not a
one-liner:

```json
{ "id": "lesson-001-eigenvalues", "order": 1, "title": "What an eigenvalue is", "status": "planned", "objective": "Teach that an eigenvector is a direction a matrix only scales (never rotates), and its eigenvalue is the scale factor. Cover the geometric picture first (a transformation acting on a few vectors, most changing direction, a special one not), then the equation Av = λv. The takeaway: the learner can look at a 2x2 transformation and point to which directions are eigenvectors. Keep it geometric — defer the characteristic-polynomial algebra to a later lesson." }
```

After teaching, the same record gains its artifact link:

```json
{ "id": "lesson-001-eigenvalues", "order": 1, "title": "What an eigenvalue is", "status": "learning", "objective": "Teach that an eigenvector is a direction a matrix only scales (never rotates), and its eigenvalue is the scale factor. Cover the geometric picture first, then Av = λv. Takeaway: spot eigenvectors of a 2x2 transformation by eye. Keep it geometric.", "lesson": "artifacts/html/lessons-linear-algebra/lesson-001-eigenvalues.html", "resources": "- [3Blue1Brown](https://www.3blue1brown.com/)", "notes": "Solid on the geometry; revisit the algebra next time." }
```

## What the learner gets, with zero host code

- **Table** — the whole course in `order`, each row showing its `status` and a
  clickable link to the rendered lesson. The `status` dropdown edits inline.
- **Kanban** — columns from `status`; the course as a progress pipeline. Drag a
  card to promote/demote a lesson, or run an entire review pass by dragging.
- **Learn button (per lesson)** — one tap starts a fresh Tutor chat seeded with
  that lesson; it teaches or reviews based on the lesson's `status`, so there's
  nothing to decide.
- **Learn button (header)** — seeds a Tutor chat with the whole course's progress
  and resumes where you left off — picking the next lesson, or growing the course
  once everything's mastered.
- Because each lesson is its own file, the course is fully diffable and portable;
  the learner owns it as plain JSON plus the HTML artifacts.

## Extending it

- **Spaced review reminders.** Add a `reviewBy` (`date`) field plus
  `"completionField": "status"`, `"completionDoneValues": ["mastered"]`,
  `"triggerField": "reviewBy"`, and a `"notifyWhen": { "field": "status", "in":
  ["practiced", "mastered"] }`. The bell then nudges the learner to review a
  taught lesson on its `reviewBy` date — without belling every `planned` lesson.
- **The mission / goal.** For a durable record of *why* the learner is studying,
  add a `singleton` companion collection (`lessons-<topic>-goal`, `singleton:
  "goal"`) with `goal`, `level`, and `target` fields — read it at the start of
  every session to resume without re-interviewing.
- **A "mastered" checkbox.** Add a `toggle` projecting `status`
  (`"field": "status", "onValue": "mastered", "offValue": "practiced"`) for a
  one-click way to mark a reviewed lesson done.
- **Prerequisites.** Add a `ref` field pointing back into the same collection to
  record which lesson must come first — useful for non-linear curricula.

Keep additions minimal — the core fields (`order`, `title`, `status`,
`objective`, `lesson`) are enough to start teaching a tracked course today.
