// Message table for the markdown plugin. Values use vue-i18n-style
// `{name}` placeholders, interpolated by `useT` (see ./index). Keys
// mirror the `pluginMarkdown.*` group extracted from MulmoClaude's
// src/lang/* so the templates' `t("pluginMarkdown.X")` calls keep
// working unchanged.
export interface Messages {
  loading: string;
  loadFailed: string;
  refreshFailed: string;
  noContent: string;
  pdf: string;
  pdfFailedShort: string;
  editSource: string;
  saving: string;
  applyChanges: string;
  cancel: string;
  saveFailed: string;
  saveError: string;
  copyLabel: string;
  copiedLabel: string;
  taskCountMismatch: string;
  marpSlidesMode: string;
  marpExportPdf: string;
  marpRenderFailed: string;
  marpSplitEnter: string;
  marpSplitExit: string;
  marpSplitEditorLabel: string;
}
