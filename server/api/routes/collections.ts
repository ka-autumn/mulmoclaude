// REST surface for schema-driven collections. Each collection is a
// skill that ships a sibling `schema.json`; the host's <CollectionView>
// component reads through these endpoints.
//
//   GET    /api/collections                       → { collections: CollectionSummary[] }
//   GET    /api/collections/:slug                 → { collection, items }
//   POST   /api/collections/:slug/items           → { item, itemId }
//   PUT    /api/collections/:slug/items/:itemId   → { item, itemId }
//   DELETE /api/collections/:slug/items/:itemId   → { deleted: true }

import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { actionVisible } from "../../../src/utils/collections/actionVisible.js";
import {
  discoverCollections,
  generateItemId,
  deleteCollection,
  deleteCollectionRefusalMessage,
  deleteItem,
  listItems,
  loadCollection,
  readItem,
  readSkillTemplate,
  buildActionSeedPrompt,
  resolveCreateItemId,
  toDetail,
  toSummary,
  writeItem,
} from "../../workspace/collections/index.js";
import type { CollectionDetail, CollectionItem, CollectionSummary } from "../../workspace/collections/index.js";
import { badRequest, notFound, conflict, forbidden, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

const router = Router();

interface CollectionsListResponse {
  collections: CollectionSummary[];
}

interface CollectionDetailResponse {
  collection: CollectionDetail;
  items: CollectionItem[];
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
    res.json({ collection: toDetail(collection), items });
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

export default router;
