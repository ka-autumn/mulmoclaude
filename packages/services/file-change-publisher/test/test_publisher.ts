import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configureFileChangePublisher, resetFileChangePublisher, publishFileChange, pluginFileChannel } from "../src/index.ts";

afterEach(() => resetFileChangePublisher());

function withWorkspace(): { workspace: string; rel: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "fcp-"));
  const rel = "artifacts/html/page.html";
  const abs = path.join(workspace, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "<html></html>");
  return { workspace, rel };
}

test("publishes the primary channel + every matching plugin scope (and skips non-matches)", async () => {
  const { workspace, rel } = withWorkspace();
  const events: { channel: string; path: string; mtimeMs: number }[] = [];
  configureFileChangePublisher({
    publish: (channel, payload) => events.push({ channel, ...payload }),
    workspaceRoot: workspace,
    toPosix: (rawPath) => rawPath.split(path.sep).join("/"),
    primaryChannel: (posix) => `file:${posix}`,
    pluginScopes: [
      { scope: "html", matches: (posix) => posix.endsWith(".html") },
      { scope: "markdown", matches: (posix) => posix.endsWith(".md") }, // shouldn't match
    ],
  });
  try {
    await publishFileChange(rel);
    const channels = events.map((event) => event.channel);
    assert.deepEqual(channels.sort(), [`file:${rel}`, pluginFileChannel("html", rel)].sort());
    assert.ok(events.every((event) => event.path === rel && typeof event.mtimeMs === "number" && event.mtimeMs > 0));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("runs onPublished after publishing", async () => {
  const { workspace, rel } = withWorkspace();
  let seen: string | null = null;
  configureFileChangePublisher({
    publish: () => {},
    workspaceRoot: workspace,
    toPosix: (rawPath) => rawPath,
    onPublished: (posix) => {
      seen = posix;
    },
  });
  try {
    await publishFileChange(rel);
    assert.equal(seen, rel);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("drops paths that escape the workspace — no publish, no onPublished", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "fcp-"));
  const events: string[] = [];
  let onPublishedCalls = 0;
  configureFileChangePublisher({
    publish: (channel) => events.push(channel),
    workspaceRoot: workspace,
    toPosix: (rawPath) => rawPath,
    primaryChannel: (posix) => `file:${posix}`,
    onPublished: () => {
      onPublishedCalls += 1;
    },
  });
  try {
    await publishFileChange("../escape.txt");
    await publishFileChange("../../etc/passwd");
    assert.deepEqual(events, []);
    assert.equal(onPublishedCalls, 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("no-op until configured; falls back to Date.now() when stat fails", async () => {
  await publishFileChange("anything"); // unconfigured → no throw, no-op
  const workspace = mkdtempSync(path.join(tmpdir(), "fcp-"));
  const events: { mtimeMs: number }[] = [];
  configureFileChangePublisher({
    publish: (_channel, payload) => events.push(payload),
    workspaceRoot: workspace,
    toPosix: (rawPath) => rawPath,
    primaryChannel: (posix) => `file:${posix}`,
  });
  try {
    await publishFileChange("missing-file.txt"); // stat fails → Date.now() fallback, still publishes
    assert.equal(events.length, 1);
    assert.ok(events[0].mtimeMs > 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
