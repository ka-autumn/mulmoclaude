import type { ToolDefinition } from "gui-chat-protocol";
import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";

export const TOOL_NAME = META.toolName;
/** Resolved-URL view of the markdown plugin's routes — `{ method,
 *  url }` per route key, with the `/api/markdown` prefix already
 *  composed by the host. */
export type DocumentEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

export interface MarkdownToolData {
  markdown: string;
  pdfPath?: string;
  filenamePrefix?: string;
}

/** True when the `markdown` field is a workspace-relative file path
 *  rather than inline content. Accepts only the canonical
 *  `artifacts/documents/*.md` prefix now that server-side
 *  `isMarkdownPath` agrees. Legacy `markdowns/*.md` references in
 *  old session JSONL are no longer auto-resolved — those sessions
 *  render their markdown content as plain text. */
export function isFilePath(value: string): boolean {
  if (!value.endsWith(".md")) return false;
  return value.startsWith("artifacts/documents/");
}

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Display a document in markdown format.",
  prompt:
    `Use the ${TOOL_NAME} tool when the user asks for a document that combines text with embedded images — guides, reports, tutorials, articles, or any structured content with visuals. ` +
    `Prefer this over standalone image generation when the user wants informational content with supporting visuals.\n\n` +
    "Format embedded images as: ![Detailed image prompt](__too_be_replaced_image_path__)\n\n" +
    "── Slide-deck (Marp) mode ──\n" +
    "When the user asks for a slide deck / presentation / スライド, opt into Marp by writing this YAML frontmatter at the very top of the markdown:\n" +
    "---\n" +
    "marp: true\n" +
    "theme: default\n" +
    "size: 16:9\n" +
    "---\n" +
    "Then separate slides with `---` on its own line. The right-pane preview and the Export-PDF button both honour Marp output.\n\n" +
    "Marp image directives (alt-text position) — use these instead of plain ![]() when slide layout matters, because a plain inline image is clipped to ~60% of slide height to leave room for surrounding text:\n" +
    "- ![bg](path)            — full-slide background (does not push other content)\n" +
    "- ![bg fit](path)        — background scaled to fit, no crop\n" +
    "- ![fit](path)           — fit-to-content inline\n" +
    "- ![w:600 h:400](path)   — explicit pixel size\n" +
    "The placeholder URL `__too_be_replaced_image_path__` still applies — the directive goes in the alt-text slot, the placeholder in the URL slot.\n\n" +
    "Aspect: `size: 16:9` (default 1280×720) or `size: 4:3` (960×720) — handled natively by Marp. For other shapes MulmoClaude bridges the directive so vertical / square / custom decks work too:\n" +
    "- `size: 9:16` → 1080×1920 portrait\n" +
    "- `size: 16:10` → 1280×800\n" +
    "- `size: 1:1` → 1080×1080 square\n" +
    "- `size: WxH` → any custom pixel canvas (e.g. `size: 1920x1080`)\n" +
    "Themes: `theme: default` | `gaia` | `uncover`. Custom sizes compose on top of whichever theme is chosen.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Title for the document",
      },
      markdown: {
        type: "string",
        description:
          "The markdown content to display. Describe embedded images in the following format: ![Detailed image prompt](__too_be_replaced_image_path__). IMPORTANT: For embedded images, you MUST use the EXACT placeholder path '__too_be_replaced_image_path__'.",
      },
      filenamePrefix: {
        type: "string",
        description:
          "Short English filename prefix (without extension). Use lowercase with hyphens, e.g. 'project-summary'. The server sanitizes the value and appends a random id to prevent collisions.",
      },
    },
    required: ["title", "markdown", "filenamePrefix"],
  },
};

export default toolDefinition;
