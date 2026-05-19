// `query` handler — read obligations and their cycles for the LLM.
//
// Range modes: "current" → latest cycle only; "all" → every cycle on
// disk; positive integer N → last N cycles.

import { z } from "zod";
import path from "node:path";

import type { EncoreDsl } from "../../../src/types/encore-dsl/schema.js";
import { parseCycleFile, type CycleState } from "../cycle.js";
import { parseIndexFile } from "../obligation.js";
import { isCycleClosed } from "../closure.js";
import { obligationDir, obligationIndexPath, OBLIGATIONS_DIRNAME } from "../paths.js";
import { readDir, readDirSubdirs, readTextOrNull } from "../../utils/files/encore-io.js";
import { log } from "../../system/logger/index.js";
import { EncoreError, workspaceRelativePath, type EncoreDispatchResult } from "./shared.js";

export const QueryArgs = z.object({
  kind: z.literal("query"),
  obligationId: z.string().optional(),
  range: z.union([z.literal("current"), z.literal("all"), z.number().int().positive()]).optional(),
  targetId: z.string().optional(),
});

interface QueryCycleResult {
  cycleId: string;
  path: string;
  state: CycleState;
  body: string;
}

interface QueryObligationResult {
  obligationId: string;
  indexPath: string;
  dsl: EncoreDsl;
  body: string;
  cycles: QueryCycleResult[];
}

export async function handleQuery(args: z.infer<typeof QueryArgs>): Promise<EncoreDispatchResult> {
  const range = args.range ?? "current";
  const obligationIds = args.obligationId ? [args.obligationId] : (await readDirSubdirs(OBLIGATIONS_DIRNAME)).sort();
  const targetedById = args.obligationId !== undefined;

  const results: QueryObligationResult[] = [];
  for (const obligationId of obligationIds) {
    const loaded = await loadObligationForQuery(obligationId, targetedById);
    if (!loaded) continue;
    loaded.cycles = await readCyclesForObligation(obligationId, range);
    results.push(loaded);
  }

  return {
    ok: true,
    message: queryMessage(results, range),
    obligations: results,
  };
}

/** Load one obligation's index for the query handler. Returns null
 *  when the file is missing or corrupt under a non-targeted query
 *  (so the outer loop can continue with the other obligations); a
 *  targeted query (`args.obligationId` present) throws so the caller
 *  knows the named record is unreadable. Pulled out of `handleQuery`
 *  to keep that function under the cognitive-complexity threshold. */
async function loadObligationForQuery(obligationId: string, targetedById: boolean): Promise<QueryObligationResult | null> {
  const indexRel = obligationIndexPath(obligationId);
  const indexRaw = await readTextOrNull(indexRel);
  if (indexRaw === null) {
    if (targetedById) throw new EncoreError(404, `obligation ${JSON.stringify(obligationId)} not found`);
    return null;
  }
  // Tolerate a single corrupt index when listing every obligation
  // — same shape as the cycle-file skip in readCyclesForObligation.
  try {
    const { dsl, body } = parseIndexFile(indexRaw);
    return { obligationId, indexPath: workspaceRelativePath(indexRel), dsl, body, cycles: [] };
  } catch (err) {
    if (targetedById) {
      throw new EncoreError(500, `obligation ${JSON.stringify(obligationId)} index is unparseable`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    log.warn("encore", "query: skipping unparseable obligation index", {
      obligationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function readCyclesForObligation(obligationId: string, range: "current" | "all" | number): Promise<QueryCycleResult[]> {
  const entries = await readDir(obligationDir(obligationId));
  const cycleFiles = entries.filter((name) => name !== "index.md" && name.endsWith(".md")).sort();
  // Sorted ascending; the most recent cycle is the last entry. For
  // "current" we return the single latest open cycle (or the latest
  // entry if none are open); for "all" we return everything; for a
  // numeric range we return the last N entries.
  const slice = range === "all" ? cycleFiles : cycleFiles.slice(-(range === "current" ? 1 : range));
  const out: QueryCycleResult[] = [];
  for (const filename of slice) {
    const rel = path.join(obligationDir(obligationId), filename);
    const raw = await readTextOrNull(rel);
    if (raw === null) continue;
    try {
      const parsed = parseCycleFile(raw);
      out.push({
        cycleId: filename.replace(/\.md$/, ""),
        path: workspaceRelativePath(rel),
        state: parsed.state,
        body: parsed.body,
      });
    } catch (err) {
      log.warn("encore", "query: skipping unparsable cycle file", {
        obligationId,
        filename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

function queryMessage(results: QueryObligationResult[], range: "current" | "all" | number): string {
  if (results.length === 0) {
    return "Encore: no obligations found.";
  }
  const lines: string[] = [];
  const rangeLabel = typeof range === "number" ? `last ${range}` : range;
  for (const result of results) {
    lines.push(`- ${result.dsl.displayName} (${result.obligationId}, status: ${result.dsl.status}): ${result.cycles.length} cycle(s) in ${rangeLabel}`);
    for (const cycle of result.cycles) {
      const status = isCycleClosed(cycle.state, result.dsl) ? "closed" : "open";
      lines.push(`  - ${cycle.cycleId} [${status}] start=${cycle.state.cycleStart} deadline=${cycle.state.cycleDeadline} path=${cycle.path}`);
    }
  }
  return lines.join("\n");
}
