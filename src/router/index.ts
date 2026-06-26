// Vue-router setup (history mode — clean URLs without #).
//
// Each page has its own route: /chat, /files, /automations, /wiki,
// /feeds, /collections. (Skills and Roles are not pages — they live in
// the Settings modal; /skills and /roles redirect to /chat.) Layout
// preference
// (single vs. stack) is a separate concern persisted in localStorage
// — it is not part of the URL. Several pages accept an optional
// identifier (automations :taskId, feeds/collections :slug) so
// notifications and external links can deep-link to a specific item.
//
// History mode requires the server to serve index.html for any path
// that doesn't match an API route or static file. In production the
// Express catch-all `app.get("*", ...)` in server/index.ts already
// does this. In dev, Vite's default SPA fallback handles it.

import { defineComponent, h } from "vue";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { PAGE_ROUTES, type PageRouteName } from "./pageRoutes";
import { HOST_EVENTS } from "../config/hostEvents";

// Re-export the constants so existing `import { PAGE_ROUTES } from
// "./router"` call sites keep working. The actual definitions live
// in `./pageRoutes` — that module is safe to import from node-side
// tests, which this module is not (createWebHistory touches window
// at module-eval time).
export { PAGE_ROUTES, type PageRouteName };

// Stub component that renders nothing. Required by vue-router (every
// route needs a component) but never actually mounted because App.vue
// renders based on `route.name` rather than using <router-view>.
const Stub = defineComponent({ render: () => h("div") });

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/chat" },
  { path: "/chat/:sessionId?", name: PAGE_ROUTES.chat, component: Stub },
  // Dashboard — a grid of the user's favorite (pinned) collections, each
  // rendered as a live embedded view. Layout (order + per-tile view mode)
  // is persisted in config/dashboard.json, independent of the URL.
  { path: "/dashboard", name: PAGE_ROUTES.dashboard, component: Stub },
  // Files view uses a repeatable catch-all so `/files/a/b/c.md` maps
  // to `params.pathMatch = ["a", "b", "c.md"]`. Joining on `/` at read
  // time keeps each segment URL-encoded independently — passing a
  // string-form catch-all (`:pathMatch(.*)`) would collapse slashes
  // to `%2F` at push time and mangle deep paths. An empty segment
  // (`/files`) yields an empty array, which we treat as "no file
  // selected". See plans/done/feat-files-path-url.md.
  { path: "/files/:pathMatch(.*)*", name: PAGE_ROUTES.files, component: Stub },
  // Automations accepts an optional `:taskId` — scheduled-task
  // notifications deep-link to a specific task row.
  { path: "/automations/:taskId?", name: PAGE_ROUTES.automations, component: Stub },
  // Legacy Scheduler / Calendar URLs — the Calendar view was removed;
  // both redirect to Automations to preserve old bookmarks.
  { path: "/scheduler", redirect: "/automations" },
  { path: "/calendar", redirect: "/automations" },
  // Wiki sub-views live on the path rather than in query params so
  // URLs mirror the filesystem layout (`data/wiki/pages/<slug>.md`)
  // and stay sibling-safe (no query-key bleed from other routes).
  // `section` is a closed enum; unknown sections fall through to the
  // catch-all redirect below. `slug` only applies when `section ===
  // "pages"`. See plans/done/feat-wiki-path-urls.md.
  { path: "/wiki/:section(pages|log|lint-report|graph)?/:slug?", name: PAGE_ROUTES.wiki, component: Stub },
  // Skills and Roles are no longer standalone pages — they moved into
  // the Settings modal (Management group). Redirect old bookmarks to
  // chat; the surfaces are reachable via the gear → Skills / Roles tabs.
  { path: "/skills", redirect: "/chat" },
  { path: "/roles", redirect: "/chat" },
  // Data-source Feeds — the declarative retrieval registry. `/feeds`
  // lists every feed; `/feeds/:slug` opens that feed's records in
  // <CollectionView> (the same component collections use), with the
  // back arrow returning to the feed list.
  { path: "/feeds/:slug?", name: PAGE_ROUTES.feeds, component: Stub },
  // Debug page (#feat-encore PR 1 follow-up). Standalone playground for
  // experimental plugin features (notifier engine, etc.). Rendered by
  // the @mulmoclaude/debug-plugin runtime plugin.
  { path: "/debug", name: PAGE_ROUTES.debug, component: Stub },
  // Schema-driven collections (see plans/done/feat-skill-driven-apps.md
  // — historical name predates the apps→collections rename).
  // `/collections` lists every discovered collection;
  // `/collections/:slug` opens that collection's <CollectionView>.
  { path: "/collections/:slug?", name: PAGE_ROUTES.collections, component: Stub },
  // Accounting — the double-entry bookkeeping app (manageAccounting).
  // Standalone page so the user can reach the books directly without
  // going through an LLM `openBook` tool call. The View self-fetches
  // the book list on mount and auto-selects a book (or shows the
  // first-run "New book" form on an empty workspace), so no route
  // param is required. The `manageAccounting` *tool* stays opt-in per
  // Role; this only adds a UI entry point to the same View.
  { path: "/accounting", name: PAGE_ROUTES.accounting, component: Stub },
  // Legacy `/apps` URL — kept as a redirect for ~one release so any
  // existing bookmarks survive the rename. Safe to delete after.
  { path: "/apps", redirect: "/collections" },
  { path: "/apps/:slug", redirect: (route) => `/collections/${encodeURIComponent(String(route.params.slug))}` },
  { path: "/:pathMatch(.*)*", redirect: "/chat" },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Bridge SPA navigation to a DOM CustomEvent so runtime-loaded plugins
// (which can't import vue-router without extra plumbing) can react to
// route changes without polling. Fires on every commit, including
// query-only changes that don't remount the matched component.
//
// Subscriber: `@mulmoclaude/debug-plugin` View, which uses it to
// re-evaluate `?mode=` and `?notificationId=` params after the host
// notifier popup pushes a new URL. The event name lives in
// `src/config/hostEvents.ts` so the contract isn't a magic string
// duplicated between host and plugin.
router.afterEach((toRoute) => {
  window.dispatchEvent(new CustomEvent(HOST_EVENTS.routeChange, { detail: { fullPath: toRoute.fullPath } }));
});

export default router;
