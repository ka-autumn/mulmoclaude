import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbortCausedExit, buildExitErrorEvent } from "../../server/agent/backend/claude-code.js";

// Regression coverage for the stop-button false-error fix (#1625).
// readAgentEvents only suppresses the exit-error event when
// isAbortCausedExit() returns true, so locking this helper locks both
// the "deliberate stop is silent" and "real crash still surfaces" paths.

function aborted(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

test("not aborted: non-zero exit is treated as a real failure", () => {
  // Genuine crash, user did not stop → must surface the error event.
  assert.equal(isAbortCausedExit(143, null, new AbortController().signal), false);
  assert.equal(isAbortCausedExit(1, null, new AbortController().signal), false);
  assert.equal(isAbortCausedExit(null, "SIGTERM", new AbortController().signal), false);
  assert.equal(isAbortCausedExit(1, null, undefined), false);
});

test("aborted + signal-shaped exit: treated as a deliberate stop", () => {
  assert.equal(isAbortCausedExit(143, null, aborted()), true); // SIGTERM → 128+15
  assert.equal(isAbortCausedExit(137, null, aborted()), true); // SIGKILL → 128+9
  assert.equal(isAbortCausedExit(null, "SIGTERM", aborted()), true); // killed by signal directly
  assert.equal(isAbortCausedExit(null, "SIGKILL", aborted()), true);
});

test("aborted but exit is NOT signal-shaped: real error still surfaces", () => {
  // A genuine non-zero exit (code 1) that merely coincides with a stop
  // click must NOT be swallowed — only signal-caused exits are aborts.
  assert.equal(isAbortCausedExit(1, null, aborted()), false);
  assert.equal(isAbortCausedExit(2, null, aborted()), false);
  assert.equal(isAbortCausedExit(null, "SIGSEGV", aborted()), false);
});

test("buildExitErrorEvent: clean exit and deliberate abort produce no event", () => {
  assert.equal(buildExitErrorEvent(0, null, undefined, ""), null);
  assert.equal(buildExitErrorEvent(143, null, aborted(), ""), null);
});

test("buildExitErrorEvent: real failure surfaces an error event", () => {
  const fromCode = buildExitErrorEvent(1, null, undefined, "");
  assert.equal(fromCode?.type, "error");
  assert.equal(fromCode?.message, "claude exited with code 1");
  // stderr, when present, takes precedence over the synthetic summary.
  assert.equal(buildExitErrorEvent(1, null, undefined, "boom")?.message, "boom");
});

test("buildExitErrorEvent: signal-only exit names the signal, never 'code null'", () => {
  const errEvent = buildExitErrorEvent(null, "SIGSEGV", undefined, "");
  assert.equal(errEvent?.message, "claude terminated by signal SIGSEGV");
  assert.equal(buildExitErrorEvent(null, null, undefined, "")?.message, "claude terminated by signal unknown");
});
