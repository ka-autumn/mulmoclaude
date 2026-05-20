// Workspace-scoped user settings, loaded fresh on every agent
// invocation so the UI can change things without a server restart.
//
// Layout under <workspace>/config/ (post-#284):
//   settings.json   ← AppSettings (this file)
//   mcp.json        ← user-defined MCP servers
//
// All helpers tolerate missing / malformed files by falling back to
// defaults. Writers perform an atomic replace (tmp + rename) so a
// reader never observes a half-written file.

import { mkdirSync } from "fs";
import path from "path";
import { log } from "./logger/index.js";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { writeFileAtomicSync } from "../utils/files/atomic.js";
import { readTextSafeSync } from "../utils/files/safe.js";
import { isRecord, isStringArray, isStringRecord } from "../utils/types.js";

// Reasoning-effort levels accepted by `claude --effort`. Kept as a
// closed union so the validator + UI stay in lockstep; new levels
// added by the CLI must be mirrored here intentionally.
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export interface AppSettings {
  // Extra tool names appended to BASE_ALLOWED_TOOLS in
  // server/agent/config.ts#buildCliArgs. Typical entries are
  // Claude Code built-in MCP prefixes like
  //   "mcp__claude_ai_Gmail"
  //   "mcp__claude_ai_Google_Calendar"
  extraAllowedTools: string[];

  // Google Maps JS API key. Pasted via Settings → Map tab and used
  // by `@gui-chat-plugin/google-map`'s View — passed through as a
  // prop from `App.vue`. Stored verbatim (local-desktop threat
  // model, same as Spotify token persistence).
  googleMapsApiKey?: string;

  // Photo-EXIF auto-capture (#1222 PR-A). When `autoCapture` is true
  // (the default), every saved attachment with an image MIME runs
  // through `readPhotoExif` and a sidecar JSON lands at
  // `data/locations/<YYYY>/<MM>/<id>.json`. Users opt out via
  // Settings → Privacy when they don't want GPS metadata captured
  // automatically (the future `manageMap` `extractExif` tool can
  // still read EXIF on demand).
  photoExif?: {
    autoCapture: boolean;
  };

  // Reasoning effort passed through as `claude --effort <level>` on
  // every agent invocation (#1323). Unset → flag is omitted →
  // Claude's own default.
  effortLevel?: EffortLevel;
}

const DEFAULT_SETTINGS: AppSettings = { extraAllowedTools: [] };

export const SETTINGS_FILE_NAME = "settings.json";
export const MCP_FILE_NAME = "mcp.json";

export function configsDir(): string {
  return WORKSPACE_PATHS.configs;
}

export function settingsPath(): string {
  return path.join(configsDir(), SETTINGS_FILE_NAME);
}

export function mcpConfigPath(): string {
  return path.join(configsDir(), MCP_FILE_NAME);
}

export function ensureConfigsDir(): void {
  mkdirSync(configsDir(), { recursive: true });
}

function isPhotoExifSettings(value: unknown): value is { autoCapture: boolean } {
  return isRecord(value) && typeof value.autoCapture === "boolean";
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

export function isAppSettings(value: unknown): value is AppSettings {
  if (!isRecord(value)) return false;
  if (!isStringArray(value.extraAllowedTools)) return false;
  if (value.googleMapsApiKey !== undefined && typeof value.googleMapsApiKey !== "string") return false;
  if (value.photoExif !== undefined && !isPhotoExifSettings(value.photoExif)) return false;
  if (value.effortLevel !== undefined && !isEffortLevel(value.effortLevel)) return false;
  return true;
}

/** A PUT-payload validator: every field optional, but if present
 *  it must match the AppSettings shape. Distinct from
 *  `isAppSettings` (which insists on the full storage shape) so a
 *  tab that owns one field can patch it without echoing back fields
 *  it doesn't manage. The PUT handler merges the patch onto the
 *  current on-disk settings before saving.
 *
 *  Why two validators: the storage-shape invariant
 *  (`extraAllowedTools` is always an array) is preserved by
 *  `loadSettings` (DEFAULT_SETTINGS) + `saveSettings` (payload
 *  ensures the array). Loosening the storage validator would
 *  weaken that guarantee for code reading from `loadSettings`. */
/** Wire shape for a settings PUT patch. Mirrors `Partial<AppSettings>`
 *  but lets nullable fields carry `null` as a "clear me" sentinel —
 *  callers normalise via `normaliseAppSettingsPatch` before merging
 *  into the storage shape (#1323). */
export type AppSettingsPatch = Partial<Omit<AppSettings, "effortLevel">> & {
  effortLevel?: EffortLevel | null;
};

/** Convert a wire patch to the storage-shape patch by dropping any
 *  `null` sentinels (which mean "clear" for the corresponding field). */
export function normaliseAppSettingsPatch(patch: AppSettingsPatch): Partial<AppSettings> {
  const { effortLevel, ...rest } = patch;
  const out: Partial<AppSettings> = { ...rest };
  if (effortLevel !== null && effortLevel !== undefined) {
    out.effortLevel = effortLevel;
  }
  return out;
}

export function isAppSettingsPatch(value: unknown): value is AppSettingsPatch {
  if (!isRecord(value)) return false;
  if (value.extraAllowedTools !== undefined && !isStringArray(value.extraAllowedTools)) return false;
  if (value.googleMapsApiKey !== undefined && typeof value.googleMapsApiKey !== "string") return false;
  if (value.photoExif !== undefined && !isPhotoExifSettings(value.photoExif)) return false;
  if (value.effortLevel !== undefined && value.effortLevel !== null && !isEffortLevel(value.effortLevel)) return false;
  return true;
}

function parseSettingsRaw(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    log.warn("config", "settings.json is not valid JSON — using defaults", { file, error: String(err) });
    return null;
  }
}

/** Defensive copy — callers shouldn't be able to mutate the file on
 *  disk by mutating the returned object. New optional fields added
 *  to `AppSettings` need a line here too (loadSettings is the choke
 *  point that propagates them). */
function cloneAppSettings(settings: AppSettings): AppSettings {
  const copy: AppSettings = { extraAllowedTools: [...settings.extraAllowedTools] };
  if (settings.googleMapsApiKey !== undefined) {
    copy.googleMapsApiKey = settings.googleMapsApiKey;
  }
  if (settings.photoExif !== undefined) {
    copy.photoExif = { autoCapture: settings.photoExif.autoCapture };
  }
  if (settings.effortLevel !== undefined) {
    copy.effortLevel = settings.effortLevel;
  }
  return copy;
}

/** Read the photo-exif auto-capture flag with the documented
 *  default of `true`. Centralises the "missing block ⇒ on" rule so
 *  the post-save hook + future Settings UI stay aligned. */
export function isPhotoExifAutoCaptureEnabled(settings: AppSettings): boolean {
  return settings.photoExif?.autoCapture ?? true;
}

export function loadSettings(): AppSettings {
  const file = settingsPath();
  const raw = readTextSafeSync(file);
  if (raw === null) return { ...DEFAULT_SETTINGS };
  const parsed = parseSettingsRaw(raw, file);
  if (parsed === null) return { ...DEFAULT_SETTINGS };
  // Accept the partial-patch shape, not just the full storage shape.
  // A user who hand-edits `settings.json` to only set the fields they
  // care about (`{ "photoExif": { "autoCapture": false } }` per the
  // PR-A docs) shouldn't have their opt-out silently ignored just
  // because `extraAllowedTools` is omitted. Missing fields fall back
  // to DEFAULT_SETTINGS; only structurally-invalid payloads (wrong
  // type on a present field) trigger the schema-warning fallback.
  // (Codex review on PR #1247.)
  if (!isAppSettingsPatch(parsed)) {
    log.warn("config", "settings.json does not match AppSettings schema — using defaults", { file });
    return { ...DEFAULT_SETTINGS };
  }
  return cloneAppSettings({ ...DEFAULT_SETTINGS, ...normaliseAppSettingsPatch(parsed) });
}

export function saveSettings(settings: AppSettings): void {
  if (!isAppSettings(settings)) {
    throw new Error("saveSettings: invalid AppSettings shape");
  }
  ensureConfigsDir();
  const payload: AppSettings = { extraAllowedTools: [...settings.extraAllowedTools] };
  if (settings.googleMapsApiKey !== undefined) {
    payload.googleMapsApiKey = settings.googleMapsApiKey;
  }
  if (settings.photoExif !== undefined) {
    payload.photoExif = { autoCapture: settings.photoExif.autoCapture };
  }
  if (settings.effortLevel !== undefined) {
    payload.effortLevel = settings.effortLevel;
  }
  const serialised = JSON.stringify(payload, null, 2);
  writeFileAtomicSync(settingsPath(), `${serialised}\n`, { mode: 0o600 });
}

// ── MCP user-defined servers ────────────────────────────────────
//
// Stored under <workspace>/config/mcp.json in the Claude CLI's
// standard `--mcp-config` shape so the file is portable:
//   { "mcpServers": { "<id>": <McpServerSpec> } }
//
// A server is either HTTP (remote, always Docker-safe) or stdio
// (local command). See plans/done/feat-web-settings-ui.md for Phase 2a /
// 2b scope notes.

export interface McpHttpSpec {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface McpStdioSpec {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  /** Opt-in (#1421 Phase B): when true AND the agent runs in Docker
   *  sandbox mode, this stdio server is NOT dropped — instead it is
   *  spawned on the HOST behind a stdio↔HTTP gateway and the
   *  sandboxed agent reaches it over `host.docker.internal`. This
   *  DELIBERATELY escapes the sandbox for this one server; the
   *  Settings UI requires an explicit risk acknowledgment to set
   *  it. Unset / false → default behavior (dropped + warned). */
  hostExecInDocker?: boolean;
}

export type McpServerSpec = McpHttpSpec | McpStdioSpec;

// UI-friendly flat array form. Storage uses the record form; conversion
// helpers below keep the two in sync.
export interface McpServerEntry {
  id: string;
  spec: McpServerSpec;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerSpec>;
}

const DEFAULT_MCP: McpConfigFile = { mcpServers: {} };

// Accepts only allow-listed commands for stdio servers — user input
// that asks Claude to spawn arbitrary binaries (eg. a shell one-liner)
// is rejected upstream. Anything that needs more tools should go in
// the sandbox image (see #162), not here.
const STDIO_COMMAND_ALLOWLIST = new Set(["npx", "node", "tsx"]);

// Accept only http: / https: URLs. Rejects malformed strings, other
// protocols (ftp:, file:, javascript:, ...), and empty values so bad
// endpoints can't be persisted even if a client bypasses the UI.
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isMcpHttpSpec(value: unknown): value is McpHttpSpec {
  if (!isRecord(value)) return false;

  if (value.type !== "http") return false;
  if (typeof value.url !== "string" || !isHttpUrl(value.url)) return false;
  if (value.headers !== undefined && !isStringRecord(value.headers)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return false;
  return true;
}

export function isMcpStdioSpec(value: unknown): value is McpStdioSpec {
  if (!isRecord(value)) return false;

  if (value.type !== "stdio") return false;
  if (typeof value.command !== "string" || value.command.length === 0) return false;
  if (!STDIO_COMMAND_ALLOWLIST.has(value.command)) return false;
  if (value.args !== undefined && !isStringArray(value.args)) return false;
  if (value.env !== undefined && !isStringRecord(value.env)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") return false;
  if (value.hostExecInDocker !== undefined && typeof value.hostExecInDocker !== "boolean") return false;
  return true;
}

export function isMcpServerSpec(value: unknown): value is McpServerSpec {
  return isMcpHttpSpec(value) || isMcpStdioSpec(value);
}

// Workspace id must be slug-shaped so it survives being used as the
// mcpServers map key and in the `mcp__<id>__<tool>` tool naming.
//
// Consecutive `__` is forbidden inside the id because `__` is the
// delimiter in the tool-name encoding — a server id like `foo__bar`
// produces `mcp__foo__bar__tool`, which is ambiguous between server
// `foo` (tool `bar__tool`) and server `foo__bar` (tool `tool`).
// Forbidding `__` in the id keeps the convention unambiguous
// everywhere (Codex review on #1356).
const MCP_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export function isMcpServerId(value: unknown): value is string {
  return typeof value === "string" && MCP_ID_RE.test(value) && !value.includes("__");
}

export function isMcpConfigFile(value: unknown): value is McpConfigFile {
  if (!isRecord(value)) return false;

  const servers = value.mcpServers;
  if (!isRecord(servers)) return false;
  for (const [serverId, spec] of Object.entries(servers)) {
    if (!isMcpServerId(serverId)) return false;
    if (!isMcpServerSpec(spec)) return false;
  }
  return true;
}

export function loadMcpConfig(): McpConfigFile {
  const file = mcpConfigPath();
  const raw = readTextSafeSync(file);
  if (raw === null) return { mcpServers: { ...DEFAULT_MCP.mcpServers } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    log.warn("config", "mcp.json is not valid JSON — using defaults", {
      file,
      error: String(err),
    });
    return { mcpServers: {} };
  }
  if (!isMcpConfigFile(parsed)) {
    log.warn("config", "mcp.json does not match McpConfigFile schema — using defaults", { file });
    return { mcpServers: {} };
  }
  return parsed;
}

export function saveMcpConfig(cfg: McpConfigFile): void {
  if (!isMcpConfigFile(cfg)) {
    throw new Error("saveMcpConfig: invalid McpConfigFile shape");
  }
  ensureConfigsDir();
  const serialised = JSON.stringify(cfg, null, 2);
  writeFileAtomicSync(mcpConfigPath(), `${serialised}\n`, { mode: 0o600 });
}

// Flatten storage form to UI-friendly array.
export function toMcpEntries(cfg: McpConfigFile): McpServerEntry[] {
  return Object.entries(cfg.mcpServers).map(([serverId, spec]) => ({ id: serverId, spec }));
}

// Re-inflate UI-friendly array to storage form. Duplicate ids are
// rejected so the record shape stays lossless.
export function fromMcpEntries(entries: McpServerEntry[]): McpConfigFile {
  const out: Record<string, McpServerSpec> = {};
  for (const { id, spec } of entries) {
    if (!isMcpServerId(id)) {
      throw new Error(`invalid MCP server id: ${JSON.stringify(id)}`);
    }
    if (id in out) {
      throw new Error(`duplicate MCP server id: ${id}`);
    }
    if (!isMcpServerSpec(spec)) {
      throw new Error(`invalid MCP server spec for id ${id}`);
    }
    out[id] = spec;
  }
  return { mcpServers: out };
}
