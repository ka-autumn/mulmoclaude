// Shared image-placeholder fill (task #6 Phase 4). The LLM is told to
// emit `![prompt](__too_be_replaced_image_path__)` for embedded images
// (see definition.ts); this owns the regex + the substitution format so
// every host stays in lockstep with that contract, while the actual
// image GENERATION + STORAGE is injected (each host wires its own
// Gemini + image store / data-URI strategy).

export const IMAGE_PLACEHOLDER = /!\[([^\]]+)\]\(\/?__too_be_replaced_image_path__\)/g;

/** Build the markdown that replaces one placeholder. `ref` is the
 *  host-resolved image reference (a workspace-rooted URL, a data URI, …)
 *  or null when generation was unavailable/failed — in which case the
 *  alt text is kept as an italic marker so the operator can see what
 *  *would* have been generated. */
export function buildImagePlaceholderReplacement(prompt: string, ref: string | null): string {
  if (ref) return `![${prompt}](${ref})`;
  return `*🖼️ Image: ${prompt}*`;
}

export interface ImagePlaceholderResult {
  full: string;
  prompt: string;
  ref: string | null;
}

export interface FillImagePlaceholdersDeps {
  /** Resolve a displayable image reference for `prompt` (the host
   *  generates + stores it, returning a URL or data URI), or null to
   *  fall back to a text marker. `index`/`total` are for progress logs. */
  resolveImage: (prompt: string, index: number, total: number) => Promise<string | null>;
}

/** Replace every `__too_be_replaced_image_path__` placeholder. Returns
 *  the filled markdown plus the per-placeholder results so the host can
 *  emit its own batch observability. Generation runs concurrently. */
export async function fillImagePlaceholders(
  markdown: string,
  deps: FillImagePlaceholdersDeps,
): Promise<{ markdown: string; results: ImagePlaceholderResult[] }> {
  const matches = [...markdown.matchAll(IMAGE_PLACEHOLDER)];
  if (matches.length === 0) return { markdown, results: [] };

  const total = matches.length;
  const results: ImagePlaceholderResult[] = await Promise.all(
    matches.map(async (match, index) => ({
      full: match[0],
      prompt: match[1],
      ref: await deps.resolveImage(match[1], index, total),
    })),
  );

  let filled = markdown;
  for (const { full, prompt, ref } of results) {
    filled = filled.replace(full, buildImagePlaceholderReplacement(prompt, ref));
  }
  return { markdown: filled, results };
}
