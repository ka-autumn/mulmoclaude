// Chart document types — the shared shape between the LLM tool args, the
// server-side write, and the Vue View. Single source of truth, also
// consumed by MulmoTerminal.

export interface ChartEntry {
  title?: string;
  type?: string;
  option: Record<string, unknown>;
}

export interface ChartDocument {
  title?: string;
  charts: ChartEntry[];
}

/** Tool-call args for presentChart. */
export interface ChartArgs {
  document: ChartDocument;
  title?: string;
}

/** `data` payload returned to the host: drives the View and the
 *  preview sidebar, and records where the document was persisted. */
export interface PresentChartData {
  document: ChartDocument;
  title?: string;
  filePath: string;
}
