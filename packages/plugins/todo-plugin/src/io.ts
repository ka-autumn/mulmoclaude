// Persistence layer — reads/writes todos.json + columns.json under
// the plugin's runtime.files.data scope root.
//
// The data shape mirrors what `server/utils/files/todos-io.ts` (now
// removed) wrote: a JSON-serialised `TodoItem[]` and `StatusColumn[]`.
// Pre-#1145 installs that still keep todos under
// `data/todos/{todos,columns}.json` will need to move them under the
// scope dir by hand (`data/plugins/%40mulmoclaude%2Ftodo-plugin/`) —
// the plugin reads from the new path only.

import type { FileOps } from "gui-chat-protocol";
import type { TodoItem, StatusColumn } from "./types";
import { DEFAULT_COLUMNS, normalizeColumns } from "./handlers/columns";
import { migrateItems } from "./handlers/items";

const TODOS_FILE = "todos.json";
const COLUMNS_FILE = "columns.json";

async function readJson(files: FileOps, rel: string): Promise<unknown> {
  if (!(await files.exists(rel))) return undefined;
  try {
    return JSON.parse(await files.read(rel));
  } catch {
    return undefined;
  }
}

// Item-level shape narrowing — drops anything that isn't a usable
// TodoItem. The four required fields gate the rest of the plugin's
// invariants (id is the dispatch key, text is rendered, completed
// drives status backfill, createdAt is the implicit secondary sort).
// Optional fields (note / labels / status / priority / dueDate /
// order) get whatever the on-disk JSON says without further
// narrowing — `migrateItems` defends against bad `status` and
// missing `order`; the others are presentation-layer.
function isTodoItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.text === "string" && typeof obj.completed === "boolean" && typeof obj.createdAt === "number";
}

export async function loadColumns(files: FileOps): Promise<StatusColumn[]> {
  const raw = await readJson(files, COLUMNS_FILE);
  return normalizeColumns(raw ?? DEFAULT_COLUMNS);
}

export async function saveColumns(files: FileOps, columns: StatusColumn[]): Promise<void> {
  await files.write(COLUMNS_FILE, JSON.stringify(columns, null, 2));
}

export async function loadTodos(files: FileOps): Promise<TodoItem[]> {
  // `todos.json` is user-editable + workspace-shared, so a corrupted
  // shape (manual edit, partial write from a kill -9, schema drift
  // from a future version) must degrade gracefully rather than
  // crash every dispatch with `rawItems.map is not a function`.
  // Codex review iter on PR #1149.
  const raw = await readJson(files, TODOS_FILE);
  const items = Array.isArray(raw) ? raw.filter(isTodoItem) : [];
  const columns = await loadColumns(files);
  return migrateItems(items, columns);
}

export async function saveTodos(files: FileOps, items: TodoItem[]): Promise<void> {
  await files.write(TODOS_FILE, JSON.stringify(items, null, 2));
}
