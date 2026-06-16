// Shared, host-agnostic dispatch router for the markdown plugin
// (task #6). Both hosts route a `dispatch({ kind, … })` call from the
// Vue View here; this switch translates the envelope into a
// `MarkdownHostApp` backend call. It imports only `./contract`, so it
// runs server-side in either host and lifts verbatim into
// `@mulmoclaude/markdown-plugin` at extraction.
//
// gui-chat-protocol shape: `execute(context, args)`. Host backends
// arrive on `context.app`; a missing `app` is a host wiring bug, so we
// throw loudly rather than silently no-op.

import type { MarkdownDispatchArgs, MarkdownHostApp } from "./contract";

export interface MarkdownExecuteContext {
  app?: MarkdownHostApp;
}

export async function executeMarkdown(context: MarkdownExecuteContext, args: MarkdownDispatchArgs): Promise<unknown> {
  const { app } = context;
  if (!app) {
    throw new Error("markdown plugin: context.app (MarkdownHostApp) was not provided by the host");
  }
  switch (args.kind) {
    case "loadDoc":
      return app.loadDoc(args.path);
    case "saveDoc":
      return app.saveDoc(args.path, args.markdown);
    case "marpThemes":
      return app.marpThemes();
    case "exportPdf":
      return app.exportPdf({
        markdown: args.markdown,
        filename: args.filename,
        marp: args.marp,
        baseDir: args.baseDir,
        format: args.format,
        stripFrontmatter: args.stripFrontmatter,
      });
    case "fillImages":
      return app.fillImages(args.markdown);
    default: {
      // Exhaustiveness guard: a new kind added to the union without a
      // branch here trips this at compile time.
      const exhaustive: never = args;
      throw new Error(`markdown plugin: unknown dispatch kind ${JSON.stringify(exhaustive)}`);
    }
  }
}
