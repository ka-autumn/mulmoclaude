// Bundled external-skill suggestions surfaced by
// `GET /api/skills/external/suggestions` (#1383 / #1335 PR-C).
//
// These are hand-curated repos we recommend to new users. The list
// ships in the launcher binary — there's no workspace-side state to
// migrate when entries change across releases. Users discover them
// through the "+ Add skill repository" modal (UI lands in PR-C2).
//
// Adding an entry here is a deliberate editorial act: each new repo
// expands what new users see by default. Stay conservative — verify
// the repo's license is permissive, the skill quality is high, and
// the repo is actively maintained.

export interface ExternalPresetSuggestion {
  url: string;
  /** Optional subpath if the repo bundles multiple skills under a
   *  common dir (Anthropic's `skills/<name>/` layout). Omitted for
   *  single-skill repos that ship `SKILL.md` at the root. */
  subpath?: string;
  /** User-facing repo name. Free-form; UI may show it as the
   *  collapsible section heading. */
  displayName: string;
  description: string;
  /** SPDX-ish license identifier from the repo's LICENSE file.
   *  Display-only; not enforced. */
  license?: string;
}

export const EXTERNAL_PRESETS: readonly ExternalPresetSuggestion[] = [
  {
    url: "https://github.com/anthropics/skills",
    subpath: "skills",
    displayName: "Anthropic skills",
    description: "Anthropic's official skill collection — PDF / Excel / DOCX builders, MCP server scaffolder, and more.",
    license: "MIT",
  },
  {
    // Engineering-workflow skills that also pay off inside
    // MulmoClaude's task agent: brainstorming, writing/executing
    // plans, systematic-debugging, code review. Layout is one-level
    // (`skills/<name>/SKILL.md`), so the existing one-level
    // discovery handles it without a scanner change. Verified
    // 2026-05: MIT, actively maintained, high-quality skills.
    url: "https://github.com/obra/superpowers",
    subpath: "skills",
    displayName: "Superpowers",
    description: "Battle-tested workflow skills — brainstorming, planning, systematic debugging, TDD, and code review.",
    license: "MIT",
  },
] as const;
