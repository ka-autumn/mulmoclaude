// Pluggable retriever registry. Each `ingest.kind` maps to one
// RetrieveFn that fetches the endpoint and returns projected records.
// Side-effect registration keeps the engine decoupled from the kinds.
// New kinds (`code`, `prompt`) register here without touching the engine.

import type { CollectionItem, CollectionSchema } from "../../collections/index.js";
import type { IngestSpec } from "../ingestTypes.js";
import type { FeedState } from "../state.js";

export interface RetrieveResult {
  /** Projected records, keyed by primaryKey (the engine upserts them). */
  items: CollectionItem[];
  /** Updated retriever cursor to persist (incremental fetches). */
  cursor: Record<string, string>;
}

export type RetrieveFn = (ingest: IngestSpec, schema: CollectionSchema, state: FeedState) => Promise<RetrieveResult>;

const registry = new Map<string, RetrieveFn>();

export function registerRetriever(kind: string, retriever: RetrieveFn): void {
  registry.set(kind, retriever);
}

export function getRetriever(kind: string): RetrieveFn | undefined {
  return registry.get(kind);
}
