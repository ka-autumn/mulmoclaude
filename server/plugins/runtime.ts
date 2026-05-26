// Plugin runtime construction — the per-plugin scoped object
// `definePlugin(setup)` factories receive at load time (#1110).
//
// Every helper closes over `pkgName` so a plugin's pubsub channel,
// data dir, log prefix etc. cannot leak across plugins. Path arguments
// to `files.{data,config}` are normalised to POSIX, then anchored
// inside the plugin's scope root via `ensureInsideBase` — so misuse of
// `node:path` on Windows still works and `"../../etc/passwd"` is
// rejected.
//
// This module is server-side only. The browser-side counterpart lives
// at `src/utils/plugin/runtime.ts`.

import path from "node:path";
import { readFile, readdir, stat as fsStat, unlink as fsUnlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FileOps, PluginRuntime } from "gui-chat-protocol";

import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { errorMessage } from "../utils/errors.js";
import { log as hostLog, type Logger } from "../system/logger/index.js";
import { ensureInsideBase } from "./runtime-loader.js";
import { ONE_SECOND_MS } from "../utils/time.js";
import type { IPubSub } from "../events/pub-sub/index.js";
import * as notifierEngine from "../notifier/engine.js";
import type { MulmoclaudeRuntime, NotifierRuntimeApi } from "../notifier/runtime-api.js";
import type { ITaskManager } from "../events/task-manager/index.js";
import type { TasksRuntimeApi } from "./runtime-tasks-api.js";
import type { ChatRuntimeApi } from "./runtime-chat-api.js";
import { startChat } from "../api/routes/agent.js";
import { PLUGIN_SESSION_ORIGIN_PREFIX } from "../../src/types/session.js";
import { BUILTIN_ROLE_IDS } from "../../src/config/roles.js";

const DEFAULT_FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;

// ─────────────────────────────────────────────────────────────────────
// Path normalisation contract (see plans/done/feat-plugin-runtime-extensions-1110.md)
//
//   1. Replace `\` with `/` (Windows path.join leak repair).
//   2. `path.posix.normalize` (folds `..`, `.`, `//`).
//   3. Reject if the normalised form starts with `..` or `/`
//      (would escape the scope root or be absolute).
//   4. `path.join(scopeRoot, ...segments)` — platform-aware join so
//      the returned absolute path uses the host OS separator
//      (backslashes on Windows, forward slashes on POSIX). Critical
//      for `ensureInsideBase` to accept the result.
//
// Plugin authors should never need `node:path`; the platform meets
// them where they are even if they mis-import it on Windows.
// ─────────────────────────────────────────────────────────────────────

/** Resolve a plugin-supplied path to an absolute path inside the
 *  plugin's scope root. Throws on traversal. Exported for tests.
 *
 *  Cross-platform: `scopeRoot` is the host OS's native form (drive
 *  letter + backslashes on Windows, forward slashes on POSIX). The
 *  user-supplied `rel` is POSIX-relative by contract; we sanitise
 *  for the lexical traversal check via `path.posix.*`, then join
 *  with `path.join` so the returned absolute path is in the host's
 *  native form (which `ensureInsideBase` requires). */
export function normalizePluginPath(scopeRoot: string, rel: string): string {
  // Defang Windows path.join output and any mixed-separator inputs.
  const slashed = rel.replace(/\\/g, "/");
  // Fold `..` / `.` / repeated `/` lexically (no fs touch yet).
  const normalised = path.posix.normalize(slashed);
  // Reject lexically — anything that escapes the scope root after
  // normalisation either starts with `..` (parent-traversal) or is
  // absolute (`/etc/passwd`). `path.posix.normalize` produces `..`
  // alone if the input is `..` itself, hence the equality branch.
  if (normalised === ".." || normalised.startsWith("../") || normalised.startsWith("/")) {
    throw new Error(`path escapes plugin scope: ${rel}`);
  }
  const segments = normalised === "." ? [] : normalised.split("/");
  // `path.join` (platform-aware) so the result uses the host
  // separator. On Windows that's backslashes; on POSIX, forward
  // slashes — matching `scopeRoot`'s existing form so
  // `ensureInsideBase`'s `path.resolve` + `path.sep` comparison
  // works across both platforms.
  const absolute = path.join(scopeRoot, ...segments);
  // Defence in depth: even though the lexical check above should
  // catch every escape, run `ensureInsideBase` so a future change to
  // either step doesn't silently regress the safety guarantee.
  if (!ensureInsideBase(absolute, scopeRoot)) {
    throw new Error(`path escapes plugin scope: ${rel}`);
  }
  return absolute;
}

// ─────────────────────────────────────────────────────────────────────
// Scoped FileOps factory
// ─────────────────────────────────────────────────────────────────────

function isErrnoException(value: unknown): value is { code: string } {
  return typeof value === "object" && value !== null && "code" in value && typeof (value as { code: unknown }).code === "string";
}

function makeFileOps(scopeRoot: string): FileOps {
  // The scope root may not exist on first use. Lazy-create at write
  // time (writeFileAtomic does its own mkdir for the file's parent;
  // we ensure the scope root exists for readDir() / stat() etc.).
  // Reads against a never-written plugin throw ENOENT — exposed as
  // `exists() === false` rather than handled here.

  return {
    async read(rel) {
      return readFile(normalizePluginPath(scopeRoot, rel), "utf-8");
    },
    async readBytes(rel) {
      const buf = await readFile(normalizePluginPath(scopeRoot, rel));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    async write(rel, content) {
      const abs = normalizePluginPath(scopeRoot, rel);
      await writeFileAtomic(abs, content);
    },
    async readDir(rel) {
      const abs = normalizePluginPath(scopeRoot, rel);
      try {
        return await readdir(abs);
      } catch (err) {
        if (isErrnoException(err) && err.code === "ENOENT") return [];
        throw err;
      }
    },
    async stat(rel) {
      const { mtimeMs, size } = await fsStat(normalizePluginPath(scopeRoot, rel));
      return { mtimeMs, size };
    },
    async exists(rel) {
      try {
        await fsStat(normalizePluginPath(scopeRoot, rel));
        return true;
      } catch (err) {
        if (isErrnoException(err) && err.code === "ENOENT") return false;
        throw err;
      }
    },
    async unlink(rel) {
      try {
        await fsUnlink(normalizePluginPath(scopeRoot, rel));
      } catch (err) {
        if (isErrnoException(err) && err.code === "ENOENT") return;
        throw err;
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sanitisation: pkg name → on-disk directory segment
// ─────────────────────────────────────────────────────────────────────

/** Convert an npm package name (`@org/foo`) to a single safe directory
 *  segment. URL-encodes `/` in scoped names so the scope root stays
 *  one level deep — keeps `readdir` predictable and avoids accidental
 *  traversal via the package name itself.
 *
 *  Exported for tests. */
export function sanitisePackageNameForFs(pkgName: string): string {
  return encodeURIComponent(pkgName);
}

// ─────────────────────────────────────────────────────────────────────
// Scoped logger
// ─────────────────────────────────────────────────────────────────────

function makeScopedLogger(pkgName: string): PluginRuntime["log"] {
  const prefix = `plugin/${pkgName}`;
  return {
    debug: (msg, data) => hostLog.debug(prefix, msg, data as Record<string, unknown> | undefined),
    info: (msg, data) => hostLog.info(prefix, msg, data as Record<string, unknown> | undefined),
    warn: (msg, data) => hostLog.warn(prefix, msg, data as Record<string, unknown> | undefined),
    error: (msg, data) => hostLog.error(prefix, msg, data as Record<string, unknown> | undefined),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped fetch (timeout + optional host allowlist)
// ─────────────────────────────────────────────────────────────────────

function makeScopedFetch(pkgName: string): PluginRuntime["fetch"] {
  return async (url, opts = {}) => {
    if (opts.allowedHosts && opts.allowedHosts.length > 0) {
      const { hostname } = new URL(url);
      if (!opts.allowedHosts.includes(hostname)) {
        throw new Error(`plugin/${pkgName}: host ${hostname} not in allowedHosts`);
      }
    }
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Forward both the caller's signal (if any) and our timeout
      // signal. AbortSignal.any returns a signal that fires when
      // either input fires — Node 20+.
      const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
      // The runtime cast keeps PluginFetchInit narrow (string | Uint8Array)
      // so plugin authors don't need to know the wider DOM BodyInit union.
      const body = opts.body as Parameters<typeof fetch>[1] extends infer T ? (T extends { body?: infer B } ? B : never) : never;
      return await fetch(url, { method: opts.method, headers: opts.headers, body, signal });
    } catch (err) {
      // Re-throw with plugin context so a fan-out failure in the
      // host log immediately points at the responsible plugin
      // instead of an anonymous network error (CodeRabbit review on
      // PR #1124). Distinguishing AbortError → "timeout" is more
      // useful than the bare "AbortError: This operation was aborted"
      // message that surfaces from AbortController.
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`plugin/${pkgName}: fetch timed out after ${timeoutMs}ms (${url})`);
      }
      throw new Error(`plugin/${pkgName}: fetch failed (${url}): ${errorMessage(err)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

function makeScopedFetchJson(pkgName: string, scopedFetch: PluginRuntime["fetch"]): PluginRuntime["fetchJson"] {
  // When `opts.parse` is provided we trust its narrowing; when absent
  // the caller asserts the JSON shape themselves (same contract as
  // `JSON.parse(...) as T`).
  return async function fetchJson<T>(url: string, opts: { parse?: (raw: unknown) => T } & Parameters<PluginRuntime["fetch"]>[1] = {}): Promise<T> {
    const response = await scopedFetch(url, opts);
    if (!response.ok) {
      throw new Error(`plugin/${pkgName}: fetchJson HTTP ${response.status} for ${url}`);
    }
    const raw = (await response.json()) as unknown;
    return opts.parse ? opts.parse(raw) : (raw as T);
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped pubsub publisher
// ─────────────────────────────────────────────────────────────────────

/** Build the channel name for a given plugin's event. Centralised so
 *  the server-side publish side and the browser-side subscribe side
 *  agree on the format (`plugin:<pkg>:<event>`). Exported for tests
 *  and for the browser runtime to import the same constant. */
export function pluginChannelName(pkgName: string, eventName: string): string {
  return `plugin:${pkgName}:${eventName}`;
}

function makeScopedPubSub(pkgName: string, hostPubSub: IPubSub): PluginRuntime["pubsub"] {
  return {
    publish(eventName, payload) {
      hostPubSub.publish(pluginChannelName(pkgName, eventName), payload);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped notifier (host extension over gui-chat-protocol's PluginRuntime)
// ─────────────────────────────────────────────────────────────────────

function makeScopedNotifier(pkgName: string): NotifierRuntimeApi {
  // Every method is plugin-scoped:
  //   - publish forces `pluginPkg` to the caller's pkg name (the
  //     plugin literally cannot publish under another's namespace).
  //   - update routes through `updateForPlugin` so a plugin can't
  //     mutate another plugin's entries. Silent no-op on cross-
  //     plugin id or validation failure.
  //   - clear routes through `clearForPlugin` so a plugin holding
  //     another plugin's id (e.g. via a future leak) silently no-ops
  //     instead of dismissing it. CodeRabbit review on PR #1198.
  //   - get returns the entry only if it belongs to this plugin;
  //     cross-plugin reads come back as `undefined`. Used for
  //     ghost-bell detection in `action`-lifecycle reconcilers.
  return {
    publish: (input) => notifierEngine.publish({ ...input, pluginPkg: pkgName }),
    update: (entryId, patch) => notifierEngine.updateForPlugin(pkgName, entryId, patch),
    clear: (entryId) => notifierEngine.clearForPlugin(pkgName, entryId),
    get: (entryId) => notifierEngine.getForPlugin(pkgName, entryId),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped tasks (host extension — Phase 1 of Encore plan)
// ─────────────────────────────────────────────────────────────────────

/** Build the registry id used for a plugin's tick. Centralised so the
 *  cap-at-1 closure check and the host task manager registration agree
 *  on the format. Exported for tests. */
export function pluginTaskId(pkgName: string): string {
  return `plugin:${pkgName}`;
}

function makeScopedTasks(pkgName: string, taskManager: ITaskManager): TasksRuntimeApi {
  // Cap-at-1 enforced at the runtime-API layer so the plugin author
  // sees a friendly message before the host task manager's generic
  // duplicate-id throw fires. The closure is per-plugin (each plugin
  // gets its own runtime), so `registered` cannot leak across
  // plugins.
  let registered = false;
  return {
    register(task) {
      if (registered) {
        throw new Error(`plugin/${pkgName}: already registered a task — only one tick per plugin is allowed`);
      }
      registered = true;
      taskManager.registerTask({
        id: pluginTaskId(pkgName),
        description: `tick for plugin ${pkgName}`,
        schedule: task.schedule,
        run: () => task.run(),
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scoped chat (host extension — Phase 1 of Encore plan)
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_PLUGIN_CHAT_ROLE = BUILTIN_ROLE_IDS.general;

function makeScopedChat(pkgName: string): ChatRuntimeApi {
  return {
    async start({ initialMessage, role }) {
      const roleId = role ?? DEFAULT_PLUGIN_CHAT_ROLE;
      const chatSessionId = randomUUID();
      const result = await startChat({
        message: initialMessage,
        roleId,
        chatSessionId,
        origin: `${PLUGIN_SESSION_ORIGIN_PREFIX}${pkgName}`,
      });
      if (result.kind === "error") {
        throw new Error(`plugin/${pkgName}: chat.start failed: ${result.error}`);
      }
      return { chatId: chatSessionId };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public entry — wire everything into one PluginRuntime
// ─────────────────────────────────────────────────────────────────────

export interface MakePluginRuntimeDeps {
  /** npm package name. Used both for sanitised fs segment + namespace prefix. */
  pkgName: string;
  /** Host pub/sub instance for fanning out scoped events. */
  pubsub: IPubSub;
  /** Locale tag the host has detected (e.g. `"ja"`). Snapshot only;
   *  reactive updates ride the frontend `BrowserPluginRuntime.locale`. */
  locale: string;
  /** Host task manager — backs `runtime.tasks.register()`. The same
   *  instance the host's own system tasks (journal, chat-index)
   *  register against. */
  taskManager: ITaskManager;
}

export function makePluginRuntime(deps: MakePluginRuntimeDeps): MulmoclaudeRuntime {
  const { pkgName, pubsub, locale, taskManager } = deps;
  const seg = sanitisePackageNameForFs(pkgName);
  const dataRoot = path.join(WORKSPACE_PATHS.pluginsData, seg);
  const configRoot = path.join(WORKSPACE_PATHS.pluginsConfig, seg);
  const scopedFetch = makeScopedFetch(pkgName);

  return {
    pubsub: makeScopedPubSub(pkgName, pubsub),
    locale,
    files: {
      data: makeFileOps(dataRoot),
      config: makeFileOps(configRoot),
    },
    log: makeScopedLogger(pkgName),
    fetch: scopedFetch,
    fetchJson: makeScopedFetchJson(pkgName, scopedFetch),
    // Host extensions over gui-chat-protocol's PluginRuntime. Plugin
    // authors access via `runtime as MulmoclaudeRuntime` for now.
    // Phase 3 of the Encore plan upstreams these into the protocol.
    notifier: makeScopedNotifier(pkgName),
    tasks: makeScopedTasks(pkgName, taskManager),
    chat: makeScopedChat(pkgName),
  };
}

// Re-export host's writeFileAtomic so plugin runtime tests can
// inspect the same primitive without reaching into utils/.
export { writeFileAtomic };

// Re-export logger type so the loader can type-check sink injection
// without re-importing from system/logger.
export type { Logger };
