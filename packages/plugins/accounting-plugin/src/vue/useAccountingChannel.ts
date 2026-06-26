// Subscribe to per-book accounting events.
//
// Returns a `version` ref that bumps every time the server publishes a
// change for the given bookId — addEntries, voidEntry,
// setOpeningBalances, upsertAccount, snapshot rebuild completion. View
// components watch `version` to drive `refetch` calls.
//
// `bookId` is reactive: switching the active book in BookSwitcher
// flips it; the composable unsubscribes from the old channel and
// subscribes to the new one.
//
// `onPayload` is an optional fine-grained hook for callers that want to
// inspect the event kind (e.g. show a "rebuilding…" indicator on
// `kind: "snapshots-rebuilding"`).
//
// The raw pub/sub transport is host-injected via `hostSubscribe`
// (see hostContext.ts) — the channel NAMES come from this package's
// own `./shared` so publisher and subscriber stay in lockstep.

import { ref, watch, onUnmounted, type Ref } from "vue";
import { bookChannel, ACCOUNTING_BOOKS_CHANNEL, type BookChannelPayload } from "../shared";
import { hostSubscribe } from "./hostContext";

export interface UseAccountingChannelReturn {
  /** Bumps on every per-book event for the current bookId. Resets to
   *  0 when bookId changes. */
  version: Ref<number>;
}

export function useAccountingChannel(bookId: Ref<string | null>, onPayload?: (payload: BookChannelPayload) => void): UseAccountingChannelReturn {
  const version = ref(0);
  let unsubscribe: (() => void) | null = null;

  function bind(nextBookId: string | null): void {
    unsubscribe?.();
    unsubscribe = null;
    version.value = 0;
    if (!nextBookId) return;
    unsubscribe = hostSubscribe(bookChannel(nextBookId), (data) => {
      const event = data as BookChannelPayload;
      version.value += 1;
      onPayload?.(event);
    });
  }

  watch(bookId, bind, { immediate: true });
  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });
  return { version };
}

/** Subscribe to "the list of books changed" events. Use in
 *  BookSwitcher.vue to refetch the dropdown contents when a sibling
 *  tab adds / deletes a book. */
export function useAccountingBooksChannel(onChange: () => void): void {
  const unsubscribe = hostSubscribe(ACCOUNTING_BOOKS_CHANNEL, onChange);
  onUnmounted(() => unsubscribe());
}
