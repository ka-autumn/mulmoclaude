// whisper.cpp warm-model sidecar. Spawns `whisper-server` once with the model
// preloaded and reuses it across transcriptions over its local HTTP API, so the
// weights stay resident (no per-request reload). State is encapsulated per
// instance via the factory closure.

import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { errorMessage, NOOP_LOGGER, ONE_MINUTE_MS, ONE_SECOND_MS, type WhisperLogger } from "./internal.ts";
import { modelFilePath, type WhisperModelName } from "./models.ts";

const HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 60 * ONE_SECOND_MS;
const READY_POLL_INTERVAL_MS = 500;
const INFERENCE_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

interface ActiveSidecar {
  readonly port: number;
  readonly proc: ChildProcess;
  readonly model: WhisperModelName;
}

export interface Sidecar {
  transcribeWav: (wavPath: string, language: string, model: WhisperModelName) => Promise<string>;
  warmup: (model: WhisperModelName) => Promise<void>;
  shutdown: () => void;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not determine a free port")));
      }
    });
  });
}

/** Resolve once the server answers any HTTP request (any status = listener up),
 *  or throw after the ready timeout. */
async function waitUntilReady(port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://${HOST}:${port}/`, { signal: AbortSignal.timeout(ONE_SECOND_MS) });
      return;
    } catch {
      await delay(READY_POLL_INTERVAL_MS);
    }
  }
  throw new Error("whisper-server did not become ready in time");
}

// whisper-server logs verbosely to stderr; left unread the OS pipe buffer fills
// and the child blocks on its next write. Drain into a small tail buffer.
function drainStderr(proc: ChildProcess, tail: { text: string }): void {
  proc.stderr?.setEncoding("utf8");
  proc.stderr?.on("data", (chunk: string) => {
    tail.text = (tail.text + chunk).slice(-4000);
  });
}

// Resolve when the server answers, or reject on spawn failure (e.g. ENOENT) /
// early exit. Listeners are one-shot and removed once the race settles.
function waitForReadyOrFailure(proc: ChildProcess, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let onError: (err: Error) => void = () => undefined;
    let onExit: (code: number | null) => void = () => undefined;
    const cleanup = () => {
      proc.removeListener("error", onError);
      proc.removeListener("exit", onExit);
    };
    onError = (err: Error) => {
      cleanup();
      reject(new Error(`spawn failed: ${errorMessage(err)}`));
    };
    onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`exited early (code ${code})`));
    };
    proc.once("error", onError);
    proc.once("exit", onExit);
    waitUntilReady(port)
      .then(() => {
        cleanup();
        resolve();
      })
      .catch((err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

function parseInferenceText(data: unknown): string {
  if (typeof data === "object" && data !== null && "text" in data) {
    const { text } = data as { text: unknown };
    if (typeof text === "string") return text;
  }
  return "";
}

export function createSidecar(modelsDir: string, serverBinary = "whisper-server", logger: WhisperLogger = NOOP_LOGGER): Sidecar {
  let sidecar: ActiveSidecar | null = null;
  let starting: { model: WhisperModelName; promise: Promise<ActiveSidecar> } | null = null;

  function shutdown(): void {
    if (!sidecar) return;
    sidecar.proc.kill();
    sidecar = null;
  }

  async function startSidecar(model: WhisperModelName): Promise<ActiveSidecar> {
    const port = await findFreePort();
    const args = ["--model", modelFilePath(modelsDir, model), "--host", HOST, "--port", String(port)];
    logger.info("sidecar: spawning", { model, port });
    const proc = spawn(serverBinary, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderrTail = { text: "" };
    drainStderr(proc, stderrTail);
    // Permanent error listener — a missing one would let a process 'error'
    // (e.g. ENOENT) throw uncaught and crash the host.
    proc.on("error", (err) => logger.warn("sidecar: process error", { model, error: errorMessage(err) }));
    proc.on("exit", (code) => {
      logger.warn("sidecar: exited", { model, code, stderrTail: stderrTail.text.slice(-500) });
      if (sidecar?.proc === proc) sidecar = null;
    });
    try {
      await waitForReadyOrFailure(proc, port);
    } catch (err) {
      proc.kill();
      throw new Error(`whisper-server failed to start: ${errorMessage(err)} — stderr: ${stderrTail.text.slice(-500)}`);
    }
    sidecar = { port, proc, model };
    logger.info("sidecar: ready", { model, port });
    return sidecar;
  }

  // Module-scoped spawn so it isn't a loop closure (no-loop-func). Only ever one
  // start is in flight at a time, so clearing `starting` on settle is safe.
  function beginStart(model: WhisperModelName): Promise<ActiveSidecar> {
    const promise = startSidecar(model).finally(() => {
      starting = null;
    });
    starting = { model, promise };
    return promise;
  }

  async function ensureSidecar(model: WhisperModelName): Promise<ActiveSidecar> {
    // Loop so that after awaiting an in-flight start for a DIFFERENT model we
    // re-evaluate; the decision-to-spawn path (beginStart) has no await, so the
    // first waiter sets `starting` synchronously and siblings then reuse it.
    for (;;) {
      if (sidecar && sidecar.model === model && !sidecar.proc.killed) return sidecar;
      if (starting && starting.model === model) return starting.promise;
      if (starting) {
        await starting.promise.catch(() => undefined);
        continue;
      }
      if (sidecar && sidecar.model !== model) shutdown();
      return beginStart(model);
    }
  }

  async function warmup(model: WhisperModelName): Promise<void> {
    try {
      await ensureSidecar(model);
    } catch (err) {
      logger.warn("sidecar: warmup failed", { model, error: errorMessage(err) });
    }
  }

  async function transcribeWav(wavPath: string, language: string, model: WhisperModelName): Promise<string> {
    const active = await ensureSidecar(model);
    const buf = await readFile(wavPath);
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/wav" }), "audio.wav");
    form.append("response_format", "json");
    form.append("language", language || "auto");
    let res: Response;
    try {
      res = await fetch(`http://${HOST}:${active.port}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS) });
    } catch (err) {
      throw new Error(`whisper-server request failed: ${errorMessage(err)}`);
    }
    if (!res.ok) throw new Error(`whisper-server returned HTTP ${res.status}`);
    return parseInferenceText(await res.json());
  }

  return { transcribeWav, warmup, shutdown };
}
