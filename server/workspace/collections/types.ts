// The canonical collection schema types now live in
// @mulmoclaude/collection-plugin (single source of truth, also consumed by
// the host frontend via src/components/collectionTypes.ts and by
// MulmoTerminal). Re-exported here so the many `./types.js` importers under
// server/workspace/collections keep compiling unchanged.
export * from "@mulmoclaude/collection-plugin";
