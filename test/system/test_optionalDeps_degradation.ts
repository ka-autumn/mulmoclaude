// E2E-style integration test for the optional-dependency graceful
// degradation feature (#1385, PR #1390). Deterministic and
// CI-runnable under `yarn test` (no Playwright, no Claude API, no
// real ffmpeg/docker needed — the probe cache is seeded directly).
//
// Proves:
//  1. ffmpeg absent  → generateMovie / renderBeat return a clean
//     HTTP 503 instead of letting mulmocast crash mid-stream.
//  2. ffmpeg absent  → boot announce emits a `deps` warn that
//     attributes the affected plugin (presentMulmoScript).
//  3. ffmpeg present → no false "missing" warning.
//
// Route handlers are pulled straight off the Express Router stack
// and invoked with mock req/res (same idiom as test_hookLog.ts) so
// no live server / supertest is needed.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Request, Response, Router } from "express";
import mulmoScriptRouter from "../../server/api/routes/mulmo-script.js";
import { announceOptionalDeps, buildOptionalDepNotification } from "../../server/system/announceOptionalDeps.js";
import { _resetOptionalDepsCacheForTest, _setOptionalDepsCacheForTest, type DepStatus, type OptionalDep } from "../../server/system/optionalDeps.js";
import { initNotifier, _setFilePathsForTesting } from "../../server/notifier/engine.js";
import { log } from "../../server/system/logger/index.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";

interface RouterInternals {
  stack: { route?: { path: string; stack: { handle: (req: Request, res: Response) => unknown }[] } }[];
}

function getHandler(router: Router, url: string): (req: Request, res: Response) => unknown {
  const internals = router as unknown as RouterInternals;
  for (const layer of internals.stack) {
    if (layer.route && layer.route.path === url) return layer.route.stack[0].handle;
  }
  throw new Error(`handler for ${url} not found in router stack`);
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  headersSent: boolean;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  setHeader: () => MockResponse;
  write: () => boolean;
  end: () => MockResponse;
}

function mockResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    setHeader() {
      return this;
    },
    write() {
      return true;
    },
    end() {
      this.headersSent = true;
      return this;
    },
  };
}

const FFMPEG_ABSENT: Record<string, DepStatus> = {
  ffmpeg: { id: "ffmpeg", available: false, reason: "not-on-path" },
};
const FFMPEG_PRESENT: Record<string, DepStatus> = {
  ffmpeg: { id: "ffmpeg", available: true, reason: "ok" },
};

async function callRoute(url: string, body: unknown): Promise<MockResponse> {
  const handler = getHandler(mulmoScriptRouter, url);
  const res = mockResponse();
  await Promise.resolve(handler({ body } as unknown as Request, res as unknown as Response));
  return res;
}

describe("optional-deps: ffmpeg route guard", () => {
  afterEach(() => _resetOptionalDepsCacheForTest());

  it("renderBeat returns 503 with a clear message when ffmpeg is unavailable", async () => {
    _setOptionalDepsCacheForTest(FFMPEG_ABSENT);
    const res = await callRoute(API_ROUTES.mulmoScript.renderBeat.url, { filePath: "stories/x.json", beatIndex: 0 });
    assert.equal(res.statusCode, 503);
    assert.match(String((res.body as { error?: string }).error), /ffmpeg is not installed/);
  });

  it("generateMovie returns 503 with a clear message when ffmpeg is unavailable", async () => {
    _setOptionalDepsCacheForTest(FFMPEG_ABSENT);
    const res = await callRoute(API_ROUTES.mulmoScript.generateMovie.url, { filePath: "stories/x.json" });
    assert.equal(res.statusCode, 503);
    assert.match(String((res.body as { error?: string }).error), /ffmpeg is not installed/);
  });

  it("does NOT short-circuit with the ffmpeg 503 when ffmpeg is present", async () => {
    _setOptionalDepsCacheForTest(FFMPEG_PRESENT);
    // Missing filePath trips the route's own 400 validation, which
    // sits before the ffmpeg guard — proving the guard stayed out
    // of the way when the dependency is available.
    const res = await callRoute(API_ROUTES.mulmoScript.generateMovie.url, {});
    assert.notEqual(res.statusCode, 503);
  });
});

describe("optional-deps: boot announcement", () => {
  let tmpDir = "";
  const captured: { namespace: string; message: string; data?: object }[] = [];
  const originalWarn = log.warn;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mulmo-optdeps-test-"));
    _setFilePathsForTesting({ active: path.join(tmpDir, "active.json"), history: path.join(tmpDir, "history.json") });
    initNotifier({ publish: () => {} });
    captured.length = 0;
    log.warn = (namespace, message, data) => {
      captured.push({ namespace, message, data });
    };
  });

  afterEach(() => {
    log.warn = originalWarn;
    _resetOptionalDepsCacheForTest();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("warns under the 'deps' namespace and attributes presentMulmoScript when ffmpeg is absent", async () => {
    _setOptionalDepsCacheForTest(FFMPEG_ABSENT);
    await announceOptionalDeps();
    const depWarn = captured.find((entry) => entry.namespace === "deps");
    assert.ok(depWarn, "a 'deps' warn must be emitted for the missing dependency");
    const data = depWarn.data as { depId?: string; affectedPlugins?: string[] };
    assert.equal(data.depId, "ffmpeg");
    assert.ok(data.affectedPlugins?.includes("presentMulmoScript"), "the warn must name the plugin that requires ffmpeg");
  });

  it("does not warn for ffmpeg when it is present", async () => {
    _setOptionalDepsCacheForTest(FFMPEG_PRESENT);
    await announceOptionalDeps();
    assert.equal(
      captured.find((entry) => entry.namespace === "deps"),
      undefined,
      "no 'deps' warn when the dependency is available",
    );
  });
});

describe("optional-deps: notification payload", () => {
  const dockerDep: OptionalDep = { id: "docker", command: "docker", enables: "dockerSandbox" };
  const ffmpegDep: OptionalDep = { id: "ffmpeg", command: "ffmpeg", enables: "mulmocast" };

  it("emits the not-found title/body keys when the binary is missing from PATH", () => {
    const status: DepStatus = { id: "docker", available: false, reason: "not-on-path" };
    const payload = buildOptionalDepNotification(dockerDep, status);
    assert.equal(payload.id, "optional-dep-missing:docker");
    assert.equal(payload.i18n?.titleKey, "optionalDeps.titleNotFound");
    assert.deepEqual(payload.i18n?.titleParams, { command: "docker" });
    assert.equal(payload.i18n?.bodyKey, "optionalDeps.notFound");
    assert.deepEqual(payload.i18n?.bodyParams, { command: "docker" });
    assert.match(String(payload.title), /not installed/);
  });

  it("emits the not-responding title/body keys when the probe fails", () => {
    const status: DepStatus = { id: "docker", available: false, reason: "probe-failed" };
    const payload = buildOptionalDepNotification(dockerDep, status);
    assert.equal(payload.id, "optional-dep-missing:docker");
    assert.equal(payload.i18n?.titleKey, "optionalDeps.titleNotResponding");
    assert.deepEqual(payload.i18n?.titleParams, { command: "docker" });
    assert.equal(payload.i18n?.bodyKey, "optionalDeps.notResponding");
    assert.deepEqual(payload.i18n?.bodyParams, { command: "docker" });
    assert.match(String(payload.title), /not running/);
  });

  it("substitutes the command name from the dep (ffmpeg, not docker)", () => {
    const status: DepStatus = { id: "ffmpeg", available: false, reason: "not-on-path" };
    const payload = buildOptionalDepNotification(ffmpegDep, status);
    assert.equal(payload.id, "optional-dep-missing:ffmpeg");
    assert.deepEqual(payload.i18n?.titleParams, { command: "ffmpeg" });
    assert.deepEqual(payload.i18n?.bodyParams, { command: "ffmpeg" });
  });
});
