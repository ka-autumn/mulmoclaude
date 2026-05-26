import type { PluginEntry, PluginRegistration } from "../../tools/types";
import type { WikiGraph } from "../../lib/wiki-page/graph";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";

const TOOL_NAME = "manageWiki";

export interface WikiEndpoints {
  [key: string]: string;
  base: string;
  pageHistory: string;
  pageHistorySnapshot: string;
  pageHistoryRestore: string;
  internalSnapshot: string;
}

export interface WikiPageEntry {
  title: string;
  slug: string;
  description: string;
  tags: string[];
}

export interface WikiData {
  action: string;
  title: string;
  content: string;
  pageEntries?: WikiPageEntry[];
  pageName?: string;
  pageExists?: boolean;
  // ── `page-edit` action (Stage 3a, #963) ──────────────────────
  // Server emits these when an LLM Write/Edit hits a wiki page.
  // The View fetches the snapshot body via /api/wiki/pages/<slug>/
  // history/<stamp> and renders it inline, falling back to
  // pagePath if the snapshot has been gc'd.
  slug?: string;
  stamp?: string;
  pagePath?: string;
  // ── `graph` action (#wiki-backlinks-graph) ───────────────────
  // Page→page link graph for the Graph tab and the per-page
  // "Linked references" panel. Present only on the `graph` action
  // response.
  graph?: WikiGraph;
}

// View-only registry entry (Stage 3b, #963). The plugin no longer
// exposes an MCP tool to the LLM, but the canvas dispatch
// (`getPlugin("manageWiki")`) still finds it so:
// (a) the server-emitted `page-edit` action toolResult renders
//     via the same `View.vue` branches the live page action used,
// (b) historical chat sessions saved with `toolName: "manageWiki"`
//     continue to replay correctly.
const wikiPlugin: PluginEntry = {
  toolDefinition: {
    type: "function",
    name: TOOL_NAME,
    prompt: "[deprecated] Replaced by inline page-edit rendering (#963). Kept registered for historical chat-history rendering only.",
    description: "[deprecated] Replaced by inline page-edit rendering (#963). Kept registered for historical chat-history rendering only.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  viewComponent: wrapWithScope("wiki", View),
  previewComponent: wrapWithScope("wiki", Preview),
};

export default wikiPlugin;

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: wikiPlugin,
};
