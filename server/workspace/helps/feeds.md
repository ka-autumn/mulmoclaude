# Feeds — pull internet data into a self-refreshing collection

A **feed** is a data source you register once; the host then fetches it on a
schedule and stores each item as a record. A feed is a `CollectionSchema` plus
an `ingest` block, written as a single file:

```
feeds/<slug>/schema.json     ← YOU write this (Write)
feeds/<slug>/_state.json     ← the host writes this (fetch cursor/state)
data/feeds/<slug>/<id>.json  ← the host writes these (one per item)
```

It is NOT a skill (no `SKILL.md`, nothing under `.claude/skills/`), so it never
enters the prompt. You don't call any tool to fetch — the host's retrieval
engine does that automatically: the first time the feed's view is opened, on an
hourly schedule thereafter, and when the user clicks **Refresh feed**. Records
render in the standard collection view at `/feeds/<slug>`.

This is the project philosophy: *the workspace is the database; you are the
intelligent interface.* Adding a feed = **fetch the URL, look at its real
fields, and write one `schema.json`.**

## Workflow to add a feed

1. **Fetch and inspect the URL yourself** (a web/fetch tool, or `curl`). Look at
   the actual structure — the item tags/fields it carries. Do NOT guess or ask
   the user design questions; infer everything from the data.
2. **Write `feeds/<slug>/schema.json`** (see the shape below). Pick a short
   `slug` (lowercase letters/digits/hyphens).
3. Tell the user the feed is registered and that opening `/feeds/<slug>` will
   load its items (the host fetches automatically on first open). Do NOT tell
   them to click Refresh — that's not needed for a new feed.

To **remove** a feed completely, delete BOTH its `feeds/<slug>/` directory
(schema + state) and its records under `data/feeds/<slug>/`. The `/feeds` page
lists all registered feeds, and its delete button does the same.

## Schema shape (STRICT — follow exactly)

```json
{
  "title": "Example Feed",
  "icon": "dynamic_feed",
  "dataPath": "data/feeds/<slug>",
  "primaryKey": "id",
  "displayField": "headline",
  "fields": {
    "id":        { "type": "string",   "label": "ID", "primary": true },
    "headline":  { "type": "string",   "label": "Headline" },
    "url":       { "type": "string",   "label": "URL" },
    "published": { "type": "date",     "label": "Published" },
    "summary":   { "type": "markdown", "label": "Summary" }
  },
  "ingest": {
    "kind": "rss",
    "url": "https://example.com/feed.xml",
    "schedule": "hourly",
    "idFrom": "guid",
    "map": { "id": "guid", "headline": "title", "url": "link", "published": "pubDate", "summary": "description" }
  }
}
```

- `title` (required), `icon` (required — a Material Symbols name; `dynamic_feed` is
  a good default). `dataPath` is set by the host to `data/feeds/<slug>` — include
  it (must equal that) or omit it; any other value is ignored. A feed can only
  ever store records under its own `data/feeds/<slug>` folder.
- `primaryKey` (required): names the id field. That field must set
  `primary: true`. The host derives a safe, stable filename from its value, so
  map it from a STABLE unique value (an item guid/id/link, or a snapshot date)
  — that's what makes re-fetches upsert in place instead of duplicating.
- `displayField` (recommended): the field whose value labels each record in the
  calendar and notifications. Set it to the human-readable field (e.g. the
  headline) — otherwise labels fall back to the opaque primaryKey id.
- `fields` is an OBJECT keyed by field name (NOT an array). Each value is
  `{ type, label, primary? }`. `type` MUST be one of: `string`, `text`, `email`,
  `number`, `date`, `boolean`, `markdown`, `enum` (enum also needs `values`).
  There is no `url`/`datetime`/`textarea` — use `string` for links, `date` for
  timestamps, `text`/`markdown` for bodies.
- Include a `date` field and map the feed's timestamp into it — values in a
  `date` field are auto-coerced to `YYYY-MM-DD`, which powers the calendar view
  and the `maxItems` cap.

## The `ingest` block

- `kind`: `rss` / `atom` (XML feeds) or `http-json` (a JSON API).
- `url`: the feed / API endpoint (must be public http/https; the host refuses
  private/loopback addresses).
- `schedule`: `hourly` | `daily` | `weekly` | `on-demand`.
- `map`: `{ <yourFieldName>: <sourcePath> }` — a dot/bracket path into each
  fetched item. **Map the fields you actually saw when you inspected the feed.**
  - rss/atom: each item is the parsed XML element. Tags are keys (`title`,
    `link`, `pubDate`); attributes are keyed `@_name` (`enclosure.@_url`);
    namespaced tags keep their prefix (`dc:creator`, `itunes:duration`);
    text-bearing tags resolve to their text automatically.
  - http-json: each item is the JSON object (`name`, `data.id`).
- `itemsAt` (http-json only): dot/bracket path to the items array, e.g.
  `results[]`. **Omit it when the response body is itself the array.**
- `idFrom` (optional): a sourcePath for a stable id, used when the mapped
  primaryKey value is empty (e.g. `guid`).
- `maxItems` (optional, default `100`): keep only the newest N records by the
  date field and delete the rest (`0` keeps everything; needs a `date` field).

## Notes

- http-json needs an array of objects. Columnar/parallel-array APIs (e.g.
  Open-Meteo weather: `hourly.time[]` + `hourly.temperature_2m[]`) are not
  supported yet.
- A malformed `schema.json` is skipped at load time (with a diagnostic on the
  notification bell), so double-check the shape above before writing.
- A feed can carry **custom views** just like any collection — author the HTML at
  `feeds/<slug>/views/<name>.html` and register it in the feed's `schema.json`
  under `views[]`. See `config/helps/custom-view.md` (note the feed path is
  `feeds/<slug>/`, not `data/skills/<slug>/`).
