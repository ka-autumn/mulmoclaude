// Task-manager — thin host binding over @mulmoclaude/scheduler. The
// generic dependency-ordered tick engine lives in the shared package;
// this file injects MulmoClaude's logger and re-exports the surface
// existing callers + tests import from `./task-manager/index.js`.

import { log } from "../../system/logger/index.js";
import { createTaskManager as createSharedTaskManager, type ITaskManager, type TaskManagerOptions } from "@mulmoclaude/scheduler";

export type { ITaskManager, TaskDefinition, TaskSchedule, TaskRunContext, TaskManagerOptions } from "@mulmoclaude/scheduler";

/** Create a task-manager wired to MulmoClaude's logger (the package logs
 *  host-agnostically; we prefix the "task-manager" scope here). Callers
 *  may still override `tickMs` / `now`; an explicit `log` wins. */
export function createTaskManager(options?: TaskManagerOptions): ITaskManager {
  return createSharedTaskManager({
    log: {
      info: (message, data) => log.info("task-manager", message, data),
      warn: (message, data) => log.warn("task-manager", message, data),
      error: (message, data) => log.error("task-manager", message, data),
    },
    ...options,
  });
}
