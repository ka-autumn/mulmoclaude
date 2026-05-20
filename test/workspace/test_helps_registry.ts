import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guards the curated `## Help Pages` list in
// `server/workspace/helps/index.md`. The list is the canonical
// human-readable index of every help file shipped with the app —
// roles point users (and Claude) at specific helps via canonical
// `config/helps/<name>.md` paths in their role prompts, and the
// index.md table is the directory that lets the LLM see what
// other reference material exists if it Reads index.md.
//
// Required shape, per line:
//   `- [Title](config/helps/<name>.md) — <one-sentence summary>`
//
// The `config/helps/` prefix is the workspace-relative canonical
// path (matching `WORKSPACE_PATHS.helps` in
// `server/workspace/paths.ts`), and is the same form role prompts
// use when telling the LLM to Read a help file — so an LLM that
// browses index.md sees identical paths to those it sees in the
// system prompt.
//
// Test fails when:
//   (a) a new help file is added without adding an index entry
//       (LLM browsing index.md wouldn't discover it);
//   (b) an index entry points at a missing file (stale link);
//   (c) a summary line exceeds the length cap (one sentence, please).
//
// The parsing here is intentionally self-contained — production code
// no longer reads index.md programmatically (the helps-injection
// apparatus was removed in favour of role prompts referencing the
// canonical path directly). This test exists purely as a
// documentation-completeness guard.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HELPS_DIR = path.resolve(__dirname, "../../server/workspace/helps");
const INDEX_FILENAME = "index.md";
const HELP_PAGES_HEADING_RE = /^##\s+Help Pages\s*$/;
const HELP_LIST_LINK_PREFIX = "config/helps/";
const HELP_LIST_LINK_SUFFIX = ".md";
const SUMMARY_MAX_CHARS = 200;

interface RegistryEntry {
  title: string;
  summary: string;
}

function parseListItem(line: string): { filename: string; entry: RegistryEntry } | null {
  const trimmed = line.trimStart();
  if (!(trimmed.startsWith("- ") || trimmed.startsWith("* "))) return null;
  const afterBullet = trimmed.slice(2).trimStart();
  if (!afterBullet.startsWith("[")) return null;
  const titleEnd = afterBullet.indexOf("]");
  if (titleEnd <= 1) return null;
  const title = afterBullet.slice(1, titleEnd).trim();
  const afterTitle = afterBullet.slice(titleEnd + 1);
  if (!afterTitle.startsWith("(")) return null;
  const linkEnd = afterTitle.indexOf(")");
  if (linkEnd <= 1) return null;
  const href = afterTitle.slice(1, linkEnd);
  if (!href.startsWith(HELP_LIST_LINK_PREFIX) || !href.endsWith(HELP_LIST_LINK_SUFFIX)) return null;
  const filename = href.slice(HELP_LIST_LINK_PREFIX.length);
  const tail = afterTitle.slice(linkEnd + 1);
  const sepIdx = tail.indexOf("—");
  if (sepIdx === -1) return null;
  const summary = tail.slice(sepIdx + 1).trim();
  if (!summary) return null;
  return { filename, entry: { title, summary } };
}

function parseRegistry(content: string): Map<string, RegistryEntry> {
  const entries = new Map<string, RegistryEntry>();
  const lines = content.split("\n");
  let inSection = false;
  for (const line of lines) {
    if (HELP_PAGES_HEADING_RE.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^#{1,2}\s+\S/.test(line)) break;
    const parsed = parseListItem(line);
    if (!parsed) continue;
    entries.set(parsed.filename, parsed.entry);
  }
  return entries;
}

function listHelpFiles(): string[] {
  return readdirSync(HELPS_DIR)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => name !== INDEX_FILENAME)
    .sort();
}

describe("server/workspace/helps registry (index.md)", () => {
  const indexPath = path.join(HELPS_DIR, INDEX_FILENAME);
  const indexContent = readFileSync(indexPath, "utf-8");
  const registry = parseRegistry(indexContent);
  const helpFiles = listHelpFiles();

  it("has a parseable `## Help Pages` section with at least one entry", () => {
    assert.ok(
      registry.size > 0,
      `${INDEX_FILENAME} should contain at least one entry under "## Help Pages" shaped: "- [Title](config/helps/<name>.md) — <summary>"`,
    );
  });

  it("has an entry for every *.md under helps/ (except index.md itself)", () => {
    const missing = helpFiles.filter((name) => !registry.has(name));
    const detail =
      missing.length === 0
        ? ""
        : `Missing index.md entries for: ${missing.join(", ")}. Add a line under '## Help Pages' shaped: '- [Title](config/helps/<name>.md) — <summary>'.`;
    assert.deepEqual(missing, [], detail);
  });

  it("does not list entries for files that don't exist on disk", () => {
    const orphaned = [...registry.keys()].filter((name) => !helpFiles.includes(name));
    assert.deepEqual(orphaned, [], `index.md lists entries for missing files: ${orphaned.join(", ")}`);
  });

  it("keeps every summary within the length cap", () => {
    const offenders: string[] = [];
    for (const [filename, entry] of registry) {
      if (entry.summary.length > SUMMARY_MAX_CHARS) {
        offenders.push(`${filename}: ${entry.summary.length} chars`);
      }
    }
    assert.deepEqual(offenders, [], `Summaries longer than ${SUMMARY_MAX_CHARS} chars: ${offenders.join("; ")}`);
  });
});
