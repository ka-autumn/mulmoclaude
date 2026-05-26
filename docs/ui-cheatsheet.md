# UI Cheatsheet — ASCII layouts anchored to component / testid names

A quick visual reference so chat instructions about UI ("the bell at the top right has stale state") can be unambiguous without screenshots. Names in `[brackets]` are real `data-testid` values from the source — so you can `grep -rn 'data-testid="<name>"' src/` to jump to the rendering site, and `gh pr review` comments can reference them in plain text.

## Conventions

- `[name]` — a real `data-testid` you can grep for.
- `<Component>` — a Vue component name (also greppable: `grep -rn 'name: "Component"' src/` or import sites).
- `(:route)` — the URL route the surface lives under.
- ASCII art captures **layout intent**, not pixels. Animation, hover state, exact spacing, and CSS regressions are out of scope — use a screenshot for those.
- This file goes **out of date as the UI evolves**. When you change a layout or rename a testid, update the matching block here in the same PR. Treat it like CHANGELOG entries — small, mechanical updates per PR keep the doc honest.

## Top-level chrome (every route)

```
┌─[App.vue root]────────────────────────────────────────────────────────┐
│ ┌─[#header]────────────────────────────────────────────────────────┐  │
│ │  ⌂[Go to latest chat / brand]  🔓lock_open  🔔[notification-bell]│  │
│ │                                              ⚙ settings          │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│ ┌─<PluginLauncher> [plugin-launcher]──────────────────────────────┐   │
│ │ ✓Todos │📅Calendar │⏰Actions │📖Wiki │📡Sources │🧠Skills │🎭Roles│📁Files│   │
│ │ [plugin-launcher-todos] [plugin-launcher-calendar] ...          │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│ ┌─[main pane — route-specific]────┐ ┌─<SessionHistoryPanel>────────┐  │
│ │                                 │ │ [session-history-side-panel] │  │
│ │  (the active /route's content)  │ │ ┌─[session-filter-bar]─────┐ │  │
│ │                                 │ │ │ All │Unread│Running│...   │ │  │
│ │                                 │ │ │ [session-filter-<key>]    │ │  │
│ │                                 │ │ └──────────────────────────┘ │  │
│ │                                 │ │ • [session-item-<uuid>]      │  │
│ │                                 │ │ • [session-item-<uuid>]      │  │
│ └─────────────────────────────────┘ └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

Sidebar visibility toggles via the canvas-layout state. When closed, the main pane is full-width.

## `<SessionSidebar>` — left column on every chat session (single layout)

The `w-80` left column inside the chat page (and any other view that mounts it). Despite the historical name `ToolResultsPanel` (renamed in #842), it owns the whole left chrome of an active session: role header, layout / tool-call-history toggles, the tool-result preview list, and the run-time "thinking" indicator.

```
┌─<SessionSidebar>──────────────────────────────┐
│ ┌─[sidebar-role-header]─────────────────────┐ │
│ │ ⭐ General              [copy-chat-md] 🔧 ▦/▥│ │  ← role icon + name
│ │                                            │ │     copy session as Markdown (content_copy)
│ │                                            │ │     toggle right sidebar (build icon)
│ │                                            │ │     <CanvasViewToggle> single/stack
│ └────────────────────────────────────────────┘ │
│ ┌─[tool-results-scroll]────────────────────┐   │  ← scrollable list,
│ │ ┌─card (selected: ring-blue-500)──────┐ │   │     click → emit("select", uuid)
│ │ │ source •          • smart-time       │ │   │
│ │ │ [<plugin>.previewComponent]         │ │   │
│ │ └──────────────────────────────────────┘ │   │
│ │ ┌─card──────────────────────────────────┐ │   │
│ │ │ ...                                   │ │   │
│ │ └──────────────────────────────────────┘ │   │
│ └──────────────────────────────────────────┘   │
│ ┌─Thinking indicator (only while isRunning)─┐  │  ← role="status" aria-live="polite"
│ │ status • • • • [run-elapsed] (≥1s)        │  │
│ │   • pendingToolName · 2.3s                │  │
│ │   • pendingToolName · 0.8s                │  │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

In **Stack layout** this sidebar isn't rendered; the same data flows through `<StackView>` which inlines result bodies into the main column. Only single layout shows the preview list. `<StackView>`'s own header (`[stack-role-header]`) carries the same control cluster — `[copy-chat-md]` (content_copy → check on success), tool-call-history toggle, and `<CanvasViewToggle>` — so the affordance lives in the same visual slot regardless of layout.

## NotificationBell expanded

```
🔔[notification-bell]──┐
   🔴[notification-badge: "N"] (worst-severity color; shown when active > 0)
   │  ┌─[notification-panel] (opens on click) ─────────────────┐
   │  │ Notifications                                          │
   │  ├─ Active (N) ──────────────── [notification-clear-all]  │ (fyi rows only)
   │  │ 🔔 Active row title                  ✕ (action only)   │
   │  │     N min ago · pluginPkg                              │
   │  │ … [notification-item-<id>]                             │
   │  ├─ History (N) ─────────────────────────────────────────┤
   │  │ ✓ / ✗  History row title                              │
   │  │        N min ago · cleared|cancelled · pluginPkg      │
   │  │ … initial 5 rows; rest hidden behind toggle           │
   │  ├──────────────────────────────────────────────────────┤
   │  │ [notification-history-toggle]                          │
   │  │   "Show more (N)" / "Show less" (only when > 5 items) │
   │  └──────────────────────────────────────────────────────┘
   └─ active rows: [notification-item-<id>]
      history rows: [notification-history-<id>]
```

- **Active** rows: fyi (body click clears + navigates) vs action (× cancels; body click navigates only).
- **History** rows: read-only; navigate on click when `navigateTarget` is present. Capped at `HISTORY_CAP` (50) FIFO server-side; bell collapses to the first 5 with a toggle so repetitive entries (e.g. recurring "docker not running") don't bury the rest. Toggle state resets each time the popup closes.

## /chat — the chat page

```
┌─[main pane (chat)] ────────────────────────────────────────────────────┐
│ ┌─[chat column — left, single layout]──┐ ┌─[canvas column — right]──┐  │
│ │                                       │ │                          │  │
│ │  scrollback transcript (text-results, │ │ Selected tool result UI: │  │
│ │  tool-call cards, agent responses)    │ │  • <CalendarView>        │  │
│ │                                       │ │  • <MarkdownView>        │  │
│ │  • text-response (user) ──────────╮   │ │  • <SpreadsheetView>     │  │
│ │  • text-response (assistant) ─────╯   │ │  • <ChartView>           │  │
│ │  • tool-call card                     │ │  • ...                   │  │
│ │    ↳ <Preview> (compact summary)      │ │                          │  │
│ │      click → selectedResultUuid       │ │ "Edit / Apply / PDF"     │  │
│ │                                       │ │ buttons may appear at    │  │
│ │                                       │ │ the top of certain views │  │
│ │  ┌─<ChatInput> [chat-input/wrapper]─┐ │ │                          │  │
│ │  │ <SuggestionsPanel> (when open)   │ │ │                          │  │
│ │  │ [user-input]                  …  │ │ │                          │  │
│ │  │ [suggestions-btn] (if queries)   │ │ │                          │  │
│ │  │ [send-btn] [stop-btn]            │ │ │                          │  │
│ │  │ [attach-file-btn]                │ │ │                          │  │
│ │  └──────────────────────────────────┘ │ │                          │  │
│ └───────────────────────────────────────┘ └──────────────────────────┘  │
│                                                                         │
│ Stack-layout collapses both columns into one (responsive / user-pref).  │
└─────────────────────────────────────────────────────────────────────────┘
```

The right canvas binds to `currentSession.selectedResultUuid`. Clicking a tool-call card on the left sets the uuid; the right pane re-renders via plugin lookup (`getPlugin(toolName).viewComponent`).

### Canvas plugin views — primary testids

Stable hooks for tests / chat references when a tool result is selected on the right canvas:

| Plugin | testid | What it points at |
|---|---|---|
| `presentHtml` | `[present-html-iframe]` | The `<iframe :src="/artifacts/html/...">` rendering the saved HTML page |
| `generateImage` | `[generate-image-view]` | The wrapper around `<ImageView>` showing a generated image (`<img src="/artifacts/images/...">`) |
| `textResponse` | `[text-response-pdf-button]` | The "PDF" button on an assistant text response (`usePdfDownload` → `/api/pdf/markdown`) |
| `textResponse` | `[text-response-edit]` / `[text-response-edit-summary]` / `[text-response-edit-textarea]` / `[text-response-apply-btn]` | The collapsible source editor on an assistant text response |

(Other plugin views — `<CalendarView>`, `<MarkdownView>`, `<SpreadsheetView>`, `<ChartView>`, etc. — are documented in their own sections below or are direct components without a stable testid yet.)

## /calendar — calendar of dated items

```
┌─[<CalendarView> mounts <SchedulerView force-tab="calendar">]──────────┐
│                                                                       │
│  ┌─Header───────────────────────────────────────────────────────────┐ │
│  │  📅 Calendar  N items     ◀ Today ▶   month ▼   week  list      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─Grid (month/week) or List───────────────────────────────────────┐ │
│  │  Mo  Tu  We  Th  Fr  Sa  Su                                     │ │
│  │  …                                                              │ │
│  │  [scheduler-item-<id>]   "Team meeting" · 10:00                  │ │
│  │                          (drag to move; click → edit form)      │ │
│  │  ...                                                             │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  Edit form (when an item is selected):                                │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │  YAML editor: title + props.{date,time,location,notes,...}    │   │
│  │  [Apply Changes] [Cancel]                                     │   │
│  └───────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

In chat, when the agent calls `manageCalendar`, the same `<CalendarView>` mounts inside the right canvas with `selectedResult` populated.

## /automations — scheduled tasks

```
┌─[<AutomationsView> mounts <SchedulerView force-tab="tasks">]──────────┐
│                                                                       │
│  ┌─<TasksTab>──────────────────────────────────────────────────────┐ │
│  │  ▾ Recommended frequencies (collapsed)  [scheduler-frequency-   │ │
│  │                                          hints]                 │ │
│  │                                                                 │ │
│  │  ┌─Task row [scheduler-task-<id>]──────────────────────────┐    │ │
│  │  │  user│Finance daily briefing            ▶  ⋯  ✕         │    │ │
│  │  │      every morning at 06:00 local  · next: tomorrow     │    │ │
│  │  │      [scheduler-task-run]                               │    │ │
│  │  │      [scheduler-task-delete]                            │    │ │
│  │  └─────────────────────────────────────────────────────────┘    │ │
│  │  ┌─Task row [scheduler-task-<id>]──────────────────────────┐    │ │
│  │  │  system│Wiki maintenance                ⋯               │    │ │
│  │  └─────────────────────────────────────────────────────────┘    │ │
│  │  ...                                                            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

Origin badges: `system` (bg-gray) / `user` (bg-blue) / `skill` (bg-purple). Disabled tasks render at `opacity-50`.

## /wiki — wiki pages and lint report

`<WikiView>` shares one header tab strip — Index / Log / Lint / [wiki-tab-graph] — across
several layouts: the **index** (page list), a **single page** body, the activity **log**, the
**lint report**, and the **graph**.

### Index

```
┌─[<WikiView> action="index"]────────────────────────────────────┐
│ Tags filter: [wiki-tag-filter-all] [wiki-tag-filter-<tag>] ... │
│                                                                │
│ ┌─Entry list─────────────────────────────────────────────────┐ │
│ │ • [wiki-page-entry-<slug>]                                 │ │
│ │   Title  — short description  #tag #tag                    │ │
│ │   click → /wiki/pages/<slug>                               │ │
│ │ • [wiki-page-entry-<slug>]                                 │ │
│ │   ...                                                      │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
│ [wiki-create-page-button]   [wiki-update-page-button]          │
│ [wiki-lint-chat-button] (asks the agent to run lint_report)    │
└────────────────────────────────────────────────────────────────┘
```

### Single page

```
┌─[<WikiView> action="page" pageName="<slug>"]──────────────────┐
│ ▮ <slug>                            [wiki-update-page-button] │
│ ┌─Markdown content (.wiki-content, scrollable)──────────────┐ │
│ │ # Title                                                   │ │
│ │ markdown body...                                          │ │
│ │ ![image](relative/path)  ← rewritten to /api/files/raw    │ │
│ │ [[wiki-link]]            ← rewritten to /wiki/pages/<slug>│ │
│ └───────────────────────────────────────────────────────────┘ │
│ ┌─[wiki-linked-references] (pages whose [[links]] point here)┐ │
│ │ • [wiki-linked-reference-<slug>] → /wiki/pages/<slug>     │ │
│ └───────────────────────────────────────────────────────────┘ │
│ Per-page chat composer:                                       │
│   [wiki-page-chat-input]  [wiki-page-chat-send]               │
└───────────────────────────────────────────────────────────────┘
```

### Graph (`/wiki/graph`)

```text
┌─[<WikiView> action="graph"]───────────────────────────────────┐
│ [wiki-graph]                                                   │
│ ┌─[wiki-graph-canvas] (echarts force layout)────────────────┐ │
│ │   (•)Title ──→ (•)Title    click node → /wiki/pages/<slug>│ │
│ │        \         /         empty → "No links to graph yet"│ │
│ └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### page-edit (canvas timeline only — #963)

When the LLM Writes/Edits a `data/wiki/pages/<slug>.md` file via
Claude Code's built-in tools, the snapshot endpoint publishes a
synthetic `manageWiki` toolResult with `action: "page-edit"` into
the active session. The canvas (StackView) renders it via the
same `<WikiView>` component as `action: "page"`, so the body
markup is identical:

```text
┌─[<WikiView> action="page-edit" — canvas only]─────────────────┐
│ ▮ Wiki edit · <slug> · 2026-04-30 12:00                       │
│ ┌─[wiki-page-metadata-bar]────────────────────────────────┐   │
│ │ Created: ... · Updated: ... · Editor: llm · #tag1 #tag2 │   │
│ └─────────────────────────────────────────────────────────┘   │
│ [wiki-page-edit-banner] (only when snapshot was gc'd)         │
│ ┌─Markdown content from snapshot file (.wiki-content)─────┐   │
│ │ ...same render as the live page action...              │   │
│ └─────────────────────────────────────────────────────────┘   │
│ [wiki-page-edit-deleted] (only when both snapshot + page gone)│
└───────────────────────────────────────────────────────────────┘
```

Tabs / PDF / chat composer / create-update buttons are hidden —
this is a moment-in-time view, not the live page.

## /news — news viewer

`/news` reads the items the sources pipeline has fetched and presents them as a two-pane reader (list + detail) with unread tracking. Per-article chat composer lets the user spawn a new chat that's already aware of the article.

```text
┌─[<NewsView> data-testid="news-view"]─────────────────────────────────────┐
│ Header row:                                                              │
│   [news-counts] (e.g. "23 unread of 142")                                │
│   Filters: [news-filter-all] [news-filter-unread]  [news-mark-all-read]  │
│   Source selector: [news-source-<slug>] (one button per source)          │
│                                                                          │
│ ┌─[news-list] (left pane, 320px)────┐ ┌─[news-detail] (right pane)─────┐ │
│ │ [news-item-<id>] · headline       │ │ Article title + metadata       │ │
│ │ ◯ unread / ⚪ read                │ │ Author, source, published date │ │
│ │ source · published date           │ │                                │ │
│ │ ─────────────────────────────────  │ │ ┌─Article body (markdown)──┐  │ │
│ │ ...                               │ │ │ ...                      │  │ │
│ │                                   │ │ └──────────────────────────┘  │ │
│ │                                   │ │ [news-open-original] (↗︎)      │ │
│ │                                   │ │                                │ │
│ │                                   │ │ Per-article chat composer:    │ │
│ │                                   │ │ [news-article-chat-input]      │ │
│ │                                   │ │ [news-article-chat-send]       │ │
│ │                                   │ │ → spawns a new chat with a    │ │
│ │                                   │ │ "read this article first"     │ │
│ │                                   │ │ prepend                       │ │
│ └───────────────────────────────────┘ └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Clicking a list row marks it read (badge decrements). The "Mark all read" button zeroes the counter for the current filter scope.

## /sources — registered news/RSS feeds

```
┌─[<SourcesManager>]─────────────────────────────────────────────────┐
│ Top bar: [sources-add-btn] [sources-rebuild-btn]                   │
│                                                                    │
│ Add form (when adding) [sources-add-form]:                         │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ kind ▼  [sources-draft-kind]                                   │ │
│ │ url    [sources-draft-primary]                                 │ │
│ │ title  [sources-draft-title]                                   │ │
│ │ [sources-draft-cancel]   [sources-draft-add]                   │ │
│ │ error  [sources-draft-error]                                   │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ Filter chips: [sources-filter-chip-<key>] [sources-filter-clear]   │
│                                                                    │
│ ┌─Source row [source-row-<slug>]─────────────────────────────────┐ │
│ │  RSS │ Federal Reserve  · federal-reserve                      │ │
│ │       https://www.federalreserve.gov/feeds/press_all.xml       │ │
│ │       #central-bank                              [source-      │ │
│ │                                                  remove-<slug>]│ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ...                                                                │
│                                                                    │
│ Empty state: [sources-empty] (if no feeds yet) → preset buttons    │
│   [sources-preset-<id>]                                            │
│                                                                    │
│ Last rebuild summary at the bottom: [sources-rebuild-summary]      │
│                                                                    │
│ Per-page chat composer (page mode only): [sources-page-chat-input] │
│   [sources-page-chat-send] — spawns a fresh chat with a prepended  │
│   pointer to config/helps/sources.md                               │
└────────────────────────────────────────────────────────────────────┘
```

## /todos — Kanban / table / list of tasks

```
┌─[<TodoExplorer>]───────────────────────────────────────────────────┐
│ Top bar:                                                           │
│  [todo-search]   [todo-add-btn]   [todo-column-add-btn]            │
│  view mode: [todo-view-kanban] [todo-view-table] [todo-view-list]  │
│                                                                    │
│ Kanban (default):                                                  │
│ ┌─Backlog─────┐ ┌─Todo──────┐ ┌─In Progress─┐ ┌─Done────────┐      │
│ │             │ │           │ │             │ │             │      │
│ │ [todo-card- │ │           │ │             │ │             │      │
│ │  <id>]      │ │           │ │             │ │             │      │
│ │   Title     │ │           │ │             │ │             │      │
│ │   #label    │ │           │ │             │ │             │      │
│ │             │ │           │ │             │ │             │      │
│ └─────────────┘ └───────────┘ └─────────────┘ └─────────────┘      │
│                                                                    │
│ Drag cards across columns to change state.                         │
└────────────────────────────────────────────────────────────────────┘
```

## /files — workspace file explorer

```
┌─[<FilesView>]──────────────────────────────────────────────────────────┐
│ ┌─Tree pane──────────┐ ┌─Preview pane (route param: pathMatch)───────┐ │
│ │ ▶ artifacts/       │ │                                             │ │
│ │ ▼ config/          │ │ ┌─[system-file-banner] (#832, optional)───┐ │ │
│ │   • interests.json │ │ │ ℹ News notification filter profile · 🟢│ │ │
│ │   • mcp.json       │ │ │   Scores articles for the bell. …       │ │ │
│ │   • settings.json  │ │ │   Schema: server/.../interests.ts       │ │ │
│ │ ▶ conversations/   │ │ └─────────────────────────────────────────┘ │ │
│ │ ▶ data/            │ │                                             │ │
│ │ ▼ data/sources/    │ │  ┌─Preview rendered by FileContentRenderer┐ │ │
│ │   • foo.md   ←sel  │ │  │                                        │ │ │
│ │   • bar.md         │ │  │  • markdown → marked + Vue             │ │ │
│ │ ...                │ │  │  • images → <img>                      │ │ │
│ │                    │ │  │  • todos JSON → <TodoExplorer>         │ │ │
│ │                    │ │  │  • scheduler items.json → <CalendarView>│ │ │
│ │                    │ │  │  • code → text                         │ │ │
│ │                    │ │  └────────────────────────────────────────┘ │ │
│ └────────────────────┘ └─────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

The preview pane reuses plugin views — clicking a `config/scheduler/items.json` mounts `<CalendarView>` via `toSchedulerResult`. System-managed files (`config/*.json`, `data/wiki/*.md`, `conversations/memory.md`, …) get a `[system-file-banner]` above the body explaining what the file is, who writes it, and whether hand-edits survive (descriptors live in `src/config/systemFileDescriptors.ts`; #832).

## /skills — workspace skills list

Two-pane layout (`<ManageSkillsView>`): left sidebar = two collapsible
sections, **Active** (skills in `.claude/skills/`, discovered by Claude
Code and loaded into the prompt) and **Catalog** (launcher-managed
presets the user can browse / ★ star / ▶ run once without bloating the
prompt). Right pane renders the selected skill's `SKILL.md` (active) or
the preset/external detail with Star / Run once actions (catalog).
Within Active, provenance (System `mc-` bundled / Project / User) is a
per-row badge, not its own group; only **Project** skills expose
Edit/Delete, the rest are read-only. Collapse state per section is
persisted to `localStorage` (`skills:sectionCollapsed`); both sections
open by default. The Catalog section nests, under the **Presets**
sub-list, one collapsible subgroup per installed **external repo**
(#1383 PR-C) — repo header has a count + uninstall button, per-repo
collapse persisted to `skills:repoCollapsed`. A **+ Add skill
repository** button opens a modal (GitHub URL + optional subpath, plus
one-click seed suggestions). External rows behave like preset rows
(select → right pane Star / Run once); uninstalling a repo keeps any
already-starred skills in Active (star = fork).

```text
┌─[<ManageSkillsView>]───────────────────────────────────────────────┐
│ Skills                              N available · click · Run = /…│
│ ┌─Sidebar (w-64)──────────┬─Detail pane──────────────────────────┐ │
│ │ ▼ ACTIVE            11  │  <skill name>                         │ │
│ │ ├ [skill-item-foo] 🏠   │  description                          │ │
│ │ ├ [skill-item-bar] 📁   │                            ✏ Edit  ✕ ⏵│ │
│ │ └ [skill-item-baz] 📁   │  rendered SKILL.md (marked + sanitize)│ │
│ │ ▼ CATALOG            4  │                                       │ │
│ │   Presets               │  (catalog row → preset/external detail│ │
│ │ ├ [skill-catalog-…] ★   │   with ★ Star / ▶ Run once)           │ │
│ │ ▼ owner/repo (n) [⟳][🗑] │                                       │ │
│ │ ├ [skill-catalog-…] ☁   │                                       │ │
│ │ [+ Add skill repository]│                                       │ │
│ └─────────────────────────┴───────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

Testids: `skill-section-{key}` / `skill-section-toggle-{key}` /
`skill-section-count-{key}` for the two section headers
(`active` / `catalog`); `skill-item-{name}` per active row;
`skill-catalog-item-{id}` per catalog row — `id` = preset slug, or
`{repoId}/{skillFolder}` for external (stable identity, not the lossy
derived slug);
`skill-catalog-empty` when the catalog has no presets;
`skill-catalog-repo-{repoId}` / `skill-catalog-repo-toggle-{repoId}` /
`skill-catalog-repo-update-{repoId}` (re-fetch upstream) /
`skill-catalog-repo-uninstall-{repoId}` per external-repo subgroup;
`skill-catalog-add-repo` + `skill-add-repo-modal` /
`skill-add-repo-url` / `skill-add-repo-subpath` /
`skill-add-repo-submit` / `skill-add-repo-error` /
`skill-add-repo-suggestion-{url}` (click = prefill the URL/subpath
form + expand its description, NOT install) /
`skill-add-repo-suggestion-link-{url}` (opens the repo on GitHub in a
new tab) for the add-repo modal.

## /roles — role configuration

```
┌─[<RolesManager>]───────────────────────────────────────────────────┐
│ ┌─Built-in roles (read-only)─────────────────────────────────────┐ │
│ │ ⭐ General              "Helpful assistant w/ workspace access" │ │
│ │ 🎨 Artist                ...                                   │ │
│ │ 🎓 Tutor                 ...                                   │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌─Custom roles────────────────────────────────────────────────── ┐ │
│ │  + add role                                                    │ │
│ │  📖 my-role     ✏ edit   ✕                                     │ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## `<AccountingApp>` — opt-in plugin (no route)

Mounted via the tool-result envelope `{ kind: "accounting-app" }`
returned by `manageAccounting({action:"openBook", bookId})`. **No `/accounting`
route exists.** The default (General) role cannot reach this
surface; the built-in **Accounting** role and any custom role whose
`availablePlugins` includes `manageAccounting` can trigger the
mount.

```text
┌─[<AccountingApp>] data-testid="accounting-app"───────────────────────┐
│ ┌─Header───────────────────────────────────────────────────────────┐ │
│ │  account_balance Accounting          [<BookSwitcher>]            │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─Tabs [accounting-tabs]───────────────────────────────────────────┐ │
│ │ [accounting-tab-journal] [accounting-tab-newEntry]               │ │
│ │ [accounting-tab-opening] [accounting-tab-ledger]                 │ │
│ │ [accounting-tab-balanceSheet] [accounting-tab-profitLoss]        │ │
│ │ [accounting-tab-settings]                                        │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌─Body (one of)────────────────────────────────────────────────────┐ │
│ │  • [accounting-no-book]    ← empty workspace                     │ │
│ │  • <JournalList>           ← entries table; voided rows strike   │ │
│ │  • <JournalEntryForm>                                            │ │
│ │  • <OpeningBalancesForm>   ← save disabled until Σdr = Σcr       │ │
│ │  • <Ledger>                                                      │ │
│ │  • <BalanceSheet>                                                │ │
│ │  • <ProfitLoss>                                                  │ │
│ │  • <BookSettings>          ← rebuild snapshots / delete book     │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Key testids and what they target:

| testid | element | notes |
|---|---|---|
| `accounting-app` | root `<div>` of the View | mount probe |
| `accounting-no-book` | empty-state branch | shows when `activeBookId` is null |
| `accounting-tabs` | tab strip wrapper | |
| `accounting-tab-{key}` | one per tab (journal / newEntry / …) | click target |
| `accounting-book-select` | `<BookSwitcher>` `<select>` | book picker |
| `accounting-journal-table` | `<JournalList>` `<table>` | entries grid |
| `accounting-journal-row-{id}` / `accounting-journal-row-voided-{id}` | per-entry `<tr>` | voided rows use the `-voided-` variant **and** carry the strikeout class — bind to `voidedEntryIds` (server-side `voidedIdSet`), **not** to `kind === 'void'` |
| `accounting-void-{id}` | per-row void button | only on `kind === 'normal'` rows |
| `accounting-entry-line-account-{idx}` / `-debit-{idx}` / `-credit-{idx}` | per-line inputs in `<JournalEntryForm>` | one set per row |
| `accounting-entry-line-tax-registration-id-{idx}` | per-line counterparty tax-registration ID input | optional; covers JP T-number, EU VAT ID, GSTIN, ABN, … (max 32 chars; canonical home = `JournalLine.taxRegistrationId`) |
| `accounting-settings` | `<BookSettings>` root | settings tab body |
| `accounting-settings-rebuild` | rebuild snapshots button | |
| `accounting-settings-delete` | confirm-then-delete button | enabled once the typed name matches |

Persistence: data lives at `~/mulmoclaude/data/accounting/books/<bookId>/`.
Book ids are server-generated (`book-XXXXXXXX`); there is no magic
`default` id. Empty workspace ⇒ `config.json#activeBookId === null`
and the View renders `accounting-no-book`.

Async snapshot rebuild: writes call `scheduleRebuild(bookId, fromPeriod)`
after invalidating snapshot files. The View can subscribe to
`accountingBookChannel(bookId)` and observe `snapshots-rebuilding` /
`snapshots-ready` events; the lazy fallback in `getOrBuildSnapshot`
guarantees correctness even if a report is requested mid-rebuild.

## How to use this doc in chat

When asking Claude (or a teammate) to change the UI, name what you mean:

> ❌ "Make the bell smaller"
> ✅ "Reduce the badge size on `[notification-badge]` — it's overflowing the bell button on narrow screens"

> ❌ "The schedule page is broken"
> ✅ "On `/automations`, `[scheduler-task-<id>]` rows render at full opacity even when `task.enabled === false` — the `opacity-50` class isn't applying"

> ❌ "Add a button to the wiki page header"
> ✅ "Next to `[wiki-update-page-button]` in `<WikiView>` action='page', add a `[wiki-export-pdf-button]` that calls `usePdfDownload`"

If a name in this doc no longer matches the source (renamed testid, restructured layout), **update the doc in the same PR as the rename** — same discipline as updating tests when changing API.

## Out of scope

- **Pixel-accurate layout** — use Playwright screenshots or a Figma file.
- **Hover / focus / animation states** — describe in code comments next to the styles.
- **Mobile / narrow-screen breakpoints** — captured in `tailwind.config.ts` + the responsive class soup; not redrawn here.
- **Modal / popover stacking order** — surface in the relevant component's `<!-- -->` doc comment, not here.
- **Plugin-internal sub-views** that don't have their own route — TodoEditDialog, MindMap, Quiz, Form, etc. Add stubs as the cheat sheet matures.
