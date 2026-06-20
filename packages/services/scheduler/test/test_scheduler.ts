import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCHEDULE_TYPES, MISSED_RUN_POLICIES } from "@receptron/task-scheduler";
import {
  createTaskManager,
  configureScheduler,
  initScheduler,
  getSchedulerTasks,
  resetSchedulerForTesting,
  type ITaskManager,
  type TaskDefinition,
  type SystemTaskDef,
} from "../src/index.ts";

const stubTm = (over: Partial<ITaskManager>): ITaskManager => ({
  registerTask: () => {},
  removeTask: () => {},
  updateSchedule: () => true,
  start: () => {},
  stop: () => {},
  tick: async () => {},
  listTasks: () => [],
  ...over,
});

afterEach(() => resetSchedulerForTesting());

// ── task-manager (tick engine) ────────────────────────────────────

test("tick runs due interval tasks", async () => {
  const ran: string[] = [];
  // A 1-minute interval task is due at UTC midnight (0 ms since midnight).
  const manager = createTaskManager({ tickMs: 60_000, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) });
  manager.registerTask({
    id: "a",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      ran.push("a");
    },
  });
  await manager.tick();
  assert.deepEqual(ran, ["a"]);
});

test("dependsOn enforces ordering within a tick; dependent skipped if dep fails", async () => {
  const order: string[] = [];
  const manager = createTaskManager({ tickMs: 60_000, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) });
  manager.registerTask({
    id: "dep",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      order.push("dep");
    },
  });
  manager.registerTask({
    id: "child",
    dependsOn: "dep",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      order.push("child");
    },
  });
  await manager.tick();
  assert.deepEqual(order, ["dep", "child"]);

  const order2: string[] = [];
  const tm2 = createTaskManager({ tickMs: 60_000, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0)) });
  tm2.registerTask({
    id: "dep",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      throw new Error("boom");
    },
  });
  tm2.registerTask({
    id: "child",
    dependsOn: "dep",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 60_000 },
    run: async () => {
      order2.push("child");
    },
  });
  await tm2.tick();
  assert.deepEqual(order2, []); // child never runs because dep did not succeed
});

test("registerTask rejects duplicate ids; updateSchedule returns false for unknown", () => {
  const manager = createTaskManager();
  manager.registerTask({ id: "a", schedule: { type: SCHEDULE_TYPES.daily, time: "09:00" }, run: async () => {} });
  assert.throws(() => manager.registerTask({ id: "a", schedule: { type: SCHEDULE_TYPES.daily, time: "10:00" }, run: async () => {} }));
  assert.equal(manager.updateSchedule("missing", { type: SCHEDULE_TYPES.daily, time: "10:00" }), false);
  assert.equal(manager.updateSchedule("a", { type: SCHEDULE_TYPES.daily, time: "10:00" }), true);
});

// ── adapter (catch-up + persistence + state) ──────────────────────

function configure(root: string): void {
  configureScheduler({
    workspaceRoot: root,
    writeFileAtomic: async (filePath, content) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    },
  });
}

test("initScheduler registers system tasks with the task-manager and exposes their state", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sched-"));
  try {
    configure(root);
    const registered: string[] = [];
    const fakeTm = stubTm({
      registerTask: (def: TaskDefinition) => {
        registered.push(def.id);
      },
    });
    const tasks: SystemTaskDef[] = [
      {
        id: "system:journal",
        name: "Journal",
        description: "d",
        schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 3_600_000 },
        missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
        run: async () => {},
      },
    ];
    await initScheduler(fakeTm, tasks);
    assert.deepEqual(registered, ["system:journal"]);
    const states = getSchedulerTasks();
    assert.equal(states.length, 1);
    assert.equal(states[0].id, "system:journal");
    // state.json directory was created under the injected workspace root.
    assert.ok(existsSync(path.join(root, "config", "scheduler")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a scheduled run executes the task and persists state to the injected workspace", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sched-"));
  try {
    configure(root);
    let ran = 0;
    const captured: { run?: TaskDefinition["run"] } = {};
    const fakeTm = stubTm({
      registerTask: (def: TaskDefinition) => {
        captured.run = def.run;
      },
    });
    await initScheduler(fakeTm, [
      {
        id: "system:feed",
        name: "Feed",
        description: "d",
        schedule: { type: SCHEDULE_TYPES.interval, intervalMs: 3_600_000 },
        missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
        run: async () => {
          ran++;
        },
      },
    ]);
    const runThunk = captured.run;
    assert.ok(runThunk, "task-manager received a run thunk");
    await runThunk({ taskId: "system:feed", now: new Date() });
    assert.equal(ran, 1);
    const statePath = path.join(root, "config", "scheduler", "state.json");
    assert.ok(existsSync(statePath));
    const persisted = JSON.parse(readFileSync(statePath, "utf-8"));
    assert.ok(JSON.stringify(persisted).includes("system:feed"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
