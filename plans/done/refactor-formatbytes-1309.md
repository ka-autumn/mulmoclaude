# formatBytes() (#1309)

## Problem

Two declared `formatBytes()` implementations exist with slightly different rounding rules; a third site (`ChatInput.vue`) does the same calculation inline. New file-size displays (photo-locations row hover, audio attachments, downloads) will keep re-implementing this if no shared helper exists.

## Scope

- `src/components/FileContentHeader.vue:47` — `formatBytes(bytes)` returns `"123 B"` / `"4.5 KB"` / `"7.2 MB"` (1024-based, 1 decimal).
- `packages/mock-server/src/server.ts:163` — own copy, different decimal rules per unit. **Left alone** per issue scope — mock-server is a standalone bridge package with its own lint scope.
- `src/components/ChatInput.vue:149` — inline `(file.size / 1024 / 1024).toFixed(1)` feeding the i18n key `chatInput.fileTooLarge` with `{sizeMB}`. The i18n string is `"File too large ({sizeMB} MB). Maximum is 30 MB."` across all 8 locales — migrating would force ` MB` suffix changes in every locale and the value would have to lose the unit. **Out of scope**: different display contract (always-MB upper-bound error) and i18n churn that's larger than the refactor itself.

## Approach

1. New file `src/utils/format/bytes.ts` with:
   ```ts
   export function formatBytes(bytes: number, opts?: { decimals?: number }): string;
   ```
   - 1024-based boundaries (KiB / MiB / GiB) — matches OS file-size convention.
   - Default 1 decimal; bytes always shown as integers.
   - Returns `"—"` for negative or non-finite input (defensive — file metadata can be null in edge cases).
2. New tests at `test/utils/format/test_bytes.ts` covering boundaries, options, and degenerate input.
3. `FileContentHeader.vue` — drop the local `formatBytes`, import from `../utils/format/bytes`. Template unchanged.
4. `docs/shared-utils.md` — promote `formatBytes` out of the "open items" callout into the Strings / Text section.

## Acceptance

- `formatBytes` exists in `src/utils/format/bytes.ts` with tests.
- `FileContentHeader.vue` uses the shared helper.
- `docs/shared-utils.md` lists the helper and no longer flags it as "open".
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
- No behavioural change in the rendered file-size text for `FileContentHeader` — the old implementation already used `1024` boundary + `.toFixed(1)`, so output is byte-identical for the same input.
