# PDF preview fails in Safari/WebKit (#1299)

## Problem (per issue)

`/api/files/raw` applies `Content-Security-Policy: sandbox` to every response, including PDFs. WebKit's PDF renderer refuses to display sandbox-opaque PDFs and forces a download, so the Files preview iframe ends up blank on Safari. Chromium (PDFium) and Firefox (pdf.js) handle the same response fine, so the regression is Safari-only and was not caught when the sandbox CSP landed.

The original comment claiming "PDFs still work because they don't rely on same-origin access to the parent" was Chromium-only reasoning.

## Approach (issue's Option A)

Drop `Content-Security-Policy: sandbox` for PDF responses only. Keep `X-Content-Type-Options: nosniff` so the response can't be re-interpreted as HTML.

The PDF viewer's own sandbox provides script isolation for embedded AcroJS — the response-level CSP was never the layer enforcing PDF script safety. So removing it costs nothing on the threat model side, and fixes Safari.

## Why not options B / C

- **B (`sandbox allow-same-origin`)**: dilutes the sandbox semantics for SVG / HTML / future threat shapes if they ever land on the same response shape. Narrower carve-out is safer.
- **C (PDF.js bundle)**: hundreds of KB of new client code and a new dependency to maintain.

## Changes

1. `server/api/routes/files.ts`:
   - Add `RAW_SECURITY_HEADERS_PDF` constant (just `nosniff`, no CSP).
   - Add `rawSecurityHeadersForMime(mime)` picker so the call site doesn't branch inline.
   - Make `applyRawSecurityHeaders(res, mime)` MIME-aware.
   - Update the threat-model comment block to reflect the carve-out and link to #1299.
2. `test/routes/test_filesRoute.ts`:
   - Existing `RAW_SECURITY_HEADERS` assertions stay (still pin the non-PDF case).
   - New `describe` block for `RAW_SECURITY_HEADERS_PDF` (no CSP, has nosniff).
   - New `describe` block for `rawSecurityHeadersForMime` covering PDF + SVG/HTML/image/text/video/audio + near-miss MIME hardening.

## Out of scope

- **E2E webkit PDF preview test.** The issue's test plan suggests adding one to the Playwright `webkit` project. The current webkit project only matches `ime-enter.spec.ts`; a meaningful preview test needs a PDF fixture, a not-mocked `/api/files/raw` route, and a way to assert "render, don't download". Worth doing but heavier than the fix. Punt to a follow-up if real-Safari verification surfaces residual issues.
- **Manual verification on real Safari**. Requires user's machine; can't do from CI.

## Test plan

- [x] Unit tests pin `RAW_SECURITY_HEADERS_PDF` (no CSP, has nosniff) and `rawSecurityHeadersForMime` PDF / non-PDF dispatch.
- [x] Existing `RAW_SECURITY_HEADERS` assertions still pass — the non-PDF path is unchanged.
- [ ] Manual: open MulmoClaude in Safari → pick a PDF in Files → confirm the iframe renders inline instead of triggering a download.

## Acceptance

- `/api/files/raw?path=foo.pdf` returns `X-Content-Type-Options: nosniff` and **no** `Content-Security-Policy` header.
- `/api/files/raw?path=foo.svg` (and every other MIME) still returns `Content-Security-Policy: sandbox` + `nosniff` — sandbox CSP defenses for SVG / HTML threats are unchanged.
- `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` all green.
