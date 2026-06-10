import type { ToolDefinition } from "gui-chat-protocol";
import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";

export const TOOL_NAME = META.toolName;
export type HtmlEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

const toolDefinition: ToolDefinition = {
  type: "function",
  name: META.toolName,
  description: "Present a complete, self-contained HTML page in the canvas — either new HTML (saved) or an existing saved page (by path).",
  prompt: `Use ${TOOL_NAME} when the user asks for HTML output, dashboards, custom layouts, or interactive content. Provide EITHER \`html\` OR \`path\`, not both. \`html\` is a full self-contained document (\`<!DOCTYPE html>\`, \`<html>\`, \`<body>\`) with all CSS / JavaScript inlined or loaded via CDN; it is saved to \`artifacts/html/<YYYY>/<MM>/...\`, so when referencing other workspace assets use a relative path with exactly three \`../\` (example: \`<img src="../../../images/2026/04/foo.png">\`). \`path\` is the workspace-relative path of an HTML file you already wrote under \`artifacts/html/...\` — pass it to present that existing page without re-saving a copy (use this for pre-authored pages). For the full path conventions and rationale, read \`config/helps/presenthtml.md\` in the workspace.`,
  parameters: {
    type: "object",
    properties: {
      html: {
        type: "string",
        description:
          "Complete, self-contained HTML document to save and present. Provide this OR `path`. See `config/helps/presenthtml.md` for the relative-path conventions when embedding workspace assets (images, charts, etc.).",
      },
      path: {
        type: "string",
        description:
          "Workspace-relative path to an existing HTML file under `artifacts/html/` to present without re-saving (e.g. `artifacts/html/lessons-x/lesson-001.html`). Provide this OR `html`.",
      },
      title: {
        type: "string",
        description: "Short label shown in the preview sidebar.",
      },
    },
    // Neither is individually required: the handler accepts `html` OR `path`.
    required: [],
  },
};

export default toolDefinition;
