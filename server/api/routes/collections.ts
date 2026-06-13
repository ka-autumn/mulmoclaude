// REST surface for schema-driven collections. Each collection is a
// skill that ships a sibling `schema.json`; the host's <CollectionView>
// component reads through these endpoints.
//
//   GET    /api/collections                       → { collections: CollectionSummary[] }
//   GET    /api/collections/:slug                 → { collection, items }
//   POST   /api/collections/:slug/items           → { item, itemId }
//   PUT    /api/collections/:slug/items/:itemId   → { item, itemId }
//   DELETE /api/collections/:slug/items/:itemId   → { deleted: true }

import { Router, Request, Response, NextFunction } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { actionVisible } from "../../../src/utils/collections/actionVisible.js";
import {
  discoverCollections,
  generateItemId,
  deleteCollection,
  deleteCollectionRefusalMessage,
  deleteCustomView,
  deleteItem,
  listItems,
  loadCollection,
  readItem,
  readSkillTemplate,
  readCustomViewHtml,
  buildActionSeedPrompt,
  buildCollectionActionSeedPrompt,
  resolveCreateItemId,
  toDetail,
  toSummary,
  validateCollectionRecords,
  writeItem,
} from "../../workspace/collections/index.js";
import type {
  CollectionAction,
  CollectionDetail,
  CollectionItem,
  CollectionSummary,
  DeleteViewResult,
  LoadedCollection,
  RecordIssue,
} from "../../workspace/collections/index.js";
import { badRequest, notFound, conflict, forbidden, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import { workspacePath } from "../../workspace/workspace.js";
import { refreshOne } from "../../workspace/feeds/index.js";
import { manageCollection } from "../../agent/mcp-tools/manageCollection.js";
import { clampCapabilities, mintViewToken, requireViewToken, type ViewCapability } from "../auth/viewToken.js";

const router = Router();

interface CollectionsListResponse {
  collections: CollectionSummary[];
}

interface CollectionDetailResponse {
  collection: CollectionDetail;
  items: CollectionItem[];
  /** Record files that failed validation (malformed JSON / schema
   *  violation) and are silently skipped at read time. Drives the
   *  in-view Repair prompt. Omitted/empty when every record is fine. */
  issues?: RecordIssue[];
}

interface ItemMutationResponse {
  itemId: string;
  item: CollectionItem;
}

interface DeleteResponse {
  deleted: true;
  itemId: string;
}

interface DeleteCollectionResponse {
  deleted: true;
  slug: string;
  /** Workspace-relative path to the backup written before removal
   *  (e.g. `archive/2026-05-31-<uuid>`). */
  archivePath: string;
}

interface DeleteViewResponse {
  deleted: true;
  viewId: string;
}

interface ActionSeedResponse {
  /** Assembled seed prompt the client feeds to a new chat. */
  prompt: string;
  /** Role id the new chat should run in (from the action). */
  role: string;
}

router.get(API_ROUTES.collections.list, async (_req: Request, res: Response<CollectionsListResponse>) => {
  try {
    const collections = await discoverCollections();
    res.json({ collections: collections.map(toSummary) });
  } catch (err) {
    log.warn("collections", "list failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.get(API_ROUTES.collections.detail, async (req: Request<{ slug: string }>, res: Response<CollectionDetailResponse>) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    notFound(res, `collection '${req.params.slug}' not found`);
    return;
  }
  try {
    const items = await listItems(collection.dataDir);
    // Best-effort validation: a malformed record is silently skipped at
    // read time, so surface the problems here too (the same pass
    // presentCollection runs) and let the view offer a Repair button.
    // Never let validation failure turn a successful detail into a 500.
    let issues: RecordIssue[] = [];
    try {
      issues = await validateCollectionRecords(collection);
    } catch (err) {
      log.warn("collections", "detail validation skipped", { slug: collection.slug, error: errorMessage(err) });
    }
    // Omit `issues` entirely when everything is fine, matching the
    // "absent when clean" contract on CollectionDetailResponse.
    res.json({ collection: toDetail(collection), items, ...(issues.length > 0 ? { issues } : {}) });
  } catch (err) {
    log.warn("collections", "detail failed", { slug: collection.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Delete an entire collection — the skill (staging + active mirror) AND
// its records — after archiving a restorable copy. Only project-scope,
// non-preset collections are deletable; see deleteCollection for the
// scope rules and the archive layout.
router.delete(API_ROUTES.collections.detail, async (req: Request<{ slug: string }>, res: Response<DeleteCollectionResponse>) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    notFound(res, `collection '${req.params.slug}' not found`);
    return;
  }
  try {
    const result = await deleteCollection(collection);
    if (result.kind !== "ok") {
      forbidden(res, deleteCollectionRefusalMessage(result));
      return;
    }
    log.info("collections", "collection deleted", { slug: result.slug, archivePath: result.archivePath });
    res.json({ deleted: true, slug: result.slug, archivePath: result.archivePath });
  } catch (err) {
    log.warn("collections", "collection delete failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

function extractRecord(body: unknown): CollectionItem | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as CollectionItem;
}

router.post(API_ROUTES.collections.items, async (req: Request<{ slug: string }>, res: Response<ItemMutationResponse>) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    notFound(res, `collection '${req.params.slug}' not found`);
    return;
  }
  const record = extractRecord(req.body);
  if (!record) {
    badRequest(res, "request body must be a JSON object");
    return;
  }
  // Resolve the item id: a singleton collection pins EVERY create to
  // its fixed id (so the "at most one record" contract holds against
  // direct API calls / scripts / concurrent clients — not just the UI,
  // which merely hides Add; with the id pinned, a second create targets
  // the same file and hits the refuseOverwrite conflict below). For a
  // normal collection the body's primaryKey value wins, else a
  // generated id (Codex P1 on #1510).
  const itemId = resolveCreateItemId(collection.schema, record) ?? generateItemId();
  const recordWithId: CollectionItem = { ...record, [collection.schema.primaryKey]: itemId };
  try {
    const result = await writeItem(collection.dataDir, itemId, recordWithId, { refuseOverwrite: true });
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "path-escape") {
      forbidden(res, `data directory for collection '${collection.slug}' escapes the workspace`);
      return;
    }
    if (result.kind === "conflict") {
      conflict(res, `item '${result.itemId}' already exists`);
      return;
    }
    log.info("collections", "item created", { slug: collection.slug, itemId: result.itemId });
    res.json({ itemId: result.itemId, item: result.item });
  } catch (err) {
    log.warn("collections", "item create failed", { slug: collection.slug, itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.put(API_ROUTES.collections.item, async (req: Request<{ slug: string; itemId: string }>, res: Response<ItemMutationResponse>) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    notFound(res, `collection '${req.params.slug}' not found`);
    return;
  }
  const record = extractRecord(req.body);
  if (!record) {
    badRequest(res, "request body must be a JSON object");
    return;
  }
  // Singleton enforcement: only the fixed id is writable, so a PUT to
  // any other id can't smuggle in a second record (Codex P1 on #1510).
  const { singleton, primaryKey } = collection.schema;
  if (singleton && req.params.itemId !== singleton) {
    badRequest(res, `collection '${collection.slug}' is a singleton; the only valid item id is '${singleton}'`);
    return;
  }
  // PUT pins the primaryKey to the URL itemId — disregard any
  // mismatched primary-key value in the body so the file's id and its
  // record id never drift.
  const recordWithId: CollectionItem = { ...record, [primaryKey]: req.params.itemId };
  try {
    const result = await writeItem(collection.dataDir, req.params.itemId, recordWithId);
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "path-escape") {
      forbidden(res, `data directory for collection '${collection.slug}' escapes the workspace`);
      return;
    }
    if (result.kind === "conflict") {
      // refuseOverwrite was false — this branch is unreachable, but
      // typescript needs the exhaustive switch.
      serverError(res, "unexpected conflict on update");
      return;
    }
    log.info("collections", "item updated", { slug: collection.slug, itemId: result.itemId });
    res.json({ itemId: result.itemId, item: result.item });
  } catch (err) {
    log.warn("collections", "item update failed", { slug: collection.slug, itemId: req.params.itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.delete(API_ROUTES.collections.item, async (req: Request<{ slug: string; itemId: string }>, res: Response<DeleteResponse>) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    notFound(res, `collection '${req.params.slug}' not found`);
    return;
  }
  try {
    const result = await deleteItem(collection.dataDir, req.params.itemId);
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "path-escape") {
      forbidden(res, `data directory for collection '${collection.slug}' escapes the workspace`);
      return;
    }
    if (result.kind === "not-found") {
      notFound(res, `item '${result.itemId}' not found`);
      return;
    }
    log.info("collections", "item deleted", { slug: collection.slug, itemId: result.itemId });
    res.json({ deleted: true, itemId: result.itemId });
  } catch (err) {
    log.warn("collections", "item delete failed", { slug: collection.slug, itemId: req.params.itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

interface RefreshResponse {
  refreshed: true;
  written: number;
  errors: string[];
}

// Re-run a feed collection's retrieval now. Generic over kind — the
// engine dispatches on `schema.ingest.kind`. 400 when the collection
// carries no `ingest` block (it's an ordinary skill collection, not a
// feed). Backs the CollectionView "Refresh feed" button.
router.post(API_ROUTES.collections.refresh, async (req: Request<{ slug: string }>, res: Response<RefreshResponse>) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    notFound(res, `collection '${req.params.slug}' not found`);
    return;
  }
  if (!collection.schema.ingest) {
    badRequest(res, `collection '${collection.slug}' is not a feed (no ingest config)`);
    return;
  }
  try {
    const result = await refreshOne(workspacePath, collection);
    log.info("collections", "feed refreshed via collection route", { slug: collection.slug, written: result.written });
    res.json({ refreshed: true, written: result.written, errors: result.errors });
  } catch (err) {
    log.warn("collections", "feed refresh failed", { slug: collection.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Assemble a schema-declared action's seed prompt for one record. The
// route is fully generic — it reads the record + the action's template
// from the skill dir and returns the seed + the role to run it in; the
// client starts the chat. No domain (invoice / PDF / role) literals.
router.post(API_ROUTES.collections.itemAction, async (req: Request<{ slug: string; itemId: string; actionId: string }>, res: Response<ActionSeedResponse>) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    notFound(res, `collection '${req.params.slug}' not found`);
    return;
  }
  const action = collection.schema.actions?.find((entry) => entry.id === req.params.actionId);
  if (!action) {
    notFound(res, `action '${req.params.actionId}' not found on collection '${collection.slug}'`);
    return;
  }
  try {
    const record = await readItem(collection.dataDir, req.params.itemId);
    if (!record) {
      notFound(res, `item '${req.params.itemId}' not found`);
      return;
    }
    // Enforce the action's `when` predicate server-side: the client
    // hides out-of-state buttons, but a stale or crafted request could
    // still target one (e.g. seed a payment journal for a non-paid
    // invoice). The visibility rule is the authorization rule.
    if (!actionVisible(action, record)) {
      conflict(res, `action '${action.id}' is not available for item '${req.params.itemId}' in its current state`);
      return;
    }
    const template = await readSkillTemplate(collection.skillDir, action.template);
    if (template === null) {
      serverError(res, `template '${action.template}' for action '${action.id}' could not be read`);
      return;
    }
    log.info("collections", "action seed built", { slug: collection.slug, itemId: req.params.itemId, actionId: action.id });
    res.json({ prompt: buildActionSeedPrompt(record, template), role: action.role });
  } catch (err) {
    log.warn("collections", "action seed failed", {
      slug: collection.slug,
      itemId: req.params.itemId,
      actionId: req.params.actionId,
      error: errorMessage(err),
    });
    serverError(res, errorMessage(err));
  }
});

// Assemble the seed for a collection-level action: read the template and inject
// a compact progress summary of every record. Returns null when the template
// can't be read. Pure plumbing — kept out of the route handler to stay under the
// function-size limit.
async function buildCollectionActionSeed(collection: LoadedCollection, action: CollectionAction): Promise<ActionSeedResponse | null> {
  const template = await readSkillTemplate(collection.skillDir, action.template);
  if (template === null) return null;
  const items = await listItems(collection.dataDir);
  log.info("collections", "collection action seed built", { slug: collection.slug, actionId: action.id, items: items.length });
  return { prompt: buildCollectionActionSeedPrompt(items, collection.schema, template), role: action.role };
}

// Like the per-record route but with no `itemId`: there is no record to read or
// gate on, so the seed injects a progress summary instead. No domain literals.
router.post(API_ROUTES.collections.collectionAction, async (req: Request<{ slug: string; actionId: string }>, res: Response<ActionSeedResponse>) => {
  const collection = await loadCollection(req.params.slug);
  if (!collection) {
    notFound(res, `collection '${req.params.slug}' not found`);
    return;
  }
  const action = collection.schema.collectionActions?.find((entry) => entry.id === req.params.actionId);
  if (!action) {
    notFound(res, `collection action '${req.params.actionId}' not found on collection '${collection.slug}'`);
    return;
  }
  try {
    const seed = await buildCollectionActionSeed(collection, action);
    if (seed === null) {
      serverError(res, `template '${action.template}' for action '${action.id}' could not be read`);
      return;
    }
    res.json(seed);
  } catch (err) {
    log.warn("collections", "collection action seed failed", { slug: collection.slug, actionId: req.params.actionId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// --- Custom views: capability-token minting + scoped data plane ---
//
// The data plane reuses the `manageCollection` tool handler verbatim, so a
// custom view can never do more than the agent itself (same getItems /
// putItems actions, same validation, scoped to one slug). The handler
// returns a JSON string on success and a bare diagnostic string on a guard
// failure (unknown slug, over-limit unselective read, bad putItems shape) —
// forward parsed JSON as 200, the bare string as a 400 `{ error }`.

/** Parse a `read`/`write` capability list from a request body value. */
function parseCapabilities(value: unknown): ViewCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const caps = value.filter((entry): entry is ViewCapability => entry === "read" || entry === "write");
  return caps.length > 0 ? caps : undefined;
}

/** Parse a comma-separated or repeated query param into a string list. */
function parseListParam(value: unknown): string[] | undefined {
  const parts = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value.map(String) : [];
  const cleaned = parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function sendToolResult(res: Response, raw: string): void {
  try {
    res.json(JSON.parse(raw));
  } catch {
    res.status(400).json({ error: raw });
  }
}

// The view-data fetch comes from a sandboxed (opaque-origin) iframe, so it is
// a cross-origin request that the browser gates with CORS. `*` is safe here:
// auth is the unguessable scoped token in the Authorization header (not a
// cookie), so no ambient-credential leak — an origin without the token just
// reads a 401. The custom Authorization header makes the request non-simple,
// so the browser preflights; the OPTIONS handler below answers it.
function viewDataCors(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  next();
}

router.options(API_ROUTES.collections.viewData, viewDataCors, (_req: Request, res: Response) => {
  res.status(204).end();
});

// Serve a custom view's HTML file. Behind the global bearer (the parent
// fetches it, then renders it sandboxed). Read from the data/skills staging
// path — custom-view HTML is staging-only, never mirrored to .claude/skills
// (rendering is host-side). Path-safe: slug + the schema-validated
// `views/*.html` file, resolved with realpath containment.
router.get(API_ROUTES.collections.viewFile, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const viewId = typeof req.query.id === "string" ? req.query.id : "";
    const collection = await loadCollection(slug);
    if (!collection) {
      notFound(res, `collection '${slug}' not found`);
      return;
    }
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) {
      notFound(res, `custom view '${viewId}' not found on collection '${slug}'`);
      return;
    }
    // Path-safe, source-aware read through the collections domain layer (no raw
    // fs / hardcoded subpaths in the route).
    const html = await readCustomViewHtml(collection, view.file);
    if (html === null) {
      notFound(res, `view file '${view.file}' not found — author it at data/skills/<slug>/${view.file}`);
      return;
    }
    res.type("text/html").send(html);
  } catch (err) {
    log.warn("collections", "view-file read failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Mint a scoped token for a custom view. Behind the global bearer (only the
// real frontend can mint); clamps requested caps to what the view declared
// so a `read`-only view can never obtain a `write` token.
router.post(API_ROUTES.collections.viewToken, async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const body = (req.body ?? {}) as { viewId?: unknown; capabilities?: unknown };
    const viewId = typeof body.viewId === "string" ? body.viewId.trim() : "";
    if (!viewId) {
      badRequest(res, "`viewId` is required");
      return;
    }
    const collection = await loadCollection(slug);
    if (!collection) {
      notFound(res, `collection '${slug}' not found`);
      return;
    }
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) {
      notFound(res, `custom view '${viewId}' not found on collection '${slug}'`);
      return;
    }
    const granted = clampCapabilities(view.capabilities, parseCapabilities(body.capabilities));
    const minted = mintViewToken(slug, granted);
    if (!minted) {
      serverError(res, "view token unavailable (server not ready)");
      return;
    }
    res.json({ token: minted.token, exp: minted.exp, dataUrl: API_ROUTES.collections.viewData.replace(":slug", slug), capabilities: granted });
  } catch (err) {
    log.warn("collections", "view-token mint failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Scoped read: enriched records (getItems). Guarded by the view token only
// (exempt from global bearer + CSRF — see server/index.ts).
router.get(API_ROUTES.collections.viewData, viewDataCors, requireViewToken("read"), async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const ids = parseListParam(req.query.ids);
    const fields = parseListParam(req.query.fields);
    const raw = await manageCollection.handler({
      action: "getItems",
      slug: req.params.slug,
      ...(ids ? { ids } : {}),
      ...(fields ? { fields } : {}),
    });
    sendToolResult(res, raw);
  } catch (err) {
    log.warn("collections", "view-data read failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Scoped write: validated putItems. Requires the `write` capability.
router.put(API_ROUTES.collections.viewData, viewDataCors, requireViewToken("write"), async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const body = (req.body ?? {}) as { items?: unknown; mode?: unknown };
    const raw = await manageCollection.handler({ action: "putItems", slug: req.params.slug, items: body.items, mode: body.mode });
    sendToolResult(res, raw);
  } catch (err) {
    log.warn("collections", "view-data write failed", { slug: req.params.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Map a non-ok view-delete result to the matching HTTP error. Kept beside the
// route so the handler stays short and the status mapping is unit-testable.
function sendDeleteViewRefusal(res: Response, result: Exclude<DeleteViewResult, { kind: "ok" }>): void {
  if (result.kind === "not-found") {
    notFound(res, `custom view '${result.viewId}' not found`);
    return;
  }
  if (result.kind === "unsafe-path") {
    badRequest(res, `custom view '${result.viewId}' has an unsafe file path`);
    return;
  }
  forbidden(
    res,
    result.kind === "user-scope"
      ? "user-scope collections (~/.claude/skills/) are read-only from MulmoClaude"
      : "preset (mc-*) collections re-seed on restart; their views can't be deleted here",
  );
}

// Delete one custom view: drop it from schema.json `views[]` (every on-disk
// copy) and unlink its HTML file. Behind the global bearer. Source-aware;
// refuses user-scope + preset collections, consistent with collection delete.
router.delete(API_ROUTES.collections.viewDelete, async (req: Request<{ slug: string; viewId: string }>, res: Response<DeleteViewResponse>) => {
  try {
    const collection = await loadCollection(req.params.slug);
    if (!collection) {
      notFound(res, `collection '${req.params.slug}' not found`);
      return;
    }
    const result = await deleteCustomView(collection, req.params.viewId);
    if (result.kind !== "ok") {
      sendDeleteViewRefusal(res, result);
      return;
    }
    log.info("collections", "custom view deleted", { slug: collection.slug, viewId: result.viewId });
    res.json({ deleted: true, viewId: result.viewId });
  } catch (err) {
    log.warn("collections", "view delete failed", { slug: req.params.slug, viewId: req.params.viewId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
