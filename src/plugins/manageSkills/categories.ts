// Pure helpers behind the /skills page sidebar. Lifted out of View.vue
// so the section-collapse state and the provenance rule (mc- prefix
// split, user/project source mapping) live in exactly one place and can
// be unit-tested in node:test without a DOM or a Vue runtime.

import type { SkillSummary } from "./index";

// categorizeSkill / pickInitialSelection only care about name + source,
// not description. Exposing a narrower input type lets unit tests build
// fixtures without padding placeholder descriptions everywhere.
export type SkillIdentity = Pick<SkillSummary, "name" | "source">;

// `mc-` is the launcher-managed namespace (see
// server/workspace/skills-preset.ts). Skills under this prefix ship
// with mulmoclaude and are overwritten on every boot, so the UI treats
// them as the read-only "system" provenance and gates editing
// accordingly. This is NOT the sidebar grouping axis — provenance only
// drives the per-row badge tooltip and the edit/delete gate. The
// sidebar groups by section (active vs catalog), see SKILL_SECTION_KEYS.
export const SYSTEM_SKILL_PREFIX = "mc-";
export type SkillProvenance = "system" | "project" | "user";

/** Map a skill to its provenance bucket (badge + edit-gate, not layout). */
export function categorizeSkill(skill: SkillIdentity): SkillProvenance {
  if (skill.source === "user") return "user";
  if (skill.name.startsWith(SYSTEM_SKILL_PREFIX)) return "system";
  return "project";
}

// Sidebar collapsible sections, aligned with the #1335 catalog/active
// model: "active" = skills in `.claude/skills/` (discovered by Claude
// Code, loaded into the system prompt); "catalog" = launcher-managed
// presets the user can browse / ★ star / ▶ run once without bloating
// the prompt. Provenance (system/project/user) is shown as a per-row
// badge inside the Active section, not as its own collapsible group.
export const SKILL_SECTION_KEYS = ["active", "catalog"] as const;
export type SkillSectionKey = (typeof SKILL_SECTION_KEYS)[number];

export const SECTION_LABEL_KEYS: Record<SkillSectionKey, string> = {
  active: "pluginManageSkills.sectionActive",
  catalog: "pluginManageSkills.sectionCatalog",
};

// Both sections open by default — #1335 shows Active and Catalog
// expanded; the user collapses whichever they don't want to see.
export const DEFAULT_CLOSED_SECTIONS: readonly SkillSectionKey[] = [];
export const COLLAPSED_SECTIONS_STORAGE_KEY = "skills:sectionCollapsed";

/**
 * @internal exported only so the unit tests can target the type guard
 * directly. Call sites should reach it via loadCollapsedSections.
 */
export function isSkillSectionKey(value: unknown): value is SkillSectionKey {
  return typeof value === "string" && (SKILL_SECTION_KEYS as readonly string[]).includes(value);
}

/** Read the persisted collapse state, falling back to defaults on any error. */
export function loadCollapsedSections(): Set<SkillSectionKey> {
  const defaults = new Set<SkillSectionKey>(DEFAULT_CLOSED_SECTIONS);
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    return new Set<SkillSectionKey>(parsed.filter(isSkillSectionKey));
  } catch {
    return defaults;
  }
}

/** Persist the collapse state. Failures (e.g. localStorage disabled) are swallowed. */
export function persistCollapsedSections(state: ReadonlySet<SkillSectionKey>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify([...state]));
  } catch {
    // localStorage may be unavailable (private mode) — swallow silently.
  }
}

// Per-external-repo collapse state (#1383 PR-C2). Distinct storage key
// from the section-level state above: the section axis is a fixed
// 2-value union (active/catalog), whereas repo ids are open-ended
// (one per installed external repo), so this set is validated as
// plain strings rather than against a key union. Default: every repo
// EXPANDED (absent = open) — a freshly installed repo should show its
// skills without a click.
export const REPO_COLLAPSED_STORAGE_KEY = "skills:repoCollapsed";

/** Read the persisted per-repo collapse set, defaulting to empty
 *  (all repos expanded) on any error. */
export function loadRepoCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(REPO_COLLAPSED_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

/** Persist the per-repo collapse set. Failures are swallowed. */
export function persistRepoCollapsed(state: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REPO_COLLAPSED_STORAGE_KEY, JSON.stringify([...state]));
  } catch {
    // localStorage may be unavailable (private mode) — swallow silently.
  }
}

/**
 * Auto-select the first active skill so the right pane isn't empty on
 * open. Returns null when the Active section is collapsed (don't select
 * a row the user can't see) or when there are no active skills.
 */
export function pickInitialSelection(skillList: readonly SkillIdentity[], collapsed: ReadonlySet<SkillSectionKey>): string | null {
  if (skillList.length === 0) return null;
  if (collapsed.has("active")) return null;
  return skillList[0].name;
}
