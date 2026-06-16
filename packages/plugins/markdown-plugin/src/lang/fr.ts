import type { Messages } from "./messages";

const fr: Messages = {
  loading: "Chargement du document...",
  loadFailed: "⚠ Échec du chargement du document : {error}",
  refreshFailed: "⚠ Échec de l'actualisation du document : {error} — affichage du dernier contenu chargé avec succès.",
  noContent: "Aucun contenu Markdown disponible",
  pdf: "PDF",
  pdfFailedShort: "⚠ Échec PDF",
  editSource: "Modifier la source Markdown",
  saving: "Enregistrement...",
  applyChanges: "Appliquer les modifications",
  cancel: "Annuler",
  saveFailed: "Échec de l'enregistrement : {error}",
  saveError: "⚠ {error}",
  copyLabel: "Copier",
  copiedLabel: "Copié !",
  taskCountMismatch: "Le nombre de tâches diffère entre la source Markdown et le rendu. La modification a été refusée pour éviter de corrompre le fichier.",
  marpSlidesMode: "Diapositives Marp · {count}",
  marpExportPdf: "Exporter en PDF",
  marpRenderFailed: "⚠ Échec du rendu des diapositives Marp : {error}",
  marpSplitEnter: "Modifier la source en parallèle de l'aperçu",
  marpSplitExit: "Fermer l'éditeur de source",
  marpSplitEditorLabel: "Source",
};

export default fr;
