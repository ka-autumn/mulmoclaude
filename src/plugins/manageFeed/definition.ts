import type { ToolDefinition } from "gui-chat-protocol";
import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";

export const TOOL_NAME = META.toolName;
export type FeedsEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description:
    "Manage the user's data-source FEEDS — recurring retrievals of internet data (RSS/Atom news, podcasts, or any JSON API that returns an ARRAY of objects) that land in a self-refreshing collection. A feed is registered ONCE as data (stored under <workspace>/feeds/, NOT as a skill, so it does not bloat the prompt) and the host re-fetches it on a schedule. Records render in the standard collection view at /collections/<slug>. " +
    "After every action the response carries the current feed list so the canvas can re-render; call action='list' to display it.\n\n" +
    "REGISTER takes `slug` + a `schema` that is a CollectionSchema PLUS an `ingest` block. The schema shape is STRICT — follow it exactly:\n" +
    "- `primaryKey` (string, required): the name of the id field.\n" +
    "- `fields` (object, required): a MAP keyed by field name — NOT an array. Each value is `{ type, label, primary? }`. Exactly one field sets `primary: true` and its key must equal `primaryKey`.\n" +
    "- `type` MUST be one of: string, text, email, number, date, boolean, markdown, enum. (There is no 'url'/'datetime'/'textarea' — use string for links, date for timestamps, text/markdown for bodies.)\n" +
    "- `title` (string, required): human-facing name. `icon` and `dataPath` are OPTIONAL — omit them and the host defaults icon to a feed glyph and dataPath to `data/feeds/<slug>`.\n" +
    "- `ingest`: { kind, url, schedule, map, itemsAt?, idFrom? }. kind = 'rss'|'atom' (XML) or 'http-json' (JSON array). schedule = 'hourly'|'daily'|'weekly'|'on-demand'.\n" +
    "- `map`: { <yourFieldName>: <sourcePath> }, where sourcePath is a dot/bracket path into each fetched ITEM. The host hard-codes NO field list for any feed — first INSPECT the actual feed/response and map the fields it really carries, choosing whatever is useful. For rss/atom each item is the parsed XML element: tags are keys (e.g. 'title', 'link', 'pubDate'), attributes are keyed `@_name` (e.g. 'enclosure.@_url'), and namespaced tags keep their prefix (e.g. 'dc:creator', 'itunes:duration'); text-bearing tags resolve to their text automatically. For http-json each item is the JSON object (e.g. 'name', 'data.id'). A value mapped into a field you declared `type: 'date'` is auto-parsed to an ISO timestamp, so point date fields at the feed's date/timestamp path.\n" +
    "- `itemsAt` (http-json only): dot/bracket path to the items array, e.g. 'results[]' (omit when the response itself is the array).\n" +
    "- `idFrom` (optional): a sourcePath giving a stable unique id (e.g. an item guid/id/link) used for the record id when the mapped primaryKey is empty, so re-fetches upsert in place instead of duplicating.\n\n" +
    "Schema SHAPE example (the field names are ILLUSTRATIVE — inspect your feed and map ITS fields):\n" +
    '{ "title": "Example", "primaryKey": "id",\n' +
    '  "fields": { "id": {"type":"string","label":"ID","primary":true}, "headline": {"type":"string","label":"Headline"}, "url": {"type":"string","label":"URL"}, "published": {"type":"date","label":"Published"} },\n' +
    '  "ingest": { "kind":"rss", "url":"https://example.com/feed.xml", "schedule":"hourly", "idFrom":"guid", "map": {"id":"guid","headline":"title","url":"link","published":"pubDate"} } }\n\n' +
    "NOTE: http-json needs an array of objects. Columnar/parallel-array APIs (e.g. Open-Meteo weather: hourly.time[] + hourly.temperature_2m[]) are NOT supported yet — don't register those.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "register", "refresh", "remove"],
        description:
          "What to do. 'list' = show all feeds. 'register' = add/replace a feed (needs slug + schema). 'refresh' = fetch one feed now (needs slug). 'remove' = delete a feed by slug (its records are retained).",
      },
      slug: {
        type: "string",
        description:
          "Feed slug (lowercase letters/digits/hyphens). Required for register / refresh / remove. Becomes the feed directory name and the collection's URL slug.",
      },
      schema: {
        type: "object",
        description:
          "Required for action='register'. A CollectionSchema-with-`ingest` object. `fields` is a MAP keyed by field name (not an array); field types are limited to string/text/email/number/date/boolean/markdown/enum; `title` + `primaryKey` + `ingest` are required; `icon`/`dataPath` are optional (auto-defaulted). See the tool description for the full shape and a worked example. Validated server-side; a malformed schema is rejected with a message.",
      },
    },
    required: ["action"],
  },
};

export default toolDefinition;
