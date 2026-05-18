// Helpers for the obligation `index.md` file (DSL frontmatter +
// free-form body). Symmetric with cycle.ts's parse/serialize.

import { parseEncoreFrontmatter, serializeEncoreFrontmatter } from "./yaml-fm.js";
import { EncoreDslInput, type EncoreDsl } from "../../src/types/encore-dsl/schema.js";

/** Parse an obligation's index.md raw markdown into (dsl, body).
 *  Re-runs the Zod validator so a hand-edited / corrupted file
 *  surfaces as a parse error rather than passing garbage downstream. */
export function parseIndexFile(raw: string): { dsl: EncoreDsl; body: string } {
  const parsed = parseEncoreFrontmatter(raw);
  if (!parsed.hasHeader) {
    throw new Error("obligation index.md: missing YAML frontmatter");
  }
  const dsl = EncoreDslInput.parse(parsed.meta);
  return { dsl, body: parsed.body };
}

/** Serialize a DSL + body back to markdown. The DSL's
 *  `EncoreDslInput.parse` output preserves all declared fields
 *  including the server-generated `id` and `createdAt`, so this is
 *  a straight YAML dump. */
export function serializeIndexFile(dsl: EncoreDsl, body: string): string {
  return serializeEncoreFrontmatter(dsl as unknown as Record<string, unknown>, body);
}
