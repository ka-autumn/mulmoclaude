// Bridge Marp's `size:` directive with canvas dimensions outside the
// default theme's preset list. Marp 4.x's built-in `default` / `gaia`
// / `uncover` themes only honour `size: 16:9` and `size: 4:3` — any
// other value (numeric `1080x1920`, an aspect like `9:16` or
// `16:10`, etc.) is silently dropped, leaving the slide canvas at
// 1280×720 even though the user clearly wanted something else.
//
// We work around it by parsing the frontmatter ourselves, dynamically
// registering a one-off composite theme (`@import "<userTheme>"; section
// { width: Wpx; height: Hpx; }`) on the Marp instance, then rewriting
// the frontmatter to point at the generated theme and drop the
// unrecognised `size:` directive. The user keeps writing the natural
// `size: 9:16` / `size: 1080x1920` shape; everything downstream
// (preview iframe sizing, PDF page dimensions) reads the new viewBox
// and Just Works.

import yaml from "js-yaml";
import { parseFrontmatter } from "./frontmatter";

interface MarpThemeSet {
  add: (css: string) => void;
}

interface MarpLike {
  themeSet: MarpThemeSet;
}

// Sensible canvas defaults for the aspect-ratio shorthand. Picked at
// 1080-line resolution so portrait/wide decks stay print-quality.
const ASPECT_PRESETS: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "16:10": [1280, 800],
  "1:1": [1080, 1080],
};

// Require ≥3 digits to reject implausibly small canvases (e.g.
// `0x0`, `10x10`) that would render unreadable slides.
const NUMERIC_SIZE_RE = /^(\d{3,5})[xX](\d{3,5})$/;

interface CustomDimensions {
  width: number;
  height: number;
}

function parseCustomSize(value: string): CustomDimensions | null {
  const preset = ASPECT_PRESETS[value];
  if (preset) return { width: preset[0], height: preset[1] };
  const match = NUMERIC_SIZE_RE.exec(value);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function serializeMarkdown(meta: Record<string, unknown>, body: string): string {
  const yamlText = yaml.dump(meta, { lineWidth: -1, sortKeys: false }).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

/**
 * Intercept Marp's `size:` directive for values the built-in themes
 * don't understand. When a custom size is detected, registers a
 * composite theme on the Marp instance and returns markdown rewritten
 * to use it. Pass-through for standard `16:9` / `4:3` (Marp handles
 * them natively) and for documents that don't declare a size.
 */
export function applyCustomMarpSize(marp: MarpLike, markdown: string): string {
  const { meta, body, hasHeader } = parseFrontmatter(markdown);
  if (!hasHeader) return markdown;
  const sizeValue = typeof meta.size === "string" ? meta.size.trim() : "";
  if (sizeValue === "" || sizeValue === "16:9" || sizeValue === "4:3") return markdown;
  const dims = parseCustomSize(sizeValue);
  if (!dims) return markdown;

  const userTheme = typeof meta.theme === "string" ? meta.theme.trim() : "default";
  // Avoid recursion if a previous render already swapped in a
  // generated theme name — re-applying would compose-on-compose.
  if (userTheme.startsWith("mc_size_")) return markdown;

  const themeName = `mc_size_${userTheme}_${dims.width}x${dims.height}`;
  marp.themeSet.add(`/* @theme ${themeName} */\n@import "${userTheme}";\nsection { width: ${dims.width}px; height: ${dims.height}px; }`);

  const newMeta: Record<string, unknown> = { ...meta, theme: themeName };
  delete newMeta.size;
  return serializeMarkdown(newMeta, body);
}
