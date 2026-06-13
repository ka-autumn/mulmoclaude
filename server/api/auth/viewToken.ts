// Capability tokens for custom collection views (see
// plans/feat-collections-custom-views.md).
//
// A custom view is LLM-authored HTML rendered in a sandboxed
// (`allow-scripts`, opaque-origin) iframe. It must NOT receive the global
// bearer token — that would grant it the whole `/api/*` surface. Instead the
// authenticated parent mints a **scoped, short-lived, signed** token that
// authorizes only the collection's `view-data` endpoint, for one slug, with
// an explicit capability set (`read` and/or `write`). The view sends it as
// `Authorization: Bearer <token>`; `requireViewToken` verifies it.
//
// Stateless + signed: the token is `base64url(payload).HMAC`, keyed by the
// per-startup bearer token (`getCurrentToken`). No server-side store, and a
// restart invalidates every outstanding view token (the key changes) — the
// same lifecycle as the global token. Forging requires the key, which an
// attacker on a loopback-bound server cannot read.
//
// This is the ONLY guard on the view-data routes: they are exempted from the
// global bearer + CSRF middleware (the iframe carries no global token and
// sends `Origin: null`), so the unguessable scoped token is what stands in
// for both. See the exemptions in `server/index.ts`.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getCurrentToken } from "./token.js";
import { unauthorized } from "../../utils/httpError.js";
import { ONE_HOUR_MS } from "../../utils/time.js";

export type ViewCapability = "read" | "write";

const CAPABILITIES: readonly ViewCapability[] = ["read", "write"];

function isCapability(value: unknown): value is ViewCapability {
  return value === "read" || value === "write";
}

/** How long a minted view token stays valid. The parent re-mints on each
 *  render, so a view that outlives this reloads with a fresh token. */
export const VIEW_TOKEN_TTL_MS = ONE_HOUR_MS;

const BEARER_PREFIX = "Bearer ";

interface ViewTokenPayload {
  /** The one collection slug this token authorizes. */
  slug: string;
  /** What the token may do against the data endpoint. */
  caps: ViewCapability[];
  /** Absolute expiry, ms since epoch. */
  exp: number;
}

function signPayload(payloadB64: string, key: string): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

/** Clamp a view's *requested* capabilities to what the view *declared* in
 *  its schema registration — a view registered `["read"]` can never be
 *  minted a `write` token, even if the frontend asks. Undefined declared ⇒
 *  the least-privilege default `["read"]`; undefined requested ⇒ grant the
 *  full declared set. The result is `declared ∩ requested`. */
export function clampCapabilities(declared: ViewCapability[] | undefined, requested: ViewCapability[] | undefined): ViewCapability[] {
  const declaredCaps = declared && declared.length > 0 ? declared : (["read"] as ViewCapability[]);
  const requestedCaps = requested && requested.length > 0 ? requested : declaredCaps;
  return declaredCaps.filter((cap) => requestedCaps.includes(cap));
}

/** Mint a signed token for `slug` granting `caps`, valid for
 *  {@link VIEW_TOKEN_TTL_MS}. Returns null when the server has no bearer
 *  key yet (pre-bootstrap) — callers surface that as "token unavailable". */
export function mintViewToken(slug: string, caps: ViewCapability[], nowMs: number = Date.now()): { token: string; exp: number } | null {
  const key = getCurrentToken();
  if (key === null) return null;
  const exp = nowMs + VIEW_TOKEN_TTL_MS;
  const payload: ViewTokenPayload = { slug, caps, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${payloadB64}.${signPayload(payloadB64, key)}`, exp };
}

/** Verify a token's signature + expiry and return its payload, or null for
 *  any failure (bad shape, tampered payload, wrong signature, expired, or
 *  no server key). Never throws. */
export function verifyViewToken(token: string, nowMs: number = Date.now()): ViewTokenPayload | null {
  const key = getCurrentToken();
  if (key === null) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = signPayload(payloadB64, key);
  // Length-guard before timingSafeEqual (it throws on length mismatch);
  // the lengths are non-secret (fixed-size HMAC), so the early-out leaks
  // nothing useful.
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.slug !== "string" || typeof candidate.exp !== "number") return null;
  if (!Array.isArray(candidate.caps) || !candidate.caps.every(isCapability)) return null;
  if (nowMs >= candidate.exp) return null;
  return { slug: candidate.slug, caps: candidate.caps as ViewCapability[], exp: candidate.exp };
}

/** Express middleware factory guarding a `view-data` route: require a valid
 *  scoped token whose `slug` matches the route param and whose capability
 *  set includes `action`. 401 (generic message, like `bearerAuth`) on any
 *  failure. */
export function requireViewToken(action: ViewCapability) {
  return function requireViewTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      unauthorized(res, "unauthorized");
      return;
    }
    const payload = verifyViewToken(header.slice(BEARER_PREFIX.length));
    if (!payload || payload.slug !== req.params.slug || !payload.caps.includes(action)) {
      unauthorized(res, "unauthorized");
      return;
    }
    next();
  };
}

// Matches a view-data request path with or without the `/api` mount prefix:
// the global CSRF middleware sees `/api/collections/<slug>/view-data` while
// the `/api`-mounted bearer closure sees `/collections/<slug>/view-data`.
// Anchored both ends; `[^/]+` is the slug segment.
const VIEW_DATA_PATH_RE = /^\/(?:api\/)?collections\/[^/]+\/view-data$/;

/** True for the view-data endpoint path (either mount base). Used in
 *  `server/index.ts` to exempt these routes from the global bearer + CSRF
 *  guards — they are guarded instead by {@link requireViewToken}. */
export function isViewDataPath(pathname: string): boolean {
  return VIEW_DATA_PATH_RE.test(pathname);
}

export { CAPABILITIES as VIEW_CAPABILITIES };
