// Host-provided UI capabilities the collection view layer needs but a package
// can't own: data fetching over the host's collection REST API, and the host's
// asset-URL scheme. Each host (MulmoClaude, MulmoTerminal) configures this once
// at app startup via `configureCollectionUi`; the view layer reads it through
// `collectionUi()`. Mirrors the server-side `configureCollectionHost` binding.
//
// This grows as more of the View moves into the package (navigation, chat,
// confirm, …) as components migrate.

import type { Component } from "vue";
import type {
  CollectionDetailResponse,
  ItemMutationResponse,
  CollectionNotifySeverity,
  CollectionsListResponse,
  FeedsListResponse,
  CollectionShortcutInfo,
} from "../core/uiTypes";
import type { CollectionItem } from "../core/schema";

/** Result of a host data fetch — structurally a subset of the host's own
 *  `ApiResult` (so the host can pass `apiGet` straight through). The view layer
 *  treats `ok: false` as a skip, never throwing on one failed target. */
export type CollectionFetchResult<T> = { ok: true; data: T } | { ok: false };

/** Result of a host write (delete / create / update / action) — the normalised
 *  `ApiResult` shape, so the host passes `apiDelete`/`apiPost`/… straight through.
 *  Carries the host's error string on failure for inline display. */
export type CollectionMutationResult = { ok: true } | { ok: false; error: string };

/** Full host `ApiResult<T>` (data on success, error + HTTP status on failure) —
 *  matches the host's `ApiResult` exactly, so `apiGet`/`apiPost`/`apiPut` pass
 *  straight through. `status` lets the view distinguish 404 (not-found) from a
 *  generic failure. */
export type CollectionApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** A collection / item action's result — a seed prompt + role for a new chat. */
export interface CollectionActionResult {
  prompt: string;
  role: string;
}

/** A feed refresh's result — counts + per-source errors. */
export interface CollectionRefreshResult {
  refreshed: boolean;
  written: number;
  errors: string[];
}

/** Scoped capability token for a sandboxed custom view (mirrors the host's mint
 *  response) — the iframe reads/writes the collection through it. */
export interface CollectionViewToken {
  token: string;
  exp: number;
  dataUrl: string;
  capabilities: string[];
}

/** Result of fetching a custom view's HTML — status-only failure (the host
 *  attaches the global bearer; a non-2xx is surfaced as `HTTP <status>`). */
export type CollectionViewHtmlResult = { ok: true; html: string } | { ok: false; status: number };

/** Inputs the host needs to wrap a custom view's HTML into a sandboxed srcdoc
 *  (token + data URL injected, CSP applied — the host owns the CSP policy). */
export interface CollectionViewSrcdocBoot {
  slug: string;
  token: string;
  dataUrl: string;
  origin: string;
}

/** Options for the host's confirm dialog — structurally matches the host's own
 *  `ConfirmOptions`, so `confirm` can forward to `useConfirm().openConfirm`. */
export interface CollectionConfirmOptions {
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "success" | "danger";
}

export interface CollectionUi {
  /** Fetch a collection's detail (schema + records) by slug — backs both the
   *  View's own load (reads `status` for 404 → not-found) and ref/embed
   *  resolution (treats `!ok` as a skip). Replaces `apiGet(…collections.detail)`. */
  fetchCollectionDetail: (slug: string) => Promise<CollectionApiResult<CollectionDetailResponse>>;
  /** Browser-loadable URL for a file/image asset value (an html/svg artifact),
   *  or null when the value isn't a renderable asset path. Replaces
   *  `isValidFilePath` + `htmlPreviewUrlFor`/`svgPreviewUrlFor`. */
  fileAssetUrl: (value: unknown) => string | null;
  /** In-app File-Explorer route for a workspace file path (the fallback for
   *  `file` values that aren't a directly-served artifact), or null when the
   *  value isn't a valid in-workspace path. */
  fileRoutePath: (value: unknown) => string | null;
  /** Browser `<img src>` for a stored image value (a workspace file path), via
   *  the host's raw-file endpoint. Replaces the host's `resolveImageSrc`. */
  imageSrc: (imageData: string) => string;
  /** Open the host's confirm dialog; resolves true if confirmed. Replaces
   *  `useConfirm().openConfirm`. */
  confirm: (options: CollectionConfirmOptions) => Promise<boolean>;
  /** Delete a collection's custom view by id. Replaces the host's
   *  `apiDelete(API_ROUTES.collections.viewDelete)`. */
  deleteView: (slug: string, viewId: string) => Promise<CollectionMutationResult>;
  /** Mint a scoped capability token for a custom view (host: `apiPost` over
   *  `API_ROUTES.collections.viewToken`). */
  mintViewToken: (slug: string, viewId: string) => Promise<CollectionApiResult<CollectionViewToken>>;
  /** Fetch a custom view's raw HTML (host: `apiFetchRaw` over
   *  `API_ROUTES.collections.viewFile`, global bearer attached). */
  fetchViewHtml: (slug: string, viewId: string) => Promise<CollectionViewHtmlResult>;
  /** Wrap a custom view's HTML in a sandboxed `<iframe srcdoc>` with the token +
   *  data URL injected and the host's CSP applied. Replaces the host's
   *  `buildCustomViewSrcdoc`. */
  buildViewSrcdoc: (html: string, boot: CollectionViewSrcdocBoot) => string;

  // ── record CRUD + actions (host: api{Post,Put,Delete} over API_ROUTES.collections) ──
  /** Create a record (`apiPost` over `…collections.items`). */
  createItem: (slug: string, record: CollectionItem) => Promise<CollectionApiResult<ItemMutationResponse>>;
  /** Update a record (`apiPut` over `…collections.item`). */
  updateItem: (slug: string, itemId: string, record: CollectionItem) => Promise<CollectionApiResult<ItemMutationResponse>>;
  /** Delete a record (`apiDelete` over `…collections.item`). */
  deleteItem: (slug: string, itemId: string) => Promise<CollectionMutationResult>;
  /** Delete a whole collection (`apiDelete` over `…collections.detail`). */
  deleteCollection: (slug: string) => Promise<CollectionMutationResult>;
  /** Delete a feed via the project-scope feed-delete route (`…feeds.detail`). */
  deleteFeed: (slug: string) => Promise<CollectionMutationResult>;
  /** Run a per-record action (`apiPost` over `…collections.itemAction`). */
  runItemAction: (slug: string, itemId: string, actionId: string) => Promise<CollectionApiResult<CollectionActionResult>>;
  /** Run a collection-level action (`apiPost` over `…collections.collectionAction`). */
  runCollectionAction: (slug: string, actionId: string) => Promise<CollectionApiResult<CollectionActionResult>>;
  /** Refresh a feed-backed collection (`apiPost` over `…collections.refresh`). */
  refreshCollection: (slug: string) => Promise<CollectionApiResult<CollectionRefreshResult>>;

  // ── routing (host: the vue-router instance) ──
  /** Current route's `:slug` param (standalone page), or undefined. */
  routeSlug: () => string | undefined;
  /** Current route's `?selected=` query (deep-linked record), or undefined. */
  routeSelectedId: () => string | undefined;
  /** True when the standalone page is the feeds route (vs collections). */
  isFeedRoute: () => boolean;
  /** Set/clear the `?selected=` deep-link (router.replace, no history entry). */
  setSelectedId: (itemId: string | null) => void;
  /** Navigate to the collections / feeds index after a delete. */
  gotoIndex: (kind: "collection" | "feed") => void;
  /** Navigate to a specific collection / feed detail page (from an index card). */
  gotoDetail: (kind: "collection" | "feed", slug: string) => void;

  // ── index pages (the browsable /collections + /feeds lists) ──
  /** List skill-backed collections (`apiGet` over `…collections.list`). */
  listCollections: () => Promise<CollectionApiResult<CollectionsListResponse>>;
  /** List feed-backed collections (`apiGet` over `…feeds.list`). */
  listFeeds: () => Promise<CollectionApiResult<FeedsListResponse>>;
  /** Bulk-reconcile pinned launcher shortcuts of one kind against the
   *  authoritative list — prune dead slugs, refresh stale labels
   *  (`useShortcuts().reconcile`). */
  reconcileShortcuts: (kind: "collection" | "feed", live: CollectionShortcutInfo[]) => Promise<void>;

  // ── app integration ──
  /** Start a new chat with a seed prompt + role (host: `useAppApi().startNewChat`). */
  startChat: (prompt: string, role: string) => void;
  /** The host's "general" role id, for chats seeded without a specific role. */
  generalRoleId: string;
  /** The host's "personal" role id (the feed-add chat seeds into it). */
  personalRoleId: string;
  /** Remove a pinned launcher shortcut for a 404'd collection/feed
   *  (`useShortcuts().unpin`). */
  unpin: (kind: "collection" | "feed", slug: string) => Promise<boolean>;
  /** Active-notification severity per record id, for accenting flagged rows/cards
   *  (`collectionNotifiedSeverities` over the host's live notifier entries). */
  notifiedSeverities: (slug: string) => Map<string, CollectionNotifySeverity>;

  // ── injected host component ──
  /** The host's pin/unpin toggle (couples to the host's shortcut store + is
   *  shared with other host views), rendered in the View header via
   *  `<component :is>`. Props: `kind`, `slug`, `title`, `icon`. */
  pinToggle: Component;
}

let current: CollectionUi | null = null;

/** Wire the collection view layer to a host. Call once at app startup. */
export function configureCollectionUi(capabilities: CollectionUi): void {
  current = capabilities;
}

export function collectionUi(): CollectionUi {
  if (current === null) {
    throw new Error("@mulmoclaude/collection-plugin/vue: configureCollectionUi() was not called by the host");
  }
  return current;
}
