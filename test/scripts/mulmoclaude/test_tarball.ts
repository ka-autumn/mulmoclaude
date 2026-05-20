// Unit tests for the pure helpers in scripts/mulmoclaude/tarball.mjs.
//
// The full end-to-end `runTarballSmoke` flow is deliberately NOT
// exercised here — it takes 30-60s and requires a built repo. The
// CI workflow that wraps it (plan step 5) IS the integration test.
// Anything testable WITHOUT spawning npm or binding a real port is
// covered below.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import * as tarball from "../../../scripts/mulmoclaude/tarball.mjs";

describe("allocateRandomPort", () => {
  it("returns a positive non-standard TCP port", async () => {
    const port = await tarball.allocateRandomPort();
    assert.ok(Number.isInteger(port), `expected integer port, got ${port}`);
    assert.ok(port > 1024 && port < 65_536, `port ${port} out of ephemeral range`);
  });

  it("can actually be bound after allocation (no leftover server)", async () => {
    // Regression guard: if allocateRandomPort forgot to close() the
    // probe server, we'd get EADDRINUSE binding the same port here.
    const port = await tarball.allocateRandomPort();
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
    });
  });

  it("returns distinct ports across parallel calls", async () => {
    const ports = await Promise.all([tarball.allocateRandomPort(), tarball.allocateRandomPort(), tarball.allocateRandomPort()]);
    assert.equal(new Set(ports).size, ports.length, `ports collided: ${ports.join(",")}`);
  });
});

describe("pollHttp", () => {
  // Build a clock + sleep pair that a test can drive deterministically.
  function fakeClock() {
    let now = 0;
    return {
      now: () => now,
      sleep: async (delayMs: number) => {
        now += delayMs;
      },
    };
  }

  it("resolves ok on the first 200", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = (async () => new Response("", { status: 200 })) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 1000,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 1);
  });

  it("keeps polling past non-2xx responses then succeeds", async () => {
    const { now, sleep } = fakeClock();
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      const status = call < 3 ? 503 : 200;
      return new Response("", { status });
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 10_000,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 3);
  });

  it("treats fetch rejections like non-2xx and keeps going", async () => {
    const { now, sleep } = fakeClock();
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call < 2) throw new Error("ECONNREFUSED");
      return new Response("", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 10_000,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
  });

  it("times out with the last error when the server never responds", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 500,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, false);
    assert.equal(result.lastError, "ECONNREFUSED");
    assert.ok(result.attempts >= 1);
  });

  it("reports non-2xx HTTP status codes as last error on timeout", async () => {
    const { now, sleep } = fakeClock();
    const fetchImpl = (async () => new Response("", { status: 500 })) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 500,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, false);
    assert.equal(result.lastError, "status 500");
  });

  it("accepts any 2xx, not just 200", async () => {
    const { now, sleep } = fakeClock();
    // Response constructor rejects a body on 204 — pass null so the
    // test actually hits the 2xx acceptance branch rather than
    // blowing up in the mock itself.
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof globalThis.fetch;
    const result = await tarball.pollHttp({
      url: "http://test/",
      timeoutMs: 1000,
      intervalMs: 100,
      fetchImpl,
      now,
      sleep,
    });
    assert.equal(result.ok, true);
  });
});

describe("buildInstallerPackageJson", () => {
  it("produces a private, minimal manifest that references the tarball", () => {
    const pkg = tarball.buildInstallerPackageJson({ tarballName: "mulmoclaude-0.4.0.tgz" });
    assert.equal(pkg.name, "mulmoclaude-smoke-installer");
    assert.equal(pkg.private, true);
    assert.deepEqual(pkg.dependencies, { mulmoclaude: "file:mulmoclaude-0.4.0.tgz" });
  });

  it("omits the dependency entry when no tarball name is given", () => {
    const pkg = tarball.buildInstallerPackageJson();
    assert.deepEqual(pkg.dependencies, {});
  });
});

describe("readTokenFromLauncherLog", () => {
  // The launcher tees stdout/stderr into the smoke's logFile. The
  // server logs `INFO  [auth] bearer token written path=<absolute>
  // source=...` exactly once per boot. Grep that line, then read the
  // file at the captured path. Tests inject a fake reader so they
  // don't touch the disk.
  function fakeReader(map: Record<string, string | Error>): (filePath: string, encoding: "utf8") => Promise<string> {
    return async (filePath) => {
      const value = map[filePath];
      if (value instanceof Error) throw value;
      if (value === undefined) throw new Error(`fake reader: unmapped path ${filePath}`);
      return value;
    };
  }

  it("extracts the path and returns the trimmed token", async () => {
    const logFile = "/tmp/log";
    const tokenFile = "/tmp/ws/.session-token";
    const readFileImpl = fakeReader({
      [logFile]: `[out] 2026-05-02T...Z INFO  [auth] bearer token written path=${tokenFile} source=random\n[out] more...\n`,
      [tokenFile]: "abc123\n",
    });
    const token = await tarball.readTokenFromLauncherLog({ logFile, readFileImpl });
    assert.equal(token, "abc123");
  });

  it("returns null when the marker line is absent", async () => {
    const readFileImpl = fakeReader({ "/tmp/log": "no token line in here\n" });
    assert.equal(await tarball.readTokenFromLauncherLog({ logFile: "/tmp/log", readFileImpl }), null);
  });

  it("returns null when the log file itself is unreadable", async () => {
    const readFileImpl = fakeReader({ "/tmp/log": new Error("ENOENT") });
    assert.equal(await tarball.readTokenFromLauncherLog({ logFile: "/tmp/log", readFileImpl }), null);
  });

  it("returns null when the captured token path can't be read", async () => {
    const readFileImpl = fakeReader({
      "/tmp/log": "INFO bearer token written path=/tmp/ghost source=random\n",
      "/tmp/ghost": new Error("ENOENT"),
    });
    assert.equal(await tarball.readTokenFromLauncherLog({ logFile: "/tmp/log", readFileImpl }), null);
  });
});

describe("probeRuntimePlugins", () => {
  function fakeFetch(handler: (url: string, init?: { headers?: Record<string, string> }) => Response | Promise<Response>): typeof globalThis.fetch {
    return ((url: string, init?: { headers?: Record<string, string> }) => Promise.resolve(handler(url, init))) as unknown as typeof globalThis.fetch;
  }

  it("ok=true and plugins=N on a 200 with a non-empty list", async () => {
    let seenAuth: string | undefined;
    const fetchImpl = fakeFetch((_url, init) => {
      seenAuth = init?.headers?.Authorization;
      return new Response(JSON.stringify({ plugins: [{ name: "@example/installed" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.plugins, 1);
    assert.equal(seenAuth, "Bearer tok", "Authorization header must be sent");
  });

  // Fresh install with no presets and no user-installed plugins is a
  // legitimate state — the route still responds correctly. The probe
  // verifies wiring (auth, route mount, JSON shape), not population.
  it("ok=true on a 200 with an empty plugins array (fresh install, no plugins yet)", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ plugins: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.plugins, 0);
    assert.equal(result.lastError, null);
  });

  it("ok=false on a 200 whose body is not the expected `{ plugins: [...] }` shape", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ unrelated: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /not \{ plugins/);
  });

  it("ok=false with a status code on a non-200 response", async () => {
    const fetchImpl = fakeFetch(() => new Response("Unauthorized", { status: 401 }));
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it("ok=false when token is missing (extraction failed upstream)", async () => {
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: null });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /no bearer token/);
  });

  it("ok=false when fetch throws (server still booting / wrong port)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /ECONNREFUSED/);
  });

  // The expectedDevPlugin filter is what makes the smoke an end-to-end
  // PR2 regression test. Drive both branches.
  it("ok=true when expectedDevPlugin is present in the list with version `dev`", async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            plugins: [
              { name: "@example/installed", version: "0.1.0" },
              { name: "@smoke/dev-fixture", version: "dev" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl, expectedDevPlugin: "@smoke/dev-fixture" });
    assert.equal(result.ok, true);
  });

  it("ok=false when expectedDevPlugin is absent from the list — error names what was seen", async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Response(JSON.stringify({ plugins: [{ name: "@example/installed", version: "0.1.0" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    // pollTimeoutMs=0 skips retries — this test asserts on the
    // single-attempt error shape, not the poll-and-give-up path.
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl, expectedDevPlugin: "@smoke/dev-fixture", pollTimeoutMs: 0 });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /@smoke\/dev-fixture@dev/);
    assert.match(result.lastError ?? "", /@example\/installed@0\.1\.0/);
  });

  it("ok=false when name matches but version is not `dev` (would mean prod plugin was loaded under wrong version)", async () => {
    // Prevents a regression where dev plugins start being stamped
    // with the package.json's literal version. The "dev" sentinel is
    // load-bearing — it's how the asset URL stays distinguishable
    // and how operators tell at a glance which plugins are dev-only.
    const fetchImpl = fakeFetch(
      () =>
        new Response(JSON.stringify({ plugins: [{ name: "@smoke/dev-fixture", version: "0.1.0" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl, expectedDevPlugin: "@smoke/dev-fixture", pollTimeoutMs: 0 });
    assert.equal(result.ok, false);
  });

  // Plugin loading runs in a fire-and-forget IIFE that resolves AFTER
  // `app.listen()`, so `/` can return 200 while the list endpoint
  // still reports `[]`. When `expectedDevPlugin` is set the probe
  // must poll until the plugin appears — otherwise the smoke flakes
  // on fast boots that win the race against plugin loading.
  it("polls until expectedDevPlugin appears when initial responses show an empty list", async () => {
    let call = 0;
    const fetchImpl = fakeFetch(() => {
      call += 1;
      const plugins = call < 3 ? [] : [{ name: "@smoke/dev-fixture", version: "dev" }];
      return new Response(JSON.stringify({ plugins }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const sleeps: number[] = [];
    let now = 0;
    const result = await tarball.probeRuntimePlugins({
      port: 3099,
      token: "tok",
      fetchImpl,
      expectedDevPlugin: "@smoke/dev-fixture",
      pollTimeoutMs: 5_000,
      pollIntervalMs: 100,
      now: () => now,
      sleep: async (delayMs: number) => {
        sleeps.push(delayMs);
        now += delayMs;
      },
    });
    assert.equal(result.ok, true, "should succeed once the dev plugin appears");
    assert.equal(call, 3, "should have probed three times");
    assert.deepEqual(sleeps, [100, 100], "should have slept between probes");
  });

  // The polling has to terminate even when the plugin never shows up
  // (e.g. the IIFE crashed). The last attempt's error message must
  // surface intact so the CI log explains what was actually seen.
  it("gives up after the poll timeout and returns the last error", async () => {
    const fetchImpl = fakeFetch(() => new Response(JSON.stringify({ plugins: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    let now = 0;
    const result = await tarball.probeRuntimePlugins({
      port: 3099,
      token: "tok",
      fetchImpl,
      expectedDevPlugin: "@smoke/dev-fixture",
      pollTimeoutMs: 500,
      pollIntervalMs: 100,
      now: () => now,
      sleep: async (delayMs: number) => {
        now += delayMs;
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /@smoke\/dev-fixture@dev/);
  });

  // Without `expectedDevPlugin`, the empty list is a legitimate state
  // (fresh install) — don't burn the poll budget on something that's
  // already true.
  it("does NOT poll when expectedDevPlugin is absent (empty list is a valid state)", async () => {
    let call = 0;
    const fetchImpl = fakeFetch(() => {
      call += 1;
      return new Response(JSON.stringify({ plugins: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(call, 1);
  });

  // 401/403 (auth misconfigured), non-200 status, non-JSON body, and
  // body-shape regressions are all permanent. The retry loop must
  // bail out on the first attempt instead of masking the failure
  // behind the poll budget — a 10s wait before surfacing "status
  // 401" makes CI logs harder to read, not easier.
  it("does NOT retry on non-200 status even when expectedDevPlugin is set (fail-fast on auth/route regression)", async () => {
    let call = 0;
    const fetchImpl = fakeFetch(() => {
      call += 1;
      return new Response("Unauthorized", { status: 401 });
    });
    const result = await tarball.probeRuntimePlugins({
      port: 3099,
      token: "tok",
      fetchImpl,
      expectedDevPlugin: "@smoke/dev-fixture",
      pollTimeoutMs: 5_000,
      pollIntervalMs: 100,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(call, 1, "should fail fast on 401, not poll");
  });

  it("does NOT retry on body-shape regression even when expectedDevPlugin is set (fail-fast)", async () => {
    let call = 0;
    const fetchImpl = fakeFetch(() => {
      call += 1;
      return new Response(JSON.stringify({ unrelated: true }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await tarball.probeRuntimePlugins({
      port: 3099,
      token: "tok",
      fetchImpl,
      expectedDevPlugin: "@smoke/dev-fixture",
      pollTimeoutMs: 5_000,
      pollIntervalMs: 100,
    });
    assert.equal(result.ok, false);
    assert.match(result.lastError ?? "", /not \{ plugins/);
    assert.equal(call, 1, "should fail fast on body-shape regression, not poll");
  });

  // The `retryable` flag is an internal contract between the poll
  // loop and the single-shot probe. Callers (smoke driver, anyone
  // who imports `tarball.mjs`) MUST NOT see it. Pin both branches
  // so a future refactor that drops `stripRetryable` fails the
  // suite instead of silently leaking internal state.
  it("never leaks the internal `retryable` flag on the success path", async () => {
    const fetchImpl = fakeFetch(
      () => new Response(JSON.stringify({ plugins: [{ name: "@x/y", version: "1.0.0" }] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl });
    assert.equal(Object.prototype.hasOwnProperty.call(result, "retryable"), false, "public result must not expose `retryable`");
  });

  it("never leaks the internal `retryable` flag on the failure path", async () => {
    const fetchImpl = fakeFetch(() => new Response("Unauthorized", { status: 401 }));
    const result = await tarball.probeRuntimePlugins({ port: 3099, token: "tok", fetchImpl, expectedDevPlugin: "@smoke/dev-fixture", pollTimeoutMs: 0 });
    assert.equal(Object.prototype.hasOwnProperty.call(result, "retryable"), false, "public result must not expose `retryable`");
  });

  // Fetch failures ARE retryable: the boot poll already proved `/`
  // answered 200, so an immediate ECONNREFUSED on the next request
  // is a transient race against the server's shutdown / restart,
  // not a permanent breakage.
  it("DOES retry on fetch transport errors when expectedDevPlugin is set", async () => {
    let call = 0;
    let now = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call < 3) throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify({ plugins: [{ name: "@smoke/dev-fixture", version: "dev" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch;
    const result = await tarball.probeRuntimePlugins({
      port: 3099,
      token: "tok",
      fetchImpl,
      expectedDevPlugin: "@smoke/dev-fixture",
      pollTimeoutMs: 5_000,
      pollIntervalMs: 100,
      now: () => now,
      sleep: async (delayMs: number) => {
        now += delayMs;
      },
    });
    assert.equal(result.ok, true);
    assert.equal(call, 3);
  });
});

describe("makeDevPluginFixture", () => {
  it("creates a directory with package.json + dist/index.js the loader can accept", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const workDir = await mkdtemp(path.join(tmpdir(), "mulmo-fixture-test-"));
    try {
      const fixture = await tarball.makeDevPluginFixture({ workDir });
      assert.equal(fixture.name, "@smoke/dev-fixture");
      const pkg = JSON.parse(await readFile(path.join(fixture.absPath, "package.json"), "utf8"));
      assert.equal(pkg.name, "@smoke/dev-fixture");
      assert.equal(pkg.type, "module");
      const indexJs = await readFile(path.join(fixture.absPath, "dist", "index.js"), "utf8");
      assert.match(indexJs, /TOOL_DEFINITION/);
      assert.match(indexJs, /smokeDevTool/);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("respects a caller-overridden name and subdir", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const workDir = await mkdtemp(path.join(tmpdir(), "mulmo-fixture-test-"));
    try {
      const fixture = await tarball.makeDevPluginFixture({ workDir, name: "@my/custom", subdir: "alt-dir" });
      assert.equal(fixture.name, "@my/custom");
      assert.equal(path.basename(fixture.absPath), "alt-dir");
      const pkg = JSON.parse(await readFile(path.join(fixture.absPath, "package.json"), "utf8"));
      assert.equal(pkg.name, "@my/custom");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
