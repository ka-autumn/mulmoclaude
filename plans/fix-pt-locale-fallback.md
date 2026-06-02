# fix: Map pt / pt-PT browser locales to pt-BR (#1590)

## Problem

Browsers reporting `pt` or `pt-PT` fall through to English because
`primarySubtagIfSupported` only checks exact locale match and bare
primary subtag — but the only Portuguese variant we ship is `pt-BR`,
not `pt`.

## Solution

Extract the locale-resolution function to `src/lang/index.ts` as
`resolveLocale` (testable without browser runtime), and add a final
fallback step: when the primary subtag itself is not a supported
locale, search for a supported locale whose primary subtag matches
(e.g. `pt` → `pt-BR`).

## Changes

- `src/lang/index.ts` — add exported `resolveLocale` with regional-variant fallback
- `src/lib/vue-i18n.ts` — replace inline `primarySubtagIfSupported` with `resolveLocale` import
- `test/lang/test_resolve_locale.ts` — unit tests covering all resolution paths
