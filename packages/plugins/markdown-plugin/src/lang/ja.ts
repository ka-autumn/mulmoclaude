import type { Messages } from "./messages";

const ja: Messages = {
  loading: "ドキュメント読み込み中...",
  loadFailed: "⚠ ドキュメントの読み込みに失敗: {error}",
  refreshFailed: "⚠ ドキュメントの更新に失敗: {error} — 前回読み込んだ内容を表示しています。",
  noContent: "Markdown コンテンツがありません",
  pdf: "PDF",
  pdfFailedShort: "⚠ PDF 失敗",
  editSource: "Markdown ソースを編集",
  saving: "保存中...",
  applyChanges: "変更を適用",
  cancel: "キャンセル",
  saveFailed: "保存失敗: {error}",
  saveError: "⚠ 保存失敗: {error}",
  copyLabel: "コピー",
  copiedLabel: "コピーしました！",
  taskCountMismatch: "Markdown ソースと描画結果でタスク数が一致しないため、ファイル破損を避けるためトグル操作を中止しました。",
  marpSlidesMode: "Marp スライド · {count}",
  marpExportPdf: "PDFを書き出し",
  marpRenderFailed: "⚠ Marp スライドの描画に失敗しました: {error}",
  marpSplitEnter: "ソースを並べて編集",
  marpSplitExit: "ソースエディタを閉じる",
  marpSplitEditorLabel: "ソース",
};

export default ja;
