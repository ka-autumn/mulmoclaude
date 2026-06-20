// Host shim — the preset-skill sync logic + the bundled assets (helps + preset
// skills) now live in @mulmoclaude/workspace-setup (shared with MulmoTerminal so the
// two apps seed a fresh workspace identically). Re-exported here so existing SERVER
// importers (the catalog, collections/configure) keep their import paths.
//
// NOTE for Vue/browser code: import `isPresetSlug` from "@mulmoclaude/workspace-setup/slug"
// (browser-safe) — NOT from here. This `.` re-export pulls in node:fs via the sync code.
export {
  syncPresetSkills,
  syncActivePresetSkills,
  isPresetSlug,
  type SyncPresetSkillsOptions,
  type SyncPresetSkillsResult,
  type SyncActivePresetSkillsOptions,
  type SyncActivePresetSkillsResult,
} from "@mulmoclaude/workspace-setup";
