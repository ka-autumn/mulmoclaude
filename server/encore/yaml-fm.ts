// Encore-local YAML-frontmatter parser/serializer.
//
// The host's `server/utils/markdown/frontmatter.ts` uses
// `yaml.FAILSAFE_SCHEMA` on load, which keeps every scalar as a
// string. That's the right call for wiki/topic files where
// `'1.20'` / `'true'` need to round-trip verbatim, but it breaks
// Encore's DSL which expects real numbers (`version: 1`) and
// booleans (`required: true`) for Zod validation on re-parse.
//
// We use js-yaml's default schema (CORE_SCHEMA) on both load and
// dump so numbers + booleans + nulls round-trip natively. Output
// is byte-compatible with the host's serializer for the same
// `---\n...\n---\n\nbody` envelope shape.

import yaml from "js-yaml";

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;

export interface ParsedMarkdown {
  meta: Record<string, unknown>;
  body: string;
  hasHeader: boolean;
}

function safeLoad(text: string): Record<string, unknown> | null {
  try {
    const loaded = yaml.load(text);
    if (loaded === null || loaded === undefined) return null;
    if (typeof loaded !== "object" || Array.isArray(loaded)) return null;
    return loaded as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Parse a markdown document, splitting frontmatter from body. */
export function parseEncoreFrontmatter(raw: string): ParsedMarkdown {
  if (!FRONTMATTER_OPEN.test(raw)) {
    return { meta: {}, body: raw, hasHeader: false };
  }
  const afterOpen = raw.replace(FRONTMATTER_OPEN, "");
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpen);
  if (!closeMatch || closeMatch.index === undefined) {
    return { meta: {}, body: raw, hasHeader: false };
  }
  const yamlText = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  const meta = safeLoad(yamlText);
  if (meta === null) {
    return { meta: {}, body: raw, hasHeader: false };
  }
  return { meta, body, hasHeader: true };
}

/** Serialize a meta object + body back into the canonical
 *  `---\n...\n---\n\nbody` shape. Empty `meta` returns the body
 *  alone. */
export function serializeEncoreFrontmatter(meta: Record<string, unknown>, body: string): string {
  if (Object.keys(meta).length === 0) return body;
  const yamlText = yaml.dump(meta, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${yamlText}\n---\n\n${body}`;
}
