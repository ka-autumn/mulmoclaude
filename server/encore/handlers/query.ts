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

  // List of obligations to inspect: either the named one, or all of
  // them (when no obligationId is passed).
  let obligationIds: string[];
  if (args.obligationId) {
    obligationIds = [args.obligationId];
  } else {
    obligationIds = (await readDirSubdirs(OBLIGATIONS_DIRNAME)).sort();
  }

  const results: QueryObligationResult[] = [];
  for (const obligationId of obligationIds) {
    const indexRel = obligationIndexPath(obligationId);
    const indexRaw = await readTextOrNull(indexRel);
    if (indexRaw === null) {
      if (args.obligationId) {
        throw new EncoreError(404, `obligation ${JSON.stringify(obligationId)} not found`);
      }
      continue;
    }
    const { dsl, body } = parseIndexFile(indexRaw);
    const cycles = await readCyclesForObligation(obligationId, range);
    results.push({
      obligationId,
      indexPath: workspaceRelativePath(indexRel),
      dsl,
      body,
      cycles,
    });
  }

  return {
    ok: true,
    message: queryMessage(results, range),
    obligations: results,
  };
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
