// Unit tests for the CSRF origin guard middleware. The middleware
// sits in front of every route and rejects state-changing requests
// that carry a non-localhost Origin header — our defense against
// cross-origin CSRF attacks that survive the CORS lockdown in
// #148.
//
// Full design: plans/done/fix-server-csrf-origin-check.md

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { isAllowedOrigin, isLocalhostOrigin, isTrustedOrigin, requireSameOrigin, requireSameOriginWith } from "../../server/api/csrfGuard.js";

// --- isLocalhostOrigin: the pure check --------------------------

describe("isLocalhostOrigin — accepts local variants", () => {
  it("accepts plain http://localhost", () => {
    assert.equal(isLocalhostOrigin("http://localhost"), true);
  });

  it("accepts http://localhost with a port", () => {
    assert.equal(isLocalhostOrigin("http://localhost:5173"), true);
    assert.equal(isLocalhostOrigin("http://localhost:3001"), true);
    assert.equal(isLocalhostOrigin("http://localhost:4173"), true);
  });

  it("accepts https://localhost (scheme-agnostic)", () => {
    assert.equal(isLocalhostOrigin("https://localhost"), true);
  });

  it("accepts http://127.0.0.1 with and without port", () => {
    assert.equal(isLocalhostOrigin("http://127.0.0.1"), true);
    assert.equal(isLocalhostOrigin("http://127.0.0.1:8080"), true);
  });

  it("accepts IPv6 loopback http://[::1]", () => {
    assert.equal(isLocalhostOrigin("http://[::1]"), true);
    assert.equal(isLocalhostOrigin("http://[::1]:5173"), true);
  });
});

describe("isLocalhostOrigin — rejects everything else", () => {
  it("rejects a foreign hostname", () => {
    assert.equal(isLocalhostOrigin("http://example.com"), false);
    assert.equal(isLocalhostOrigin("https://attacker.example"), false);
  });

  it("rejects localhost-lookalikes (subdomain attack)", () => {
    // The classic CSRF bypass: register `localhost.evil.com`,
    // hope the check is a substring / suffix match. URL.hostname
    // returns the FULL hostname so a Set membership check is
    // immune.
    assert.equal(isLocalhostOrigin("http://localhost.evil.com"), false);
    assert.equal(isLocalhostOrigin("http://127.0.0.1.nip.io"), false);
  });

  it("rejects evil-prefixed hostnames that lack the dot", () => {
    // `evillocalhost` would match a naive `includes("localhost")`
    // check. Set membership rejects it.
    assert.equal(isLocalhostOrigin("http://evillocalhost"), false);
    assert.equal(isLocalhostOrigin("http://notlocalhost"), false);
  });

  it("rejects a URL that only contains `localhost` in the path", () => {
    assert.equal(isLocalhostOrigin("http://attacker.com/path?host=localhost"), false);
  });

  it("rejects the string `null`", () => {
    // Browsers set `Origin: null` for sandboxed iframes, file://,
    // data: URLs, and some cross-origin redirects. None of those
    // should be trusted to hit the API.
    assert.equal(isLocalhostOrigin("null"), false);
  });

  it("rejects empty string", () => {
    assert.equal(isLocalhostOrigin(""), false);
  });

  it("rejects non-URL garbage", () => {
    assert.equal(isLocalhostOrigin("not a url"), false);
    assert.equal(isLocalhostOrigin("http://"), false);
  });

  it("rejects a javascript: URI", () => {
    // `new URL("javascript:alert(1)").hostname` is "" — not in
    // the loopback set, so rejected.
    // eslint-disable-next-line no-script-url -- guard test fixture
    assert.equal(isLocalhostOrigin("javascript:alert(1)"), false);
  });

  it("rejects file:// origins", () => {
    // file:// URLs usually get `Origin: null` in practice, but
    // just in case one arrives as a literal file:// value:
    assert.equal(isLocalhostOrigin("file:///tmp/evil.html"), false);
  });

  it("rejects non-loopback IPs including private LAN addresses", () => {
    // If the server ever re-binds to 0.0.0.0 (don't), a LAN
    // attacker with its own HTTP server could use its own
    // address as Origin. Explicitly rejected.
    assert.equal(isLocalhostOrigin("http://192.168.1.10"), false);
    assert.equal(isLocalhostOrigin("http://10.0.0.1"), false);
    assert.equal(isLocalhostOrigin("http://172.16.0.5"), false);
    assert.equal(isLocalhostOrigin("http://0.0.0.0"), false);
  });

  it("rejects non-HTTP schemes even when the hostname is localhost", () => {
    // The function promises "localhost" in the HTTP-origin sense
    // (what browsers actually send). A synthetic client crafting
    // `ftp://localhost` or `chrome-extension://localhost` does not
    // get the localhost-binding trust — that path is for genuine
    // same-host HTTP callers only.
    assert.equal(isLocalhostOrigin("ftp://localhost"), false);
    assert.equal(isLocalhostOrigin("ftp://127.0.0.1:21"), false);
    assert.equal(isLocalhostOrigin("file://localhost"), false);
    assert.equal(isLocalhostOrigin("chrome-extension://localhost"), false);
    assert.equal(isLocalhostOrigin("ws://localhost:5173"), false);
    assert.equal(isLocalhostOrigin("wss://localhost:5173"), false);
  });
});

// --- requireSameOrigin: Express middleware behaviour ------------

// Minimal fake Request/Response/NextFunction for middleware
// testing — avoids pulling in supertest. The `headers` value type
// is intentionally widened to `unknown` so tests can simulate
// header-smuggling-style malformed values (e.g. an array Origin)
// even though Express's runtime type is `string | string[]`.
interface FakeReq {
  method: string;
  headers: Record<string, unknown>;
}

interface FakeRes {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
}

function makeReq(method: string, origin?: string): FakeReq {
  return {
    method,
    headers: origin === undefined ? {} : { origin },
  };
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

function run(req: FakeReq, res: FakeRes): { nextCalled: boolean; statusCode: number; body: unknown } {
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  // The types differ slightly from real Express — cast through
  // `unknown` since the middleware only touches `method`,
  // `headers`, `status`, `json`.
  requireSameOrigin(req as unknown as Request, res as unknown as Response, next);
  return {
    nextCalled,
    statusCode: res.statusCode,
    body: res.body,
  };
}

describe("requireSameOrigin — safe methods pass through", () => {
  it("lets GET through regardless of Origin", () => {
    for (const origin of [undefined, "http://localhost", "http://example.com", "null"]) {
      const { nextCalled, statusCode } = run(makeReq("GET", origin), makeRes());
      assert.equal(nextCalled, true, `expected next() for Origin=${origin}`);
      assert.equal(statusCode, 200);
    }
  });

  it("lets HEAD through regardless of Origin", () => {
    const { nextCalled } = run(makeReq("HEAD", "http://example.com"), makeRes());
    assert.equal(nextCalled, true);
  });

  it("lets OPTIONS through (CORS preflight shouldn't be CSRF-checked)", () => {
    const { nextCalled } = run(makeReq("OPTIONS", "http://example.com"), makeRes());
    assert.equal(nextCalled, true);
  });
});

describe("requireSameOrigin — state-changing methods, missing Origin", () => {
  // Non-browser callers (curl, MCP tools, Node HTTP libraries)
  // don't set Origin. They're trusted because #148 binds to
  // localhost.

  it("allows POST with no Origin header", () => {
    const { nextCalled, statusCode } = run(makeReq("POST"), makeRes());
    assert.equal(nextCalled, true);
    assert.equal(statusCode, 200);
  });

  it("allows PUT / PATCH / DELETE with no Origin header", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const { nextCalled } = run(makeReq(method), makeRes());
      assert.equal(nextCalled, true, `expected next() for ${method}`);
    }
  });
});

describe("requireSameOrigin — state-changing methods, localhost Origin", () => {
  it("allows POST from http://localhost:5173 (Vite dev)", () => {
    const { nextCalled } = run(makeReq("POST", "http://localhost:5173"), makeRes());
    assert.equal(nextCalled, true);
  });

  it("allows POST from http://localhost:3001 (production Express)", () => {
    const { nextCalled } = run(makeReq("POST", "http://localhost:3001"), makeRes());
    assert.equal(nextCalled, true);
  });

  it("allows POST from http://127.0.0.1 variants", () => {
    const { nextCalled } = run(makeReq("POST", "http://127.0.0.1:5173"), makeRes());
    assert.equal(nextCalled, true);
  });

  it("allows POST from http://[::1] (IPv6 loopback)", () => {
    const { nextCalled } = run(makeReq("POST", "http://[::1]:5173"), makeRes());
    assert.equal(nextCalled, true);
  });
});

describe("requireSameOrigin — state-changing methods, foreign Origin (blocked)", () => {
  function assertBlocked(method: string, origin: string) {
    const { nextCalled, statusCode, body } = run(makeReq(method, origin), makeRes());
    assert.equal(nextCalled, false, `${method} from ${origin} should be blocked`);
    assert.equal(statusCode, 403);
    assert.ok(body && typeof body === "object" && "error" in body, "response body should include an error field");
  }

  it("blocks POST from an arbitrary foreign origin", () => {
    assertBlocked("POST", "http://evil.example");
  });

  it("blocks POST from a localhost subdomain lookalike", () => {
    // The classic CSRF bypass: register `localhost.evil.com`,
    // hope the hostname check is a substring match.
    assertBlocked("POST", "http://localhost.evil.com");
  });

  it("blocks POST from `http://evillocalhost` (no-dot lookalike)", () => {
    assertBlocked("POST", "http://evillocalhost");
  });

  it("blocks POST with Origin `null` (sandboxed iframe / file:// / data:)", () => {
    assertBlocked("POST", "null");
  });

  it("blocks POST with a malformed Origin", () => {
    assertBlocked("POST", "not a url");
  });

  it("blocks PUT / PATCH / DELETE with a foreign Origin", () => {
    assertBlocked("PUT", "http://evil.example");
    assertBlocked("PATCH", "http://evil.example");
    assertBlocked("DELETE", "http://evil.example");
  });

  it("blocks POST from a private-LAN IP (defensive for future re-bind)", () => {
    // Even if the server is re-bound to 0.0.0.0 in the future,
    // a LAN attacker can't use its own address as a trusted
    // Origin.
    assertBlocked("POST", "http://192.168.1.10");
    assertBlocked("POST", "http://10.0.0.1");
  });
});

// --- isTrustedOrigin: env-driven allowlist ----------------------

describe("isTrustedOrigin — verbatim allowlist match", () => {
  const LAN_IPAD = "http://192.168.1.42:5173";
  const LAN_DESKTOP = "http://192.168.1.50:5173";
  const trusted = [LAN_IPAD, LAN_DESKTOP] as const;

  it("accepts an Origin that is listed verbatim", () => {
    assert.equal(isTrustedOrigin(LAN_IPAD, trusted), true);
    assert.equal(isTrustedOrigin(LAN_DESKTOP, trusted), true);
  });

  it("rejects an Origin not in the list", () => {
    assert.equal(isTrustedOrigin("http://192.168.1.99:5173", trusted), false);
    assert.equal(isTrustedOrigin("http://evil.example", trusted), false);
  });

  it("rejects a listed entry with a different port", () => {
    // Browsers send the exact origin (scheme + host + port). A port
    // mismatch is a different origin and must NOT be allowed.
    assert.equal(isTrustedOrigin("http://192.168.1.42:3001", trusted), false);
  });

  it("rejects a listed entry with a different scheme", () => {
    assert.equal(isTrustedOrigin("https://192.168.1.42:5173", trusted), false);
  });

  it("rejects a listed entry with a trailing slash (misconfig safety net)", () => {
    // `Origin` header is always scheme://host[:port] with no path
    // and no trailing slash. If the operator pastes a URL with a
    // trailing slash into the env var, the match silently fails —
    // which is preferable to a permissive prefix match that could
    // be turned into an Origin-confusion exploit.
    assert.equal(isTrustedOrigin("http://192.168.1.42:5173", ["http://192.168.1.42:5173/"]), false);
  });

  it("rejects empty and `null` Origins regardless of list", () => {
    // Defense-in-depth: even if an operator typoed `null` into the
    // allowlist, we reject it. Browsers send `Origin: null` for
    // opaque contexts (sandboxed iframes, file://, data:); honoring
    // that string would turn the opt-in allowlist into a downgrade
    // vector. See `NULL_ORIGIN_LITERAL` in server/api/csrfGuard.ts.
    assert.equal(isTrustedOrigin("", trusted), false);
    assert.equal(isTrustedOrigin("null", [...trusted, "null"]), false);
  });

  it("treats an empty allowlist as a no-op", () => {
    assert.equal(isTrustedOrigin("http://192.168.1.42:5173", []), false);
  });
});

// --- isAllowedOrigin: composite (localhost OR trusted) ----------

describe("isAllowedOrigin — composes localhost + trusted", () => {
  const trusted = ["http://192.168.1.42:5173"] as const;

  it("accepts a localhost Origin regardless of trusted list", () => {
    assert.equal(isAllowedOrigin("http://localhost:5173", []), true);
    assert.equal(isAllowedOrigin("http://127.0.0.1:3001", trusted), true);
  });

  it("accepts a trusted-list Origin even when not localhost", () => {
    assert.equal(isAllowedOrigin("http://192.168.1.42:5173", trusted), true);
  });

  it("rejects an Origin that is neither localhost nor trusted", () => {
    assert.equal(isAllowedOrigin("http://192.168.1.99:5173", trusted), false);
    assert.equal(isAllowedOrigin("http://evil.example", trusted), false);
  });

  it("accepts an explicitly listed entry even if it looks like a localhost lookalike", () => {
    // Caveat-pinning test: the allowlist is a verbatim string match,
    // so if the operator types a localhost-lookalike (`localhost.evil.com`)
    // into the env var, the middleware will accept it. We rely on
    // the operator-vs-attacker boundary (only the operator sets the
    // env var) and document the caveat in the .env.example. This
    // test pins the current behaviour so any future tightening
    // (e.g. rejecting subdomain-lookalikes at env-parse time) shows
    // up as a deliberate test update rather than a silent regression.
    assert.equal(isAllowedOrigin("http://localhost.evil.com", ["http://localhost.evil.com"]), true);
  });

  it("still rejects `null` Origin even when listed", () => {
    // `isAllowedOrigin` composes localhost + trusted, so the
    // unconditional `null` reject in `isTrustedOrigin` propagates.
    // `null` is also not a valid loopback per `isLocalhostOrigin`,
    // so neither branch admits it.
    assert.equal(isAllowedOrigin("null", ["null"]), false);
  });
});

// --- requireSameOriginWith: factory + middleware integration -----

// The exported `requireSameOrigin` binds to `env.trustedOrigins` at
// module load (which is frozen and parsed once). The factory lets
// us exercise the middleware path with arbitrary allowlists, which
// is the actual wiring used by Express.

function runWith(trustedOrigins: readonly string[], req: FakeReq, res: FakeRes): { nextCalled: boolean; statusCode: number; body: unknown } {
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  const middleware = requireSameOriginWith(trustedOrigins);
  middleware(req as unknown as Request, res as unknown as Response, next);
  return {
    nextCalled,
    statusCode: res.statusCode,
    body: res.body,
  };
}

describe("requireSameOriginWith — trusted-origins allowlist wiring", () => {
  const LAN_IPAD = "http://192.168.1.42:5173";
  const trusted = [LAN_IPAD] as const;

  it("permits POST from a listed LAN origin", () => {
    const { nextCalled, statusCode } = runWith(trusted, makeReq("POST", LAN_IPAD), makeRes());
    assert.equal(nextCalled, true);
    assert.equal(statusCode, 200);
  });

  it("still permits POST from localhost regardless of list contents", () => {
    const { nextCalled } = runWith(trusted, makeReq("POST", "http://localhost:5173"), makeRes());
    assert.equal(nextCalled, true);
  });

  it("blocks POST from an Origin that is NOT in the list", () => {
    const { nextCalled, statusCode } = runWith(trusted, makeReq("POST", "http://192.168.1.99:5173"), makeRes());
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  it("blocks POST from `null` Origin even when listed", () => {
    // Hardening invariant: an opaque-context request must NEVER be
    // admitted, regardless of operator misconfiguration.
    const { nextCalled, statusCode } = runWith(["null"], makeReq("POST", "null"), makeRes());
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  it("permits POST with NO Origin header regardless of list", () => {
    // Missing Origin = non-browser caller. Unchanged from the
    // pre-allowlist behaviour, but pinned here so a future refactor
    // can't silently regress it.
    const { nextCalled } = runWith(trusted, makeReq("POST"), makeRes());
    assert.equal(nextCalled, true);
  });

  it("lets GET through regardless of list (safe method)", () => {
    const { nextCalled } = runWith([], makeReq("GET", "http://evil.example"), makeRes());
    assert.equal(nextCalled, true);
  });

  it("empty allowlist preserves the original localhost-only behaviour", () => {
    // Regression guard: the default env (no `MULMOCLAUDE_TRUSTED_ORIGINS`
    // set) must behave identically to the pre-allowlist middleware.
    assert.equal(runWith([], makeReq("POST", "http://localhost:5173"), makeRes()).nextCalled, true);
    assert.equal(runWith([], makeReq("POST", "http://192.168.1.42:5173"), makeRes()).nextCalled, false);
  });
});

// --- Malformed Origin header (array / non-string) ---------------

// Node's `IncomingMessage.headers.origin` is typed `string | string[]
// | undefined`. In practice the parser folds repeated headers into a
// comma-joined string, but the type contract still admits arrays
// (e.g. a custom proxy adapter forwarding multiple `Origin:` lines,
// a test fixture, or a deliberate header-smuggling attempt). The
// guard treats those as present-but-untrustworthy: the localhost-
// binding trust argument only covers the genuine *missing*-Origin
// path, not multi-valued / non-string values.

function makeReqWithRawOrigin(method: string, rawOrigin: unknown): FakeReq {
  return {
    method,
    headers: { origin: rawOrigin },
  };
}

describe("requireSameOriginWith — malformed Origin (non-string / array)", () => {
  const trusted = ["http://192.168.1.42:5173"] as const;

  it("rejects a POST whose Origin is an array (even if one entry is trusted)", () => {
    const { nextCalled, statusCode } = runWith(trusted, makeReqWithRawOrigin("POST", ["http://192.168.1.42:5173", "http://evil.example"]), makeRes());
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  it("rejects a POST whose Origin is an array (no localhost trust shortcut)", () => {
    const { nextCalled, statusCode } = runWith([], makeReqWithRawOrigin("POST", ["http://localhost:5173", "http://localhost:5173"]), makeRes());
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  it("still allows POST when the Origin header is genuinely absent (undefined)", () => {
    // The trusted-missing path stays open for curl / MCP / Node HTTP
    // callers. Without this, a regression here would break the
    // bearer-auth'd MCP subprocess flow.
    const { nextCalled } = runWith([], makeReqWithRawOrigin("POST", undefined), makeRes());
    assert.equal(nextCalled, true);
  });

  it("lets GET through even with an array Origin (safe method bypass)", () => {
    // Safe-method bypass applies before the Origin type check —
    // GETs are idempotent per RFC 9110, no CSRF angle.
    const { nextCalled } = runWith([], makeReqWithRawOrigin("GET", ["x", "y"]), makeRes());
    assert.equal(nextCalled, true);
  });
});

describe("requireSameOrigin (env-bound export) — smoke test", () => {
  // We can't easily mutate `env.trustedOrigins` between tests (it's
  // frozen at module load), so we only smoke-test that the default
  // export is the same shape as the factory output. The actual
  // env-parsing logic is covered in test/server/test_env.ts and the
  // composition is covered by the factory tests above.

  it("is a function with the (req, res, next) middleware shape", () => {
    assert.equal(typeof requireSameOrigin, "function");
    assert.equal(requireSameOrigin.length, 3);
  });

  it("default-bound instance still rejects a foreign POST", () => {
    // With `MULMOCLAUDE_TRUSTED_ORIGINS` unset in the test process,
    // this exercises the production wire-up — anything off-localhost
    // is blocked, just like before the allowlist was introduced.
    const res = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };
    requireSameOrigin(makeReq("POST", "http://evil.example") as unknown as Request, res as unknown as Response, next);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });
});

// --- env-bound wiring: dynamic-import env.ts with MULMOCLAUDE_TRUSTED_ORIGINS

// `env` is a frozen module-level snapshot taken at process boot, so
// we re-import `server/system/env.ts` under different
// `process.env` states (same cache-busting pattern as
// test/server/test_env.ts) and compose the resulting
// `env.trustedOrigins` through the `requireSameOriginWith` factory.
// That mirrors exactly what `server/api/csrfGuard.ts` does at module
// load (`export const requireSameOrigin = requireSameOriginWith(env.trustedOrigins)`),
// so any wiring regression — env-key typo, missed `asCsv` call,
// stale snapshot — is caught here.
//
// We can't simply re-import `csrfGuard.ts` with a query because
// Node's ESM resolver caches `import { env } from "../system/env.js"`
// by the un-queried URL, so the re-imported csrfGuard would still
// capture the original env snapshot. Recomposing via the factory
// from a freshly-loaded env is the equivalent assertion.

const TRUSTED_ORIGINS_KEY = "MULMOCLAUDE_TRUSTED_ORIGINS";
let csrfCacheBuster = 0;

interface FreshEnvModule {
  env: { readonly trustedOrigins: readonly string[] };
}

async function loadEnvBoundMiddleware(envValue: string | undefined): Promise<(req: Request, res: Response, next: NextFunction) => void> {
  const prev = process.env[TRUSTED_ORIGINS_KEY];
  if (envValue === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- key is a fixed string literal
    delete process.env[TRUSTED_ORIGINS_KEY];
  } else {
    process.env[TRUSTED_ORIGINS_KEY] = envValue;
  }
  csrfCacheBuster++;
  try {
    const envMod = (await import(`../../server/system/env.ts?t=csrf-env-${csrfCacheBuster}`)) as FreshEnvModule;
    return requireSameOriginWith(envMod.env.trustedOrigins);
  } finally {
    if (prev === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- key is a fixed string literal
      delete process.env[TRUSTED_ORIGINS_KEY];
    } else {
      process.env[TRUSTED_ORIGINS_KEY] = prev;
    }
  }
}

function callMiddleware(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  method: string,
  origin?: string,
): { nextCalled: boolean; statusCode: number } {
  const res = makeRes();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  middleware(makeReq(method, origin) as unknown as Request, res as unknown as Response, next);
  return { nextCalled, statusCode: res.statusCode };
}

describe("requireSameOrigin (env-bound export) — env-binding integration", () => {
  it("admits a POST whose Origin matches a single MULMOCLAUDE_TRUSTED_ORIGINS entry", async () => {
    const LAN_IPAD = "http://192.168.1.42:5173";
    const middleware = await loadEnvBoundMiddleware(LAN_IPAD);
    const { nextCalled, statusCode } = callMiddleware(middleware, "POST", LAN_IPAD);
    assert.equal(nextCalled, true, "listed LAN origin should be admitted by the env-bound middleware");
    assert.equal(statusCode, 200);
  });

  it("admits a POST whose Origin matches any entry in a comma-separated list", async () => {
    const LAN_IPAD = "http://192.168.1.42:5173";
    const LAN_DESKTOP = "http://192.168.1.50:5173";
    const middleware = await loadEnvBoundMiddleware(`${LAN_IPAD}, ${LAN_DESKTOP}`);
    assert.equal(callMiddleware(middleware, "POST", LAN_IPAD).nextCalled, true);
    assert.equal(callMiddleware(middleware, "POST", LAN_DESKTOP).nextCalled, true);
  });

  it("rejects a POST whose Origin is NOT in the configured list", async () => {
    const middleware = await loadEnvBoundMiddleware("http://192.168.1.42:5173");
    const { nextCalled, statusCode } = callMiddleware(middleware, "POST", "http://192.168.1.99:5173");
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  it("rejects a POST with `Origin: null` even when `null` is listed in the env var", async () => {
    // Regression pin for the iteration-1 hardening: the literal
    // `null` must never be admitted through the env path either.
    const middleware = await loadEnvBoundMiddleware("null,http://192.168.1.42:5173");
    const { nextCalled, statusCode } = callMiddleware(middleware, "POST", "null");
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
  });

  it("falls back to localhost-only behaviour when the env var is unset", async () => {
    const middleware = await loadEnvBoundMiddleware(undefined);
    assert.equal(callMiddleware(middleware, "POST", "http://localhost:5173").nextCalled, true);
    assert.equal(callMiddleware(middleware, "POST", "http://192.168.1.42:5173").nextCalled, false);
  });

  it("treats an empty-string env var as an empty allowlist (localhost-only)", async () => {
    // Pins the `asCsv("")` → `[]` semantic from server/system/env.ts —
    // an explicit `MULMOCLAUDE_TRUSTED_ORIGINS=` line in `.env`
    // behaves the same as no entry at all, not as a permissive
    // wildcard. Regression guard for any future change to the CSV
    // parser that might surface `[""]` here instead of `[]`.
    const middleware = await loadEnvBoundMiddleware("");
    assert.equal(callMiddleware(middleware, "POST", "http://localhost:5173").nextCalled, true);
    assert.equal(callMiddleware(middleware, "POST", "http://192.168.1.42:5173").nextCalled, false);
  });
});
