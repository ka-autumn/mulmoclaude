<template>
  <div class="inline-flex max-w-full items-stretch border border-gray-300 rounded overflow-hidden text-xs" data-testid="plugin-launcher">
    <!-- Fixed groups (data plugins + management). Never shrink / scroll. -->
    <div class="flex flex-none items-stretch">
      <template v-for="(target, idx) in visibleTargets" :key="target.key">
        <!-- Visual separator between data plugins and management plugins -->
        <div v-if="idx === separatorAfterIndex" class="w-px bg-gray-300 my-0.5" />
        <button
          :class="[
            'h-8 w-8 flex items-center justify-center rounded border-r border-gray-200 last:border-r-0 transition-colors',
            isActive(target) ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50',
          ]"
          :title="target.literalTitle ?? t(`pluginLauncher.${target.key}.label`)"
          :aria-label="target.literalLabel ?? t(`pluginLauncher.${target.key}.label`)"
          :data-testid="`plugin-launcher-${target.key}`"
          @click="emit('navigate', target)"
        >
          <span class="material-icons text-base">{{ target.icon }}</span>
        </button>
      </template>
    </div>

    <!-- Pinned shortcuts zone (#feat-shortcut-bar). Appears only when the
         user has pinned at least one collection / feed. Separated by a
         second divider; scrolls horizontally on overflow (no cap on the
         pin count) so a long list never pushes the chrome past the
         viewport. The fixed groups above stay put. -->
    <template v-if="shortcuts.length > 0">
      <div class="w-px bg-gray-300 my-0.5 flex-none" />
      <div
        class="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:thin]"
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { PAGE_ROUTES } from "../router/pageRoutes";
import type { Shortcut, ShortcutKind } from "../types/shortcuts";

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
}>();

const shortcuts = computed<Shortcut[]>(() => props.shortcuts ?? []);

export type PluginLauncherKind = "view"; // Switch the canvas to a dedicated view mode

// The `key` is also the i18n lookup prefix (see pluginLauncher.*
// in src/lang/en.ts). The button is icon-only; both the tooltip
// (`title`) and screen-reader name (`aria-label`) resolve to the
// same `pluginLauncher.<key>.label` string. Keeping i18n strings
// out of this file avoids duplication across the 8 locales.
export interface PluginLauncherTarget {
  /** Stable key for testid + dispatch in App.vue. */
  key: "automations" | "wiki" | "collections" | "feeds" | "files" | "debug";
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
  // ─── Data plugins ───
  // Automations (recurring agent tasks). The former sibling Calendar
  // entry was removed with the Calendar view + `manageCalendar` tool;
  // dated items now live in `calendarField` collections.
  { key: "automations", kind: "view", icon: "schedule" },
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
  // ─── Management / navigation ───
  // Skills and Roles moved into the Settings modal (Management group) —
  // both are static configuration surfaces (what Claude can do / which
  // role a chat uses), not dynamic workspace data you monitor, so they
  // belong with Tools / MCP rather than as top-level launcher pages.
  { key: "files", kind: "view", icon: "folder" },
  // ─── Dev-only ───
  // Encore plan PR 1 follow-up. Hidden in production builds; the
  // /debug route stays reachable by typing the URL even with the
  // button hidden. Owned by `@mulmoclaude/debug-plugin`. Literal
  // label/title — the debug surface is dev-only, so we deliberately
  // keep the strings out of the 8-locale i18n bundle.
  { key: "debug", kind: "view", icon: "bug_report", devOnly: true, literalLabel: "Debug", literalTitle: "Open debug playground (dev mode only)" },
];

// Index AFTER which the visual separator is inserted (between data
// plugins on the left and management on the right). Data plugins are
// automations / wiki / collections / feeds (indices 0-3), so the
// divider renders before index 4 (files).
const SEPARATOR_AFTER_INDEX = 4;

// Dev-mode flag — set `VITE_DEV_MODE=1` in `.env`. Anything else
// (including unset) hides any target with `devOnly: true`.
const DEV_MODE = import.meta.env.VITE_DEV_MODE === "1";

// Targets that should render given the current dev-mode flag.
const visibleTargets = computed(() => TARGETS.filter((target) => !target.devOnly || DEV_MODE));

// Recompute the separator index after the dev-only filter — without
// this, hiding a dev-only target before the separator would shift the
// divider one slot to the left. Today the only dev-only target sits
// at the end, so this matches the static constant; the computed keeps
// future entries safe.
const separatorAfterIndex = computed(() => {
  const fullIndexOfSeparator = SEPARATOR_AFTER_INDEX;
  const hiddenBefore = TARGETS.slice(0, fullIndexOfSeparator).filter((target) => target.devOnly && !DEV_MODE).length;
  return fullIndexOfSeparator - hiddenBefore;
});

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
}>();
</script>
