<script setup lang="ts">
// Chat-on-mount redirect — extracted from View.vue (#feat-encore-page).
//
// Why this branch exists at all:
//   - The tick NEVER calls chat.start(). If it did, the chat would
//     appear in the user's sidebar before they engaged with the
//     notification (the "abandoned chat" problem).
//   - Chat creation must be deferred until the user clicks the bell.
//     The bell's `navigateTarget` is just a URL, so to intercept the
//     click we own the destination route (/encore?pendingId=…) and
//     run plugin code on mount.
//   - On mount this component dispatches resolveNotification (which
//     starts the chat server-side) and redirects to /chat/<chatId>
//     via a FULL navigation. The full nav guarantees the
//     `from encore` chip renders on first paint — same trick
//     debug-plugin uses.
//
// Notification clearing is NOT done here — that's the LLM's job
// once it's talking to the user in the resulting chat (the LLM
// calls markStepDone / markTargetSkipped with the pendingId; the
// MCP handler reads the ticket and calls notifier.clear). The only
// clear-here case is an orphan ticket (already swept) — the server
// clears the bell entry by notificationId and returns
// { orphan: true }, and we render the "already resolved" line.

import { computed, onMounted, ref } from "vue";
import { pluginEndpoints } from "../api";
import { apiCall } from "../../utils/api";
import { META } from "./manageEncoreMeta";
import type { EncoreEndpoints } from "./manageEncoreDefinition";

const props = defineProps<{ pendingId: string }>();

const status = ref<"starting" | "redirecting" | "error" | "orphan">("starting");
const errorMessage = ref<string | null>(null);

// The host's NotificationBell.vue splices `notificationId=<entryId>`
// onto every navigateTarget at click time (see appendNotificationId
// in src/components/NotificationBell.vue). Reading it lets the
// server clear orphan bell entries whose ticket was already swept.
const notificationId = computed<string | null>(() => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("notificationId");
});

interface ResolveResult {
  ok: boolean;
  chatId?: string;
  navigateTo?: string;
  orphan?: boolean;
  error?: string;
  message?: string;
}

async function resolveAndRedirect(): Promise<void> {
  try {
    const endpoints = pluginEndpoints<EncoreEndpoints>(META.apiNamespace);
    const { method, url } = endpoints.dispatch;
    const response = await apiCall<ResolveResult>(url, {
      method,
      body: {
        kind: "resolveNotification",
        pendingId: props.pendingId,
        notificationId: notificationId.value ?? undefined,
      },
    });
    if (!response.ok) {
      status.value = "error";
      errorMessage.value = response.error;
      return;
    }
    const result = response.data;
    if (result.orphan) {
      status.value = "orphan";
      errorMessage.value = result.message ?? "This notification was already resolved.";
      return;
    }
    if (!result.ok || !result.chatId) {
      status.value = "error";
      errorMessage.value = result.error ?? "resolveNotification returned no chatId";
      return;
    }
    status.value = "redirecting";
    // Full-page navigation (not Vue-router push) so the seeded
    // user turn renders with the `from encore` chip on first
    // paint — same mechanism debug-plugin uses.
    window.location.href = result.navigateTo ?? `/chat/${result.chatId}`;
  } catch (err) {
    status.value = "error";
    errorMessage.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(() => {
  void resolveAndRedirect();
});
</script>

<template>
  <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- chat-on-mount page is a transient redirect, not a user-facing surface; strings stay out of the 8-locale bundle (matches debug-plugin's View). -->
  <div class="h-full flex items-center justify-center text-sm text-gray-500">
    <div v-if="status === 'starting'">Starting chat…</div>
    <div v-else-if="status === 'redirecting'">Redirecting to chat…</div>
    <div v-else-if="status === 'orphan'" class="text-center max-w-md px-4">
      <div class="text-gray-700 mb-2">This notification has already been resolved.</div>
      <a href="/chat" class="block text-blue-600 hover:underline text-sm">← back to chat</a>
    </div>
    <div v-else class="text-center max-w-md px-4">
      <div class="text-red-600 mb-2">Couldn't open the resolution chat.</div>
      <div class="text-xs text-gray-500">{{ errorMessage }}</div>
      <a href="/chat" class="block mt-3 text-blue-600 hover:underline text-sm">← back to chat</a>
    </div>
  </div>
  <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
</template>
