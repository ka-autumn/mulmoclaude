// Per-plugin mutex. All dispatch calls and all ticks serialise
// through one Promise-chain so:
//
//   - Two concurrent handler calls can't tmp+rename the same cycle
//     file at once (writeFileAtomic ENOENT race).
//   - A handler that kicks the tick can't race the hourly heartbeat
//     into double-publishing the same notification.
//
// Implementation split:
//   - `withLock(fn)`: appends fn to the chain; returns its result.
//     Errors don't poison the chain — the next consumer's wait
//     resolves regardless.
//   - `kickTickLocked(reason)`: acquires the lock, runs the tick,
//     releases. Handlers call this AFTER persisting; the hourly
//     heartbeat also goes through this.
//   - `runDispatchLocked(fn)`: thin alias for withLock — exists for
//     readability at call sites in dispatch.ts.
//
// Handlers that need to kick the tick from inside their critical
// section MUST NOT call kickTickLocked (it would deadlock). They
// invoke `tickUnlocked` directly. The boot wiring + the hourly
// heartbeat both call kickTickLocked so external callers don't
// have to think about which one to pick.

import { log } from "../system/logger/index.js";
import { runTick, type TickDeps } from "./tick.js";

let pluginLock: Promise<unknown> = Promise.resolve();

/** Append `fn` to the per-plugin chain. Returns `fn`'s result. */
export function withLock<T>(task: () => Promise<T>): Promise<T> {
  const next = pluginLock.catch(() => undefined).then(task);
  pluginLock = next.catch(() => undefined);
  return next;
}

/** Run the tick without acquiring the lock. Callers that already
 *  hold the lock (e.g. a handler that wants to kick the tick from
 *  inside its critical section) use this; everyone else uses
 *  `kickTickLocked`. */
export async function tickUnlocked(deps: TickDeps, reason: string): Promise<void> {
  try {
    await runTick(deps);
  } catch (err) {
    log.warn("encore", "tick: unhandled error", { reason, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Acquire the lock, run the tick, release. The hourly heartbeat
 *  and `kickTick`-from-handler calls both come through here so the
 *  serialisation guarantee applies. */
export async function kickTickLocked(deps: TickDeps, reason: string): Promise<void> {
  await withLock(() => tickUnlocked(deps, reason));
}

/** Reset the lock to a fresh resolved Promise. Test-only — production
 *  code never wants this; the chain is meant to live for the process
 *  lifetime. */
export function _resetLockForTesting(): void {
  pluginLock = Promise.resolve();
}
