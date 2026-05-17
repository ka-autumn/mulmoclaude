// Static system-prompt blocks, loaded from `server/prompts/system/*.md`
// at module init. These are app-owned constants (model-read English,
// never user-visible, never edited at runtime), so a synchronous read
// at import time is correct — no async plumbing, no per-request I/O.
//
// Content is returned verbatim (NO trimEnd): the source `.md` files
// are byte-identical to the template literals these replaced, including
// whether or not they end in a trailing newline. `buildSystemPrompt`
// must produce a byte-identical system prompt before/after this
// refactor — see plans/refactor-prompts-to-files.md.
//
// Path is resolved relative to this module (import.meta.url), NOT
// process.cwd(), so it resolves under both the dev server and the
// npx-installed launcher (which ships the whole `server/` tree).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEM_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "system");

function load(name: string): string {
  return readFileSync(path.join(SYSTEM_DIR, name), "utf-8");
}

export const SYSTEM_PROMPT = load("system.md");
export const TOPIC_MEMORY_MANAGEMENT = load("memory-management-topic.md");
export const ATOMIC_MEMORY_MANAGEMENT = load("memory-management-atomic.md");
export const NEWS_CONCIERGE_PROMPT = load("news-concierge.md");
export const SANDBOX_TOOLS_HINT = load("sandbox-tools.md");
