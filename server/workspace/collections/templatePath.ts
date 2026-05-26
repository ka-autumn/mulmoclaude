// Shared template-path safety, used by BOTH the collection schema
// validator (`discovery.ts` `ActionSpecSchema`) and the skill-bridge
// hook (`hooks/handlers/skillBridge.ts`). Centralised so the set of
// action `template` paths a schema may declare is *exactly* the set
// the bridge mirrors into `.claude/skills/<slug>/` — if the two
// diverge, a schema can validate yet reference a template the bridge
// silently drops (runtime "template could not be read").
//
// Keep this module dependency-free: the bridge is bundled into a lean
// esbuild dispatcher, so it must not drag in workspace/path machinery.

/** `templates/` — the subdir an action template must live under. */
const TEMPLATES_PREFIX = "templates/";

/**
 * A safe skill-relative path: non-empty, no backslash, not absolute,
 * and every `/`-separated segment is a plain `[A-Za-z0-9._-]+` token
 * that isn't `.` / `..` (no traversal). Multi-segment (nested) paths
 * are allowed. The reader's realpath containment is the hard
 * guarantee; this fails a bad path fast.
 */
export function isSafeTemplatePath(value: string): boolean {
  if (value.length === 0 || value.includes("\\") || value.startsWith("/")) return false;
  return value.split("/").every((seg) => seg.length > 0 && seg !== "." && seg !== ".." && /^[A-Za-z0-9._-]+$/.test(seg));
}

/**
 * An action `template` value: a safe path that lives under the skill's
 * `templates/` subdir. This is the canonical contract — the schema
 * validator rejects anything else up front, and the bridge mirrors
 * exactly these. Nested paths (`templates/mail/welcome.md`) and any
 * extension are allowed as long as the path is otherwise safe.
 */
export function isSafeActionTemplatePath(value: string): boolean {
  return value.startsWith(TEMPLATES_PREFIX) && isSafeTemplatePath(value);
}
