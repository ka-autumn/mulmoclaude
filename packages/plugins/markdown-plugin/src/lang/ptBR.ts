import type { Messages } from "./messages";

const ptBR: Messages = {
  loading: "Carregando documento...",
  loadFailed: "⚠ Falha ao carregar o documento: {error}",
  refreshFailed: "⚠ Falha ao atualizar o documento: {error} — exibindo o último conteúdo carregado com sucesso.",
  noContent: "Nenhum conteúdo Markdown disponível",
  pdf: "PDF",
  pdfFailedShort: "⚠ Falha no PDF",
  editSource: "Editar fonte Markdown",
  saving: "Salvando...",
  applyChanges: "Aplicar alterações",
  cancel: "Cancelar",
  saveFailed: "Falha ao salvar: {error}",
  saveError: "⚠ {error}",
  copyLabel: "Copiar",
  copiedLabel: "Copiado!",
  taskCountMismatch: "O número de tarefas diverge entre a fonte Markdown e a saída renderizada. A alternância foi recusada para evitar corromper o arquivo.",
  marpSlidesMode: "Slides Marp · {count}",
  marpExportPdf: "Exportar PDF",
  marpRenderFailed: "⚠ Falha ao renderizar os slides Marp: {error}",
  marpSplitEnter: "Editar o código fonte ao lado da visualização",
  marpSplitExit: "Fechar o editor de código",
  marpSplitEditorLabel: "Código",
};

export default ptBR;
