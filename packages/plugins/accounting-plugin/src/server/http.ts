// Tiny Express helper owned by the package so the router is
// self-contained (no host util imports). `asyncHandler` turns an
// uncaught throw inside an async handler into a logged 500 carrying
// only the caller-supplied fallback message — never the raw error text
// (which could leak internals). Mirrors the host's
// server/utils/asyncHandler.ts, scoped to this package's logger.

import type { Request, Response, NextFunction } from "express";
import { log } from "./context.js";
import { errorMessage } from "../shared/errors.js";

export function asyncHandler<TReq = Request, TRes = Response>(
  namespace: string,
  fallbackMessage: string,
  handler: (req: TReq, res: TRes) => Promise<void>,
): (req: TReq, res: TRes, next: NextFunction) => Promise<void> {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (err) {
      const expressReq = req as Request;
      const expressRes = res as Response;
      log.error(namespace, "handler threw", { route: expressReq.path, error: errorMessage(err) });
      if (expressRes.headersSent) {
        // Response already (partially) sent — we can't write a clean 500.
        // Forward to Express's error flow so it can destroy the socket
        // rather than leaving the request hanging.
        next(err);
        return;
      }
      expressRes.status(500).json({ error: fallbackMessage });
    }
  };
}
