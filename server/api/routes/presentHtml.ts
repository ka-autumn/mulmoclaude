import { Router, Request, Response } from "express";
import { executeHtml, executeHtmlUpdate } from "@mulmoclaude/html-plugin";
import type { HtmlArgs, PresentHtmlData } from "@mulmoclaude/html-plugin";
import { makeArtifactsFileOps } from "../../plugins/runtime.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { publishFileChange } from "../../events/file-change.js";

const router = Router();

// presentHtml's tool schema, validation, and artifacts persistence now live in
// the shared @mulmoclaude/html-plugin package (single source of truth, also
// consumable by MulmoTerminal). These routes are THIN host adapters: they inject
// the GENERIC `files.artifacts` runtime capability and forward the package's
// result, adding only the host-specific file-change pub/sub so subscribed View
// tabs cache-bust. All html logic — html/path mutual exclusion, slug/path
// building, containment guard, write — lives in the package.

interface PresentHtmlResponse {
  message: string;
  instructions?: string;
  data?: PresentHtmlData;
  error?: string;
}

bindRoute(router, API_ROUTES.html.create, async (req: Request<object, unknown, HtmlArgs>, res: Response<PresentHtmlResponse>) => {
  const { html, title, path: htmlPath } = req.body ?? {};
  log.info("html", "present: start", {
    titlePreview: typeof title === "string" ? previewSnippet(title) : undefined,
    bytes: typeof html === "string" ? html.length : undefined,
    pathPreview: typeof htmlPath === "string" ? previewSnippet(htmlPath) : undefined,
  });
  try {
    const result = await executeHtml({ files: { artifacts: makeArtifactsFileOps() } }, req.body);
    if (!result.data) {
      // Validation failure (both `html`+`path`, neither, or a non-existent
      // path): executeHtml returns a message-only ToolResult to stay
      // host-agnostic. Map it to HTTP 400 here so we preserve the
      // pre-extraction contract — the frontend (`src/plugins/presentHtml/
      // index.ts`) treats any 2xx as success and would otherwise drop the
      // error into a data-less, near-empty tool result instead of surfacing
      // `message` via its `!result.ok` branch.
      log.warn("html", "present: rejected", { message: result.message });
      badRequest(res, result.message);
      return;
    }
    // Fire-and-forget: any subscribed View tab refetches via cache-bust.
    void publishFileChange(result.data.filePath);
    log.info("html", "present: ok", { filePath: result.data.filePath });
    res.json(result);
  } catch (err) {
    log.error("html", "present: threw", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Update html file on disk (user edits in View). Body carries the
// workspace-relative path verbatim (e.g.
// `artifacts/html/2026/04/page-abc.html`) so the route doesn't have to
// reconstruct one from a basename — same shape as presentDocument.updateMarkdown.
interface UpdateHtmlBody {
  relativePath: string;
  html: string;
}

bindRoute(router, API_ROUTES.html.update, async (req: Request<object, unknown, UpdateHtmlBody>, res: Response<{ path: string } | { error: string }>) => {
  const { relativePath, html } = req.body ?? {};
  log.info("html", "update: start", {
    pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
    bytes: typeof html === "string" ? html.length : undefined,
  });
  try {
    const result = await executeHtmlUpdate({ files: { artifacts: makeArtifactsFileOps() } }, { relativePath, html });
    if (!result.ok) {
      log.warn("html", "update: rejected", { error: result.error, pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined });
      badRequest(res, result.error);
      return;
    }
    log.info("html", "update: ok", { pathPreview: previewSnippet(result.filePath), bytes: html.length });
    void publishFileChange(result.filePath);
    res.json({ path: result.filePath });
  } catch (err) {
    log.error("html", "update: threw", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
