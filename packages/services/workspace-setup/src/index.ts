// @mulmoclaude/workspace-setup — server-only workspace bootstrap shared by MulmoClaude
// and MulmoTerminal: seed/refresh the bundled help docs + preset skills into a
// workspace so a fresh workspace (created by EITHER app) is set up identically.
//
// The `.` entry is SERVER-ONLY (uses node:fs + bundled assets). The browser-safe
// `isPresetSlug` lives at the `./slug` entry so the Vue UI can import it without
// pulling in node:fs (it's also re-exported here for server callers).
export * from "./sync.js";
export * from "./assets.js";
export * from "./slug.js";
