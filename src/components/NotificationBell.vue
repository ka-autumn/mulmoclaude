<script setup lang="ts">
// Bell badge + popup, backed by the notifier engine (PR 4 of
// feat-encore). Active section on top, History below, single scroll,
// no tabs. Active rows use a bell icon (severity-colored) instead of
// a colored dot — at-a-glance "this is a notification" is more
// readable than a generic dot. History rows fall back to a faded
// dot so the row reads as past-tense.
//
// Body is displayed only as a native hover tooltip (`:title=`) — the
// row stays compact and the relative-time meta line is what the user
// scans for "when was this?".
//
// The dev-mode `NotifierDebugPopup` that ran in parallel during PR 3
// is gone — the production bell now serves both audiences.
// `NotificationToast.vue` is also gone; the worst-severity badge
// color (gray / amber / red) is the at-a-distance signal.

import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useNotifications, type NotifierEntry, type NotifierHistoryEntry } from "../composables/useNotifications";
import { formatRelativeTime } from "../utils/format/date";
import type { NotificationI18n, NotificationKind, NotificationPriority } from "../types/notification";
import { isRecord } from "../utils/types";

const { t } = useI18n();
const router = useRouter();

const { entries, history, badgeCount, badgeColor, clear, cancel } = useNotifications();

const props = defineProps<{ forceClose?: boolean }>();
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

// Bell mirrors the debug popup's "newest first" panel order — sort
// in reverse of the composable's oldest-first output.
const visibleEntries = computed(() => [...entries.value].reverse());
const visibleHistory = computed(() => history.value);
const fyiCount = computed(() => entries.value.filter((entry) => (entry.lifecycle ?? "fyi") === "fyi").length);

const badgeText = computed(() => (badgeCount.value > 99 ? "99+" : String(badgeCount.value)));

// History collapses to N rows on open; everything beyond hides behind
// the "Show more" toggle. Keeps the panel scannable when the 50-item
// HISTORY_CAP fills with repetitive entries (e.g. recurring
// "docker not running" notifications burying active items).
const HISTORY_INITIAL_VISIBLE = 5;
const historyExpanded = ref(false);
const displayedHistory = computed(() => (historyExpanded.value ? visibleHistory.value : visibleHistory.value.slice(0, HISTORY_INITIAL_VISIBLE)));
const hiddenHistoryCount = computed(() => Math.max(0, visibleHistory.value.length - HISTORY_INITIAL_VISIBLE));
const canToggleHistory = computed(() => visibleHistory.value.length > HISTORY_INITIAL_VISIBLE);

function toggleHistoryExpanded(): void {
  historyExpanded.value = !historyExpanded.value;
}

// Hover state on the bulk-clear button — every fyi row's hover-check
// icon renders while it's true, mirroring the debug popup's "this is
// what's about to get swept" affordance.
const hoveringClearAll = ref(false);

function close(): void {
  open.value = false;
  emit("update:open", false);
}

function toggle(): void {
  open.value = !open.value;
  emit("update:open", open.value);
}

function onDocumentClick(event: MouseEvent): void {
  if (!open.value || !rootRef.value) return;
  if (!rootRef.value.contains(event.target as Node)) close();
}

onMounted(() => document.addEventListener("mousedown", onDocumentClick));
onUnmounted(() => document.removeEventListener("mousedown", onDocumentClick));

watch(
  () => props.forceClose,
  (shouldClose) => {
    if (shouldClose && open.value) close();
  },
);

// Reset history expansion when the popup closes so the next open
// starts from the collapsed 5-row view. Without this, an expanded
// state persists across closes and the scroll position jumps.
watch(open, (nowOpen: boolean) => {
  if (!nowOpen) historyExpanded.value = false;
});

// ── Legacy pluginData typing ────────────────────────────────
//
// `publishNotification()` stashes legacy fields under
// `pluginData.legacy = true`. The bell type-narrows here so it can
// preserve i18n localization for entries that came through the
// wrapper. Future direct callers of `notifier.publish()` don't set
// this shape; their entries fall back to the engine-level
// `entry.title` / `entry.body`.

interface LegacyPluginDataShape {
  legacy: true;
  legacyId: string;
  kind: NotificationKind;
  priority: NotificationPriority;
  i18n?: NotificationI18n;
}

function asLegacy(entry: { pluginData?: unknown }): LegacyPluginDataShape | null {
  const data = entry.pluginData;
  if (!isRecord(data)) return null;
  if (data.legacy !== true) return null;
  if (typeof data.legacyId !== "string") return null;
  if (typeof data.kind !== "string") return null;
  if (typeof data.priority !== "string") return null;
  return data as unknown as LegacyPluginDataShape;
}

function localizeTitle(entry: NotifierEntry | NotifierHistoryEntry): string {
  const legacy = asLegacy(entry);
  if (legacy?.i18n) return t(legacy.i18n.titleKey, legacy.i18n.titleParams ?? {});
  return entry.title;
}

function localizeBody(entry: NotifierEntry | NotifierHistoryEntry): string | undefined {
  const legacy = asLegacy(entry);
  if (legacy?.i18n?.bodyKey) return t(legacy.i18n.bodyKey, legacy.i18n.bodyParams ?? {});
  return entry.body;
}

function severityIconColor(severity: NotifierEntry["severity"]): string {
  switch (severity) {
    case "urgent":
      return "text-red-500";
    case "nudge":
      return "text-amber-500";
    case "info":
    default:
      return "text-gray-300";
  }
}

// History rows keep the original colored-dot encoding (faded) — the
// bell icon is reserved for Active so the eye distinguishes "still
// open" from "already closed" at a glance.
function severityDotClassForHistory(severity: NotifierEntry["severity"]): string {
  switch (severity) {
    case "urgent":
      return "bg-red-500";
    case "nudge":
      return "bg-amber-500";
    case "info":
    default:
      return "bg-gray-300";
  }
}

function formatTime(iso: string): string {
  return formatRelativeTime(iso);
}

/** Strip the leading `@scope/` from a scoped npm package name for
 *  display. The `@mulmoclaude/` prefix on plugin pluginPkgs is noise
 *  in a meta line — what readers want is the suffix. Unscoped names
 *  (the legacy `host` / `todo` / `agent` / … pluginPkgs that the
 *  wrapper assigns) pass through unchanged. */
function shortPkg(pluginPkg: string): string {
  return pluginPkg.startsWith("@") ? pluginPkg.split("/").slice(1).join("/") || pluginPkg : pluginPkg;
}

/** Splice `notificationId=<id>` into the navigateTarget so the landing
 *  page (action-lifecycle plugin views, e.g. the debug page's
 *  `?mode=auto-clear` / `?mode=manual-clear` modes) can identify which
 *  entry triggered the navigation and call `clear(id)` accordingly.
 *  Harmless on legacy fyi targets that don't read the query.
 *
 *  Inserts before any `#hash` so the fragment stays at the end —
 *  `?a=1#frag` becomes `?a=1&notificationId=…#frag`, not
 *  `?a=1#frag&notificationId=…`. */
function appendNotificationId(target: string, entryId: string): string {
  const hashIdx = target.indexOf("#");
  const beforeHash = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
  const hash = hashIdx >= 0 ? target.slice(hashIdx) : "";
  const separator = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${separator}notificationId=${encodeURIComponent(entryId)}${hash}`;
}

async function navigateAndClose(target: string, entryId: string): Promise<void> {
  close();
  await router.push(appendNotificationId(target, entryId)).catch(() => {});
}

/** Lifecycle-correct primary action for an Active row. The keyboard
 *  Enter/Space handler routes through here so keyboard users get a
 *  single, predictable activation regardless of where focus is —
 *  separate from the mouse two-tier UX that distinguishes body click
 *  vs row-padding click. fyi: navigate (if target) then clear.
 *  action: navigate only (plugin owns the clear). */
function performPrimaryAction(entry: NotifierEntry): void {
  if (entry.navigateTarget) void navigateAndClose(entry.navigateTarget, entry.id);
  if ((entry.lifecycle ?? "fyi") === "fyi") void clear(entry.id);
}

// True when activating the row (click, Enter, Space) does anything
// useful — either clears a fyi notification or navigates to the
// action's target. Action notifications without a `navigateTarget`
// fall through both branches, so their row is not a button and
// should not advertise as one to assistive technology.
function hasPrimaryAction(entry: NotifierEntry): boolean {
  return Boolean(entry.navigateTarget) || (entry.lifecycle ?? "fyi") === "fyi";
}

// Body click on an Active row. Stop propagation so the outer <li>'s
// fyi-clear handler doesn't double-fire when a fyi click already
// lands here (matches the debug popup's two-layer click handling).
function onActiveRowBodyClick(entry: NotifierEntry, event: MouseEvent): void {
  event.stopPropagation();
  performPrimaryAction(entry);
}

// Outer-row click — fyi only. Action rows must use the body div or
// the trailing × so the user can't accidentally cancel by clicking
// padding. Keyboard activation goes through `performPrimaryAction`
// instead, which works for both lifecycles.
function onActiveRowClick(entry: NotifierEntry): void {
  const lifecycle = entry.lifecycle ?? "fyi";
  if (lifecycle !== "fyi") return;
  performPrimaryAction(entry);
}

async function handleDismiss(event: Event, entry: NotifierEntry): Promise<void> {
  event.stopPropagation();
  const lifecycle = entry.lifecycle ?? "fyi";
  if (lifecycle === "fyi") await clear(entry.id);
  else await cancel(entry.id);
}

async function handleHistoryClick(entry: NotifierHistoryEntry): Promise<void> {
  if (!entry.navigateTarget) return;
  await navigateAndClose(entry.navigateTarget, entry.id);
}

async function clearAllFyi(): Promise<void> {
  const ids = entries.value.filter((entry) => (entry.lifecycle ?? "fyi") === "fyi").map((entry) => entry.id);
  for (const entryId of ids) await clear(entryId);
}
</script>

<template>
  <div ref="rootRef" class="relative">
    <button
      class="relative h-8 w-8 flex items-center justify-center rounded text-gray-400 hover:text-gray-700"
      data-testid="notification-bell"
      :aria-label="t('notificationBell.notifications')"
      @click="toggle"
    >
      <span class="material-icons">notifications</span>
      <span
        v-if="badgeCount > 0"
        :class="[
          'absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-0.5 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none',
          badgeColor,
        ]"
        data-testid="notification-badge"
      >
        {{ badgeText }}
      </span>
    </button>

    <div
      v-if="open"
      class="absolute left-0 top-full mt-1 w-96 max-h-[80vh] bg-white border border-gray-200 rounded-lg shadow-lg z-50 flex flex-col text-xs overflow-hidden"
      data-testid="notification-panel"
    >
      <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <span class="font-semibold text-gray-700">{{ t("notificationBell.notifications") }}</span>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div class="flex items-center px-3 py-1.5 border-b border-gray-100 bg-gray-50">
          <span class="text-gray-500 font-medium">{{ t("notificationBell.activeSection") }} ({{ visibleEntries.length }})</span>
          <button
            v-if="fyiCount > 0"
            type="button"
            class="ml-auto text-gray-500 font-medium hover:text-green-600"
            data-testid="notification-clear-all"
            @click="clearAllFyi"
            @mouseenter="hoveringClearAll = true"
            @mouseleave="hoveringClearAll = false"
          >
            {{ t("notificationBell.clearAll") }}
          </button>
        </div>
        <p v-if="visibleEntries.length === 0" class="px-3 py-3 text-gray-400 italic" data-testid="notification-empty-active">
          {{ t("notificationBell.noActive") }}
        </p>
        <ul v-else class="divide-y divide-gray-100">
          <li
            v-for="entry in visibleEntries"
            :key="entry.id"
            :data-testid="`notification-item-${entry.id}`"
            :data-lifecycle="entry.lifecycle ?? 'fyi'"
            :role="hasPrimaryAction(entry) ? 'button' : undefined"
            :tabindex="hasPrimaryAction(entry) ? 0 : undefined"
            :aria-label="hasPrimaryAction(entry) ? localizeTitle(entry) : undefined"
            :class="['px-3 py-2 group focus:bg-gray-100 focus:outline-none', (entry.lifecycle ?? 'fyi') === 'fyi' ? 'cursor-pointer hover:bg-gray-50' : '']"
            @click="onActiveRowClick(entry)"
            @keydown.enter.prevent.self="(e) => hasPrimaryAction(entry) && !e.repeat && performPrimaryAction(entry)"
            @keydown.space.prevent.self="(e) => hasPrimaryAction(entry) && !e.repeat && performPrimaryAction(entry)"
          >
            <div class="flex items-start gap-2">
              <span
                :class="['material-icons text-sm shrink-0 leading-none mt-0.5', severityIconColor(entry.severity)]"
                :title="entry.severity"
                aria-hidden="true"
              >
                notifications
              </span>
              <div
                :class="[
                  'flex-1 min-w-0',
                  entry.lifecycle === 'action' && entry.navigateTarget
                    ? 'cursor-pointer hover:underline'
                    : (entry.lifecycle ?? 'fyi') === 'fyi'
                      ? 'cursor-pointer'
                      : '',
                ]"
                :title="localizeBody(entry) || undefined"
                @click="onActiveRowBodyClick(entry, $event)"
              >
                <div class="flex items-baseline gap-2">
                  <span class="font-medium text-gray-800 truncate">{{ localizeTitle(entry) }}</span>
                  <span v-if="entry.lifecycle" class="text-[10px] uppercase tracking-wide text-gray-400 shrink-0">{{ entry.lifecycle }}</span>
                </div>
                <div class="text-gray-400 mt-0.5 font-mono text-[10px]">{{ formatTime(entry.createdAt) }} · {{ shortPkg(entry.pluginPkg) }}</div>
              </div>
              <button
                v-if="entry.lifecycle === 'action'"
                type="button"
                class="text-gray-400 hover:text-red-500 shrink-0"
                :title="t('notificationBell.cancel')"
                :aria-label="t('notificationBell.cancel')"
                data-testid="notification-dismiss"
                @click="handleDismiss($event, entry)"
              >
                <span class="material-icons text-sm">close</span>
              </button>
              <span
                v-else
                :class="['text-green-500 shrink-0 transition-opacity', hoveringClearAll ? 'opacity-100' : 'opacity-0 group-hover:opacity-100']"
                aria-hidden="true"
                data-testid="notification-fyi-hover-check"
              >
                <span class="material-icons text-sm">check</span>
              </span>
            </div>
          </li>
        </ul>
        <div class="px-3 py-1.5 text-gray-500 font-medium border-y border-gray-100 bg-gray-50">
          {{ t("notificationBell.historySection") }} ({{ visibleHistory.length }})
        </div>
        <p v-if="visibleHistory.length === 0" class="px-3 py-3 text-gray-400 italic" data-testid="notification-empty-history">
          {{ t("notificationBell.noHistory") }}
        </p>
        <ul v-else id="notification-history-list" class="divide-y divide-gray-100">
          <li
            v-for="entry in displayedHistory"
            :key="`${entry.id}-${entry.terminalAt}`"
            :data-testid="`notification-history-${entry.id}`"
            :role="entry.navigateTarget ? 'button' : undefined"
            :tabindex="entry.navigateTarget ? 0 : undefined"
            :aria-label="entry.navigateTarget ? localizeTitle(entry) : undefined"
            :class="['px-3 py-2 focus:bg-gray-100 focus:outline-none', entry.navigateTarget ? 'cursor-pointer hover:bg-gray-50' : '']"
            @click="entry.navigateTarget && handleHistoryClick(entry)"
            @keydown.enter.prevent.self="(e) => entry.navigateTarget && !e.repeat && handleHistoryClick(entry)"
            @keydown.space.prevent.self="(e) => entry.navigateTarget && !e.repeat && handleHistoryClick(entry)"
          >
            <div class="flex items-start gap-2">
              <!-- eslint-disable @intlify/vue-i18n/no-raw-text --
                Symbolic glyph (✓ / ✗) — language-neutral terminal-state
                marker, identical for every locale. Not a translatable
                string. -->
              <span class="mt-0.5 shrink-0 font-bold text-gray-400">
                {{ entry.terminalType === "cleared" ? "✓" : "✗" }}
              </span>
              <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
              <span :class="['mt-1 inline-block w-2 h-2 rounded-full shrink-0 opacity-30', severityDotClassForHistory(entry.severity)]" aria-hidden="true" />
              <div :class="['flex-1 min-w-0', entry.navigateTarget ? 'hover:underline' : '']">
                <div class="flex items-baseline gap-2">
                  <span class="text-gray-700 truncate">{{ localizeTitle(entry) }}</span>
                </div>
                <div class="text-gray-400 mt-0.5 font-mono text-[10px]">
                  {{ formatTime(entry.terminalAt) }} · {{ entry.terminalType }} · {{ shortPkg(entry.pluginPkg) }}
                </div>
              </div>
            </div>
          </li>
        </ul>
        <button
          v-if="canToggleHistory"
          type="button"
          class="w-full px-3 py-1.5 text-gray-500 font-medium hover:text-gray-700 hover:bg-gray-50 border-t border-gray-100"
          data-testid="notification-history-toggle"
          :aria-expanded="historyExpanded"
          aria-controls="notification-history-list"
          @click="toggleHistoryExpanded"
        >
          {{ historyExpanded ? t("notificationBell.showLess") : t("notificationBell.showMore", { count: hiddenHistoryCount }) }}
        </button>
      </div>
    </div>
  </div>
</template>
