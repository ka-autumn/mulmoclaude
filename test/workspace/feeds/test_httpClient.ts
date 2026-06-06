import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchText } from "../../../server/workspace/feeds/fetch/httpClient.js";

// All cases reject at the SSRF guard BEFORE any network call (IP literals
// need no DNS), so these run offline and deterministically.
describe("httpClient SSRF guard", () => {
  it("rejects non-http(s) schemes", async () => {
    await assert.rejects(() => fetchText("ftp://example.com/x"), /non-http/);
    await assert.rejects(() => fetchText("file:///etc/passwd"), /non-http/);
  });

  it("rejects loopback / private / link-local / metadata addresses", async () => {
    await assert.rejects(() => fetchText("http://127.0.0.1:9/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://10.1.2.3/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://192.168.0.1/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://172.16.5.5/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://169.254.169.254/latest/meta-data/"), /private|loopback/);
    await assert.rejects(() => fetchText("http://[::1]/"), /private|loopback/);
  });
});
