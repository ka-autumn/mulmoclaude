// Unit tests for the custom-view srcdoc builder (see
// plans/feat-collections-custom-views.md). Pure — the builder takes the
// origin explicitly, so no DOM/window is needed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCustomViewSrcdoc } from "../../../src/utils/html/customViewSrcdoc.js";

const boot = {
  slug: "plans",
  token: "abc.def",
  dataUrl: "/api/collections/plans/view-data",
  origin: "http://localhost:3001",
};

describe("buildCustomViewSrcdoc", () => {
  it("injects __MC_VIEW with an absolutised dataUrl after <head>", () => {
    const out = buildCustomViewSrcdoc("<html><head><title>x</title></head><body></body></html>", boot);
    assert.match(out, /window\.__MC_VIEW=/);
    assert.match(out, /"dataUrl":"http:\/\/localhost:3001\/api\/collections\/plans\/view-data"/);
    assert.match(out, /"token":"abc\.def"/);
    assert.match(out, /"slug":"plans"/);
    // injected right after the opening head tag, before the title
    assert.ok(out.indexOf("__MC_VIEW") < out.indexOf("<title>"));
  });

  it("sets a CSP meta with connect-src = the server origin", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    assert.match(out, /Content-Security-Policy/);
    assert.match(out, /connect-src http:\/\/localhost:3001/);
  });

  it("locks connect-src to the origin (the exfiltration channel) but allows CDN resource loads", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    // connect-src (fetch/XHR/WebSocket/beacon) is the channel that could stream
    // the token/records to an attacker — it must be the origin only, never '*'.
    assert.match(out, /connect-src http:\/\/localhost:3001/);
    assert.ok(!/connect-src[^;]*\*/.test(out), "connect-src must not be wildcard");
    // Resource loads may use the curated CDN allowlist (charting libs, fonts) —
    // those hosts don't relay request data to attackers.
    assert.match(out, /script-src[^;]*cdn\.jsdelivr\.net/);
  });

  it("wraps a fragment that has no <head>", () => {
    const out = buildCustomViewSrcdoc("<div>hi</div>", boot);
    assert.match(out, /^<!DOCTYPE html><html><head>/);
    assert.match(out, /<body><div>hi<\/div><\/body>/);
  });

  it("escapes < in the injected JSON so a hostile value can't break out", () => {
    const out = buildCustomViewSrcdoc("<head></head>", { ...boot, token: "</script><x>" });
    assert.ok(!out.includes("</script><x>"));
    assert.match(out, /\\u003c/);
  });

  it("leaves an already-absolute dataUrl unchanged", () => {
    const out = buildCustomViewSrcdoc("<head></head>", { ...boot, dataUrl: "http://example.test/data" });
    assert.match(out, /"dataUrl":"http:\/\/example\.test\/data"/);
  });

  it("injects the onChange live-refresh bootstrap into the same script", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    // The helper is defined on the existing __MC_VIEW global…
    assert.match(out, /v\.onChange=function/);
    // …and only reacts to the parent's collection-changed message.
    assert.match(out, /mc-collection-changed/);
    assert.match(out, /e\.source!==window\.parent/);
    // It lives inside the single bootstrap <script>, before the view's own code.
    assert.ok(out.indexOf("onChange") < out.indexOf("</head>"));
  });

  it("injects the openItem bridge + origin so the view can open the host modal", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    // The origin is injected so openItem can target the parent frame's origin.
    assert.match(out, /"origin":"http:\/\/localhost:3001"/);
    // openItem posts an mc-open-item message up to the parent.
    assert.match(out, /v\.openItem=function/);
    assert.match(out, /mc-open-item/);
    assert.match(out, /window\.parent\.postMessage\(/);
    // Targets the known parent origin, never '*'.
    assert.ok(out.includes("},v.origin)"), "openItem must post to the parent origin, not '*'");
  });

  it("keeps the onChange bootstrap free of a </script> breakout sequence", () => {
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    // The bootstrap is inlined in a <script>; a literal </script> inside it would
    // close the tag early. The only </script> must be the intended closer.
    assert.equal(out.match(/<\/script>/gi)?.length, 1);
  });

  it("the injected bootstrap script body contains no raw < (no parser surprises)", () => {
    // Isolate the bootstrap <script>…</script> and assert its body has no `<` at
    // all — the contract that lets it be inlined safely (Sourcery suggestion).
    const out = buildCustomViewSrcdoc("<head></head>", boot);
    const body = out.slice(out.indexOf("<script>") + "<script>".length, out.indexOf("</script>"));
    assert.ok(body.length > 0);
    assert.ok(!body.includes("<"), "inlined bootstrap must not contain a raw '<'");
  });
});
