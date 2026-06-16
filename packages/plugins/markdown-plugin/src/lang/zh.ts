import type { Messages } from "./messages";

const zh: Messages = {
  loading: "正在加载文档...",
  loadFailed: "⚠ 加载文档失败: {error}",
  refreshFailed: "⚠ 刷新文档失败: {error} — 正在显示上次成功加载的内容。",
  noContent: "没有可用的 Markdown 内容",
  pdf: "PDF",
  pdfFailedShort: "⚠ PDF 失败",
  editSource: "编辑 Markdown 源",
  saving: "保存中...",
  applyChanges: "应用更改",
  cancel: "取消",
  saveFailed: "保存失败: {error}",
  saveError: "⚠ 保存失败: {error}",
  copyLabel: "复制",
  copiedLabel: "已复制!",
  taskCountMismatch: "Markdown 源与渲染输出的任务数不一致，为避免文件损坏，已拒绝切换。",
  marpSlidesMode: "Marp 幻灯片 · {count}",
  marpExportPdf: "导出 PDF",
  marpRenderFailed: "⚠ Marp 幻灯片渲染失败: {error}",
  marpSplitEnter: "并排编辑源代码",
  marpSplitExit: "关闭源代码编辑器",
  marpSplitEditorLabel: "源代码",
};

export default zh;
