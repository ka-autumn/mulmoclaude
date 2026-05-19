// stdio↔HTTP shim for the Docker-sandbox opt-in path (#1421 Phase B).
//
// The Docker sandbox image can't host arbitrary stdio MCP runtimes
// (npx / python / …), so stdio servers are dropped by default
// (server/agent/config.ts). A user can opt a specific server into
// `hostExecInDocker` — the explicit, UI-acknowledged escape hatch:
// the stdio server runs on the HOST behind `supergateway` (a
// battle-tested stdio→SSE MCP bridge) and the sandboxed agent
// reaches it over `host.docker.internal`.
//
// `supergateway` (rather than a hand-rolled adapter) is deliberate:
// MCP transport correctness is delegated to a maintained tool — for
// a sandbox-escaping feature, protocol-correct + battle-tested beats
// zero-dependency.
//
// SECURITY: every started shim runs UNSANDBOXED with host
// privileges. That is the acknowledged trade-off of the opt-in;
// callers MUST gate on `spec.hostExecInDocker === true` and the UI
// MUST surface the risk. This module never decides policy — it only
// executes an already-authorized opt-in.

import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import { findAvailablePort } from "../utils/port.mjs";
import { log } from "../system/logger/index.js";
import { ONE_SECOND_MS } from "../utils/time.js";
import type { McpStdioSpec } from "../system/config.js";

export interface ShimHandle {
  /** Host URL the (sandboxed) agent's MCP client connects to. */
  url: string;
  /** Tear down the gateway + its stdio child. Idempotent. */
  close: () => void;
}

// Pinned: this is an UNSANDBOXED host-exec path, so `npx -y` must not
// resolve a mutable upstream version on every run (supply-chain +
// reproducibility). Bump deliberately after reviewing the diff.
const SUPERGATEWAY_VERSION = "3.4.3";

const SHIM_PORT_RANGE_START = 39_100;
const SHIM_READY_TIMEOUT_MS = 15 * ONE_SECOND_MS;
const SHIM_READY_POLL_MS = ONE_SECOND_MS / 4;

// POSIX single-quote escaping. supergateway runs the `--stdio` value
// through `spawn(..., { shell: true })`, so the string is parsed by a
// shell — whitespace-only quoting would let metacharacters
// (`$ ; | & ( )`, backticks, quotes) be expanded and diverge from the
// non-shim `spawn(command, args)` path. Wrapping every token in single
// quotes (and `'\''`-escaping embedded single quotes) neutralises ALL
// shell metacharacters, which matters because this path runs
// UNSANDBOXED on the host. This is POSIX-shell-specific; on Windows
// the default shell is cmd.exe where single-quote semantics differ,
// so `startStdioHttpShim` refuses to run there (safe default: drop)
// rather than risk a misparse on a sandbox-escaping path.
function shellQuote(token: string): string {
  const escaped = token.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

export function buildStdioCommand(spec: McpStdioSpec): string {
  return [spec.command, ...(spec.args ?? [])].map(shellQuote).join(" ");
}

const SHIM_PROBE_TIMEOUT_MS = 2 * ONE_SECOND_MS;

async function probeOnce(port: number): Promise<boolean> {
  // Per-request timeout: a half-open TCP connection (port accepts but
  // never responds) would otherwise hang past the overall deadline.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHIM_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/sse`, { method: "GET", signal: controller.signal });
    // 405 / 400 = server is up but rejects a bare GET on the SSE
    // endpoint — that still proves the gateway is listening.
    return res.ok || res.status === 405 || res.status === 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntilListening(child: ChildProcess, port: number, hasSpawnFailed: () => boolean): Promise<boolean> {
  const deadline = Date.now() + SHIM_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // Bail immediately on a dead/failed child instead of burning the
    // full timeout: spawn 'error' can fire after the caller's initial
    // check, so re-test the flag (and exit/signal) every iteration.
    if (hasSpawnFailed() || child.exitCode !== null || child.signalCode !== null) return false;
    if (await probeOnce(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, SHIM_READY_POLL_MS));
  }
  return false;
}

function drainToDebug(child: ChildProcess, serverId: string): void {
  // supergateway / the wrapped server can be chatty. We never parse
  // this output (readiness is an HTTP probe), but unread `pipe`
  // buffers fill and block the child, so the streams MUST be
  // consumed. Forward to debug so failures are still diagnosable.
  const forward = (stream: Readable | null, channel: "stdout" | "stderr") => {
    if (!stream) return;
    stream.on("data", (chunk: Buffer) => {
      log.debug("mcp-shim", `${channel}: ${chunk.toString().trimEnd()}`, { serverId });
    });
  };
  forward(child.stdout, "stdout");
  forward(child.stderr, "stderr");
}

/** Start a host-side stdio↔HTTP gateway for an opted-in stdio
 *  server. Returns a handle, or `null` when the gateway failed to
 *  come up (caller falls back to the safe default: drop the server).
 *  Never throws — a shim failure must not abort the agent turn.
 *
 *  `workspacePath` is the chat workspace; the shim runs with it as
 *  cwd so relative args / config-file discovery match the normal
 *  (non-Docker) stdio execution semantics. */
export async function startStdioHttpShim(serverId: string, spec: McpStdioSpec, workspacePath: string): Promise<ShimHandle | null> {
  // Windows host: the shell escaping below is POSIX-only and
  // supergateway runs `--stdio` via cmd.exe here, so refuse rather
  // than risk a misparse on an UNSANDBOXED path. Falls through to the
  // safe default (server dropped + logged by the caller).
  if (process.platform === "win32") {
    log.warn("mcp-shim", "host-exec stdio shim is unsupported on Windows — dropping server", { serverId });
    return null;
  }

  const port = await findAvailablePort(SHIM_PORT_RANGE_START);
  if (port === null) {
    log.warn("mcp-shim", "no free port for stdio→http shim — dropping server", { serverId });
    return null;
  }

  const child = spawn("npx", ["-y", `supergateway@${SUPERGATEWAY_VERSION}`, "--stdio", buildStdioCommand(spec), "--port", String(port)], {
    // Run from the chat workspace (parity with the non-Docker stdio
    // path) so relative args / config lookups resolve identically.
    cwd: workspacePath,
    // Merge the spec env so the stdio child sees its required vars
    // (API keys etc.); inherit the host env for npx/node resolution.
    env: { ...process.env, ...(spec.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  drainToDebug(child, serverId);
  // Without an error listener a spawn failure (npx missing) would be
  // an unhandled 'error' event → process crash. Same lesson as the
  // claude-code backend's spawn guard.
  let spawnFailed = false;
  child.once("error", (err) => {
    spawnFailed = true;
    log.warn("mcp-shim", "supergateway spawn failed", { serverId, error: err instanceof Error ? err.message : String(err) });
  });

  const close = () => {
    if (!child.killed) child.kill("SIGTERM");
  };

  const ready = !spawnFailed && (await waitUntilListening(child, port, () => spawnFailed));
  if (!ready) {
    close();
    log.warn("mcp-shim", "stdio→http shim did not become ready — dropping server", { serverId, port });
    return null;
  }

  log.info("mcp-shim", "stdio→http shim ready (host-exec, escapes sandbox)", { serverId, port });
  // Loopback URL; the caller rewrites localhost→host.docker.internal
  // for the in-container MCP config.
  return { url: `http://127.0.0.1:${port}/sse`, close };
}
