// REST endpoint for the Encore plugin. Single POST dispatch route
// with a `kind` discriminator — matches the accounting / scheduler
// convention so the MCP bridge (which posts the tool args verbatim)
// and the click-handler page (`src/plugins/encore/View.vue`) plug in
// without translation.
//
// All business logic lives in `src/plugins/encore/server.ts`; this
// file is just the Express adapter (request validation, error
// mapping, logging).
//
// See plans/feat-encore-as-builtin.md.

import { Router, Request, Response } from "express";

import { dispatch, EncoreError, type EncoreDispatchBody } from "../../encore/dispatch.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";
import { log } from "../../system/logger/index.js";
import { asyncHandler } from "../../utils/asyncHandler.js";

const router = Router();

interface EncoreErrorResponse {
  error: string;
  details?: unknown;
}

bindRoute(
  router,
  API_ROUTES.encore.dispatch,
  asyncHandler<Request<object, unknown, EncoreDispatchBody>, Response<unknown | EncoreErrorResponse>>("encore", "encore dispatch failed", async (req, res) => {
    const { body } = req;
    if (!body || typeof body !== "object" || typeof body.kind !== "string") {
      log.warn("encore", "POST dispatch: invalid body");
      res.status(400).json({ error: "request body must be an object with a string `kind` field" });
      return;
    }
    const { kind } = body;
    log.info("encore", "POST dispatch: start", { kind });
    try {
      const result = await dispatch(body);
      log.info("encore", "POST dispatch: ok", { kind, ok: result.ok });
      res.json(result);
    } catch (err) {
      if (err instanceof EncoreError) {
        log.warn("encore", "POST dispatch: error", { kind, status: err.status, message: err.message });
        res.status(err.status).json({ error: err.message, details: err.details });
        return;
      }
      throw err;
    }
  }),
);

export default router;
