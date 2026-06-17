import { Router, Request, Response } from "express";
import { executeChart, isValidChartDocument } from "@mulmoclaude/chart-plugin";
import type { ChartArgs } from "@mulmoclaude/chart-plugin";
import { makeArtifactsFileOps } from "../../plugins/runtime.js";
import { errorMessage } from "../../utils/errors.js";
import { serverError } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";

const router = Router();

// presentChart's tool schema, validation, and persistence now live in the
// shared @mulmoclaude/chart-plugin package (single source of truth, also
// consumed by MulmoTerminal). This route is a THIN host adapter: it injects
// the GENERIC `files.artifacts` runtime capability (the shared, user-browsable
// artifacts area) and forwards the package's ToolResult. All chart logic —
// validation, slug/path building, JSON write — lives in the package.
//
// `isValidChartDocument` is re-exported so test/routes/test_chartRoute.ts and
// any other host caller keep importing it from here unchanged.
export { isValidChartDocument };

bindRoute(router, API_ROUTES.chart.create, async (req: Request<object, unknown, ChartArgs>, res: Response) => {
  const { title } = req.body ?? {};
  log.info("chart", "present: start", {
    titlePreview: typeof title === "string" ? previewSnippet(title) : undefined,
    chartCount: isValidChartDocument(req.body?.document) ? req.body.document.charts.length : undefined,
  });
  try {
    const result = await executeChart({ files: { artifacts: makeArtifactsFileOps() } }, req.body);
    log.info("chart", "present: ok", { hasData: "data" in result });
    res.json(result);
  } catch (err) {
    log.error("chart", "present: threw", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
