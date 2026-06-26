<template>
  <!-- Two separate bordered pills with a gap between them:
       · Group 1 (Chat → Files, +Debug in dev): the Chat button plus the
         fixed plugin-nav buttons, all in one run.
       · Group 2 (favorites): pinned collection / feed shortcuts.
       Neither pill is overflow-hidden so the Chat button's session-count
       badges (negative offsets) aren't clipped; group 2 scrolls horizontally
       via its own overflow-x-auto. -->
  <div class="inline-flex max-w-full items-center gap-2 text-xs" data-testid="plugin-launcher">
    <!-- Group 1: Chat + fixed plugin nav. Never shrinks / scrolls. -->
    <div class="inline-flex flex-none items-stretch border border-gray-300 rounded">
      <!-- Chat button. Leftmost control and the always-visible entry
           point back into a conversation (resumes the most recent chat,
           or starts a fresh one). Carries the active/unread count badges.
           Lights up on /chat. -->
      <button
        class="relative h-8 w-8 flex items-center justify-center rounded-l border-r border-gray-200 transition-colors"
        :class="isChatActive ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'"
        :title="chatAccessibleName"
        :aria-label="chatAccessibleName"
        data-testid="plugin-launcher-chat"
        @click="emit('navigateChat')"
      >
        <span class="material-icons text-base">forum</span>
        <SessionCountBadges :active-session-count="activeSessionCount" :unread-count="unreadCount" />
      </button>
      <button
        v-for="target in visibleTargets"
        :key="target.key"
        :class="[
          'h-8 w-8 flex items-center justify-center border-r border-gray-200 last:border-r-0 last:rounded-r transition-colors',
          isActive(target) ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50',
        ]"
        :title="target.literalTitle ?? t(`pluginLauncher.${target.key}.label`)"
        :aria-label="target.literalLabel ?? t(`pluginLauncher.${target.key}.label`)"
        :data-testid="`plugin-launcher-${target.key}`"
        @click="emit('navigate', target)"
      >
        <span class="material-icons text-base">{{ target.icon }}</span>
      </button>
    </div>

    <!-- Group 2 — pinned shortcuts pill (#feat-shortcut-bar). Appears only
       when the user has pinned at least one collection / feed. Its own
       bordered pill, separated from group 1 by the gap; scrolls horizontally
       on overflow (no cap on the pin count) so a long list never pushes the
       chrome past the viewport. Group 1 stays put. -->
    <div
      v-if="shortcuts.length > 0"
      class="inline-flex min-w-0 items-stretch border border-gray-300 rounded overflow-x-auto [scrollbar-width:thin]"
      :aria-label="t('shortcuts.zoneAriaLabel')"
      data-testid="plugin-launcher-shortcuts"
    >
      <button
        v-for="shortcut in shortcuts"
        :key="`${shortcut.kind}:${shortcut.slug}`"
        :class="[
          'h-8 w-8 flex items-center justify-center flex-none border-r border-gray-200 last:border-r-0 transition-colors',
          isShortcutActive(shortcut) ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50',
        ]"
        :title="shortcut.title"
        :aria-label="shortcut.title"
        :data-testid="`plugin-launcher-shortcut-${shortcut.kind}-${shortcut.slug}`"
        @click="emit('navigateShortcut', shortcut)"
      >
        <!-- Icon-only — the cached title rides the tooltip / aria-label.
           Collections / feeds use the material-symbols font for their
           glyphs (matches the index cards), distinct from the
           material-icons used by the fixed launcher buttons. -->
        <span class="material-symbols-outlined text-base">{{ shortcut.icon }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { PAGE_ROUTES } from "../router/pageRoutes";
import type { Shortcut, ShortcutKind } from "../types/shortcuts";
import SessionCountBadges from "./SessionCountBadges.vue";

const { t } = useI18n();
const route = useRoute();

// Quick-access toolbar sitting above the canvas. Each button
// navigates to a dedicated page (/wiki, /automations, etc.). The "invoke"
// kind is kept in the union for future use but currently all targets
// use "view".

const props = defineProps<{
  /** Current page route name — the matching button lights up. */
  activeViewMode?: string | null;
  /** Pinned shortcuts (collections / feeds) rendered as the third zone. */
  shortcuts?: Shortcut[];
  /** Running-session count — yellow badge on the Chat button. */
  activeSessionCount?: number;
  /** Unread-reply count — red badge on the Chat button. */
  unreadCount?: number;
}>();

const shortcuts = computed<Shortcut[]>(() => props.shortcuts ?? []);

// The Chat button highlights whenever the chat page is active. Unlike
// the data-plugin buttons (matched by `activeViewMode`), chat is a
// dedicated control, so we read the route name directly.
const isChatActive = computed(() => route.name === PAGE_ROUTES.chat);

const activeSessionCount = computed(() => props.activeSessionCount ?? 0);
const unreadCount = computed(() => props.unreadCount ?? 0);

// The Chat button is the only off-chat surface for the active/unread
// session counts, so its accessible name must spell them out — a bare
// "Chat" aria-label would override the badge text and leave screen
// readers with no unread/running signal on /wiki, /files, etc. Reuses
// the same localized plural strings as the badges. (No aria-live: a
// polite region here would re-announce background count changes while
// the user is reading another page; the name is announced when the
// control is focused.)
const chatAccessibleName = computed(() => {
  const parts = [t("pluginLauncher.chat.label")];
  if (activeSessionCount.value > 0) {
    parts.push(t("sessionTabBar.activeSessions", activeSessionCount.value, { named: { count: activeSessionCount.value } }));
  }
  if (unreadCount.value > 0) {
    parts.push(t("sessionTabBar.unreadReplies", unreadCount.value, { named: { count: unreadCount.value } }));
  }
  return parts.join(", ");
});

export type PluginLauncherKind = "view"; // Switch the canvas to a dedicated view mode

// The `key` is also the i18n lookup prefix (see pluginLauncher.*
// in src/lang/en.ts). The button is icon-only; both the tooltip
// (`title`) and screen-reader name (`aria-label`) resolve to the
// same `pluginLauncher.<key>.label` string. Keeping i18n strings
// out of this file avoids duplication across the 8 locales.
export interface PluginLauncherTarget {
  /** Stable key for testid + dispatch in App.vue. */
  key: "dashboard" | "automations" | "wiki" | "collections" | "feeds" | "accounting" | "files" | "debug";
  kind: PluginLauncherKind;
  /** Material-icons glyph. */
  icon: string;
  /** When true, only visible if `VITE_DEV_MODE=1`. The corresponding
   *  page itself is still reachable via direct URL (`/debug`) — only
   *  the launcher button is gated. */
  devOnly?: boolean;
  /** Literal label / tooltip used in place of the i18n lookup. Set on
   *  dev-only targets so the host's 8-locale bundle doesn't carry
   *  strings that only English-speaking developers ever see. When
   *  unset (the production case), label/title come from
   *  `pluginLauncher.<key>.{label,title}` in `src/lang/*.ts`. */
  literalLabel?: string;
  literalTitle?: string;
}

const TARGETS: PluginLauncherTarget[] = [
  // Dashboard — grid of favorite collections. Sits first (right after the
  // Chat button) so it reads as the home surface beside the chat entry.
  { key: "dashboard", kind: "view", icon: "dashboard" },
  { key: "wiki", kind: "view", icon: "menu_book" },
  // Schema-driven collections launcher — opens the collections
  // index, from which the user picks one. The index lists every
  // starred skill that ships a sibling `schema.json`. See
  // plans/done/feat-skill-driven-apps.md (the original "apps" name
  // was renamed to "collections" because each entry is really a
  // schema-defined record collection, not an app).
  { key: "collections", kind: "view", icon: "apps" },
  // Data-source Feeds (#feat-feeds) — declarative retrieval of internet
  // data (RSS / podcast / weather / JSON) into self-refreshing
  // collections. Takes the rss_feed glyph now that the legacy Sources
  // surface is gone.
  { key: "feeds", kind: "view", icon: "rss_feed" },
  // Accounting — the double-entry bookkeeping app. Sits with the other
  // data-app surfaces (collections / feeds). The button always shows so
  // the books are reachable directly; the `manageAccounting` *tool*
  // (LLM access) remains opt-in per Role, independent of this entry point.
  { key: "accounting", kind: "view", icon: "account_balance" },
  // Skills and Roles moved into the Settings modal — both are static
  // configuration surfaces (what Claude can do / which role a chat
  // uses), not dynamic workspace data you monitor, so they belong with
  // Tools / MCP rather than as top-level launcher pages.
  { key: "files", kind: "view", icon: "folder" },
  // Automations (recurring agent tasks) — sits to the right of Files.
  // The former sibling Calendar entry was removed with the Calendar
  // view + `manageCalendar` tool; dated items now live in
  // `calendarField` collections.
  { key: "automations", kind: "view", icon: "schedule" },
  // ─── Dev-only ───
  // Encore plan PR 1 follow-up. Hidden in production builds; the
  // /debug route stays reachable by typing the URL even with the
  // button hidden. Owned by `@mulmoclaude/debug-plugin`. Literal
  // label/title — the debug surface is dev-only, so we deliberately
  // keep the strings out of the 8-locale i18n bundle.
  { key: "debug", kind: "view", icon: "bug_report", devOnly: true, literalLabel: "Debug", literalTitle: "Open debug playground (dev mode only)" },
];

// Dev-mode flag — set `VITE_DEV_MODE=1` in `.env`. Anything else
// (including unset) hides any target with `devOnly: true`.
const DEV_MODE = import.meta.env.VITE_DEV_MODE === "1";

// Targets that should render given the current dev-mode flag. The Chat
// button and these plugin buttons form a single group (no internal
// divider); the only divider is before the favorites/shortcuts zone.
const visibleTargets = computed(() => TARGETS.filter((target) => !target.devOnly || DEV_MODE));

function isActive(target: PluginLauncherTarget): boolean {
  return props.activeViewMode === target.key;
}

// A shortcut's `kind` is singular ("collection" / "feed"); the route
// name (and `activeViewMode`) is plural ("collections" / "feeds").
const ROUTE_NAME_BY_KIND: Record<ShortcutKind, string> = {
  collection: PAGE_ROUTES.collections,
  feed: PAGE_ROUTES.feeds,
};

// A shortcut lights up only when its route AND slug both match — so the
// active collection's pill highlights but its siblings don't.
function isShortcutActive(shortcut: Shortcut): boolean {
  return props.activeViewMode === ROUTE_NAME_BY_KIND[shortcut.kind] && route.params.slug === shortcut.slug;
}

const emit = defineEmits<{
  navigate: [target: PluginLauncherTarget];
  navigateShortcut: [shortcut: Shortcut];
  navigateChat: [];
}>();
</script>
