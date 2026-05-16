# feat: srcset image rewriter (#1275)

## Problem

`src/utils/image/htmlSrcAttrs.ts`'s shared rewriter handled
single-URL attributes (`<img src>`, `<source src>`, `<video
poster|src>`, `<audio src>`) since #1011 Stage B, but `srcset` was
explicitly deferred with no follow-up issue. Result: wiki / PDF
HTML containing `srcset` (LLM-generated or pasted) keeps raw
workspace-relative URLs that 404 on high-density screens (low
real-world impact — the `src` fallback still renders on normal
screens — but visibly broken on Retina).

## Approach

`srcset` is a comma-separated `url [descriptor]` list, so it needs
a split/rewrite pass separate from the single-URL path. Both
callers (`rewriteMarkdownImageRefs.ts` → `/api/files/raw`,
`server/api/routes/pdf.ts` → `data:` URI) go through the one
shared helper, so the fix lands on both surfaces with no
caller-side change.

- `SRCSET_TAG_ATTRS = { img: ["srcset"], source: ["srcset"] }` —
  a subset of the existing outer-regex tag set, so no regex
  alternation change.
- `rewriteSrcset(value, transform)` — pure string ops (split on
  `,`, first token = URL, rest = descriptor, rejoin). No regex →
  ReDoS-safe by construction.
- `replaceAttrIfResolvable` branches on whether the attribute is a
  srcset attr; unchanged single-URL behaviour otherwise. Added a
  `replacement === value` no-op guard so an unchanged srcset is
  left byte-verbatim (preserves original quoting/spacing).

## Out of scope

- SVG `<image href>` / CSS `url()` — still deferred (separate gap
  items, unchanged).
- srcset URLs containing raw commas — non-conformant per the HTML
  spec (must be percent-encoded); plain comma split is correct for
  valid input.

## Tests

- `test/utils/image/test_htmlSrcAttrs.ts` — new `srcset rewriting`
  block: single candidate, descriptor list (`1x/2x/3x`), width
  descriptors + irregular whitespace, `<source srcset>`, null
  (verbatim), video/audio NOT srcset-rewritten, standalone
  `rewriteSrcset`, SRCSET_TAG_ATTRS ⊆ outer-regex tag set. Updated
  the pre-existing `<picture>` test (was asserting srcset deferred).
- `e2e-live/tests/wiki.spec.ts` L-W-S-03 unskipped + implemented:
  `<picture><source srcset>` srcset rewritten to `/api/files/raw`,
  descriptors preserved, fallback `<img>` decodes.
- `plans/feat-e2e-live.md` L-W-S-03 row → landed.

## Acceptance

- `<img srcset="a.png 1x, a@2x.png 2x">` in wiki → both URLs
  rewritten, descriptors intact, no `../../../` left.
- PDF export inlines srcset candidates as `data:` URIs.
- `yarn format/lint/typecheck/build/test` green.
