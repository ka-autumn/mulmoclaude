# Custom collection views (LLM-authored HTML)

A **custom view** is an HTML file you write that renders a collection's records
however the user wants — a year-at-a-glance planner, a Gantt bar, a heat-map,
a printable report. The host renders it in a sandboxed iframe over the
collection's data. The user asks for it in plain language ("give me a view that
shows my whole year"); you author the HTML and register it.

Read `config/helps/collection-skills.md` first for the collection/schema DSL.
This file is only about the **view** layer.

## Where the files go

```text
data/skills/<slug>/
  schema.json          ← register the view here, under `views[]`
  views/
    <name>.html        ← the view you author (Write/Edit)
```

**Feed collections** keep their skill files under `feeds/<slug>/` instead of
`data/skills/<slug>/`, so author a feed's view at `feeds/<slug>/views/<name>.html`
and register it in `feeds/<slug>/schema.json`. Everything else below — the
`views[]` entry shape, the runtime contract, the sandbox rules — is identical.

The HTML lives under `views/` and must end in `.html`. Register each view in
the collection's `schema.json`:

```jsonc
{
  "title": "Annual Plan",
  "icon": "calendar_month",
  "dataPath": "data/annual-plan/items",
  "primaryKey": "id",
  "fields": {
    /* … */
  },
  "views": [
    { "id": "year", "label": "Year", "icon": "grid_view", "file": "views/year.html", "capabilities": ["read"] },
    { "id": "planner", "label": "Planner", "icon": "edit_calendar", "file": "views/planner.html", "capabilities": ["read", "write"] },
  ],
}
```

- **`id`** — a slug (letters/digits/`-`/`_`). The selector shows one button per view.
- **`label`** — the button text (author it; it is not run through translation).
- **`icon`** — optional Material Symbols icon name.
- **`file`** — `views/<name>.html`, path-safe.
- **`capabilities`** — least privilege. `["read"]` (default) for a view that
  only displays data; `["read","write"]` only if the view edits records.

After you Write the HTML and register it, the view's button appears in the
collection's view-mode selector automatically.

## The runtime contract — `window.__MC_VIEW`

The host injects a bootstrap into your page **before any of your scripts run**:

```js
window.__MC_VIEW = {
  slug: "annual-plan", // this collection
  token: "<scoped capability token>", // Authorization bearer
  dataUrl: "http://localhost:3001/api/collections/annual-plan/view-data",
  onChange: (cb) => unsubscribe, // live refresh — see "Staying live" below
  openItem: (id, mode) => void, // open a record in the host's panel — see "Opening a record"
};
```

### Reading records

```js
const { token, dataUrl } = window.__MC_VIEW;
const res = await fetch(dataUrl, { headers: { Authorization: "Bearer " + token } });
if (!res.ok) throw new Error("load failed: " + res.status);
const { items } = await res.json(); // { collection, count, items: [...] }
```

Records come back **with computed fields already resolved** (derived formulas,
toggles, embeds) — the same numbers the user sees elsewhere.

- Narrow large reads: `dataUrl + "?fields=title,start,end"` or `?ids=a,b,c`
  (comma-separated). A read of **more than 200 records** without `ids`/`fields`
  is refused — always project `fields` for big collections.

### Writing records (only with the `write` capability)

```js
const res = await fetch(dataUrl, {
  method: "PUT",
  headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  body: JSON.stringify({ items: [{ id: "task-3", start: "2026-07-01" }], mode: "merge" }),
});
const { written, rejected } = await res.json(); // fix & re-send any rejected rows
```

- `mode`: `"merge"` (update only the fields you send — use this for edits),
  `"upsert"` (replace the whole record), `"create"` (fail if the id exists).
- Each row must carry the collection's `primaryKey`.
- **Never** send computed fields (`derived` / `toggle` / `embed`) — they are
  rejected. Write the underlying enum for a toggle.
- **There is no delete** from a view. A view can never do more than the agent's
  own data tools.

Surface any `rejected` rows to the user with their `problem` text — don't fail
silently.

### Staying live — `onChange`

By default a view paints once, on load. To keep it fresh, register a callback —
it runs whenever the collection's data changes on the server:

```js
async function render() {
  const res = await fetch(dataUrl, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return; // handle the error per your UI
  const { items } = await res.json();
  // …draw items…
}
render(); // initial paint
window.__MC_VIEW.onChange(render); // live refresh on every server-side change
```

What you need to know:

- **It fires for every writer** — the assistant adding/editing a record in chat,
  an edit from another browser tab, a feed refresh, and auto-generated recurring
  records. Your view stays in sync no matter who changed the data.
- **Make the callback a full re-fetch + re-render** (like `render` above). It is
  a "something changed, reload" signal — it carries no record data — and one
  callback may stand in for several rapid changes.
- **It is already debounced** (a burst of changes collapses to one call) — do
  **not** add your own throttle.
- **No extra capability needed** — a read-only view can use `onChange`.
- It returns an **unsubscribe** function; you rarely need it (the view is torn
  down with the iframe), but it's there for fine-grained control.

### Opening a record — `openItem`

Your view owns the *layout* (a grid, a chart, a board); it doesn't have to
rebuild a form to view or edit one record. Call `openItem` to hand a record to
the host's own panel — the same detail/edit modal the user gets clicking a row
in the table view — centred over your view:

```js
window.__MC_VIEW.openItem("task-3"); // read-only detail (default)
window.__MC_VIEW.openItem("task-3", "edit"); // jump straight into the editor
```

- **`id`** — the record's `primaryKey` value. If it isn't a loaded record,
  nothing happens (fire-and-forget; returns nothing).
- **`mode`** — `"view"` (default) opens read-only detail with the panel's own
  Edit button; `"edit"` opens the editor directly.
- **No `write` capability required — even for `"edit"`.** Opening the host's
  panel is a *user* action in the host's trusted UI: the user still has to press
  Save, and the write goes through the host, not your scoped token. So a
  `["read"]` view can offer a full "edit this record" affordance without
  widening its own capabilities. (Capabilities gate what your view's *code* may
  do to the data; they don't restrict what the user may do through the host.)
- **Pair it with `onChange`.** After the user saves in the panel, your
  `onChange` callback fires (the data changed), so a live view repaints itself —
  no extra wiring needed.

This is the right tool whenever a record's full detail is richer than your
view's summary, or whenever the user wants to edit but you don't want a
`write`-capable view doing its own PUTs.

## Sandbox rules (what the view may and may not do)

The view runs in a `sandbox="allow-scripts"` iframe with a strict CSP:

- **Inline `<script>` and `<style>` only.** External scripts/styles/fonts must
  come from the allowed CDNs: `cdn.jsdelivr.net`, `unpkg.com`,
  `cdnjs.cloudflare.com`, `fonts.googleapis.com`, `fonts.gstatic.com`,
  `cdn.plot.ly` — so charting libraries (Chart.js, Plotly, D3) load fine from
  those CDNs. No other external hosts.
- **`<img>` may load from any `https:` host** (plus `data:` / `blob:`), so an
  image URL stored in a record — a feed's article thumbnail, a poster, an
  avatar — renders directly. (Images are the one resource type not pinned to the
  CDN allowlist; everything else above still is.)
- **`<audio>` / `<video>` may load from any `https:` host** (plus the origin and
  `data:` / `blob:`), so a record's media URL — a podcast feed's `.mp3`, a
  video enclosure — plays directly.
- **`fetch` (and XHR / WebSocket / `sendBeacon`) is allowed ONLY to
  `window.__MC_VIEW.dataUrl`'s origin.** All other origins are blocked — no
  phone-home, no third-party analytics, no fetching weather / prices / etc.
  directly from the view. If the user needs external data, put it in a (feed)
  collection and read it through `dataUrl`. (This is the channel that actually
  matters for keeping the scoped token and records from leaking off-box.)
- No access to cookies, `localStorage`, or the parent page — the iframe has an
  opaque origin. The token is the only credential, and it is scoped to this one
  collection.
- **Opening external links is allowed** — use `<a href="…" target="_blank"
  rel="noopener">` (or `window.open(url, "_blank")`) to open a record's URL in a
  new browser tab, e.g. a feed card linking to its article. The link opens as a
  normal tab. (A plain same-tab `<a href>` would try to navigate the sandboxed
  frame itself and is blocked, so always use `target="_blank"` for outbound
  links.)
- Build a full HTML document with a `<head>` (the host injects its bootstrap at
  the start of `<head>`).

## Editing / iterating

To change a view later, just Read and Edit its `views/<name>.html` file under the
collection's skill dir (`data/skills/<slug>/` — or `feeds/<slug>/` for a feed);
its path is in the schema's `views[]`. To remove one, delete the file and its
`views[]` entry — or use the collection's settings gear (the per-collection
config modal) in the UI, which does both for you.

---

## Example 1 — Year overview (read-only)

A 12-month grid that plots each record on its start month. Schema has `date`
fields `start` / `end` and a `title`. `capabilities: ["read"]`.

`data/skills/annual-plan/views/year.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 0;
        padding: 16px;
        color: #1e293b;
      }
      h1 {
        font-size: 16px;
        margin: 0 0 12px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .month {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 8px;
        min-height: 90px;
      }
      .month h2 {
        font-size: 12px;
        color: #64748b;
        margin: 0 0 6px;
      }
      .chip {
        font-size: 12px;
        background: #eef2ff;
        color: #3730a3;
        border-radius: 4px;
        padding: 2px 6px;
        margin-bottom: 4px;
        cursor: pointer;
      }
      .err {
        color: #b91c1c;
      }
    </style>
  </head>
  <body>
    <h1>Year overview</h1>
    <div id="root">Loading…</div>
    <script>
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      async function main() {
        const { token, dataUrl } = window.__MC_VIEW;
        const res = await fetch(dataUrl, { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const { items } = await res.json();
        const buckets = MONTHS.map(() => []);
        for (const it of items) {
          const m = it.start ? new Date(it.start).getMonth() : -1;
          if (m >= 0 && m < 12) buckets[m].push(it); // keep the item, not just its title — we need the id
        }
        const root = document.getElementById("root");
        root.className = "grid";
        root.innerHTML = MONTHS.map(
          (name, i) =>
            '<div class="month"><h2>' +
            name +
            "</h2>" +
            buckets[i].map((it) => '<div class="chip" data-id="' + it.id + '">' + (it.title || it.id) + "</div>").join("") +
            "</div>",
        ).join("");
        // Click a chip → open that record in the host's panel (read-only detail;
        // the panel's own Edit button takes it from there). Pass "edit" to jump
        // straight into the editor — no `write` capability needed.
        root.onclick = (e) => {
          const chip = e.target.closest(".chip");
          if (chip) window.__MC_VIEW.openItem(chip.dataset.id);
        };
      }
      main().catch((e) => {
        document.getElementById("root").innerHTML = '<span class="err">Could not load: ' + e.message + "</span>";
      });
      // Live refresh: re-run whenever the collection's data changes server-side.
      window.__MC_VIEW.onChange(() => main().catch(() => {}));
    </script>
  </body>
</html>
```

## Example 2 — Weekly planner (read + write)

Seven day columns; clicking a record bumps its `start` date forward a day and
writes it back. `capabilities: ["read","write"]`.

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        font-family: system-ui, sans-serif;
        margin: 0;
        padding: 16px;
      }
      .row {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 6px;
      }
      .day {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 6px;
        min-height: 80px;
      }
      .task {
        font-size: 12px;
        background: #f1f5f9;
        border-radius: 4px;
        padding: 3px 6px;
        margin-bottom: 4px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div id="root">Loading…</div>
    <script>
      const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const { token, dataUrl } = window.__MC_VIEW;
      const auth = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

      async function read() {
        const res = await fetch(dataUrl, { headers: { Authorization: "Bearer " + token } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        return (await res.json()).items;
      }
      async function bump(item) {
        const next = new Date(item.start || Date.now());
        next.setDate(next.getDate() + 1);
        const res = await fetch(dataUrl, {
          method: "PUT",
          headers: auth,
          body: JSON.stringify({ items: [{ id: item.id, start: next.toISOString().slice(0, 10) }], mode: "merge" }),
        });
        const { rejected } = await res.json();
        if (rejected && rejected.length) alert(rejected[0].problem);
        render();
      }
      async function render() {
        const items = await read();
        const cols = DAYS.map(() => []);
        for (const it of items) {
          const d = it.start ? (new Date(it.start).getDay() + 6) % 7 : 0;
          cols[d].push(it);
        }
        const root = document.getElementById("root");
        root.className = "row";
        root.innerHTML = DAYS.map((d, i) => '<div class="day" data-i="' + i + '"><b>' + d + "</b></div>").join("");
        DAYS.forEach((_, i) => {
          const cell = root.querySelector('[data-i="' + i + '"]');
          for (const it of cols[i]) {
            const el = document.createElement("div");
            el.className = "task";
            el.textContent = it.title || it.id;
            el.onclick = () => bump(it);
            cell.appendChild(el);
          }
        });
      }
      render().catch((e) => {
        document.getElementById("root").textContent = "Could not load: " + e.message;
      });
      // Live refresh: re-render on any server-side change (incl. our own writes
      // landing, and edits from the assistant or another tab).
      window.__MC_VIEW.onChange(() => render().catch(() => {}));
    </script>
  </body>
</html>
```
