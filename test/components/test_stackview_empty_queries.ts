// Regression check for #1538 — StackView's empty state must render
// the role's sample queries as click-to-send pill buttons (mirroring
// App.vue's single-layout empty state) and fall back to the
// `app.startConversation` message when the role declares none.
//
// The repo doesn't have a Vue component unit-test runtime today; the
// sibling googlemap-wiring test uses the same source-text assertion
// pattern. A future refactor that drops any of the three branches
// below will trip the assertion at unit-test time, ahead of the e2e
// run that would otherwise catch it later.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readSource(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

test("StackView declares `queries?: readonly string[]` prop", () => {
  const src = readSource("src/components/StackView.vue");
  assert.match(src, /queries\?:\s*readonly\s+string\[\]/, "StackView's defineProps must declare `queries?: readonly string[]`");
});

test("StackView empty state renders queries as click-to-send buttons (happy path)", () => {
  const src = readSource("src/components/StackView.vue");
  // Gate: queries non-empty AND a sender is wired.
  assert.match(
    src,
    /queries\s*&&\s*queries\.length\s*>\s*0\s*&&\s*sendTextMessage/,
    "Empty-state render must be gated on queries presence + sendTextMessage prop",
  );
  // Click handler dispatches to the prop directly so App.vue's
  // sendMessage flows through the same path as ChatInput.
  assert.match(src, /@click="sendTextMessage\(query\)"/, 'Each query button must @click="sendTextMessage(query)"');
  // Defensive `type=\"button\"` so a future surrounding form can't
  // accidentally turn these into submit triggers (Sourcery review).
  assert.match(
    src,
    /data-testid="stack-empty-query"[\s\S]*?type="button"|type="button"[\s\S]*?data-testid="stack-empty-query"/,
    'Query buttons must declare type="button"',
  );
});

test("StackView empty state falls back to app.startConversation when queries are absent", () => {
  const src = readSource("src/components/StackView.vue");
  assert.match(src, /t\("app\.startConversation"\)/, "Empty-state fallback must reuse the existing `app.startConversation` i18n key");
});

test("App.vue threads sessionRoleQueries into StackView", () => {
  const src = readSource("src/App.vue");
  assert.match(
    src,
    /<StackView[\s\S]*?:queries="sessionRoleQueries"[\s\S]*?\/>/,
    'App.vue\'s <StackView> mount must pass :queries="sessionRoleQueries" so the empty-state suggestions actually appear',
  );
});
