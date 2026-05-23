// REST surface for schema-driven apps. Each app is a skill that
// ships a sibling `schema.json`; the host's <AppCollectionView>
// component reads through these endpoints.
//
//   GET    /api/apps                       → { apps: AppSummary[] }
//   GET    /api/apps/:slug                 → { app, items }
//   POST   /api/apps/:slug/items           → { item, itemId }
//   PUT    /api/apps/:slug/items/:itemId   → { item, itemId }
//   DELETE /api/apps/:slug/items/:itemId   → { deleted: true }

import { Router, Request, Response } from "express";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { discoverApps, generateItemId, deleteItem, listItems, loadApp, toDetail, toSummary, writeItem } from "../../workspace/apps/index.js";
import type { AppDetail, AppItem, AppSummary } from "../../workspace/apps/index.js";
import { badRequest, notFound, conflict, serverError } from "../../utils/httpError.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

const router = Router();

interface AppsListResponse {
  apps: AppSummary[];
}

interface AppDetailResponse {
  app: AppDetail;
  items: AppItem[];
}

interface ItemMutationResponse {
  itemId: string;
  item: AppItem;
}

interface DeleteResponse {
  deleted: true;
  itemId: string;
}

router.get(API_ROUTES.apps.list, async (_req: Request, res: Response<AppsListResponse>) => {
  try {
    const apps = await discoverApps();
    res.json({ apps: apps.map(toSummary) });
  } catch (err) {
    log.warn("apps", "list failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.get(API_ROUTES.apps.detail, async (req: Request<{ slug: string }>, res: Response<AppDetailResponse>) => {
  const app = await loadApp(req.params.slug);
  if (!app) {
    notFound(res, `app '${req.params.slug}' not found`);
    return;
  }
  try {
    const items = await listItems(app.dataDir);
    res.json({ app: toDetail(app), items });
  } catch (err) {
    log.warn("apps", "detail failed", { slug: app.slug, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

function extractRecord(body: unknown): AppItem | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as AppItem;
}

router.post(API_ROUTES.apps.items, async (req: Request<{ slug: string }>, res: Response<ItemMutationResponse>) => {
  const app = await loadApp(req.params.slug);
  if (!app) {
    notFound(res, `app '${req.params.slug}' not found`);
    return;
  }
  const record = extractRecord(req.body);
  if (!record) {
    badRequest(res, "request body must be a JSON object");
    return;
  }
  // Honour the schema's primaryKey: if the record carries it, use that
  // value as the item id; otherwise generate one. The body always wins
  // over a generated id so Claude-derived semantic slugs stick.
  const primaryRaw = record[app.schema.primaryKey];
  const itemId = typeof primaryRaw === "string" && primaryRaw.length > 0 ? primaryRaw : generateItemId();
  const recordWithId: AppItem = { ...record, [app.schema.primaryKey]: itemId };
  try {
    const result = await writeItem(app.dataDir, itemId, recordWithId, { refuseOverwrite: true });
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "conflict") {
      conflict(res, `item '${result.itemId}' already exists`);
      return;
    }
    log.info("apps", "item created", { slug: app.slug, itemId: result.itemId });
    res.json({ itemId: result.itemId, item: result.item });
  } catch (err) {
    log.warn("apps", "item create failed", { slug: app.slug, itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.put(API_ROUTES.apps.item, async (req: Request<{ slug: string; itemId: string }>, res: Response<ItemMutationResponse>) => {
  const app = await loadApp(req.params.slug);
  if (!app) {
    notFound(res, `app '${req.params.slug}' not found`);
    return;
  }
  const record = extractRecord(req.body);
  if (!record) {
    badRequest(res, "request body must be a JSON object");
    return;
  }
  // PUT pins the primaryKey to the URL itemId — disregard any
  // mismatched primary-key value in the body so the file's id and its
  // record id never drift.
  const recordWithId: AppItem = { ...record, [app.schema.primaryKey]: req.params.itemId };
  try {
    const result = await writeItem(app.dataDir, req.params.itemId, recordWithId);
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "conflict") {
      // refuseOverwrite was false — this branch is unreachable, but
      // typescript needs the exhaustive switch.
      serverError(res, "unexpected conflict on update");
      return;
    }
    log.info("apps", "item updated", { slug: app.slug, itemId: result.itemId });
    res.json({ itemId: result.itemId, item: result.item });
  } catch (err) {
    log.warn("apps", "item update failed", { slug: app.slug, itemId: req.params.itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

router.delete(API_ROUTES.apps.item, async (req: Request<{ slug: string; itemId: string }>, res: Response<DeleteResponse>) => {
  const app = await loadApp(req.params.slug);
  if (!app) {
    notFound(res, `app '${req.params.slug}' not found`);
    return;
  }
  try {
    const result = await deleteItem(app.dataDir, req.params.itemId);
    if (result.kind === "invalid-id") {
      badRequest(res, `invalid item id: ${result.itemId}`);
      return;
    }
    if (result.kind === "not-found") {
      notFound(res, `item '${result.itemId}' not found`);
      return;
    }
    log.info("apps", "item deleted", { slug: app.slug, itemId: result.itemId });
    res.json({ deleted: true, itemId: result.itemId });
  } catch (err) {
    log.warn("apps", "item delete failed", { slug: app.slug, itemId: req.params.itemId, error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
