// Bell-side composable backed by the notifier engine.
//
// PR 4 of feat-encore migrated `publishNotification()` onto the new
// engine, so the bell consumes the same data as the dev-mode debug
// popup: a single global pubsub channel (`PUBSUB_CHANNELS.notifier`),
// primed via `POST /api/notifier {action: "list" | "listHistory"}`.
//
// Singleton state shared across consumers: a single subscription is
// shared between the bell badge, the panel, and any other surface
// that wants to render the same source of truth. Subscriber counting
// + ref-counted teardown matches the legacy composable's pattern so
// the websocket subscription doesn't leak when every consumer
// unmounts.

import { computed, onUnmounted, ref, type ComputedRef, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { PUBSUB_CHANNELS } from "../config/pubsubChannels";
import { apiPost } from "../utils/api";
import { usePubSub } from "./usePubSub";

// Mirror of `server/notifier/types.ts` — repeated here rather than
// imported because the server tree pulls in fs / pubsub deps that
// shouldn't bleed into the client bundle. The two definitions are
// kept in sync by code review.
export interface NotifierEntry {
  id: string;
  pluginPkg: string;
  severity: "info" | "nudge" | "urgent";
  lifecycle?: "fyi" | "action";
  title: string;
  body?: string;
  navigateTarget?: string;
  pluginData?: unknown;
  createdAt: string;
}

export interface NotifierHistoryEntry extends NotifierEntry {
  terminalType: "cleared" | "cancelled";
  terminalAt: string;
}

type NotifierEvent =
  | { type: "published"; entry: NotifierEntry }
  | { type: "cleared"; id: string }
  | { type: "cancelled"; id: string }
  | { type: "updated"; entry: NotifierEntry };

const HISTORY_CAP = 50;

const entries = ref<NotifierEntry[]>([]);
const history = ref<NotifierHistoryEntry[]>([]);
const ready = ref(false);

let subscriberCount = 0;
let unsubscribeFn: (() => void) | null = null;
let primePromise: Promise<void> | null = null;

async function prime(): Promise<void> {
  if (primePromise) return primePromise;
  primePromise = (async () => {
    const [activeResult, historyResult] = await Promise.all([
      apiPost<{ entries: NotifierEntry[] }>(API_ROUTES.notifier.dispatch, { action: "list" }),
      apiPost<{ history: NotifierHistoryEntry[] }>(API_ROUTES.notifier.dispatch, { action: "listHistory" }),
    ]);
    if (activeResult.ok) entries.value = activeResult.data.entries;
    if (historyResult.ok) history.value = historyResult.data.history;
    ready.value = true;
  })();
  return primePromise;
}

function applyEvent(event: NotifierEvent): void {
  switch (event.type) {
    case "published":
      // Dedup against optimistic local update — the host UI clear
      // button already removed the entry; ignore the echoing event.
      if (!entries.value.some((entry) => entry.id === event.entry.id)) {
        entries.value = [...entries.value, event.entry];
      }
      return;
    case "updated": {
      // In-place replacement: same id, fresh title/body/severity.
      // No history record — the entry is still active. If the id
      // isn't in our local set (subscribed mid-flight, or the
      // entry was optimistically cleared elsewhere), fall back to
      // append so the bell at least surfaces live state.
      const index = entries.value.findIndex((entry) => entry.id === event.entry.id);
      if (index >= 0) {
        const next = entries.value.slice();
        next[index] = event.entry;
        entries.value = next;
      } else {
        entries.value = [...entries.value, event.entry];
      }
      return;
    }
    case "cleared":
    case "cancelled": {
      const removed = entries.value.find((entry) => entry.id === event.id);
      entries.value = entries.value.filter((entry) => entry.id !== event.id);
      if (removed) {
        const historyEntry: NotifierHistoryEntry = {
          ...removed,
          terminalType: event.type === "cleared" ? "cleared" : "cancelled",
          terminalAt: new Date().toISOString(),
        };
        history.value = [historyEntry, ...history.value].slice(0, HISTORY_CAP);
      }
    }
  }
}

function ensureSubscribed(subscribe: ReturnType<typeof usePubSub>["subscribe"]): void {
  subscriberCount += 1;
  if (unsubscribeFn) return;
  unsubscribeFn = subscribe(PUBSUB_CHANNELS.notifier, (data) => applyEvent(data as NotifierEvent));
  void prime();
}

function releaseSubscription(): void {
  subscriberCount -= 1;
  if (subscriberCount <= 0 && unsubscribeFn) {
    unsubscribeFn();
    unsubscribeFn = null;
    subscriberCount = 0;
  }
}

export function useNotifications(): {
  entries: ComputedRef<NotifierEntry[]>;
  history: Ref<NotifierHistoryEntry[]>;
  badgeCount: ComputedRef<number>;
  /** Worst-severity-wins Tailwind class. Mirrors the dev debug popup
   *  and matches the bell-badge encoding in `feat-notifier-ux.md`. */
  badgeColor: ComputedRef<string>;
  ready: Ref<boolean>;
  clear: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
} {
  const { subscribe } = usePubSub();
  ensureSubscribed(subscribe);
  onUnmounted(releaseSubscription);

  // Sort oldest-first so a row's vertical position doesn't jump when
  // a fresh entry arrives at the bottom — the same scan order the
  // debug popup uses. The bell panel then visually inverts via flex
  // direction, matching today's "newest at the top" expectation.
  const sortedEntries = computed(() => [...entries.value].sort((left, right) => left.createdAt.localeCompare(right.createdAt)));

  const badgeCount = computed(() => entries.value.length);

  const badgeColor = computed(() => {
    if (entries.value.some((entry) => entry.severity === "urgent")) return "bg-red-500";
    if (entries.value.some((entry) => entry.severity === "nudge")) return "bg-amber-500";
    return "bg-gray-400";
  });

  /** Remove an entry from the active list and prepend a synthetic
   *  history record. Used optimistically by `clear` / `cancel` so the
   *  bell reacts before the server round-trip completes; `applyEvent`
   *  is idempotent on the eventual pubsub echo (the entry is already
   *  gone from `entries`, so its `cleared`/`cancelled` branch finds
   *  nothing to remove and skips the history append).
   *
   *  No-op if the entry was already taken out (e.g. another tab raced
   *  us via the pubsub event); preserves single-history-entry-per-id
   *  semantics. */
  function moveToHistoryLocally(entryId: string, terminalType: "cleared" | "cancelled"): void {
    const removed = entries.value.find((entry) => entry.id === entryId);
    if (!removed) return;
    entries.value = entries.value.filter((entry) => entry.id !== entryId);
    const historyEntry: NotifierHistoryEntry = {
      ...removed,
      terminalType,
      terminalAt: new Date().toISOString(),
    };
    history.value = [historyEntry, ...history.value].slice(0, HISTORY_CAP);
  }

  async function clear(entryId: string): Promise<void> {
    moveToHistoryLocally(entryId, "cleared");
    const result = await apiPost<{ ok: true }>(API_ROUTES.notifier.dispatch, { action: "clear", id: entryId });
    if (!result.ok) {
      // Rendering this in console rather than the panel itself —
      // the panel is small and we don't want a transient API error
      // shouting at the user. A future prime() would resync state
      // if the server is genuinely out of sync.
      console.error("[useNotifications] clear failed", result.error);
    }
  }

  async function cancel(entryId: string): Promise<void> {
    moveToHistoryLocally(entryId, "cancelled");
    const result = await apiPost<{ ok: true }>(API_ROUTES.notifier.dispatch, { action: "cancel", id: entryId });
    if (!result.ok) console.error("[useNotifications] cancel failed", result.error);
  }

  return { entries: sortedEntries, history, badgeCount, badgeColor, ready, clear, cancel };
}
