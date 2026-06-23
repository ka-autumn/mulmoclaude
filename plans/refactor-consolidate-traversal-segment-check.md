# refactor: consolidate hasTraversalSegment() into safe.ts

Tracks: #1759 (a direct follow-up to #1756 / catalog hygiene #1304).

## Duplication

`hasTraversalSegment(value)` is defined in two stores with identical bodies:

- `server/utils/files/attachment-store.ts:190`
- `server/utils/files/image-store.ts:38`

```ts
function hasTraversalSegment(value: string): boolean {
  return value.split(/[/\\]/).some((segment) => segment === ".." || segment === ".");
}
```

## Fix

Move to `server/utils/files/safe.ts` next to `containsDotfileSegment`. Export. Stores import.

## Why both functions live side-by-side

- `containsDotfileSegment` — rejects ANY `.`-prefixed segment (`.git`, `.hidden`, plus `.`/`..`). Used by HTML `dotfiles: deny`.
- `hasTraversalSegment` — rejects only `.` and `..` literal segments. Used by `is{Attachment,Image}Path` where dotfiles are fine but traversal must be blocked.

Document the distinction in the docstring + catalog entry.

## Tests

- New `test/utils/files/test_safe_traversal.ts` — happy path, `..` / `.` segments at any depth, mixed `/` and `\` separators, doesn't reject `.git` (distinguishing it from `containsDotfileSegment`).

## Catalog update

`docs/shared-utils.md` — Files / Paths section, add entry for `hasTraversalSegment` with the policy distinction note.

## Out of scope

The 6-store `is*Path()` factory consolidation (different normalization strategies) lands in a separate PR.
