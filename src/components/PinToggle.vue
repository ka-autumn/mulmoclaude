<template>
  <button
    type="button"
    :class="[
      'h-8 w-8 flex items-center justify-center rounded transition-colors',
      pinned ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
    ]"
    :title="pinned ? t('shortcuts.unpin') : t('shortcuts.pin')"
    :aria-label="pinned ? t('shortcuts.unpin') : t('shortcuts.pin')"
    :aria-pressed="pinned"
    :data-testid="`pin-toggle-${kind}-${slug}`"
    @click.stop="toggle"
    @keydown.enter.stop
    @keydown.space.stop
  >
    <span class="material-icons text-lg">{{ pinned ? "star" : "star_border" }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useShortcuts } from "../composables/useShortcuts";
import type { ShortcutKind } from "../types/shortcuts";

// Shared ★ toggle used by the collections / feeds index cards and the
// individual view header. Talks to the `useShortcuts` singleton itself,
// so a parent only supplies the target's identity + cached label/icon.
// Click + keyboard activation are stopped so toggling the star never
// also opens the underlying card.

const props = defineProps<{
  kind: ShortcutKind;
  slug: string;
  /** Cached at pin time so the launcher renders without re-fetching. */
  title: string;
  icon: string;
}>();

const { t } = useI18n();
const { isPinned, pin, unpin } = useShortcuts();

const pinned = computed(() => isPinned(props.kind, props.slug));

function toggle(): void {
  if (pinned.value) {
    void unpin(props.kind, props.slug);
  } else {
    void pin({ kind: props.kind, slug: props.slug, title: props.title, icon: props.icon });
  }
}
</script>
