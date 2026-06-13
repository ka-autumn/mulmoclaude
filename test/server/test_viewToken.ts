// Unit tests for the custom-view capability token (see
// plans/feat-collections-custom-views.md). Covers the pure codec
// (mint/verify round-trip, tamper, expiry), the capability clamp, the
// path predicate, and the `requireViewToken` middleware. Token seeding
// mirrors test_bearerAuth.ts: a tmp-file token sets the HMAC key.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import path from "path";
import { tmpdir } from "os";
import type { Request, Response, NextFunction } from "express";
import { __resetForTests, generateAndWriteToken } from "../../server/api/auth/token.js";
import { clampCapabilities, isViewDataPath, mintViewToken, requireViewToken, verifyViewToken, VIEW_TOKEN_TTL_MS } from "../../server/api/auth/viewToken.js";

let tmpDir = "";

beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "mulmo-viewtoken-test-"));
  __resetForTests();
  await generateAndWriteToken(path.join(tmpDir, ".session-token"));
});

describe("viewToken — mint/verify round-trip", () => {
  it("verifies a freshly minted token and returns its payload", () => {
    const minted = mintViewToken("my-collection", ["read", "write"]);
    assert.ok(minted);
    const payload = verifyViewToken(minted.token);
    assert.ok(payload);
    assert.equal(payload.slug, "my-collection");
    assert.deepEqual(payload.caps, ["read", "write"]);
    assert.equal(payload.exp, minted.exp);
  });

  it("sets exp to now + TTL", () => {
    const now = 1_000_000;
    const minted = mintViewToken("c", ["read"], now);
    assert.ok(minted);
    assert.equal(minted.exp, now + VIEW_TOKEN_TTL_MS);
  });
});

describe("viewToken — rejects tampering", () => {
  it("returns null when the payload is altered (signature mismatch)", () => {
    const minted = mintViewToken("c", ["read"]);
    assert.ok(minted);
    // Forge a write capability by swapping the payload but keeping the sig.
    const [, sig] = minted.token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ slug: "c", caps: ["write"], exp: Date.now() + VIEW_TOKEN_TTL_MS }), "utf8").toString("base64url");
    assert.equal(verifyViewToken(`${forgedPayload}.${sig}`), null);
  });

  it("returns null for a garbage token", () => {
    assert.equal(verifyViewToken("not-a-token"), null);
    assert.equal(verifyViewToken(""), null);
    assert.equal(verifyViewToken("."), null);
  });

  it("returns null once a different server key is in effect", async () => {
    const minted = mintViewToken("c", ["read"]);
    assert.ok(minted);
    // Simulate a restart: a fresh key invalidates outstanding tokens.
    __resetForTests();
    await generateAndWriteToken(path.join(tmpDir, ".session-token-2"));
    assert.equal(verifyViewToken(minted.token), null);
  });
});

describe("viewToken — rejects expired", () => {
  it("returns null when nowMs is at or past exp", () => {
    const now = 5_000;
    const minted = mintViewToken("c", ["read"], now);
    assert.ok(minted);
    assert.ok(verifyViewToken(minted.token, minted.exp - 1));
    assert.equal(verifyViewToken(minted.token, minted.exp), null);
    assert.equal(verifyViewToken(minted.token, minted.exp + 1), null);
  });
});

describe("viewToken — capability clamp", () => {
  it("clamps requested caps to the declared set", () => {
    assert.deepEqual(clampCapabilities(["read"], ["read", "write"]), ["read"]);
    assert.deepEqual(clampCapabilities(["read", "write"], ["write"]), ["write"]);
  });

  it("defaults declared to [read] and requested to the declared set", () => {
    assert.deepEqual(clampCapabilities(undefined, undefined), ["read"]);
    assert.deepEqual(clampCapabilities(["read", "write"], undefined), ["read", "write"]);
    assert.deepEqual(clampCapabilities(undefined, ["read", "write"]), ["read"]);
  });
});

describe("viewToken — isViewDataPath", () => {
  it("matches the view-data path with and without the /api prefix", () => {
    assert.equal(isViewDataPath("/collections/my-slug/view-data"), true);
    assert.equal(isViewDataPath("/api/collections/my-slug/view-data"), true);
  });

  it("does not match sibling collection routes", () => {
    assert.equal(isViewDataPath("/api/collections/my-slug/items"), false);
    assert.equal(isViewDataPath("/api/collections/my-slug/view-token"), false);
    assert.equal(isViewDataPath("/api/collections/my-slug/view-data/extra"), false);
  });
});

// --- requireViewToken middleware ---

interface FakeReq {
  headers: { authorization?: string };
  params: { slug: string };
}
interface FakeRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function run(action: "read" | "write", authorization: string | undefined, slug: string): { nextCalled: boolean; statusCode: number } {
  const req: FakeReq = { headers: authorization === undefined ? {} : { authorization }, params: { slug } };
  const res = makeRes();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  requireViewToken(action)(req as unknown as Request, res as unknown as Response, next);
  return { nextCalled, statusCode: res.statusCode };
}

describe("requireViewToken — middleware", () => {
  it("calls next() for a valid token with the right slug + capability", () => {
    const minted = mintViewToken("c", ["read", "write"]);
    assert.ok(minted);
    const { nextCalled, statusCode } = run("read", `Bearer ${minted.token}`, "c");
    assert.equal(nextCalled, true);
    assert.equal(statusCode, 200);
  });

  it("401s when the token's slug does not match the route param", () => {
    const minted = mintViewToken("c", ["read"]);
    assert.ok(minted);
    const { nextCalled, statusCode } = run("read", `Bearer ${minted.token}`, "other");
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
  });

  it("401s when the token lacks the required capability (read token on write route)", () => {
    const minted = mintViewToken("c", ["read"]);
    assert.ok(minted);
    const { nextCalled, statusCode } = run("write", `Bearer ${minted.token}`, "c");
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
  });

  it("401s on missing / malformed Authorization header", () => {
    assert.equal(run("read", undefined, "c").statusCode, 401);
    assert.equal(run("read", "Basic xyz", "c").statusCode, 401);
    assert.equal(run("read", "Bearer not-a-token", "c").statusCode, 401);
  });
});
