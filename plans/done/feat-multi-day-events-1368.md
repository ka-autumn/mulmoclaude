# feat: multi-day calendar events (#1368)

## Problem

Events with `props.endDate` only render in the cell matching
`props.date`. `itemsForDay` in `src/plugins/scheduler/View.vue:368-371`
does a strict equality against `date` and never consults `endDate`,
even though `handleAdd` happily persists whatever is in `props`.

Secondary gaps:

- `calendarDefinition.ts` doesn't document `endDate`, so the LLM
  emits it on a hunch with no validation.
- No validation in `handleAdd` / `handleUpdate`: a malformed range
  (`endDate < date`, non-ISO value) is silently stored.
- No tests for multi-day handling anywhere.

## Approach — hybrid (issue #1368 "Recommended fix")

Render the same event on every day its range covers, but vary the
per-cell styling so the first and last day have rounded corners on
the outer edges and middle days stay square. Same `id` everywhere
→ click / edit / delete naturally hit the same event. Skips the two
genuinely hard pieces of a real Google-Calendar-style bar
(week-row splitting into one DOM element + lane assignment for
overlapping bars).

## Changes

### 1. Helper module (new, pure, testable)

`src/plugins/scheduler/multiDayHelpers.ts` — small pure module so
the range-match + segment-position logic can be unit-tested without
mounting a Vue component:

- `eventRange(item)` → `{ start, end } | null` (returns `null` for
  undated items; treats missing `endDate` as `start === end`; returns
  `null` when start/end are non-strings, malformed, or `end < start`)
- `coversDay(item, dateStr)` → boolean
- `segmentPosition(item, dateStr)` → `"only" | "start" | "middle" | "end" | null`

### 2. View.vue

- Swap the `itemsForDay` filter to use `coversDay`.
- Refactor the month-cell chip render to read `segmentPosition` and
  apply Tailwind classes:
  - `only`: `rounded` + full title
  - `start`: `rounded-l` + square right + full title
  - `middle`: square both + title visually hidden (`opacity-70` or
    `text-transparent` keeping height) — final choice TBD by what
    looks decent at the existing `text-[10px]` size
  - `end`: square left + `rounded-r` + square right edge
- Apply the same logic to the week-view chip (line ~128).

### 3. Tool schema (`calendarDefinition.ts`)

- Add an explicit `endDate` mention in `props`' description (ISO
  date, inclusive, optional) so the LLM emits it deliberately.
- Update the prompt blurb to mention multi-day events.

### 4. Validation (`schedulerHandlers.ts`)

- `handleAdd` / `handleUpdate`: when `props.endDate` is present,
  require `props.date` to also be present, both to be ISO date
  strings (`YYYY-MM-DD`), and `endDate >= date`. On violation:
  drop `endDate` and continue (don't reject the whole add — the
  event itself is still valid as a single-day).
- Same rules on `handleReplace` (in case data is replayed).

### 5. Tests

- `test/plugins/scheduler/test_multiDayHelpers.ts` (new) — full
  coverage of `eventRange` / `coversDay` / `segmentPosition` across:
  - undated event
  - single-day event (no endDate)
  - 3-day range
  - week-crossing range
  - month-crossing range
  - malformed (`endDate < date`, non-string types, empty strings)
- `test/routes/test_schedulerHandlers.ts` — extend with:
  - add accepts valid range
  - add drops `endDate` when malformed but keeps the event
  - update merges valid `endDate`
  - update drops invalid `endDate` patch but applies other props

## Out of scope

- Full Google-Calendar-style continuous bar (week-row splitting +
  lane stacking). File as follow-up if `+N more` overflow becomes a
  real complaint.
- Repeating / recurring events.
- Intra-day `endTime`.
- iCal-style timezone handling.

## Acceptance

- Adding `{ date: "2026-05-27", endDate: "2026-05-29" }` paints the
  event on May 27, 28, and 29 in both week and month views.
- Across a Sun/Mon week boundary, the segments split visually with
  no special arrow indicator (acceptable for v1).
- `endDate: "2026-05-26"` (before start) is silently dropped at
  add time; event still saves as a single-day on 2026-05-27.
- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
  all pass.
