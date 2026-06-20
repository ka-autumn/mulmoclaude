// @mulmoclaude/scheduler — the cron tick engine + persistence/catch-up
// adapter shared by MulmoClaude and MulmoTerminal. The engine
// (task-manager) and the @receptron/task-scheduler binding (adapter) are
// host-agnostic; the host injects its workspace root, atomic writer, and
// logger via `configureScheduler`, and supplies its OWN system tasks
// (journal / feeds / user-cron) to `initScheduler`. The package owns no
// task definitions and no routes — those stay host-side.
export {
  createTaskManager,
  type ITaskManager,
  type TaskDefinition,
  type TaskSchedule,
  type TaskRunContext,
  type TaskManagerOptions,
  type SchedulerLogger,
} from "./task-manager.js";
export {
  configureScheduler,
  initScheduler,
  applyScheduleOverride,
  getSchedulerLogs,
  getSchedulerTasks,
  resetSchedulerForTesting,
  type SchedulerConfig,
  type SystemTaskDef,
} from "./adapter.js";
