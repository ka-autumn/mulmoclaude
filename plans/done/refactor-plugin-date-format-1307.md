# Plugin View Date Formatting Migration (#1307)

## Problem

Several plugin Views call `toLocaleString()` / `toLocaleDateString()` directly instead of using the existing helpers in `src/utils/format/date.ts`. New display tweaks (e.g. moving to a locale preference rather than browser default) ripple through every Vue file instead of one helper.

## Scope after audit

The original issue listed 5 sites. After verifying each:

- **`accounting/Preview.vue:38`** — actually a **number** formatter (`{ minimumFractionDigits: 2, maximumFractionDigits: 2 }`), not a date. Out of scope here; addressed in #1308 (currency).
- **`scheduler/View.vue:391`** — `toLocaleDateString(undefined, { month: "short", day: "numeric" })`. Exactly matches the existing `formatShortDate`.
- **`scheduler/View.vue:394`** — `toLocaleDateString(undefined, { month: "long", year: "numeric" })`. No existing helper — add `formatMonthYear`.
- **`wiki/View.vue:729`** — `Intl.DateTimeFormat("sv-SE", { ... })`. **Locale-pinned intentionally** for ISO-style snapshot timestamps (the existing comment explains `hour12: false` defense). Not a generic display call; leave alone.
- **`photoLocations/View.vue:87`** — `new Date(iso).toLocaleString()`. Used in a tight row layout; the full locale string ("5/12/2026, 7:30:00 PM") overflows. Migrate to `formatDate(iso)` ("Apr 11 06:32") — both consistency win and a UX improvement.
- **`packages/plugins/spotify-plugin/src/View.vue:314`** — standalone package, out of scope.

## Approach

1. Add `formatMonthYear(value: Date | number | string)` to `src/utils/format/date.ts`. Generic enough for any month-picker / page header that wants "April 2026" style.
2. `scheduler/View.vue` — import `formatShortDate` + `formatMonthYear`, replace both inline calls. Inline `fmt` closure dropped.
3. `photoLocations/View.vue` — import `formatDate`, replace `new Date(iso).toLocaleString()`. Behavioural change: row date now renders as "Apr 11 06:32" instead of the locale-long string. Worth flagging in the PR.
4. `wiki/View.vue` — leave alone, comment already justifies the locale pin.
5. Tests: add `formatMonthYear` cases to `test/utils/format/test_date.ts`.
6. Catalog: `formatMonthYear` joins the existing date helper list.

## Out of scope

- `wiki/View.vue` Swedish-locale `Intl.DateTimeFormat`. Intentional, has a comment, not user-facing in a way that benefits from locale-aware formatting.
- `accounting/Preview.vue` — number formatting, addressed in #1308.
- `spotify-plugin` — standalone package.

## Acceptance

- `formatMonthYear` exported from `src/utils/format/date.ts` with tests.
- `scheduler/View.vue` uses helpers, no inline `toLocaleDateString`.
- `photoLocations/View.vue` uses `formatDate`, no inline `toLocaleString`.
- `wiki/View.vue` unchanged.
- Catalog updated.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
