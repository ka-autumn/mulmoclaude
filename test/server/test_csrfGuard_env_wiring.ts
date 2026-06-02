// Env-bound wiring smoke for the exported `requireSameOrigin`.
// Issue #1463 — companion to test/server/test_csrfGuard.ts.
//
// Why a separate file: the existing "env-binding integration" suite
// in test_csrfGuard.ts dynamically re-imports server/system/env.ts and
// **manually recomposes** the middleware via
// `requireSameOriginWith(envMod.env.trustedOrigins)`. That proves the
// env parser + factory still compose, but it cannot catch a typo at
// the actual export site, e.g.
//
//     export const requireSameOrigin = requireSameOriginWith([]);
//     export const requireSameOrigin = requireSameOriginWith(env.sandboxMountConfigs);
//
// Node's ESM resolver caches `import { env } from "../system/env.js"`
// by un-queried URL, so re-importing csrfGuard.ts inside the same
// process always captures the original env snapshot. The only
// reliable way to verify the export wiring is to run a fresh process
// with `MULMOCLAUDE_TRUSTED_ORIGINS` set and import the ACTUAL
// exported `requireSameOrigin` — that's what the dedicated
// `yarn test:csrf-wiring` script does.
//
// The same file is also picked up by the main `./test/*/test_*.ts`
// glob during `yarn test` (env unset), where it asserts the
// localhost-only fallback. CI runs both invocations.
//
// Full design: plans/done/test-csrf-env-wiring-1463.md

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { requireSameOrigin } from "../../server/api/csrfGuard.js";
import { makeReq, makeRes } from "./helpers/fakeExpressMiddleware.js";

const TRUSTED_ORIGINS_ENV_KEY = "MULMOCLAUDE_TRUSTED_ORIGINS";
const TRUSTED_ORIGIN = "http://192.168.1.42:5173";
const FORBIDDEN_ORIGIN = "http://192.168.1.99:5173";
const LOCALHOST_ORIGIN = "http://localhost:5173";

function envHas(value: string): boolean {
  const raw = process.env[TRUSTED_ORIGINS_ENV_KEY] ?? "";
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .includes(value);
}

interface MiddlewareCallResult {
  nextCalled: boolean;
  statusCode: number;
}

function callMiddleware(method: string, origin: string): MiddlewareCallResult {
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  const res = makeRes();
  requireSameOrigin(makeReq(method, origin) as unknown as Request, res as unknown as Response, next);
  return { nextCalled, statusCode: res.statusCode };
}

describe("requireSameOrigin (env-bound export) — wiring smoke (#1463)", () => {
  // Sanity: localhost always passes — guards against an export-site
  // wiring that accidentally rejects every origin (e.g. swapping
  // SAFE_METHODS or inverting the allow check).
  it("admits a POST from http://localhost regardless of env", () => {
    const { nextCalled, statusCode } = callMiddleware("POST", LOCALHOST_ORIGIN);
    assert.equal(nextCalled, true, "localhost POST must pass the env-bound middleware");
    assert.equal(statusCode, 200);
  });

  if (envHas(TRUSTED_ORIGIN)) {
    // Env-set mode: `yarn test:csrf-wiring` runs this branch.
    //
    // The typo catcher. If `csrfGuard.ts` wires
    // `requireSameOriginWith([])` (or the wrong env field), the
    // LAN origin is NOT in the bound allowlist and the POST is
    // 403'd here — assertion fails, CI red.
    it(`admits a POST from the listed LAN origin (${TRUSTED_ORIGIN})`, () => {
      const { nextCalled, statusCode } = callMiddleware("POST", TRUSTED_ORIGIN);
      assert.equal(nextCalled, true, "env-bound requireSameOrigin must admit the configured LAN origin — export-site typo?");
      assert.equal(statusCode, 200);
    });

    it("rejects a POST from a non-listed LAN origin", () => {
      const { nextCalled, statusCode } = callMiddleware("POST", FORBIDDEN_ORIGIN);
      assert.equal(nextCalled, false, "non-listed LAN origin must still be blocked");
      assert.equal(statusCode, 403);
    });
  } else {
    // Env-unset mode (default `yarn test` invocation via the glob).
    //
    // Pins the fallback: with no allowlist, the env-bound middleware
    // is localhost-only. Catches a regression where someone defaults
    // `env.trustedOrigins` to something permissive at the env layer.
    it(`rejects a POST from a LAN origin when ${TRUSTED_ORIGINS_ENV_KEY} is unset`, () => {
      const { nextCalled, statusCode } = callMiddleware("POST", TRUSTED_ORIGIN);
      assert.equal(nextCalled, false, "LAN origin must be blocked when the allowlist is unset");
      assert.equal(statusCode, 403);
    });
  }
});
