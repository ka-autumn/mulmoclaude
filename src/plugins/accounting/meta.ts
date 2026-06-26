// Central-registry-facing metadata that the accounting plugin owns.
// Imported by host aggregators (`src/config/*` and
// `server/workspace/paths.ts`) which iterate over every plugin's
// META and merge automatically, plus the codegen barrels
// (`src/plugins/_generated/*`). Host code holds zero plugin-specific
// literals — when a constant is "produced by the plugin", the plugin
// is the source of truth.
//
// Stays host-side (not in @mulmoclaude/accounting-plugin) because the
// plugin-barrel codegen discovers every built-in plugin by scanning
// `src/plugins/<name>/meta.ts`. The reusable per-book channel/event
// contract moved to `@mulmoclaude/accounting-plugin/shared` (the
// backend needs it); this file keeps only the host-wiring META.
//
// Browser-safe: no Vue imports, no server-only imports.

import { definePluginMeta } from "../meta-types";
import { ACCOUNTING_DIRS } from "@mulmoclaude/accounting-plugin/shared";

/** Single object the host aggregators iterate over. `definePluginMeta`
 *  type-checks the shape (typo / missing field surfaces at compile
 *  time) AND preserves nested literal types via TS 5.0+'s `const`
 *  type parameter. */
export const META = definePluginMeta({
  toolName: "manageAccounting",
  apiNamespace: "accounting",
  apiRoutes: {
    /** POST /api/accounting — single dispatch with action discriminator. */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
  // Flat keys merged into the central `WORKSPACE_DIRS`. Created
  // lazily on first `createBook` so default workspaces don't get a
  // stub `accounting/` they never use.
  // Sourced from the package's shared `ACCOUNTING_DIRS` (the single
  // source of truth the backend io layer also reads) so the on-disk
  // layout can't drift between this aggregator merge and the backend.
  workspaceDirs: {
    accounting: ACCOUNTING_DIRS.accounting,
    // `accounting/books/<bookId>/{accounts.json, journal/YYYY-MM.jsonl,
    //  snapshots/YYYY-MM.json}` — multi-book layout (#1078).
    accountingBooks: ACCOUNTING_DIRS.accountingBooks,
  },
  // Static pubsub channel names merged into the central
  // `PUBSUB_CHANNELS`. Per-book data changes ride
  // `bookChannel(bookId)` (helper in the package's shared surface);
  // book-list-level events (a new book was created, an existing one
  // was deleted) ride `accountingBooks` so a `JournalList.vue`
  // viewing book A doesn't repaint when the user creates book B from
  // another window.
  staticChannels: {
    accountingBooks: "accounting:books",
  },
});
