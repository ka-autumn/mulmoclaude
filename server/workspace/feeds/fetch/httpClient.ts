// Minimal HTTP client for feed retrievers. Feed URLs are model-authored /
// user-supplied, so beyond a User-Agent + timeout this guards against SSRF:
// every URL (and every redirect hop) is DNS-resolved and rejected if it
// points at a loopback / private / link-local / cloud-metadata address.
// Redirects are followed MANUALLY so a public URL can't 302 to an internal
// one and bypass the guard. It does NOT do robots.txt / rate limiting (the
// engine fetches feeds sequentially to stay gentle).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ONE_SECOND_MS } from "../../../utils/time.js";

/** Identifies the bot to site operators. */
export const FEED_USER_AGENT = "MulmoClaude-FeedBot/1.0 (+https://github.com/receptron/mulmoclaude)";

/** Per-request wall-clock cap so a hung server can't wedge a refresh. */
export const DEFAULT_FEED_TIMEOUT_MS = 30 * ONE_SECOND_MS;

/** Cap on redirect hops followed (each re-checked for SSRF). */
const MAX_REDIRECTS = 5;

// CIDR blocks we refuse to fetch: unspecified, loopback, RFC1918, CGNAT,
// and link-local (which also covers the 169.254.169.254 metadata IP).
/* eslint-disable sonarjs/no-hardcoded-ip -- intentional SSRF deny-list of loopback / private / link-local / CGNAT CIDRs */
const BLOCKED_V4_CIDRS: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];
/* eslint-enable sonarjs/no-hardcoded-ip */

function ipv4ToInt(address: string): number | null {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true; // malformed → block
  return BLOCKED_V4_CIDRS.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base) ?? 0;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (baseInt & mask);
  });
}

function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback, unspecified
  if (lower.startsWith("fe80")) return true; // link-local fe80::/10
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower); // IPv4-mapped
  return mapped ? isBlockedIpv4(mapped[1]) : false;
}

/** True for any address we must not fetch (also blocks non-IP input). */
function isBlockedIp(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isBlockedIpv4(address);
  if (kind === 6) return isBlockedIpv6(address);
  return true;
}

/** Reject non-http(s) URLs and URLs that resolve to a private/loopback
 *  address (SSRF guard). Throws with a clear reason; returns void on pass. */
async function assertFetchableUrl(rawUrl: string): Promise<void> {
  if (!/^https?:\/\//i.test(rawUrl)) throw new Error(`refusing non-http(s) URL: ${rawUrl}`);
  const { hostname } = new URL(rawUrl);
  // URL.hostname keeps the brackets for IPv6 literals (`[::1]`); strip them
  // so isIP / the block check see the bare address.
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`refusing to fetch a private/loopback address: ${host}`);
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch (err) {
    throw new Error(`could not resolve host '${host}': ${String(err)}`);
  }
  const blocked = addresses.find((entry) => isBlockedIp(entry.address));
  if (blocked) throw new Error(`refusing to fetch '${host}' — resolves to a private/loopback address (${blocked.address})`);
}

async function fetchOnce(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`feed fetch timed out after ${timeoutMs}ms`, "TimeoutError")), timeoutMs);
  try {
    return await fetch(url, { headers: { "User-Agent": FEED_USER_AGENT }, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

// Follow redirects manually, re-running the SSRF guard on every hop so a
// public URL cannot bounce to an internal target.
async function fetchGuarded(rawUrl: string, timeoutMs: number): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertFetchableUrl(current);
    const response = await fetchOnce(current, timeoutMs);
    const redirect = response.status >= 300 && response.status < 400 && response.status !== 304 ? response.headers.get("location") : null;
    if (!redirect) return response;
    current = new URL(redirect, current).toString();
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS}) starting from ${rawUrl}`);
}

/** Fetch a URL as text, throwing on guard rejection, network error, or non-2xx. */
export async function fetchText(url: string, timeoutMs: number = DEFAULT_FEED_TIMEOUT_MS): Promise<string> {
  const response = await fetchGuarded(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  return response.text();
}

/** Fetch a URL as parsed JSON, throwing on guard rejection, network error, or non-2xx. */
export async function fetchJson(url: string, timeoutMs: number = DEFAULT_FEED_TIMEOUT_MS): Promise<unknown> {
  const response = await fetchGuarded(url, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  return response.json();
}
