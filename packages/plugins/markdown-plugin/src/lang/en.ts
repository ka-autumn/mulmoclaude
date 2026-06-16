import type { Messages } from "./messages";

const en: Messages = {
  loading: "Loading document...",
  loadFailed: "⚠ Failed to load document: {error}",
  refreshFailed: "⚠ Failed to refresh document: {error} — showing last successfully loaded content.",
  noContent: "No markdown content available",
  pdf: "PDF",
  pdfFailedShort: "⚠ PDF failed",
  editSource: "Edit Markdown Source",
  saving: "Saving...",
  applyChanges: "Apply Changes",
  cancel: "Cancel",
  saveFailed: "Save failed: {error}",
  saveError: "⚠ Save failed: {error}",
  copyLabel: "Copy",
  copiedLabel: "Copied!",
  taskCountMismatch: "Markdown source and rendered output disagree on the number of tasks. Refusing to toggle to avoid corruption.",
  marpSlidesMode: "Marp slides · {count}",
  marpExportPdf: "Export PDF",
  marpRenderFailed: "⚠ Failed to render Marp slides: {error}",
  marpSplitEnter: "Edit source side-by-side with preview",
  marpSplitExit: "Hide source editor",
  marpSplitEditorLabel: "Source",
};

export default en;
