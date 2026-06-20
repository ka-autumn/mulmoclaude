// Preset-skill namespace — the ONE definition of "is this a launcher-managed preset
// skill". Browser-safe (no node imports) so the Vue UI can import it via the package's
// `./slug` entry while the server-only sync logic (`.` entry, uses node:fs) imports it
// here too. Shared by MulmoClaude and MulmoTerminal so the `mc-` convention can't drift.

/** Launcher preset namespace. Preset skills (and only those) are `mc-*`. */
export const PRESET_SLUG_PREFIX = "mc-";

/** True for a launcher-managed preset slug (`mc-<something>`). The sync logic uses
 *  this to bound which active skills it may refresh/prune, so user-authored skills are
 *  never touched. */
export function isPresetSlug(slug: string): boolean {
  return slug.startsWith(PRESET_SLUG_PREFIX) && slug.length > PRESET_SLUG_PREFIX.length;
}
