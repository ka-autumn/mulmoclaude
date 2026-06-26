// Single source of truth for the accounting REST contract — the one
// dispatch route the plugin owns. Consumed by BOTH the Vue api client
// (./vue/api.ts) and the server router (./server/router.ts) so the path
// can't drift between them. Mirrors the host META's
// `{ apiNamespace: "accounting", dispatch: { method: "POST", path: "" } }`
// resolved to a full URL.
//
// (CLAUDE.md: API routes go through `as const` objects, never hardcoded
// strings at the call site.)

export const ACCOUNTING_API = {
  dispatch: {
    path: "/api/accounting",
    method: "POST",
  },
} as const;
