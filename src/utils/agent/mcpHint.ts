// Frontend-side helper that turns an `mcp__<server>__<tool>` name
// into a structured hint the right-sidebar can render alongside an
// MCP tool's error body (#1354).
//
// The hint is *user-facing only* — pulled from the same `mcpCatalog`
// the Settings UI uses, so it stays consistent with whatever the
// user installed via Settings. Non-MCP tools and custom (off-catalog)
// servers return `null` and the UI falls back to the plain error
// chip.

import { findCatalogEntry, requiredKeysOf } from "../../config/mcpCatalog";

export interface McpHint {
  /** Catalog id parsed from the tool name (`notion`, `github`, …). */
  server: string;
  /** i18n key for the server's localised display name. Render via
   *  `t(displayNameKey)` in the consuming component. */
  displayNameKey: string;
  /** External setup-guide URL when the catalog entry provides one. */
  setupGuideUrl?: string;
  /** Sorted list of `configSchema[].key` values the catalog marks
   *  `required: true`. Empty when the entry has no required fields. */
  requiredKeys: string[];
}

// `[A-Za-z0-9-]+` matches all current catalog ids (e.g. `notion`,
// `google-maps`, `weather-open-meteo`). No underscore — the trailing
// `__<tool>` separator would otherwise be ambiguous.
const MCP_TOOL_NAME_PATTERN = /^mcp__([A-Za-z0-9-]+)__/;

/** Returns a structured hint when `toolName` references an MCP
 *  server present in the catalog; `null` otherwise. */
export function extractMcpHint(toolName: string): McpHint | null {
  const match = MCP_TOOL_NAME_PATTERN.exec(toolName);
  if (match === null) return null;
  const [, server] = match;
  const entry = findCatalogEntry(server);
  if (entry === null) return null;
  const requiredKeys = [...requiredKeysOf(entry)].sort();
  const hint: McpHint = {
    server,
    displayNameKey: entry.displayName,
    requiredKeys,
  };
  if (entry.setupGuideUrl) hint.setupGuideUrl = entry.setupGuideUrl;
  return hint;
}
