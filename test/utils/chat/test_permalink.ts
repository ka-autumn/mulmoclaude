import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMessagePermalink } from "../../../src/utils/chat/permalink";

const ORIGIN = "http://localhost:5173";
const SESSION = "ff67bde8-0f13-4b3c-ba93-7ebc8bc7d954";
const UUID = "a285688f-450d-49ca-a255-c74a2b75163e";

describe("buildMessagePermalink", () => {
  it("returns the full chat URL with ?result= when both ids are present", () => {
    assert.equal(buildMessagePermalink(ORIGIN, SESSION, UUID), `${ORIGIN}/chat/${SESSION}?result=${UUID}`);
  });

  it("returns null when sessionId is null (no active chat)", () => {
    assert.equal(buildMessagePermalink(ORIGIN, null, UUID), null);
  });

  it("returns null when resultUuid is null (empty / new session)", () => {
    assert.equal(buildMessagePermalink(ORIGIN, SESSION, null), null);
  });

  it("returns null when both ids are null", () => {
    assert.equal(buildMessagePermalink(ORIGIN, null, null), null);
  });

  it("returns null when sessionId is an empty string", () => {
    assert.equal(buildMessagePermalink(ORIGIN, "", UUID), null);
  });

  it("returns null when resultUuid is an empty string", () => {
    assert.equal(buildMessagePermalink(ORIGIN, SESSION, ""), null);
  });

  it("preserves the origin verbatim (https, custom port, path-less)", () => {
    assert.equal(buildMessagePermalink("https://example.com:8443", SESSION, UUID), `https://example.com:8443/chat/${SESSION}?result=${UUID}`);
  });

  it("URL-encodes dynamic segments so reserved characters cannot break the link", () => {
    // Regression: if a future caller passes non-UUID ids (slugs, kebab-ids,
    // raw user input echoes), characters like '?', '&', '#', '/', ' ' must
    // not bleed into the URL grammar.
    const dirtyId = "weird id?with&reserved/chars#x y";
    const url = buildMessagePermalink(ORIGIN, dirtyId, dirtyId);
    assert.equal(url, `${ORIGIN}/chat/${encodeURIComponent(dirtyId)}?result=${encodeURIComponent(dirtyId)}`);
    // Sanity-check the structural invariant: exactly one literal '?' delimits
    // the query string (the rest of the reserved chars must be percent-encoded).
    assert.equal(url?.split("?").length, 2);
  });

  it("does not produce a session-only URL when resultUuid is missing (no '?result=' suffix-stripped fallback)", () => {
    // Regression: previously the section would render a session-only URL when nothing was selected,
    // which conflicted with the "selected message permalink" label. The helper must return null
    // so the section hides instead.
    assert.equal(buildMessagePermalink(ORIGIN, SESSION, null), null);
  });
});
