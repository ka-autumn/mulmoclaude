// Boot-time + per-agent-run preflight for external MCP servers
// (#1352).
//
// Built-in MCP-only tools have always done this via
// `isMcpToolEnabled` + `logMcpStatus` (server/index.ts:750) — when an
// env var listed in `requiredEnv` is unset, the tool drops out of
// the list and the operator sees an info log explaining why. External
// MCP servers (the `mcp.json` ones — Notion / GitHub / Linear /…)
// had no equivalent, so a half-configured catalog entry would still
// spawn a subprocess and every tool call would fail silently with
// 401. This module is the parity fix.
//
// The catalog (`src/config/mcpCatalog.ts`) declares which config
// fields are `required: true`. The user's saved `mcp.json` holds
// resolved values. Cross-referencing the two tells us which servers
// are ready to boot and which should be excluded from the config
// handed to Claude Code.

import type { McpServerSpec } from "../system/config.js";
import { findCatalogEntry, requiredKeysOf, type McpCatalogEntry } from "../../src/config/mcpCatalog.js";
import { log } from "../system/logger/index.js";

export interface McpPreflightResult {
  /** Servers that passed preflight, keyed by the same id used in
   *  the input. Safe to pass straight into `prepareUserServers` /
   *  `buildMcpConfig`. */
  ready: Record<string, McpServerSpec>;
  /** Servers excluded by preflight, with the catalog field keys
   *  whose values were unset / unresolved. */
  skipped: { serverId: string; missing: string[] }[];
}

const PLACEHOLDER_PATTERN = /\$\{([A-Z0-9_]+)\}/g;
const SINGLE_PLACEHOLDER = /^\$\{([A-Z0-9_]+)\}$/;

/** Returns the catalog field keys whose values are unresolved in
 *  the user's saved spec — `""`, missing, or still carrying a
 *  `${KEY}` placeholder.
 *
 *  Mapping goes: catalog `configSchema[].key` → spec env key, via
 *  the catalog template's env value. E.g. catalog template
 *  `env: { NOTION_TOKEN: "${NOTION_API_KEY}" }` binds the field
 *  `NOTION_API_KEY` to the env key `NOTION_TOKEN`. We then check
 *  the user's saved spec's `env.NOTION_TOKEN`.
 *
 *  HTTP-type catalog entries currently have no required fields
 *  (deepwiki is empty) — they fall through with `[]`. When a
 *  required HTTP header lands in the catalog, extend this helper. */
export function findMissingRequiredEnv(entry: McpCatalogEntry, spec: McpServerSpec): string[] {
  // Transport mismatch (e.g. catalog stdio entry but user pointed
  // the same id at an HTTP URL) means the catalog's env template
  // doesn't apply to this user spec — see `preflightUserServers`'s
  // header comment for the rationale. Guard here too so callers that
  // skip the wrapper still get the correct answer.
  if (entry.spec.type !== spec.type) return [];
  if (entry.spec.type !== "stdio" || !entry.spec.env) return [];
  const fieldToEnvKey = buildFieldToEnvKeyMap(entry.spec.env);
  const userEnv = spec.type === "stdio" ? spec.env : undefined;
  const required = requiredKeysOf(entry);
  const missing: string[] = [];
  for (const fieldKey of required) {
    const envKey = fieldToEnvKey.get(fieldKey);
    if (envKey === undefined) continue;
    const value = userEnv?.[envKey];
    if (!isResolved(value)) missing.push(fieldKey);
  }
  return missing;
}

function buildFieldToEnvKeyMap(templateEnv: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [envKey, value] of Object.entries(templateEnv)) {
    const match = SINGLE_PLACEHOLDER.exec(value);
    if (match) out.set(match[1], envKey);
  }
  return out;
}

function isResolved(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  // Trim before the empty check — `"   "` (whitespace-only) is just
  // as misconfigured as `""` and would otherwise let preflight
  // greenlight a server that can't actually authenticate (Codex
  // review on #1355).
  if (value.trim().length === 0) return false;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return !PLACEHOLDER_PATTERN.test(value);
}

/** Filter user MCP servers by checking the catalog's required
 *  fields. Servers without a catalog match (= user-added custom
 *  servers) pass through — we have no metadata to validate them
 *  against.
 *
 *  Two other shapes also pass through unvalidated:
 *
 *  - `enabled: false` entries (CodeRabbit review on #1355). They're
 *    intentionally disabled by the user; running them through
 *    preflight produces spurious "missing required config" warnings
 *    AND skews the boot summary's `started` count. The downstream
 *    `prepareUserServers` already drops disabled entries before
 *    spawning anything, so we just forward them.
 *
 *  - Type-mismatched catalog hits. If the user's mcp.json has
 *    `gmail: { type: "http", url: ... }` but the catalog's `gmail`
 *    entry is `type: "stdio"` with env templates, the catalog's
 *    requirement list doesn't apply to the user's spec — they've
 *    pointed `gmail` at a different transport, effectively making it
 *    a custom server. Treat as custom (no preflight) rather than
 *    false-flagging missing env. */
export function preflightUserServers(userServers: Record<string, McpServerSpec> | undefined | null): McpPreflightResult {
  const ready: Record<string, McpServerSpec> = {};
  const skipped: McpPreflightResult["skipped"] = [];
  // Defensive default (Sourcery review on #1355): a malformed
  // mcp.json — or a future refactor that nulls `mcpServers` — would
  // otherwise throw `Object.entries(null)` at boot.
  for (const [serverId, spec] of Object.entries(userServers ?? {})) {
    if (spec.enabled === false) {
      ready[serverId] = spec;
      continue;
    }
    const entry = findCatalogEntry(serverId);
    if (entry === null || entry.spec.type !== spec.type) {
      ready[serverId] = spec;
      continue;
    }
    const missing = findMissingRequiredEnv(entry, spec);
    if (missing.length > 0) {
      skipped.push({ serverId, missing: missing.sort() });
      continue;
    }
    ready[serverId] = spec;
  }
  return { ready, skipped };
}

// Dedup cache so per-agent-run logging doesn't repeat identical
// state across chat turns. Boot-time logging bypasses the cache
// (always logs once on startup).
const loggedKeys = new Set<string>();

function dedupKey(entry: { serverId: string; missing: string[] }): string {
  return `${entry.serverId}:${entry.missing.join(",")}`;
}

/** Emit structured logs for the preflight outcome.
 *  - `source: "boot"`  — runs once at startup; always logs.
 *  - `source: "agent-run"` — runs per agent invocation; dedups
 *    identical (server, missing-keys) tuples so a Settings UI
 *    change shows once and stale state stays quiet. */
export function logPreflightResult(result: McpPreflightResult, source: "boot" | "agent-run"): void {
  const isBoot = source === "boot";
  for (const entry of result.skipped) {
    const key = dedupKey(entry);
    if (!isBoot && loggedKeys.has(key)) continue;
    loggedKeys.add(key);
    log.warn("mcp", "preflight: skipping server — missing required config", {
      source,
      serverId: entry.serverId,
      missing: entry.missing,
    });
  }
  if (isBoot) {
    log.info("mcp", "preflight summary", {
      started: Object.keys(result.ready).length,
      skipped: result.skipped.length,
    });
  }
}

/** Test seam — reset the dedup cache between tests so each case
 *  sees a fresh logging state. */
export function _resetPreflightLogCache(): void {
  loggedKeys.clear();
}
