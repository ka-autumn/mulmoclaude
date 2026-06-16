import type { Messages } from "./messages";

const de: Messages = {
  loading: "Dokument wird geladen...",
  loadFailed: "⚠ Laden des Dokuments fehlgeschlagen: {error}",
  refreshFailed: "⚠ Aktualisieren des Dokuments fehlgeschlagen: {error} — es wird der zuletzt erfolgreich geladene Inhalt angezeigt.",
  noContent: "Kein Markdown-Inhalt verfügbar",
  pdf: "PDF",
  pdfFailedShort: "⚠ PDF fehlgeschlagen",
  editSource: "Markdown-Quelle bearbeiten",
  saving: "Wird gespeichert...",
  applyChanges: "Änderungen übernehmen",
  cancel: "Abbrechen",
  saveFailed: "Speichern fehlgeschlagen: {error}",
  saveError: "⚠ {error}",
  copyLabel: "Kopieren",
  copiedLabel: "Kopiert!",
  taskCountMismatch:
    "Die Anzahl der Aufgaben in der Markdown-Quelle und im gerenderten Ergebnis stimmt nicht überein. Das Umschalten wurde abgelehnt, um eine Beschädigung der Datei zu vermeiden.",
  marpSlidesMode: "Marp-Folien · {count}",
  marpExportPdf: "Als PDF exportieren",
  marpRenderFailed: "⚠ Rendern der Marp-Folien fehlgeschlagen: {error}",
  marpSplitEnter: "Quelle neben der Vorschau bearbeiten",
  marpSplitExit: "Quelleneditor schließen",
  marpSplitEditorLabel: "Quelle",
};

export default de;
