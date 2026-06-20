// Scheduler adapter — thin host binding over @mulmoclaude/scheduler. The
// persistence/catch-up adapter over @receptron/task-scheduler lives in the
// shared package; this file injects MulmoClaude's workspace root, atomic
// file writer, and logger, and re-exports the surface existing callers +
// routes import from `./scheduler-adapter.js`. The system task DEFINITIONS
// (journal / chat-index / feed-refresh) stay in server/index.ts and are
// passed into `initScheduler`.

import { workspacePath } from "../workspace/workspace.js";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { log } from "../system/logger/index.js";
import { configureScheduler } from "@mulmoclaude/scheduler";

export { initScheduler, applyScheduleOverride, getSchedulerLogs, getSchedulerTasks, type SystemTaskDef } from "@mulmoclaude/scheduler";

// Configure the package at module load — before `initScheduler` runs at
// boot. The atomic writer is the host's (single-sourced with its other
// writers); the logger prefixes the "scheduler" scope the package omits.
configureScheduler({
  workspaceRoot: workspacePath,
  writeFileAtomic,
  log: {
    info: (message, data) => log.info("scheduler", message, data),
    warn: (message, data) => log.warn("scheduler", message, data),
    error: (message, data) => log.error("scheduler", message, data),
  },
});
