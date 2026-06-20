// @mulmoclaude/file-change-publisher — shared "this workspace file changed"
// broadcaster. A host write route calls `publishFileChange(relPath)` after a
// successful write; subscribed UI tabs refetch. Extracted so MulmoClaude and
// MulmoTerminal forward to the SAME plugin-scoped channels (the live-refresh
// contract the markdown/html Views subscribe to) without duplicating the logic.
//
// Everything host-specific is INJECTED via `configureFileChangePublisher` (the
// pubsub, the workspace root, the path→posix normaliser, the host's own primary
// channel, the plugin-scope matchers, and any side-effect), so this package owns
// only the orchestration + the `plugin:<scope>:file:<path>` channel format and
// touches neither host's pubsub-channel config nor its frontend subscribers.
import { stat } from "node:fs/promises";
import path from "node:path";

/** Payload published on every file-change channel. `mtimeMs` is the post-write
 *  modified time — monotonic, suitable for cache-busting (`?v=`) and out-of-order
 *  drops. */
export interface FileChannelPayload {
  path: string;
  mtimeMs: number;
}

/** A plugin View that wants live-refresh: when `matches(posixPath)` is true, the
 *  change is forwarded to `plugin:<scope>:file:<path>` (the channel the View's
 *  runtime subscribes to). */
export interface FileChangeScope {
  scope: string;
  matches: (posixPath: string) => boolean;
}

export interface FileChangePublisherConfig {
  /** Host pubsub publish. */
  publish: (channel: string, payload: FileChannelPayload) => void;
  /** Workspace root — joined with the relative path to stat the post-write mtime. */
  workspaceRoot: string;
  /** Normalise a workspace-relative path to POSIX (drives both `payload.path` and
   *  every channel suffix, so they can't drift on mixed separators). */
  toPosix: (relativePath: string) => string;
  /** The host's primary file channel (e.g. a Files explorer's `file:<path>`).
   *  Omit when the host has no general file subscriber (e.g. MulmoTerminal). */
  primaryChannel?: (posixPath: string) => string;
  /** Plugin Views to forward to. */
  pluginScopes?: FileChangeScope[];
  /** Optional side-effect after publishing (e.g. a topic-index regen). Receives the
   *  posix path + payload; may itself call `publishFileChange` for derived files. */
  onPublished?: (posixPath: string, payload: FileChannelPayload) => void;
  /** Optional warn logger; a publish/stat failure logs but never throws (callers
   *  fire-and-forget, so a throw would be an unhandled rejection). */
  warn?: (message: string, data?: Record<string, unknown>) => void;
}

let config: FileChangePublisherConfig | null = null;

/** Wire the publisher to a host. Call once at startup, before any write route. */
export function configureFileChangePublisher(cfg: FileChangePublisherConfig): void {
  config = cfg;
}

/** Clear the binding — test-only. */
export function resetFileChangePublisher(): void {
  config = null;
}

/** The plugin-scoped live-refresh channel a View subscribes to. */
export function pluginFileChannel(scope: string, posixPath: string): string {
  return `plugin:${scope}:file:${posixPath}`;
}

/** Publish a file-change for a workspace-relative path: the primary channel (if any)
 *  + every matching plugin scope, with the post-write mtime. No-op until configured. */
export async function publishFileChange(relativePath: string): Promise<void> {
  const cfg = config;
  if (!cfg) return;
  // `relativePath` comes from the host's write routes. Contain it before doing
  // anything: a path that escapes the workspace is dropped entirely — we
  // neither stat an arbitrary file nor broadcast an out-of-workspace path to
  // subscribers or host side-effects. Defence-in-depth, since this is the
  // shared package both hosts use. `root` carries a trailing separator and the
  // guard is a single `startsWith` early-return — the canonical containment
  // shape (so the check is unambiguous for both readers and static analysis).
  const root = path.resolve(cfg.workspaceRoot) + path.sep;
  const absPath = path.join(root, relativePath);
  if (!absPath.startsWith(root)) {
    cfg.warn?.("ignoring file-change for path outside workspace", { path: relativePath });
    return;
  }
  let mtimeMs: number;
  try {
    ({ mtimeMs } = await stat(absPath));
  } catch (err) {
    cfg.warn?.("stat failed; falling back to Date.now()", { path: relativePath, error: errMsg(err) });
    mtimeMs = Date.now();
  }
  const posixPath = cfg.toPosix(relativePath);
  const payload: FileChannelPayload = { path: posixPath, mtimeMs };

  if (cfg.primaryChannel) {
    safePublish(cfg, cfg.primaryChannel(posixPath), payload, "primary publish failed");
  }
  for (const { scope, matches } of cfg.pluginScopes ?? []) {
    if (!matches(posixPath)) continue;
    safePublish(cfg, pluginFileChannel(scope, posixPath), payload, `${scope} plugin forward failed`);
  }
  cfg.onPublished?.(posixPath, payload);
}

function safePublish(cfg: FileChangePublisherConfig, channel: string, payload: FileChannelPayload, failMsg: string): void {
  try {
    cfg.publish(channel, payload);
  } catch (err) {
    cfg.warn?.(`${failMsg}; subscribers will miss this event`, { channel, error: errMsg(err) });
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
