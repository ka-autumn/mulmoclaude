<template>
  <!-- Centered modal shell for a collection record's open/edit panel. Used
       by every non-calendar view mode (table / kanban / dashboard) and the
       calendar's undated tray, so opening an item is a consistent popup
       everywhere. Calendar's dated records keep their own day-view modal
       (CollectionDayView), which embeds the same panel on its right. Teleported
       to <body> so an embedded card's transformed ancestor can't trap the
       fixed overlay. Backdrop click / Escape both emit `close`; the host
       decides whether that cancels an edit or closes the detail.

       Focus is contained while open (Tab/Shift+Tab wrap inside the dialog)
       and restored to the trigger on close, so keyboard users can't reach
       the controls behind the overlay (WCAG focus containment). -->
  <Teleport to="body">
    <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" data-testid="collections-record-modal" @click.self="emit('close')">
      <div
        ref="dialogEl"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl focus:outline-none"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        @keydown.esc="emit('close')"
        @keydown.tab="onTab"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

const emit = defineEmits<{ close: [] }>();

const dialogEl = ref<HTMLDivElement | null>(null);

// The control that had focus before the modal opened (usually the row /
// card the user activated). Restored when the modal unmounts.
let previouslyFocused: HTMLElement | null = null;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Visible, focusable controls inside the dialog, in DOM order. */
function focusableItems(): HTMLElement[] {
  if (!dialogEl.value) return [];
  return Array.from(dialogEl.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((node) => node.offsetParent !== null);
}

/** Trap Tab / Shift+Tab inside the dialog so focus can't escape to the
 *  page behind the overlay. Wraps at both ends; the dialog container
 *  itself (tabindex -1) counts as "before the first item". */
function onTab(event: KeyboardEvent): void {
  const items = focusableItems();
  if (items.length === 0) {
    event.preventDefault();
    dialogEl.value?.focus();
    return;
  }
  const [first] = items;
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || active === dialogEl.value) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

// Focus the dialog on open so Escape (bound on the dialog) fires even
// before the user clicks into a field, and focus leaves the row behind it.
onMounted(async () => {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  dialogEl.value?.focus();
});

// Restore focus to the trigger so keyboard users land back where they were.
onBeforeUnmount(() => {
  previouslyFocused?.focus?.();
});
</script>
