# feat: `image` field type for collections

## Goal

Let a collection store a workspace-relative image path in a field and render
it as an actual `<img>` in the list table and the detail (open) view. The
motivating flow: the user attaches a photo of a business card to chat, Claude
reads the details off it (vision) and creates a `contacts` entry whose
`cardImage` field holds the attachment path.

## What already works (no change needed)

Two of the three things this feature seemed to need are already in place:

1. **The LLM already sees the attachment path.** When a file is attached, the
   server prepends `[Attached file: <path>]` to the user message
   (`server/api/routes/agent.ts:257` → `withAttachedFileMarker`). So Claude
   can copy `data/attachments/YYYY/MM/<id>.jpg` straight into a field — it is
   not limited to the base64 vision block.
2. **Serving the image to an `<img>` is already auth-safe.** `/api/files/raw`
   is bearer-exempt precisely so `<img src>` works without a token
   (`server/api/auth/bearerAuth.ts:15`, `server/index.ts:238`). The
   `resolveImageSrc()` helper (`src/utils/image/resolve.ts`) already turns a
   workspace-relative path into the right URL.

So the design we discussed — store the **original attachment path**, no copy,
no delete-time cleanup (attachments already persist forever in
`data/attachments/`) — needs only one new capability: a field type that
renders a stored path as an image.

## The one change: an `image` field type

`image` behaves like a `string` for storage and editing (it holds a
workspace-relative path), and gets special render treatment: an `<img>` via
`resolveImageSrc()`.

### Server

- `server/workspace/collections/types.ts` — add `"image"` to
  `CollectionFieldType`.
- `server/workspace/collections/discovery.ts` — add `"image"` to the
  **top-level** field-type zod enum (line ~106). Not added to the table
  sub-field enum — images inside table rows are out of scope.

### Frontend (`src/components/CollectionView.vue`)

- Add `"image"` to the local `FieldType` union.
- `import { resolveImageSrc } from "../utils/image/resolve"`.
- **Detail view**: render `<img :src="resolveImageSrc(String(viewing[key]))">`
  when `field.type === 'image'` and the value is a non-empty string; empty
  falls through to the `—` fallback. Add `image` to the `col-span-full` list
  so the card spans the row.
- **List table**: `image` fields are excluded from the columns (via
  `listColumnFields`, alongside `embed`). A per-row image fetch is too
  expensive for a collection with many records, and the image is shown in the
  detail view anyway.
- **Edit form**: add `image` to the scalar-`<input>` list so the path is an
  editable single-line text field (`inputTypeFor` already returns `text`,
  `scalarDraftToValue` already returns the raw string).

### LLM-facing docs

- `server/workspace/helps/collection-skills.md` — add `image` to the field
  types list + a bullet: stores a workspace-relative path (e.g. a
  `data/attachments/...` upload), rendered as an `<img>` in the table and
  detail view. This is what tells Claude the type exists when it authors a
  collection.

### Personal role sample query

- `src/config/roles.ts` — add one English sample query to the Personal role
  prompting creation of a contacts collection with a business-card image
  field and the attach-and-extract flow. (English only per request; the
  `queries` array is not part of the i18n locale schema.)

## Out of scope / deferred

- No image inside table rows.
- No copy of the attachment into the collection dir, no delete-time cleanup
  (decided: store the original path; attachments persist anyway).
- No upload widget in the collection edit form — the field is a path string;
  population happens via chat (Claude) or manual path entry.

## Verification

- `yarn format && yarn lint && yarn typecheck && yarn build`, `yarn test`.
- Manual: define a collection with an `image` field, point it at an existing
  `data/attachments/...` file, confirm it renders in both list and detail.
