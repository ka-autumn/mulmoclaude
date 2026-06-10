import { Router, Request, Response } from "express";
import { realpathSync } from "node:fs";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/workspace.js";
import { writeWorkspaceText } from "../../utils/files/workspace-io.js";
import { resolveWithinRoot } from "../../utils/files/index.js";
import { buildArtifactPath } from "../../utils/files/naming.js";
import { overwriteHtml, isHtmlPath } from "../../utils/files/html-store.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { publishFileChange } from "../../events/file-change.js";

const router = Router();

// Realpath'd workspace root, resolved once — `resolveWithinRoot` needs an
// already-realpath'd root (same pattern as the files route).
const workspaceReal = realpathSync(workspacePath);

const PRESENT_ACK = "Acknowledge that the HTML page has been presented to the user.";

interface PresentHtmlBody {
  html?: string;
  title?: string;
  path?: string;
}

interface PresentHtmlSuccessResponse {
  message: string;
  instructions: string;
  data: { title?: string; filePath: string };
}

interface PresentHtmlErrorResponse {
  error: string;
}

type PresentHtmlResponse = PresentHtmlSuccessResponse | PresentHtmlErrorResponse;

// New HTML: persist under a fresh artifact path, then present it.
async function saveAndPresent(html: string, title: string | undefined, res: Response<PresentHtmlResponse>): Promise<void> {
  const filePath = buildArtifactPath(WORKSPACE_DIRS.htmls, title, ".html", "page");
  await writeWorkspaceText(filePath, html);
  log.info("html", "present: ok", { filePath, bytes: html.length });
  // Fire-and-forget: any subscribed View tab refetches via cache-bust.
  void publishFileChange(filePath);
  res.json({ message: `Saved HTML to ${filePath}`, instructions: PRESENT_ACK, data: { title, filePath } });
}

// Existing HTML: present a file already on disk without re-saving a copy.
function presentExisting(relativePath: string, title: string | undefined, res: Response<PresentHtmlResponse>): void {
  // `isHtmlPath` rejects non-artifact / traversal paths; `resolveWithinRoot` is the
  // realpath-based containment check (and returns null when the file is missing).
  if (!isHtmlPath(relativePath) || resolveWithinRoot(workspaceReal, relativePath) === null) {
    log.warn("html", "present: bad path", { pathPreview: previewSnippet(relativePath) });
    badRequest(res, "path must be an existing .html file under artifacts/html/");
    return;
  }
  log.info("html", "present: existing", { filePath: relativePath });
  res.json({ message: `Presented existing HTML at ${relativePath}`, instructions: PRESENT_ACK, data: { title, filePath: relativePath } });
}

bindRoute(router, API_ROUTES.html.create, async (req: Request<object, unknown, PresentHtmlBody>, res: Response<PresentHtmlResponse>) => {
  const { html, title, path: htmlPath } = req.body;
  log.info("html", "present: start", {
    titlePreview: typeof title === "string" ? previewSnippet(title) : undefined,
    bytes: typeof html === "string" ? html.length : undefined,
    pathPreview: typeof htmlPath === "string" ? previewSnippet(htmlPath) : undefined,
  });
  try {
    // `html` and `path` are mutually exclusive (the tool contract / prompt say
    // "either, not both") — reject both-set and neither-set rather than letting
    // one silently win and present the wrong page.
    if (typeof htmlPath === "string" && htmlPath.length > 0 && typeof html === "string" && html.length > 0) {
      log.warn("html", "present: both html and path provided");
      badRequest(res, "provide either `html` or `path`, not both");
    } else if (typeof htmlPath === "string" && htmlPath.length > 0) {
      presentExisting(htmlPath, title, res);
    } else if (typeof html === "string" && html.length > 0) {
      await saveAndPresent(html, title, res);
    } else {
      log.warn("html", "present: missing html and path");
      badRequest(res, "provide either `html` or `path`");
    }
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

interface UpdateHtmlSuccessResponse {
  path: string;
}

interface UpdateHtmlErrorResponse {
  error: string;
}

bindRoute(
  router,
  API_ROUTES.html.update,
  async (req: Request<object, unknown, UpdateHtmlBody>, res: Response<UpdateHtmlSuccessResponse | UpdateHtmlErrorResponse>) => {
    const { relativePath, html } = req.body;
    log.info("html", "update: start", {
      pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
      bytes: typeof html === "string" ? html.length : undefined,
    });
    if (!html) {
      log.warn("html", "update: missing html");
      badRequest(res, "html is required");
      return;
    }
    if (!relativePath || !isHtmlPath(relativePath)) {
      log.warn("html", "update: invalid relativePath", {
        pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
      });
      badRequest(res, "invalid html relativePath");
      return;
    }
    try {
      await overwriteHtml(relativePath, html);
      log.info("html", "update: ok", { pathPreview: previewSnippet(relativePath), bytes: html.length });
      void publishFileChange(relativePath);
      res.json({ path: relativePath });
    } catch (err) {
      log.error("html", "update: threw", { pathPreview: previewSnippet(relativePath), error: errorMessage(err) });
      serverError(res, errorMessage(err));
    }
  },
);

export default router;
