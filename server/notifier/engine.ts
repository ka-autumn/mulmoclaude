// Notifier engine — thin host binding over @mulmoclaude/notifier. The
// engine logic (validation, write coordinator, active+history
// persistence, fan-out) lives in the shared package so MulmoClaude and
// MulmoTerminal run one notification engine; this file injects the
// host's workspace paths, atomic JSON writer, pub-sub channel, and
// logger, and preserves the export surface existing callers + tests
// import from `../notifier/engine.js`.

import { PUBSUB_CHANNELS } from "../../src/config/pubsubChannels.js";
import { log } from "../system/logger/index.js";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { writeJsonAtomic } from "../utils/files/json.js";
import { configureNotifier, setNotifierFilePaths, type NotifierEvent } from "@mulmoclaude/notifier";

// Engine methods + validation re-exported verbatim from the package.
export {
  publish,
  clear,
  cancel,
  updateForPlugin,
  getForPlugin,
  clearForPlugin,
  get,
  listFor,
  listAll,
  listHistory,
  onEvent,
  validatePublishInput,
  NOTIFIER_LIMITS,
} from "@mulmoclaude/notifier";

// Bind production active/history paths at module load — mirrors the
// previous module-init default (`let activeFilePath = WORKSPACE_PATHS…`).
// `initNotifier` deliberately does NOT touch paths, so test code can
// call `_setFilePathsForTesting` before `initNotifier` without the
// latter clobbering the temp paths.
setNotifierFilePaths({ active: WORKSPACE_PATHS.notifierActive, history: WORKSPACE_PATHS.notifierHistory });

// ── Dependency injection (matches server/events/notifications.ts) ──

export interface NotifierDeps {
  publish: (channel: string, payload: unknown) => void;
}

export function initNotifier(injected: NotifierDeps): void {
  configureNotifier({
    writeJson: writeJsonAtomic,
    publishEvent: (event: NotifierEvent) => injected.publish(PUBSUB_CHANNELS.notifier, event),
    log: {
      warn: (message, data) => log.warn("notifier", message, data),
      error: (message, data) => log.error("notifier", message, data),
    },
  });
}

/** Test-only: redirect the engine at temp files. Resets the queue too. */
export function _setFilePathsForTesting(paths: { active: string; history: string }): void {
  setNotifierFilePaths(paths);
}
