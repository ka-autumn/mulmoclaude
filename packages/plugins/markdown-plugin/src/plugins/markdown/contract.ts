// Host-agnostic capability contract for the markdown plugin (task #6 /
// markdown full-fidelity). The plugin's Vue View is decoupled from any
// one host's REST surface: it calls `useRuntime().dispatch({ kind, … })`
// (gui-chat-protocol's `BrowserPluginRuntime.dispatch`), the host routes
// that to the shared core `executeMarkdown(context, args)` (see
// `./core`), and the core reaches host backends through
// `context.app: MarkdownHostApp`.
//
// Each host implements `MarkdownHostApp` over its OWN backends:
//   - MulmoClaude  → `server/plugins/markdown-builtin.ts` (Puppeteer PDF,
//                    Gemini image-fill, artifacts/documents store).
//   - MulmoTerminal → its `server/backends/*` (next session).
//
// This file is pure types + the dispatch envelope; it imports nothing
// host-specific so it lifts verbatim into `@mulmoclaude/markdown-plugin`
// at extraction (Phase 3).

/** A workspace Marp theme: the slug authors reference via frontmatter
 *  `theme: <name>` and the CSS to register on the Marp themeSet. */
export interface MarpThemeEntry {
  readonly name: string;
  readonly css: string;
}

/** Options for a PDF export. `marp` switches to the slide pipeline;
 *  `baseDir` resolves workspace-relative `<img src>` references. */
export interface ExportPdfOptions {
  markdown: string;
  filename: string;
  marp?: boolean;
  baseDir?: string;
  format?: "Letter" | "A4";
  stripFrontmatter?: boolean;
}

/**
 * The host-capability surface a host injects via gui-chat-protocol's
 * `ToolContext.app`. Every method is async + JSON-serialisable in/out
 * so it survives the `dispatch` HTTP hop (which is why `exportPdf`
 * returns base64, not a binary Buffer).
 */
export interface MarkdownHostApp {
  /** Read a workspace-relative document's content. */
  loadDoc: (path: string) => Promise<{ content: string }>;
  /** Overwrite a workspace-relative document; returns the stored path.
   *  Implementations should also publish a file-change event so other
   *  views/tabs refresh (see the `file:<path>` pubsub channel). */
  saveDoc: (path: string, markdown: string) => Promise<{ path: string }>;
  /** Persist a NEW document (the tool-call create path) under a
   *  collision-safe path derived from `prefix`; returns the stored path. */
  saveNewDoc: (prefix: string, markdown: string) => Promise<{ path: string }>;
  /** List the workspace's Marp themes. */
  marpThemes: () => Promise<{ themes: MarpThemeEntry[] }>;
  /** Render markdown (or a Marp deck) to a PDF, returned base64-encoded. */
  exportPdf: (options: ExportPdfOptions) => Promise<{ pdfBase64: string }>;
  /** Replace `__too_be_replaced_image_path__` placeholders with
   *  generated images (degrades to text markers when unavailable). */
  fillImages: (markdown: string) => Promise<{ markdown: string }>;
}

// ── Dispatch envelope (what the View sends through `dispatch`) ───────

export interface LoadDocArgs {
  kind: "loadDoc";
  path: string;
}
export interface SaveDocArgs {
  kind: "saveDoc";
  path: string;
  markdown: string;
}
export interface MarpThemesArgs {
  kind: "marpThemes";
}
export interface ExportPdfArgs extends ExportPdfOptions {
  kind: "exportPdf";
}
export interface FillImagesArgs {
  kind: "fillImages";
  markdown: string;
}

/** Discriminated union of every action the View can `dispatch`. */
export type MarkdownDispatchArgs = LoadDocArgs | SaveDocArgs | MarpThemesArgs | ExportPdfArgs | FillImagesArgs;

/** Maps a dispatch `kind` to its result shape so the View can call
 *  `dispatch<MarkdownDispatchResult["loadDoc"]>(…)` without a cast. */
export interface MarkdownDispatchResult {
  loadDoc: { content: string };
  saveDoc: { path: string };
  marpThemes: { themes: MarpThemeEntry[] };
  exportPdf: { pdfBase64: string };
  fillImages: { markdown: string };
}
