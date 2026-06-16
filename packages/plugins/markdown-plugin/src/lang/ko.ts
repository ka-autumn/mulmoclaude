import type { Messages } from "./messages";

const ko: Messages = {
  loading: "문서를 불러오는 중...",
  loadFailed: "⚠ 문서 불러오기 실패: {error}",
  refreshFailed: "⚠ 문서 새로고침 실패: {error} — 마지막으로 성공적으로 불러온 내용을 표시합니다.",
  noContent: "사용 가능한 Markdown 콘텐츠가 없습니다",
  pdf: "PDF",
  pdfFailedShort: "⚠ PDF 실패",
  editSource: "Markdown 원본 편집",
  saving: "저장 중...",
  applyChanges: "변경 사항 적용",
  cancel: "취소",
  saveFailed: "저장 실패: {error}",
  saveError: "⚠ 저장 실패: {error}",
  copyLabel: "복사",
  copiedLabel: "복사됨!",
  taskCountMismatch: "Markdown 원본과 렌더링 결과의 작업 수가 일치하지 않아, 파일 손상을 방지하기 위해 토글이 거부되었습니다.",
  marpSlidesMode: "Marp 슬라이드 · {count}",
  marpExportPdf: "PDF로 내보내기",
  marpRenderFailed: "⚠ Marp 슬라이드 렌더링 실패: {error}",
  marpSplitEnter: "소스를 나란히 편집",
  marpSplitExit: "소스 편집기 닫기",
  marpSplitEditorLabel: "소스",
};

export default ko;
