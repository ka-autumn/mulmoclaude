# Portfolio tracker — the stock-quotes + portfolio recipe

Read this when the user asks to **set up a stock portfolio tracker / track their
investments / "value my holdings"** (sample query: *"Set up a stock portfolio
tracker"*). It scaffolds **two** collection skills that work as a pair:

- **`stock-quotes`** — a watchlist of public-equity quotes (price, P/E, yield).
  Prices come from Yahoo Finance (15-minute delayed); the agent fetches them.
- **`portfolio`** — the user's holdings (ticker + share count). Each holding's
  **price and value are computed live** from the matching `stock-quotes` row via
  a cross-collection `ref` + `derived` formula, so one quote refresh updates every
  holding that references it.

This is the canonical **`<refField>.<col>` cross-collection lookup** pattern (see
`config/helps/collection-skills.md`): `portfolio.value = shares * ticker.price`
reads `price` off the `stock-quotes` record the holding's `ticker` points at —
the price lives **only** in `stock-quotes`; the portfolio never stores a copy.

Read `config/helps/collection-skills.md` first for the general schema DSL. Author
everything under `data/skills/<slug>/` (the bridge mirrors it to
`.claude/skills/<slug>/`; the user opens it at `/collections/<slug>`). **Do not
use the `mc-` prefix.**

> **Follow this recipe verbatim — do NOT redesign.** The schemas below are fixed
> and known-good. Write them exactly as given (you may only adjust `title`/`icon`
> if the user explicitly asks). Do **not** add fields, do **not** call
> `presentForm` to ask design questions, and do **not** mimic other collections
> in the workspace. The whole point is a reproducible, working pair. (For a
> *custom* collection, use `config/helps/collection-skills.md` instead.) If the
> user already has `data/stock-quotes/items` / `data/portfolio/items` records,
> they match these schemas and will render as-is — no data edits needed.

## Slug contract (do not change these)

`portfolio.ticker` references `stock-quotes` by this exact slug, and
`portfolio.value` dereferences its `price` column. Author with **exactly** these
slugs so the cross-collection lookup resolves:

| Collection | slug | `dataPath` | referenced by |
|---|---|---|---|
| Stock Quotes | `stock-quotes` | `data/stock-quotes/items` | `portfolio.ticker` (ref), `portfolio.{price,value}` (derived) |
| Portfolio | `portfolio` | `data/portfolio/items` | — |

## Order: `stock-quotes` before `portfolio`

`portfolio.ticker` is a `ref` to `stock-quotes` and `portfolio.price`/`value`
dereference its `price` column, so create `stock-quotes` first (and add the rows
for the tickers the user holds). A holding whose `ticker` has no `stock-quotes`
row renders `price`/`value` as `—` (fail-soft) until the quote exists.

---

## 1. `stock-quotes`

`data/skills/stock-quotes/schema.json`:

```json
{
  "title": "Stock Quotes",
  "icon": "trending_up",
  "dataPath": "data/stock-quotes/items",
  "primaryKey": "id",
  "fields": {
    "id":            { "type": "string",   "label": "ID", "primary": true, "required": true },
    "ticker":        { "type": "string",   "label": "Ticker", "required": true },
    "companyName":   { "type": "string",   "label": "Company", "required": true },
    "price":         { "type": "number",   "label": "Latest Price" },
    "currency":      { "type": "string",   "label": "Currency" },
    "peRatio":       { "type": "number",   "label": "P/E Ratio" },
    "dividendYield": { "type": "number",   "label": "Dividend Yield (%)" },
    "asOf":          { "type": "string",   "label": "As Of" },
    "notes":         { "type": "markdown", "label": "Notes" }
  }
}
```

`data/skills/stock-quotes/SKILL.md`:

```markdown
---
name: stock-quotes
description: A simple stock-quote watchlist. Use whenever the user asks to add, list, update, or remove a stock quote, or to look up the latest price / PE ratio / dividend yield for a ticker. Records live at `data/stock-quotes/items/<ticker>.json` (one JSON per ticker, lowercase id); the user views them at `/collections/stock-quotes`, rendered from `schema.json` by the host. Record I/O via the `manageCollection` tool (getItems / putItems; raw Read / Write / Edit on the JSON files is the escape hatch). Price data comes from Yahoo Finance (15-minute delayed).
---

# Stock Quotes (schema-driven collection)

A lightweight watchlist of public-equity quotes.

## Record shape

- `id` — string, **primary key**, lowercase ticker symbol (e.g. `aapl`, `msft`). Filename without extension.
- `ticker` — ticker symbol in upstream casing (e.g. `AAPL`) — **required**
- `companyName` — company long name (e.g. `Apple Inc.`) — **required**
- `price` — latest stock price (number, in the listed currency)
- `currency` — ISO currency code of the price (e.g. `USD`)
- `peRatio` — trailing P/E ratio (number). Omit if the company has no/negative earnings.
- `dividendYield` — trailing dividend yield as a percent (number, e.g. `0.42` means 0.42%). Omit if no dividend.
- `asOf` — ISO-8601 timestamp of when the quote was fetched
- `notes` — markdown notes (optional)

Omit fields the user didn't supply or that Yahoo Finance didn't return — don't write empty strings.

## What to do

**Add / refresh**: Fetch from Yahoo Finance (`https://query1.finance.yahoo.com/v7/finance/quote?symbols=<SYM>` or `quoteSummary` with `summaryDetail,price,defaultKeyStatistics`). Build the records and store them in one call — `manageCollection` `putItems` with `slug: "stock-quotes"` validates each row against the schema before writing; fix any `rejected` row using its `problem` text and retry just those. Upserting an existing id is the intended way to refresh a quote.

**List**: `manageCollection` `getItems` with `slug: "stock-quotes"` (use `fields` to keep it small). Don't dump every record into chat — link to `/collections/stock-quotes`.

**Update**: `putItems` with `mode: "merge"` and a partial row (`{ id, <changed fields> }`) — it keeps every field the row omits. Always update `asOf`.

**Delete**: Confirm once if ambiguous, then remove the file (`data/stock-quotes/items/<id>.json`).

## Linking from chat

When referring to a specific ticker, link to the collection view, not the raw JSON:

- ✅ `[AAPL](/collections/stock-quotes?selected=aapl)`
- ❌ `[AAPL](data/stock-quotes/items/aapl.json)`

`?selected=<id>` opens the detail view directly.

## Citation discipline

Always tell the user when the price was fetched and that it's typically 15-minute delayed. Don't paraphrase fundamentals (PE, yield) without anchoring to the data source.
```

---

## 2. `portfolio`

`data/skills/portfolio/schema.json` (`ticker` is a `ref` **to `stock-quotes`**;
`price` / `value` are `derived` cross-collection lookups):

```json
{
  "title": "My Portfolio",
  "icon": "account_balance_wallet",
  "dataPath": "data/portfolio/items",
  "primaryKey": "id",
  "fields": {
    "id":     { "type": "string",  "label": "ID", "primary": true, "required": true },
    "ticker": { "type": "ref",     "to": "stock-quotes", "label": "Stock", "required": true },
    "shares": { "type": "number",  "label": "Shares", "required": true },
    "price":  { "type": "derived", "label": "Latest Price", "formula": "ticker.price", "display": "money", "currency": "USD" },
    "value":  { "type": "derived", "label": "Value", "formula": "shares * ticker.price", "display": "money", "currency": "USD" },
    "notes":  { "type": "markdown", "label": "Notes" }
  }
}
```

`data/skills/portfolio/SKILL.md`:

```markdown
---
name: portfolio
description: A personal stock portfolio. Use whenever the user asks to add, list, edit, or remove a holding, or to see the value of their portfolio. Each record is one holding (ticker + share count); the latest price is pulled live from the `stock-quotes` collection via a derived ref, so the holding's value updates whenever the quote is refreshed. Records live at `data/portfolio/items/<id>.json`; the user views them at `/collections/portfolio`, rendered from `schema.json` by the host. Record I/O via the `manageCollection` tool — its getItems is the ONLY way to read the computed `price` / `value` columns (the stored JSON never contains them).
---

# My Portfolio (schema-driven collection)

A lightweight book of equity holdings. Each row records *how many shares* of a ticker the user owns; the *price* and *value* columns are computed on the fly from the matching `stock-quotes` record, so a single quote refresh updates every holding that references it.

## Record shape

- `id` — string, **primary key**, lowercase ticker symbol (e.g. `aapl`, `tsla`). Filename without extension.
- `ticker` — **ref → stock-quotes**, stores the lowercase target slug (e.g. `aapl`). The matching row MUST already exist in `stock-quotes`, otherwise `price` and `value` render as `—`.
- `shares` — number, share count (required).
- `price` — **derived**, `ticker.price`. Host-computed; **do NOT write this field**.
- `value` — **derived**, `shares * ticker.price`. Host-computed; **do NOT write this field**.
- `notes` — markdown notes (optional).

Omit fields the user didn't supply — don't write empty strings. Never write `price` or `value` into the JSON; the host recomputes them on every render and the form refuses to persist them.

## What to do

**Add a holding**: confirm the ticker has a row in `/collections/stock-quotes`; if not, add it first via the `stock-quotes` skill (so `ticker.price` resolves). Then `manageCollection` `putItems` with `slug: "portfolio"` and a row carrying `id`, `ticker`, `shares` (and optional `notes`) — never `price` / `value`; putItems rejects computed keys.

**List / value the portfolio**: `manageCollection` `getItems` with `slug: "portfolio"` — the returned records INCLUDE the host-computed `price` and `value`, so total the `value` column from there (reading the raw JSON files would show neither). Don't dump every record into chat — link to `/collections/portfolio`.

**Update shares**: `putItems` with `mode: "merge"` and `{ "id": "<id>", "shares": <n> }` — merge keeps the fields the row omits.

**Refresh prices**: don't touch the portfolio records — go refresh the matching row in `stock-quotes` instead. The portfolio's `price` and `value` columns update on the next render.

**Delete**: Confirm once if ambiguous, then remove the file (`data/portfolio/items/<id>.json`).

## Linking from chat

When referring to a specific holding, link to the collection view, not the raw JSON:

- ✅ `[AAPL holding](/collections/portfolio?selected=aapl)`
- ❌ `[AAPL holding](data/portfolio/items/aapl.json)`

`?selected=<id>` opens the detail view directly.
```

---

## How prices stay current

Prices are **not** auto-fetched. The agent populates / refreshes `stock-quotes`
by fetching Yahoo Finance (see the `stock-quotes` SKILL above) — e.g. when adding
a holding or when the user asks to refresh. `portfolio.price` / `value` are pure
projections of `stock-quotes.price`, recomputed on every render, so refreshing a
quote updates every holding that references it with zero edits to the portfolio.

## Done

Tell the user both collections are ready at `/collections/stock-quotes` and
`/collections/portfolio`. The bridge mirrors the files and re-scans, so they
appear without a restart. Offer to fetch quotes for the tickers they hold so the
`price` / `value` columns populate immediately.
