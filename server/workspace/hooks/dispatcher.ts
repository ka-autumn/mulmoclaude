// PostToolUse dispatcher — runs after every Claude CLI Write / Edit
// / Bash tool call and fans out to the registered handlers. Each
// handler decides for itself whether the call is relevant (by
// tool_name + file_path / command), so adding a new behaviour means
// dropping a new file under `handlers/` and registering it here —
// settings.json never changes.
//
// THIS FILE IS THE SOURCE OF TRUTH. Edits here, then run
// `yarn build:hooks` (or `yarn build`) to regenerate the bundle at
// `server/build/dispatcher.mjs` (generated output is kept out of the
// source tree). The bundled `.mjs` is committed to git so
// `provision.ts` can read it at server startup without invoking
// esbuild on the runtime path. CI's "Verify built hook bundle"
// step runs `git diff --exit-code` on the committed bundle to catch
// a stale commit.
//
// The hook executes inside Claude CLI's process space — must be a
// self-contained ESM bundle. esbuild rolls every import (handlers,
// shared, and the wiki-slug helper from `src/lib/`) into one file.

import { handleConfigRefresh } from "./handlers/configRefresh.js";
import { handleSkillBridge } from "./handlers/skillBridge.js";
import { handleWikiSnapshot } from "./handlers/wikiSnapshot.js";
import { readHookPayload, type HookPayload } from "./shared/stdin.js";

type Handler = (payload: HookPayload) => Promise<void>;

// Order is informational only — handlers don't interact. Add new
// entries here. Each one is wrapped so an individual failure
// doesn't block its siblings (the user's tool turn would visibly
// stall otherwise).
const HANDLERS: Handler[] = [handleWikiSnapshot, handleConfigRefresh, handleSkillBridge];

async function runHandler(handler: Handler, payload: HookPayload): Promise<void> {
  try {
    await handler(payload);
  } catch {
    // Hooks run synchronously to the LLM tool flow — never throw.
    // A busted handler would make the tool itself look like it
    // failed to the LLM, which is much worse than a missed
    // side-effect.
  }
}

async function main(): Promise<void> {
  const payload = await readHookPayload();
  if (!payload) return;
  // Run handlers in parallel — they touch disjoint resources
  // (wiki snapshot endpoint vs config-refresh endpoint vs local
  // file copy) and serialising them would push the per-turn
  // latency past the 2 s safePost timeout under bad conditions.
  await Promise.all(HANDLERS.map((handler) => runHandler(handler, payload)));
}

main().catch(() => {
  // Outermost safety net — see runHandler comment.
});
