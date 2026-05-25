// Test-only launcher for a fully isolated mulmoclaude dev server.
//
// L-FRESH-BOOT and the other fresh-user smoke scenarios need to boot
// the server against an empty `$HOME` and an empty workspace, without
// touching the developer's running `yarn dev` (port 3001/5173 against
// `~/mulmoclaude/`). This helper spawns `tsx server/index.ts` as a
// subprocess with three independent overrides:
//
//   - `HOME=<temp-home>` so `os.homedir()` (claude CLI auth lookup,
//     `~/.claude/.credentials.json`, `~/.claude/skills/`) targets the
//     test-only directory instead of the user's actual home
//   - `MULMOCLAUDE_WORKSPACE_PATH=<temp-workspace>` so workspace init
//     (`server/workspace/paths.ts:89`) creates the fresh directory
//     structure inside the temp dir rather than `~/mulmoclaude/`
//   - `PORT=<isolated-port>` so the HTTP listener does not collide
//     with whatever the developer already has bound on 3001
//
// `NODE_ENV=production` switches the express server into static-host
// mode so it serves `index.html` itself (with the `<meta
// name="mulmoclaude-auth">` token substituted). The Vite dev server
// is bypassed entirely — Vite's proxy is hardcoded to 3001 and its
// token file path is hardcoded to `~/mulmoclaude/.session-token`,
// neither of which respects the per-test overrides this helper sets.
//
// `MULMOCLAUDE_CLIENT_DIR` (added in this PR) tells the production
// path where to read `index.html` from. Without it, the server reads
// `<__dirname>/../client/`, which only exists in the published
// package layout (`prepare-dist.js` copies `dist/client/` there).
// From a source checkout we point at `<repo-root>/dist/client/`.

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import { isErrorWithCode } from "../../server/utils/types.ts";
import { API_ROUTES } from "../../src/config/apiRoutes.ts";

const FIXTURES_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(FIXTURES_DIR, "..", "..");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SERVER_ENTRY = path.join(REPO_ROOT, "server", "index.ts");
const CLIENT_DIST_DIR = path.join(REPO_ROOT, "dist", "client");
const CLIENT_DIST_INDEX = path.join(CLIENT_DIST_DIR, "index.html");
const HOST_CREDENTIALS_PATH = path.join(homedir(), ".claude", ".credentials.json");
const HOST_WORKSPACE_PATH = path.join(homedir(), "mulmoclaude");
const HOST_CLAUDE_SKILLS_PATH = path.join(homedir(), ".claude", "skills");

const HEALTH_POLL_TIMEOUT_MS = 30 * ONE_SECOND_MS;
const HEALTH_POLL_INTERVAL_MS = ONE_SECOND_MS / 2;
const HEALTH_FETCH_TIMEOUT_MS = 2 * ONE_SECOND_MS;
const SHUTDOWN_GRACE_MS = 10 * ONE_SECOND_MS;
const SHUTDOWN_POLL_INTERVAL_MS = 200;

export interface HostMtimeBaseline {
  /** Absolute path observed for the host baseline. */
  readonly path: string;
  /** `null` when the path was absent at baseline time. */
  readonly mtimeMs: number | null;
}

export interface IsolatedServerHandle {
  readonly baseUrl: string;
  readonly port: number;
  readonly homeDir: string;
  readonly workspaceDir: string;
  /** Bearer token the server is enforcing (pinned via `MULMOCLAUDE_AUTH_TOKEN`). */
  readonly authToken: string;
  readonly hostBaselines: readonly HostMtimeBaseline[];
  /** Internal — kept on the handle so `stopIsolatedDevServer` can `SIGTERM` it. */
  readonly _process: ChildProcess;
}

export interface SpawnOptions {
  /** Stable nonce so the temp dirs are findable in trace if the test crashes. */
  readonly testId: string;
  /** When true, copy `~/.claude/.credentials.json` into the test HOME. Default true. */
  readonly copyCredentials?: boolean;
}

/**
 * Build the test-only client bundle once, idempotently. The helper
 * triggers this lazily so a fresh worktree (no `dist/client/`) still
 * works without forcing the user to run `yarn build:client` by hand.
 * Subsequent test runs are no-ops because `dist/client/index.html`
 * already exists.
 */
export function ensureClientBuilt(): void {
  if (existsSync(CLIENT_DIST_INDEX)) return;
  execFileSync("yarn", ["build:client"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    // Vite's build runs `tsc` first and reads the same `node_modules`
    // the rest of the worktree uses, so no extra env is needed.
  });
}

async function probeFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (typeof address === "object" && address !== null) {
          resolve(address.port);
          return;
        }
        reject(new Error("probeFreePort: server.address() returned no port"));
      });
    });
  });
}

async function snapshotMtime(target: string): Promise<HostMtimeBaseline> {
  try {
    const stats = await stat(target);
    return { path: target, mtimeMs: stats.mtimeMs };
  } catch (err) {
    if (isErrorWithCode(err) && err.code === "ENOENT") {
      return { path: target, mtimeMs: null };
    }
    throw err;
  }
}

async function snapshotHostBaselines(): Promise<readonly HostMtimeBaseline[]> {
  return Promise.all([HOST_WORKSPACE_PATH, HOST_CLAUDE_SKILLS_PATH].map((target) => snapshotMtime(target)));
}

async function copyHostCredentialsToTestHome(testHome: string): Promise<void> {
  if (!existsSync(HOST_CREDENTIALS_PATH)) return;
  const destDir = path.join(testHome, ".claude");
  await mkdir(destDir, { recursive: true });
  await copyFile(HOST_CREDENTIALS_PATH, path.join(destDir, ".credentials.json"));
}

async function waitForHealth(baseUrl: string, authToken: string): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  // `/api/health` is bearer-protected (see server/index.ts:289), so
  // the probe must carry the same token the SPA injects into
  // `<meta name="mulmoclaude-auth">`. We pinned it via
  // `MULMOCLAUDE_AUTH_TOKEN` at spawn time so the value is known
  // even before the server writes `.session-token` to disk.
  while (Date.now() - start < HEALTH_POLL_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}${API_ROUTES.health}`, {
        headers: { Authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(HEALTH_FETCH_TIMEOUT_MS),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status} ${response.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(`Isolated server at ${baseUrl} did not become healthy within ${HEALTH_POLL_TIMEOUT_MS}ms. Last probe: ${lastError ?? "no probe attempted"}`);
}

interface ServerEnv {
  readonly homeDir: string;
  readonly workspaceDir: string;
  readonly port: number;
  readonly authToken: string;
}

/**
 * Build the env handed to the spawned server. Strips a handful of
 * inherited vars that would defeat the isolation (parent `PORT`
 * leaking into the child, an exported `MULMOCLAUDE_WORKSPACE_PATH`
 * from a previous run, etc.). The override values are placed AFTER
 * the `...process.env` spread so they always win.
 */
function buildServerEnv(env: ServerEnv): Record<string, string> {
  // `process.env` types `value` as `string | undefined`, but
  // `child_process.spawn`'s env reads the same — TypeScript widens
  // when we spread; coerce undefined values away so the Record<string,
  // string> return type stays honest.
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") inherited[key] = value;
  }
  return {
    ...inherited,
    HOME: env.homeDir,
    USERPROFILE: env.homeDir, // Windows analogue; harmless on POSIX
    MULMOCLAUDE_WORKSPACE_PATH: env.workspaceDir,
    PORT: String(env.port),
    NODE_ENV: "production",
    MULMOCLAUDE_CLIENT_DIR: CLIENT_DIST_DIR,
    // Pin the bearer token so the test process knows the value
    // before the server gets a chance to write `.session-token`.
    // Without this override the test would have to read the token
    // file (race) or include a token-free `/api/health` route
    // (route surface change for a test-only concern).
    MULMOCLAUDE_AUTH_TOKEN: env.authToken,
    // The fresh-user smoke scenarios verify the boot path itself,
    // not Docker sandboxing — leaving sandbox setup on would force
    // `ensureSandboxImage` to build the image (minutes) on a cold CI
    // machine. L-FRESH-SANDBOX-BUILD (separate, future PR) exercises
    // that path explicitly.
    DISABLE_SANDBOX: "1",
  };
}

async function makeTestDirs(testId: string): Promise<{ homeDir: string; workspaceDir: string }> {
  const safeId = testId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 32);
  const root = await mkdtemp(path.join(tmpdir(), `mc-fresh-${safeId}-`));
  const homeDir = path.join(root, "home");
  const workspaceDir = path.join(root, "workspace");
  await mkdir(homeDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  return { homeDir, workspaceDir };
}

export async function spawnIsolatedDevServer(options: SpawnOptions): Promise<IsolatedServerHandle> {
  ensureClientBuilt();
  const port = await probeFreePort();
  const hostBaselines = await snapshotHostBaselines();
  const { homeDir, workspaceDir } = await makeTestDirs(options.testId);
  if (options.copyCredentials !== false) {
    await copyHostCredentialsToTestHome(homeDir);
  }
  // 32 random bytes → 64 hex chars matches the server's
  // `generateAndWriteToken` shape, so the override looks identical
  // to a freshly generated token from any auth-logging diagnostic.
  const authToken = randomBytes(32).toString("hex");

  const child = spawn(TSX_BIN, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: buildServerEnv({ homeDir, workspaceDir, port, authToken }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  forwardChildLogs(child, options.testId);

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl, authToken);
  } catch (err) {
    await killChild(child);
    throw err;
  }
  return { baseUrl, port, homeDir, workspaceDir, authToken, hostBaselines, _process: child };
}

/**
 * Pipe the spawned server's stdout/stderr to the test process so
 * trace viewers and CI logs can attribute crashes to the test that
 * caused them. Without this the child writes into a void and a boot
 * failure looks like a vanilla `waitForHealth` timeout with no clue
 * about the underlying error.
 */
function forwardChildLogs(child: ChildProcess, testId: string): void {
  const tag = `[isolated-server:${testId}]`;
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`${tag} ${chunk.toString()}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`${tag} ${chunk.toString()}`);
  });
  child.on("error", (err) => {
    process.stderr.write(`${tag} spawn error: ${err.message}\n`);
  });
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const start = Date.now();
  while (Date.now() - start < SHUTDOWN_GRACE_MS) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_INTERVAL_MS));
  }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

export async function stopIsolatedDevServer(server: IsolatedServerHandle): Promise<void> {
  await killChild(server._process);
  // Best-effort temp cleanup. The dirs live under `os.tmpdir()` and
  // the OS will reap them eventually, so we swallow errors rather
  // than turning a passing test red on a tmpfs race.
  const root = path.dirname(server.homeDir);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Verify that the test did not mutate the developer's real workspace
 * or `~/.claude/skills/`. Tests call this in `finally` AFTER the
 * server has been stopped — if a host path's `mtime` advanced, the
 * isolation contract is broken (probably a stray `homedir()` call
 * that bypassed the env override).
 */
export async function assertHostUntouched(baselines: readonly HostMtimeBaseline[]): Promise<void> {
  const drift: string[] = [];
  for (const baseline of baselines) {
    const current = await snapshotMtime(baseline.path);
    if (current.mtimeMs !== baseline.mtimeMs) {
      drift.push(`${baseline.path}: baseline=${formatMtime(baseline.mtimeMs)} now=${formatMtime(current.mtimeMs)}`);
    }
  }
  if (drift.length > 0) {
    throw new Error(`Isolated server contaminated host paths:\n${drift.join("\n")}`);
  }
}

function formatMtime(mtimeMs: number | null): string {
  return mtimeMs === null ? "absent" : new Date(mtimeMs).toISOString();
}

export const ISOLATED_SERVER_HEALTH_TIMEOUT_MS = HEALTH_POLL_TIMEOUT_MS;
export const ISOLATED_SERVER_DEFAULT_BOOT_BUDGET_MS = HEALTH_POLL_TIMEOUT_MS + ONE_MINUTE_MS;
