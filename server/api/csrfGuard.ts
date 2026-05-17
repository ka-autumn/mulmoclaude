// CSRF defense: reject cross-origin state-changing requests.
//
// Complements the CORS / localhost-bind hardening in #148. With
// those in place, the browser refuses to expose response bodies
// to cross-origin callers, but the **request itself** still
// reaches the server. That's enough for a fire-and-forget side
// effect (e.g. `POST /api/chat-index/rebuild` spawning claude CLI
// in the background) to be triggered from an attacker page.
//
// This middleware checks the Origin header on every non-safe
// method and rejects anything that didn't come from localhost
// (or an operator-allowlisted Origin — see `MULMOCLAUDE_TRUSTED_ORIGINS`
// in server/system/env.ts and plans/feat-csrf-trusted-origins.md).
// Requests with NO Origin header are allowed — that's how
// non-browser callers (MCP tools, curl, CLI scripts) look, and
// they're trustable only because the server binds to 127.0.0.1
// (#148) so remote traffic can't reach us at all.
//
// Full design + threat model: plans/done/fix-server-csrf-origin-check.md

import type { Request, Response, NextFunction } from "express";
import { log } from "../system/logger/index.js";
import { env } from "../system/env.js";
import { forbidden } from "../utils/httpError.js";

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

const LOCALHOST_HOSTNAMES: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  // IPv6 loopback. Note `new URL("http://[::1]:5173").hostname`
  // returns the literal string `[::1]` **with brackets** (the
  // Node URL parser preserves them). So that's what we match.
  // The un-bracketed `::1` is kept alongside as belt-and-
  // suspenders in case a different parser implementation (older
  // Node, a shim) ever strips them.
  "[::1]",
  "::1",
]);

// Decide whether an Origin header value points at the same
// machine. Accepts scheme + hostname + optional port; rejects
// `null`, empty, malformed, subdomain-lookalikes, non-loopback
// IPs, and non-HTTP schemes. Exported for test.
export function isLocalhostOrigin(origin: string): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return LOCALHOST_HOSTNAMES.has(url.hostname);
}

// Opt-in allowlist for cross-origin state-changing requests.
// `trustedOrigins` is the user-configured list from
// `MULMOCLAUDE_TRUSTED_ORIGINS` (see server/system/env.ts). The match
// is a verbatim string comparison against the request `Origin`
// header, so the configured value must include the scheme and port
// and must NOT have a trailing slash (browsers never include one in
// `Origin`). Malformed entries silently fail to match — there is no
// startup-time validator because that would turn a typo into a
// boot-blocking error.
//
// Exported alongside `isLocalhostOrigin` so unit tests can pin the
// pure check without spinning up Express.
export function isTrustedOrigin(origin: string, trustedOrigins: readonly string[]): boolean {
  if (!origin) return false;
  return trustedOrigins.includes(origin);
}

// Composite check used by `requireSameOrigin` below — extracted as a
// pure function so the security-critical branching can be pinned by
// unit tests without spinning up Express. An Origin is allowed iff
// it is a loopback address OR explicitly listed by the operator.
export function isAllowedOrigin(origin: string, trustedOrigins: readonly string[]): boolean {
  return isLocalhostOrigin(origin) || isTrustedOrigin(origin, trustedOrigins);
}

// Express middleware. Safe-method requests (GET / HEAD / OPTIONS)
// pass through unchecked — they have no side effects per RFC 9110,
// and OPTIONS is required for CORS preflights anyway (even though
// we no longer advertise CORS, browsers still issue the preflight
// before some requests). Non-safe requests need an Origin header
// that resolves to localhost / trusted-list OR no Origin header at
// all.
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const { origin } = req.headers;
  if (typeof origin !== "string") {
    // Missing Origin: non-browser caller (curl, MCP, Node HTTP
    // libraries). Trusted because the server binds to 127.0.0.1.
    next();
    return;
  }
  if (isAllowedOrigin(origin, env.trustedOrigins)) {
    next();
    return;
  }
  // Security-relevant event: an upstream caller just hit us from
  // off-localhost with a state-changing method. Log it at warn so
  // operators see it in both the console and the rotating file
  // log even if the attack is otherwise silent on the wire.
  log.warn("csrf", "rejected cross-origin request", {
    origin,
    method: req.method,
    path: req.path,
  });
  forbidden(res, "Forbidden: cross-origin request rejected");
}
