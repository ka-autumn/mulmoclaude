<script setup lang="ts">
// Encore page entry — branches between two unrelated surfaces that
// happen to share the /encore route:
//
//   1. `?pendingId=<uuid>` present  → `EncoreRedirect.vue`
//      Notification-click landing. Dispatches `resolveNotification`
//      on mount, then full-navigates to the resulting /chat/<chatId>.
//      The user never actually sees this surface — transient (~300ms).
//
//   2. No `pendingId`               → `EncoreDashboard.vue`
//      Read-only browser over `obligations/` (active obligations +
//      cycle history). Reached from the top-bar launcher; no
//      mutating affordances — those are LLM-only verbs.
//
// The branch lives here (rather than in the router) because the
// route name and Vue surface stay one-to-one — App.vue mounts a
// single component per `currentPage`.

import { computed } from "vue";
import { useRoute } from "vue-router";
import EncoreRedirect from "./EncoreRedirect.vue";
import EncoreDashboard from "./EncoreDashboard.vue";

const route = useRoute();

const pendingId = computed<string | null>(() => {
  const value = route.query.pendingId;
  if (typeof value === "string" && value.length > 0) return value;
  return null;
});
</script>

<template>
  <EncoreRedirect v-if="pendingId" :pending-id="pendingId" />
  <EncoreDashboard v-else />
</template>
