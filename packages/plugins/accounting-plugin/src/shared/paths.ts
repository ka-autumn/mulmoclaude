// Workspace-relative directories this plugin owns. Single source of
// truth, consumed by BOTH the server io layer (./server/io.ts) and the
// host META (src/plugins/accounting/meta.ts → the WORKSPACE_DIRS
// aggregator), so the on-disk layout can't drift between the backend
// and the rest of the app.
//
// Browser-safe: no node:* imports.

export const ACCOUNTING_DIRS = {
  /** `data/accounting/config.json` + the books tree below. */
  accounting: "data/accounting",
  /** `data/accounting/books/<bookId>/{accounts.json, journal/, snapshots/}`. */
  accountingBooks: "data/accounting/books",
} as const;
